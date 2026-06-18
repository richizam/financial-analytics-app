from __future__ import annotations

from fastapi import Header, HTTPException, status

from .config import get_settings


def require_backend_api_key(x_backend_api_key: str | None = Header(default=None)) -> None:
    settings = get_settings()
    if not settings.api_key_required:
        return

    if x_backend_api_key != settings.backend_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid backend API key",
        )
