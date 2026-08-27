"""Included under a prefix the scanner cannot read, so these routes are
reported exactly as written, with confidence lowered rather than guessed."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/reports")
def list_reports():
    return []
