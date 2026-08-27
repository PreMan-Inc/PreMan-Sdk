"""Pins that a dotted target names one router: multi.router_a is mounted under
/api and multi.router_b is left alone."""

from fastapi import FastAPI

from .routers import multi

app = FastAPI()

app.include_router(multi.router_a, prefix="/api")


@app.get("/health")
def health():
    return {"ok": True}
