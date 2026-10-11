"""Demo mode: answer instantly from recordings instead of calling the live model.

Every successful live fridge scan and meal estimate is recorded. With demo mode on, the same
requests replay the latest recording, and planning and chat use the rule-based agents. Nothing
is invented: a replay is exactly what the live model returned earlier for the recorded photo.
"""

from __future__ import annotations

import base64
import logging
from dataclasses import dataclass

from pydantic import ValidationError

from app.inventory_ops import new_item_id
from app.repository import DEMO_PREFIX, Repository
from app.schemas import DemoState, MealEstimate, ScanResult

logger = logging.getLogger(__name__)

FLAG_KEY = f"{DEMO_PREFIX}on"
SCAN_KEY = f"{DEMO_PREFIX}scan"
SCAN_PHOTO_KEY = f"{DEMO_PREFIX}scan-photo"
SCAN_MIME_KEY = f"{DEMO_PREFIX}scan-mime"
MEAL_KEY = f"{DEMO_PREFIX}meal"
ON = "1"


@dataclass(frozen=True)
class Photo:
    data: bytes
    mime_type: str


def is_on(repository: Repository) -> bool:
    return repository.get_doc(FLAG_KEY) == ON


def set_on(repository: Repository, on: bool) -> None:
    repository.put_doc(FLAG_KEY, ON if on else "")


def record_scan(repository: Repository, result: ScanResult, photo: bytes, mime_type: str) -> None:
    repository.put_doc(SCAN_KEY, result.model_dump_json())
    repository.put_doc(SCAN_PHOTO_KEY, base64.b64encode(photo).decode("ascii"))
    repository.put_doc(SCAN_MIME_KEY, mime_type)


def recorded_scan(repository: Repository) -> ScanResult | None:
    """The latest recorded scan, with fresh item ids so a replay never collides with saved items."""
    raw = repository.get_doc(SCAN_KEY)
    if not raw:
        return None
    try:
        saved = ScanResult.model_validate_json(raw)
    except ValidationError:
        logger.warning("The recorded scan is unreadable.")
        return None
    new_ids = {item.id: new_item_id() for item in saved.items}
    return ScanResult(
        items=tuple(item.model_copy(update={"id": new_ids[item.id]}) for item in saved.items),
        boxes=tuple(
            box.model_copy(update={"item_id": new_ids[box.item_id]}) for box in saved.boxes if box.item_id in new_ids
        ),
        has_photo=bool(repository.get_doc(SCAN_PHOTO_KEY)),
    )


def recorded_photo(repository: Repository) -> Photo | None:
    encoded = repository.get_doc(SCAN_PHOTO_KEY)
    if not encoded:
        return None
    try:
        data = base64.b64decode(encoded, validate=True)
    except ValueError:
        return None
    return Photo(data=data, mime_type=repository.get_doc(SCAN_MIME_KEY) or "image/jpeg")


def record_meal(repository: Repository, estimate: MealEstimate) -> None:
    repository.put_doc(MEAL_KEY, estimate.model_dump_json())


def recorded_meal(repository: Repository) -> MealEstimate | None:
    raw = repository.get_doc(MEAL_KEY)
    if not raw:
        return None
    try:
        return MealEstimate.model_validate_json(raw)
    except ValidationError:
        return None


def state(repository: Repository) -> DemoState:
    return DemoState(
        on=is_on(repository),
        has_scan=bool(repository.get_doc(SCAN_KEY)),
        has_meal=bool(repository.get_doc(MEAL_KEY)),
    )
