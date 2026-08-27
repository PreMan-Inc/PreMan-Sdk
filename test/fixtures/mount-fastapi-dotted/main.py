"""Pins a dotted mount target: `from .routers import users` binds the module,
and include_router names the router as an attribute on it."""

from fastapi import FastAPI

from .routers import users

app = FastAPI()

app.include_router(users.router, prefix="/api/v1")


@app.get("/health")
def health():
    return {"ok": True}
