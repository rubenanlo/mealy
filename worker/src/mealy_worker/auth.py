"""Supabase JWT verification (Task 8).

Tokens are Supabase access tokens with audience ``authenticated``. Projects
on the new asymmetric signing keys issue ES256 tokens verified against the
project JWKS (env ``MEALY_SUPABASE_URL``); legacy HS256 tokens verify with
the shared secret (env ``SUPABASE_JWT_SECRET``). Everything except
``/health`` requires a valid token.
"""

from __future__ import annotations

import os

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

AUDIENCE = "authenticated"

_bearer = HTTPBearer(auto_error=False)
_jwks_client: jwt.PyJWKClient | None = None


def get_jwt_secret() -> str:
    secret = os.environ.get("SUPABASE_JWT_SECRET")
    if not secret:
        raise HTTPException(status_code=500, detail="SUPABASE_JWT_SECRET not configured")
    return secret


def _get_jwks_client() -> jwt.PyJWKClient:
    """Cached JWKS client; PyJWKClient caches the keys themselves too."""
    global _jwks_client
    if _jwks_client is None:
        base = os.environ.get("MEALY_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
        if not base:
            raise HTTPException(status_code=500, detail="MEALY_SUPABASE_URL not configured")
        _jwks_client = jwt.PyJWKClient(f"{base.rstrip('/')}/auth/v1/.well-known/jwks.json")
    return _jwks_client


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail="Invalid token",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def verify_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    """FastAPI dependency: returns the decoded claims or raises 401."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="Missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    try:
        alg = jwt.get_unverified_header(token).get("alg")
    except jwt.PyJWTError:
        raise _unauthorized()

    if alg == "HS256":
        try:
            return jwt.decode(token, get_jwt_secret(), algorithms=["HS256"], audience=AUDIENCE)
        except jwt.PyJWTError:
            raise _unauthorized()
    if alg == "ES256":
        try:
            key = _get_jwks_client().get_signing_key_from_jwt(token).key
            return jwt.decode(token, key, algorithms=["ES256"], audience=AUDIENCE)
        except jwt.PyJWTError:
            raise _unauthorized()
    raise _unauthorized()
