"""Two routers in one module. Only router_a is included with a prefix, so only
its routes may be prefixed; router_b's route stays exactly as written."""

from fastapi import APIRouter

router_a = APIRouter()

router_b = APIRouter()


@router_a.get("/alpha")
def alpha():
    return {}


@router_b.get("/beta")
def beta():
    return {}
