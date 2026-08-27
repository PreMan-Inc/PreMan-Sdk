"""Pins that a bare target imported by name mounts that router and no other. The
import clause names router_a, so /api reaches its route and never router_b's."""

from fastapi import FastAPI

from .routers.multi import router_a

app = FastAPI()

app.include_router(router_a, prefix="/api")


@app.get("/health")
def health():
    return {"ok": True}
