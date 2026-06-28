from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import logging
import time
from typing import Any

import httpx
import jwt
import psycopg
from fastapi import Header, HTTPException, status
from jwt import InvalidTokenError, PyJWKClient
from jwt.exceptions import PyJWKClientError

from .config import get_settings


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AuthenticatedUser:
    user_id: str
    email: str | None
    workspace_id: str
    workspace_role: str


@dataclass(frozen=True)
class _WorkspaceCacheEntry:
    workspace_id: str
    workspace_role: str
    expires_at: float


_workspace_auth_cache: dict[str, _WorkspaceCacheEntry] = {}


def require_backend_api_key(x_backend_api_key: str | None = Header(default=None)) -> None:
    settings = get_settings()
    if not settings.api_key_required:
        return

    if x_backend_api_key != settings.backend_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid backend API key",
        )


@lru_cache(maxsize=8)
def _jwks_client(jwks_url: str) -> PyJWKClient:
    return PyJWKClient(jwks_url, timeout=3)


def _bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Supabase access token",
        )
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization header",
        )
    return token.strip()


def _verify_with_jwks(token: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        signing_key = _jwks_client(settings.supabase_jwks_url).get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "ES256", "EdDSA"],
            audience="authenticated",
            issuer=settings.supabase_auth_issuer,
        )
    except (InvalidTokenError, PyJWKClientError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Supabase access token",
        ) from exc


def _verify_with_auth_server(token: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        response = httpx.get(
            f"{settings.supabase_auth_issuer}/user",
            headers={
                "apikey": str(settings.supabase_publishable_key),
                "Authorization": f"Bearer {token}",
            },
            timeout=10,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not validate Supabase token",
        ) from exc
    if response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Supabase access token",
        )
    data = response.json()
    return {
        "sub": data.get("id"),
        "email": data.get("email"),
        "role": "authenticated",
        "aud": "authenticated",
    }


def _verified_claims(token: str) -> dict[str, Any]:
    settings = get_settings()
    if not settings.supabase_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase auth is not configured",
        )
    try:
        algorithm = str(jwt.get_unverified_header(token).get("alg", ""))
    except InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Supabase access token",
        ) from exc
    if algorithm.startswith("HS"):
        return _verify_with_auth_server(token)
    try:
        return _verify_with_jwks(token)
    except HTTPException:
        return _verify_with_auth_server(token)


_ACTIVE_WORKSPACE_QUERY = """
    select wm.workspace_id::text, wm.role
    from public.workspace_members wm
    join public.workspaces w on w.id = wm.workspace_id
    where wm.user_id = %s
      and w.status in ('trialing', 'active')
    order by
      case wm.role
        when 'owner' then 1
        when 'admin' then 2
        when 'member' then 3
        else 4
      end,
      wm.created_at asc
    limit 1
"""

# Error text that marks a pooled connection the Supabase pooler dropped while
# idle (vs. a genuine error like a bad password). On these we retry with a fresh
# pooled connection instead of failing the request with a 503.
_DROPPED_CONNECTION_MARKERS = (
    "ssl error",
    "unexpected eof",
    "server closed",
    "connection is closed",
    "consuming input failed",
    "bad connection",
    "terminating connection",
    "eof detected",
)


def _is_dropped_connection(exc: Exception) -> bool:
    if not isinstance(exc, psycopg.OperationalError):
        return False
    text = str(exc).lower()
    return any(marker in text for marker in _DROPPED_CONNECTION_MARKERS)


def _fetch_active_workspace_row(database_url: str, user_id: str) -> tuple[str, str] | None:
    from backend.app.storage.postgres import discard_request_connection, request_connection

    last_exc: psycopg.OperationalError | None = None
    # The pool validates a connection before lending it (check=), but a
    # connection can still be dropped between validation and use; retry so a
    # stale connection becomes a transparent recovery instead of a 503. Uses the
    # request-scoped connection when one is active, so this single validated
    # borrow is then reused by the rest of the request's queries.
    for _ in range(3):
        try:
            with request_connection(database_url) as conn:
                with conn.cursor() as cur:
                    cur.execute(_ACTIVE_WORKSPACE_QUERY, (user_id,))
                    return cur.fetchone()
        except psycopg.OperationalError as exc:
            if not _is_dropped_connection(exc):
                raise
            last_exc = exc
            # Drop the broken request connection so the retry borrows a fresh,
            # validated one (and the rest of the request reuses that).
            discard_request_connection(database_url)
            logger.warning("Workspace lookup hit a dropped DB connection; retrying")
    raise last_exc if last_exc is not None else RuntimeError("Workspace lookup failed")


def _resolve_active_workspace_for_user(user_id: str) -> tuple[str, str]:
    settings = get_settings()
    if not settings.database_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="DATABASE_URL is required for workspace authorization",
        )

    try:
        row = _fetch_active_workspace_row(settings.database_url, user_id)
    except Exception as exc:
        logger.exception("Could not resolve workspace access for Supabase user %s", user_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not resolve workspace access",
        ) from exc

    if not row:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No active workspace for this user",
        )
    return str(row[0]), str(row[1])


def _prune_workspace_cache(now: float) -> None:
    expired = [user_id for user_id, entry in _workspace_auth_cache.items() if entry.expires_at <= now]
    for user_id in expired:
        _workspace_auth_cache.pop(user_id, None)
    if len(_workspace_auth_cache) > 2048:
        _workspace_auth_cache.clear()


def _active_workspace_for_user(user_id: str) -> tuple[str, str]:
    settings = get_settings()
    ttl = settings.workspace_auth_cache_ttl_seconds
    if ttl <= 0:
        return _resolve_active_workspace_for_user(user_id)

    now = time.monotonic()
    entry = _workspace_auth_cache.get(user_id)
    if entry and entry.expires_at > now:
        return entry.workspace_id, entry.workspace_role

    workspace_id, workspace_role = _resolve_active_workspace_for_user(user_id)
    _prune_workspace_cache(now)
    _workspace_auth_cache[user_id] = _WorkspaceCacheEntry(
        workspace_id=workspace_id,
        workspace_role=workspace_role,
        expires_at=now + ttl,
    )
    return workspace_id, workspace_role


def require_supabase_user(authorization: str | None = Header(default=None)) -> AuthenticatedUser:
    token = _bearer_token(authorization)
    claims = _verified_claims(token)
    user_id = str(claims.get("sub") or "")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Supabase token is missing a user id",
        )
    workspace_id, workspace_role = _active_workspace_for_user(user_id)
    email = claims.get("email")
    return AuthenticatedUser(
        user_id=user_id,
        email=str(email) if email else None,
        workspace_id=workspace_id,
        workspace_role=workspace_role,
    )
