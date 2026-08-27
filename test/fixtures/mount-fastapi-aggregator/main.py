"""`from .routers import api_router` names the package's own module, so resolution has
to reach routers/__init__.py and then follow the include one hop further to
routers/users.py. Stopping at either end reports /users without /api/v1."""

from fastapi import FastAPI

from .routers import api_router

app = FastAPI()

app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
def health():
    return {"ok": True}
