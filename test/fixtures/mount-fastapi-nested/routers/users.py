"""Two mounts above this file: v1.py includes it at /users and main.py includes
v1 at /api, so these routes really answer under /api/users."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/profile")
def profile():
    return {}


@router.post("/invite")
def invite():
    return {}
