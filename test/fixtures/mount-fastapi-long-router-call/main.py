"""Includes the long-form router under a second prefix, so both the router's own
prefix and the mount's have to survive to reach /api/catalog/items."""

from fastapi import FastAPI

from .routers import catalog

app = FastAPI()

app.include_router(catalog.router, prefix="/api")


@app.get("/health")
def health():
    return {"ok": True}
