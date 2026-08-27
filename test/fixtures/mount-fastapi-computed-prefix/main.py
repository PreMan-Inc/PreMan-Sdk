"""A concatenated include_router prefix. It opens with a readable literal and states
a computed value, so reading '/api/' alone reports a path the server has nothing at."""

from fastapi import FastAPI

from .routers import audit, reports

VERSION = "v1"

app = FastAPI()

app.include_router(reports.router, prefix="/api/" + VERSION)

app.include_router(audit.router)


@app.get("/health")
def health():
    return {"ok": True}
