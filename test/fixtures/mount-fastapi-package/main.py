"""Pins package-shaped resolution: `.routers` is a directory holding users.py,
not a module holding a name `users`, and the mount must find users.py."""

from fastapi import FastAPI

from .routers import users

app = FastAPI()

app.include_router(users.router, prefix="/api/v2")


@app.get("/health")
def health():
    return {"ok": True}
