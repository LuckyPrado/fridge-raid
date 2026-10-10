"""Persistence for inventory and weekly raid stats.

One SQL implementation serves both Tiger Data (Postgres) and the local SQLite fallback.
On Postgres with TimescaleDB, raid_stats becomes a hypertable so history queries stay fast.
"""

from __future__ import annotations

import logging
import sqlite3
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Protocol, Sequence

from app.schemas import CATEGORIES, InventoryItem, RaidStat

logger = logging.getLogger(__name__)

DEFAULT_STATS_LIMIT = 52

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


class Repository(Protocol):
    name: str

    def list_items(self) -> list[InventoryItem]: ...

    def replace_items(self, items: Sequence[InventoryItem]) -> None: ...

    def add_stat(self, stat: RaidStat) -> None: ...

    def list_stats(self, limit: int = DEFAULT_STATS_LIMIT) -> list[RaidStat]: ...


class SqlRepository:
    def __init__(self, name: str, connect: Callable[[], Any], placeholder: str, ts_type: str) -> None:
        self.name = name
        self._connect = connect
        self._ph = placeholder
        self._ts_type = ts_type

    def init_schema(self, hypertable: bool = False) -> None:
        with closing(self._connect()) as conn:
            cursor = conn.cursor()
            cursor.execute(_INVENTORY_DDL)
            cursor.execute(_STATS_DDL.format(ts_type=self._ts_type))
            conn.commit()
            if hypertable:
                self._try_hypertable(conn)

    def _try_hypertable(self, conn: Any) -> None:
        try:
            conn.cursor().execute("SELECT create_hypertable('raid_stats', 'ts', if_not_exists => TRUE)")
            conn.commit()
        except Exception:  # extension missing or table already populated
            conn.rollback()
            logger.warning("Could not create hypertable for raid_stats; using a plain table.", exc_info=True)

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
        with closing(self._connect()) as conn:
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
        with closing(self._connect()) as conn:
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
                ts=row[0].isoformat() if isinstance(row[0], datetime) else str(row[0]),
                meals=row[1],
                spend=row[2],
                waste_value_saved=row[3],
                items_rescued=row[4],
            )
            for row in reversed(rows)
        ]


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
