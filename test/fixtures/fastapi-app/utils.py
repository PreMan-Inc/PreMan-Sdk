"""Plain helpers. No web framework import, so this file declares no routes."""


def slugify(value: str) -> str:
    return value.strip().lower().replace(" ", "-")


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))
