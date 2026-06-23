from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import logging
import time
from typing import Any

import httpx
import jwt
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


def _active_workspace_for_user(user_id: str) -> tuple[str, str]:
    settings = get_settings()
    if not settings.database_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="DATABASE_URL is required for workspace authorization",
        )

    try:
        import psycopg

        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                conn = psycopg.connect(settings.database_url, connect_timeout=10)
                break
            except psycopg.OperationalError as exc:
                last_exc = exc
                if attempt == 2:
                    raise
                time.sleep(0.5 * (attempt + 1))
        else:
            raise last_exc or RuntimeError("Could not connect to database")

        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
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
                    """,
                    (user_id,),
                )
                row = cur.fetchone()
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
