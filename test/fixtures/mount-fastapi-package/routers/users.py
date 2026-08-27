"""The module `from .routers import users` must resolve to."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/users")
def list_users():
    return []
