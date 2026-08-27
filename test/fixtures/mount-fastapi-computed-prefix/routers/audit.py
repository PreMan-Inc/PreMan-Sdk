"""A router whose own constructor states a prefix nobody can read. Reading it as
absent would put /events at the site root, at full confidence and with nothing
anywhere saying so."""

from fastapi import APIRouter

AUDIT_PREFIX = "/audit"

router = APIRouter(prefix=AUDIT_PREFIX)


@router.get("/events")
def events():
    return []
