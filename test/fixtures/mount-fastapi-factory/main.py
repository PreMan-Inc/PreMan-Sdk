"""FastAPI's own application-factory idiom, plus a router built under an `if`.

Two headers sit on the line above a binding here: the `-> FastAPI:` return annotation
of create_app, and the `if ENABLE_LEGACY:` clause. Neither may be read as the start of
the assignment below it — doing so captured a receiver named FastAPI or ENABLE_LEGACY
and left the real app and router carrying nothing at all."""

from fastapi import APIRouter, FastAPI

from .routers import users

ENABLE_LEGACY = True

if ENABLE_LEGACY:
    legacy_router = APIRouter()

    @legacy_router.get("/ping")
    def ping():
        return {"ok": True}


def create_app() -> FastAPI:
    app = FastAPI()
    app.include_router(users.router, prefix="/api")
    app.include_router(legacy_router, prefix="/legacy")

    @app.get("/health")
    def health():
        return {"ok": True}

    return app
