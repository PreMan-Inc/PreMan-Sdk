"""User routes hanging off an APIRouter with a prefix."""

from fastapi import APIRouter

router = APIRouter(prefix="/api/v1", tags=["users"])


@router.get("/users")
def list_users():
    return []


@router.get("/users/{user_id}")
def get_user(user_id: str):
    return {"id": user_id}


@router.delete("/users/{user_id}")
def delete_user(user_id: str):
    return None
