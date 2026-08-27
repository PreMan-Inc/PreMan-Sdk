"""The middle link: includes a router and is itself included, so the prefix
chain has to be walked two levels rather than one."""

from fastapi import APIRouter

from .routers.users import router as users_router

router = APIRouter()

router.include_router(users_router, prefix="/users")
