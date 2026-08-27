"""The aggregator FastAPI projects keep in routers/__init__.py: one router that
includes the package's modules, which the app then mounts under a single name."""

from fastapi import APIRouter

from .users import router as users_router

api_router = APIRouter()

api_router.include_router(users_router)
