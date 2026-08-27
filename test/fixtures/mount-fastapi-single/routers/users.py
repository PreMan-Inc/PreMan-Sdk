"""A router declared here and included elsewhere. main.py gives it /api/v1, so
the paths written below are not the paths the server answers on."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/users")
def list_users():
    return []


@router.get("/users/{user_id}")
def get_user(user_id: str):
    return {"id": user_id}
