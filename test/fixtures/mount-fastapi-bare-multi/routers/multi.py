"""Two routers in one module, one route each. Only router_a is included, so only
its route may be prefixed; router_b's route stays exactly as written."""

from fastapi import APIRouter

router_a = APIRouter()

router_b = APIRouter()


@router_a.get("/alpha")
def alpha():
    return {}


@router_b.get("/beta")
def beta():
    return {}
