"""Pydantic models. The scanner ignores these today; issue #40 will read them."""

from typing import Optional

from pydantic import BaseModel


class User(BaseModel):
    id: str
    email: str
    name: Optional[str] = None


class UserCreate(BaseModel):
    email: str
    name: Optional[str] = None


class Item(BaseModel):
    id: int
    title: str
    price: float
