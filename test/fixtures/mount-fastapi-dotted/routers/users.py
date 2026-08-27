"""Reached as an attribute of the imported module: main.py includes
users.router, the layout FastAPI's own docs teach."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/users")
def list_users():
    return []
