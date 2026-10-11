"""Persistence for inventory, the food log, cooking stats, and small saved documents.

One SQL implementation serves both Tiger Data (Postgres) and the local SQLite fallback.
On Postgres with TimescaleDB, the time-series tables (raid_stats, food_log) become hypertables.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Protocol, Sequence

from app.schemas import CATEGORIES, InventoryItem, LogEntry, RaidStat

logger = logging.getLogger(__name__)

DEFAULT_STATS_LIMIT = 500
STREAK_LOOKBACK_DAYS = 120
HYPERTABLES = ("raid_stats", "food_log")
PLACES_CACHE_PREFIX = "places:"

_INVENTORY_DDL = """
CREATE TABLE IF NOT EXISTS inventory (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    quantity DOUBLE PRECISION NOT NULL,
    unit TEXT NOT NULL,
    expires_on TEXT NOT NULL
)
"""

_STATS_DDL = """
CREATE TABLE IF NOT EXISTS raid_stats (
    ts {ts_type} NOT NULL,
    meals INTEGER NOT NULL,
    spend DOUBLE PRECISION NOT NULL,
    waste_value_saved DOUBLE PRECISION NOT NULL,
    items_rescued INTEGER NOT NULL
)
"""

_LOG_DDL = """
CREATE TABLE IF NOT EXISTS food_log (
    ts {ts_type} NOT NULL,
    id TEXT NOT NULL,
    day TEXT NOT NULL,
    name TEXT NOT NULL,
    calories INTEGER NOT NULL,
    protein_g INTEGER NOT NULL,
    sodium_mg INTEGER NOT NULL,
    kind TEXT NOT NULL
)
"""

# Small JSON documents keyed by name: the profile, the current plan, water per day.
_DOCS_DDL = """
CREATE TABLE IF NOT EXISTS app_docs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
)
"""


class Repository(Protocol):
    name: str

    def list_items(self) -> list[InventoryItem]: ...

    def replace_items(self, items: Sequence[InventoryItem]) -> None: ...

    def add_stat(self, stat: RaidStat) -> None: ...

    def list_stats(self, limit: int = DEFAULT_STATS_LIMIT) -> list[RaidStat]: ...

    def add_log(self, entry: LogEntry) -> None: ...

    def list_log(self, day: str) -> list[LogEntry]: ...

    def logged_days(self, limit: int = STREAK_LOOKBACK_DAYS) -> list[str]: ...

    def get_doc(self, key: str) -> str | None: ...

    def put_doc(self, key: str, value: str) -> None: ...

    def reset(self) -> None: ...


class SqlRepository:
    def __init__(self, name: str, connect: Callable[[], Any], placeholder: str, ts_type: str) -> None:
        self.name = name
        self._connect = connect
        self._ph = placeholder
        self._ts_type = ts_type
        # Serializes writes: overlapping delete-then-insert collides on Postgres, and SQLite allows one writer.
        self._write_lock = threading.Lock()

    def init_schema(self, hypertable: bool = False) -> None:
        with closing(self._connect()) as conn:
            cursor = conn.cursor()
            cursor.execute(_INVENTORY_DDL)
            cursor.execute(_STATS_DDL.format(ts_type=self._ts_type))
            cursor.execute(_LOG_DDL.format(ts_type=self._ts_type))
            cursor.execute(_DOCS_DDL)
            conn.commit()
            if hypertable:
                for table in HYPERTABLES:
                    self._try_hypertable(conn, table)

    def _try_hypertable(self, conn: Any, table: str) -> None:
        try:
            conn.cursor().execute(
                f"SELECT create_hypertable({self._ph}::regclass, 'ts', if_not_exists => TRUE, migrate_data => TRUE)", (table,)
            )
            conn.commit()
        except Exception:  # extension missing
            conn.rollback()
            logger.warning("Could not create hypertable for %s; using a plain table.", table, exc_info=True)

    def list_items(self) -> list[InventoryItem]:
        today = date.today()
        with closing(self._connect()) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, name, category, quantity, unit, expires_on FROM inventory ORDER BY expires_on")
            rows = cursor.fetchall()
        return [
            InventoryItem(
                id=row[0],
                name=row[1],
                category=row[2] if row[2] in CATEGORIES else "other",
                quantity=row[3],
                unit=row[4],
                days_left=max(-30, min(3650, (date.fromisoformat(row[5]) - today).days)),
            )
            for row in rows
        ]

    def replace_items(self, items: Sequence[InventoryItem]) -> None:
        today = date.today()
        insert = (
            "INSERT INTO inventory (id, name, category, quantity, unit, expires_on) "
            f"VALUES ({', '.join([self._ph] * 6)})"
        )
        rows = [
            (i.id, i.name, i.category, i.quantity, i.unit, (today + timedelta(days=i.days_left)).isoformat())
            for i in items
        ]
        with self._write_lock, closing(self._connect()) as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM inventory")
            if rows:
                cursor.executemany(insert, rows)
            conn.commit()

    def add_stat(self, stat: RaidStat) -> None:
        insert = (
            "INSERT INTO raid_stats (ts, meals, spend, waste_value_saved, items_rescued) "
            f"VALUES ({', '.join([self._ph] * 5)})"
        )
        with self._write_lock, closing(self._connect()) as conn:
            conn.cursor().execute(
                insert, (stat.ts, stat.meals, stat.spend, stat.waste_value_saved, stat.items_rescued)
            )
            conn.commit()

    def list_stats(self, limit: int = DEFAULT_STATS_LIMIT) -> list[RaidStat]:
        query = (
            "SELECT ts, meals, spend, waste_value_saved, items_rescued FROM raid_stats "
            f"ORDER BY ts DESC LIMIT {self._ph}"
        )
        with closing(self._connect()) as conn:
            cursor = conn.cursor()
            cursor.execute(query, (limit,))
            rows = cursor.fetchall()
        return [
            RaidStat(
                ts=_iso(row[0]),
                meals=row[1],
                spend=row[2],
                waste_value_saved=row[3],
                items_rescued=row[4],
            )
            for row in reversed(rows)
        ]

    def add_log(self, entry: LogEntry) -> None:
        insert = (
            "INSERT INTO food_log (ts, id, day, name, calories, protein_g, sodium_mg, kind) "
            f"VALUES ({', '.join([self._ph] * 8)})"
        )
        row = (
            entry.ts, entry.id, entry.day, entry.name, entry.calories, entry.protein_g, entry.sodium_mg, entry.kind
        )
        with self._write_lock, closing(self._connect()) as conn:
            conn.cursor().execute(insert, row)
            conn.commit()

    def list_log(self, day: str) -> list[LogEntry]:
        query = (
            "SELECT ts, id, day, name, calories, protein_g, sodium_mg, kind FROM food_log "
            f"WHERE day = {self._ph} ORDER BY ts LIMIT 200"
        )
        with closing(self._connect()) as conn:
            cursor = conn.cursor()
            cursor.execute(query, (day,))
            rows = cursor.fetchall()
        return [
            LogEntry(
                ts=_iso(row[0]), id=row[1], day=row[2], name=row[3], calories=row[4], protein_g=row[5],
                sodium_mg=row[6], kind=row[7] if row[7] in ("meal", "manual") else "manual",
            )
            for row in rows
        ]

    def logged_days(self, limit: int = STREAK_LOOKBACK_DAYS) -> list[str]:
        """Distinct days with at least one log entry, newest first."""
        query = f"SELECT DISTINCT day FROM food_log ORDER BY day DESC LIMIT {self._ph}"
        with closing(self._connect()) as conn:
            cursor = conn.cursor()
            cursor.execute(query, (limit,))
            return [row[0] for row in cursor.fetchall()]

    def get_doc(self, key: str) -> str | None:
        with closing(self._connect()) as conn:
            cursor = conn.cursor()
            cursor.execute(f"SELECT value FROM app_docs WHERE key = {self._ph}", (key,))
            row = cursor.fetchone()
        return row[0] if row else None

    def put_doc(self, key: str, value: str) -> None:
        upsert = (
            f"INSERT INTO app_docs (key, value) VALUES ({self._ph}, {self._ph}) "
            "ON CONFLICT (key) DO UPDATE SET value = excluded.value"
        )
        with self._write_lock, closing(self._connect()) as conn:
            conn.cursor().execute(upsert, (key, value))
            conn.commit()


    def reset(self) -> None:
        """Erase everything the player has saved. Cached map lookups are kept, since they are not personal."""
        with self._write_lock, closing(self._connect()) as conn:
            cursor = conn.cursor()
            for table in ("inventory", "raid_stats", "food_log"):
                cursor.execute(f"DELETE FROM {table}")
            cursor.execute(f"DELETE FROM app_docs WHERE key NOT LIKE {self._ph}", (f"{PLACES_CACHE_PREFIX}%",))
            conn.commit()


def _iso(value: Any) -> str:
    return value.isoformat() if isinstance(value, datetime) else str(value)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sqlite_repository(path: Path) -> SqlRepository:
    repo = SqlRepository("sqlite", lambda: sqlite3.connect(path), placeholder="?", ts_type="TEXT")
    repo.init_schema()
    return repo


def postgres_repository(database_url: str) -> SqlRepository:
    import psycopg

    repo = SqlRepository(
        "tiger-data", lambda: psycopg.connect(database_url, connect_timeout=10), placeholder="%s",
        ts_type="TIMESTAMPTZ",
    )
    repo.init_schema(hypertable=True)
    return repo


def create_repository(database_url: str | None, sqlite_path: Path) -> SqlRepository:
    if database_url:
        try:
            return postgres_repository(database_url)
        except Exception:
            logger.exception("Could not connect to Postgres; falling back to local SQLite.")
    return sqlite_repository(sqlite_path)
