"""Real grocery stores near the player, from OpenStreetMap through the public Overpass API.

Only store names and positions are real. OpenStreetMap carries no prices, so deals stay sample data.
"""

from __future__ import annotations

import logging
import math
import re
from typing import Any, Awaitable, Callable, Sequence

import httpx

from app.schemas import StoreInfo

logger = logging.getLogger(__name__)

OVERPASS_URLS: tuple[str, ...] = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
)
USER_AGENT = "FridgeRaid/0.2 (HackRU student project)"
SEARCH_RADIUS_M = 4000
REQUEST_TIMEOUT_SECONDS = 12
MAX_ELEMENTS = 60
MAX_STORES = 5
EARTH_RADIUS_MI = 3958.8
WALK_MINUTES_PER_MILE = 20
SHOP_KINDS = "supermarket|convenience|greengrocer|grocery"

Fetch = Callable[[str, str], Awaitable[dict[str, Any]]]


class PlacesError(Exception):
    """No store data could be fetched."""


def overpass_query(lat: float, lon: float) -> str:
    return (
        f"[out:json][timeout:{REQUEST_TIMEOUT_SECONDS}];"
        f'(nwr["shop"~"^({SHOP_KINDS})$"]["name"](around:{SEARCH_RADIUS_M},{lat:.5f},{lon:.5f}););'
        f"out center {MAX_ELEMENTS};"
    )


def distance_miles(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    """Great-circle distance between two points."""
    phi_a, phi_b = math.radians(lat_a), math.radians(lat_b)
    half_dphi = math.radians(lat_b - lat_a) / 2
    half_dlambda = math.radians(lon_b - lon_a) / 2
    h = math.sin(half_dphi) ** 2 + math.cos(phi_a) * math.cos(phi_b) * math.sin(half_dlambda) ** 2
    return 2 * EARTH_RADIUS_MI * math.asin(math.sqrt(h))


def _position(element: dict[str, Any]) -> tuple[float, float] | None:
    center = element.get("center") or element
    lat, lon = center.get("lat"), center.get("lon")
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
        return float(lat), float(lon)
    return None


def _clean_name(raw: Any) -> str:
    return " ".join(str(raw or "").split())[:60]


def stores_from_elements(elements: Sequence[dict[str, Any]], lat: float, lon: float) -> tuple[StoreInfo, ...]:
    """Turn raw map elements into the nearest few distinct stores, supermarkets ahead of corner shops."""
    found: dict[str, tuple[bool, float, StoreInfo]] = {}
    for element in elements:
        tags = element.get("tags") or {}
        name = _clean_name(tags.get("name"))
        position = _position(element)
        if not name or position is None:
            continue
        miles = distance_miles(lat, lon, *position)
        info = StoreInfo(
            id=re.sub(r"[^a-z0-9]+", "-", f"osm-{element.get('type', 'n')}-{element.get('id', name)}".lower())[:40],
            name=name,
            neighborhood=_clean_name(tags.get("addr:city") or tags.get("addr:suburb")),
            distance_mi=round(miles, 1),
            walk_min=round(miles * WALK_MINUTES_PER_MILE),
            lat=position[0],
            lon=position[1],
        )
        is_corner_shop = tags.get("shop") == "convenience"
        key = name.lower()
        if key not in found or miles < found[key][1]:
            found[key] = (is_corner_shop, miles, info)
    ranked = sorted(found.values(), key=lambda entry: (entry[0], entry[1]))
    nearest = sorted(ranked[:MAX_STORES], key=lambda entry: entry[1])
    return tuple(entry[2] for entry in nearest)


async def _fetch(url: str, query: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS + 3, headers={"User-Agent": USER_AGENT}) as client:
        response = await client.post(url, data={"data": query})
        response.raise_for_status()
        return response.json()


async def find_stores(lat: float, lon: float, fetch: Fetch = _fetch) -> tuple[StoreInfo, ...]:
    """Nearest grocery stores to a point. Tries each Overpass server in turn."""
    query = overpass_query(lat, lon)
    for url in OVERPASS_URLS:
        try:
            payload = await fetch(url, query)
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("Store lookup failed on %s (%s).", url.split("/")[2], type(exc).__name__)
            continue
        elements = payload.get("elements") if isinstance(payload, dict) else None
        if isinstance(elements, list):
            return stores_from_elements(elements, lat, lon)
    raise PlacesError("No map server answered.")
