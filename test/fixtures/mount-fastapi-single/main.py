"""Pins a single-level include_router mount: the included router picks up
/api/v1, while this file's own route keeps the path it was written with."""

from fastapi import FastAPI

from .routers.users import router as users_router

app = FastAPI()

app.include_router(users_router, prefix="/api/v1")


@app.get("/health")
def health():
    return {"ok": True}
