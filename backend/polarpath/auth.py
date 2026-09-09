"""Authentication, roles and the audit trail.

Prototype scope, but not a pretend login. Passwords are stored as PBKDF2-SHA256
hashes with a per-user salt, never in clear; sessions are signed tokens carrying
their own expiry, so the server keeps no session table and a stolen token dies
on its own; and every sign-in and every route computed is written to an audit
trail, because a decision support system used by a government programme has to
be able to say who asked for what and when.

The signing key is generated on first run and kept out of the repository. A
deployment would take it from the environment instead.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

from fastapi import Header, HTTPException

from .config import ARTEFACT_DIR

TOKEN_TTL_SECONDS = 30 * 24 * 3600
PBKDF2_ROUNDS = 120_000
AUDIT_LIMIT = 400


# --------------------------------------------------------------- signing key

def _load_secret() -> bytes:
    """Signing key.

    Order of preference: an explicit ``POLARPATH_SECRET``, then a key file
    beside the artefacts, then a key derived from the deployment identity.

    The last case exists for read-only hosts such as serverless functions,
    where nothing can be written and every instance of one deployment has to
    agree on the key or a token minted by one would be rejected by the next.
    Deriving it from the immutable deployment id gives that agreement. Set
    POLARPATH_SECRET in production so sessions survive a redeploy.
    """
    env = os.environ.get("POLARPATH_SECRET")
    if env:
        return env.encode("utf-8")

    path = ARTEFACT_DIR / "session.key"
    if path.exists():
        return path.read_bytes()

    key = secrets.token_bytes(32)
    try:
        path.write_bytes(key)
        return key
    except OSError:
        pass

    stable = (
        os.environ.get("VERCEL_DEPLOYMENT_ID")
        or os.environ.get("VERCEL_GIT_COMMIT_SHA")
        or os.environ.get("RENDER_GIT_COMMIT")
    )
    if stable:
        return hashlib.sha256(f"polarpath::{stable}".encode("utf-8")).digest()
    return key


_SECRET = _load_secret()


# ---------------------------------------------------------------- passwords

def hash_password(password: str, salt: str | None = None) -> str:
    """PBKDF2-SHA256 digest, stored as ``salt$digest``."""
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"),
                                 salt.encode("utf-8"), PBKDF2_ROUNDS)
    return f"{salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    salt, _ = stored.split("$", 1)
    return hmac.compare_digest(hash_password(password, salt), stored)


# -------------------------------------------------------------------- roles

ROLES: dict[str, dict] = {
    "administrator": {
        "label": "Research Administrator",
        "description": "Full access, including the user register and the audit trail.",
        "views": ["overview", "operations", "skill", "benchmark", "method", "admin"],
    },
    "analyst": {
        "label": "Forecast Analyst",
        "description": "Forecasts, model skill and voyage analysis. No user administration.",
        "views": ["overview", "operations", "skill", "benchmark", "method"],
    },
    "master": {
        "label": "Vessel Master",
        "description": "Passage planning and the method reference, as carried on the bridge.",
        "views": ["overview", "operations", "method"],
    },
}


@dataclass
class User:
    email: str
    name: str
    role: str
    organisation: str
    password_hash: str = field(repr=False, default="")

    def public(self) -> dict:
        d = asdict(self)
        d.pop("password_hash", None)
        d["role_label"] = ROLES[self.role]["label"]
        d["views"] = ROLES[self.role]["views"]
        return d


# Seeded register. Credentials are printed at start-up so a reviewer can sign in
# without hunting through the source.
SEED = [
    ("admin@ncpor.gov.in", "PolarPath@2026", "Dr A. Raghunathan", "administrator",
     "National Centre for Polar and Ocean Research"),
    ("analyst@ncpor.gov.in", "Analyst@2026", "S. Menon", "analyst",
     "NCPOR Sea Ice and Climate Group"),
    ("master@isea.in", "Master@2026", "Capt. V. Deshmukh", "master",
     "Indian Scientific Expedition to Antarctica"),
]

USERS: dict[str, User] = {
    email: User(email=email, name=name, role=role, organisation=org,
                password_hash=hash_password(password))
    for email, password, name, role, org in SEED
}

DEMO_CREDENTIALS = [
    {"email": email, "password": password, "role": role,
     "role_label": ROLES[role]["label"], "name": name}
    for email, password, name, role, _ in SEED
]


# ------------------------------------------------------------------- tokens

def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def issue_token(user: User) -> str:
    payload = {"sub": user.email, "role": user.role,
               "exp": int(time.time()) + TOKEN_TTL_SECONDS}
    body = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(_SECRET, body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_b64(signature)}"


def decode_token(token: str) -> dict | None:
    try:
        body, signature = token.split(".", 1)
    except ValueError:
        return None
    expected = hmac.new(_SECRET, body.encode("ascii"), hashlib.sha256).digest()
    if not hmac.compare_digest(_unb64(signature), expected):
        return None
    try:
        payload = json.loads(_unb64(body))
    except (ValueError, json.JSONDecodeError):
        return None
    if payload.get("exp", 0) < time.time():
        return None
    return payload


def authenticate(email: str, password: str) -> User | None:
    user = USERS.get(email.strip().lower())
    if user is None:
        # Run the hash anyway so a missing address and a wrong password take the
        # same time to answer.
        hash_password(password)
        return None
    return user if verify_password(password, user.password_hash) else None


# ---------------------------------------------------------------- audit log

_audit: deque[dict] = deque(maxlen=AUDIT_LIMIT)
_audit_lock = threading.Lock()


def record(action: str, actor: str, detail: str = "", outcome: str = "ok") -> None:
    entry = {
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "action": action,
        "actor": actor,
        "detail": detail,
        "outcome": outcome,
    }
    with _audit_lock:
        _audit.append(entry)


def audit_trail(limit: int = 120) -> list[dict]:
    with _audit_lock:
        return list(_audit)[-limit:][::-1]


# ------------------------------------------------------------- dependencies

def require_user(authorization: str | None = Header(default=None)) -> User:
    """FastAPI dependency: resolve the bearer token to a signed-in user."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "sign in required")
    payload = decode_token(authorization.split(" ", 1)[1].strip())
    if payload is None:
        raise HTTPException(401, "session expired, sign in again")
    user = USERS.get(payload["sub"])
    if user is None:
        raise HTTPException(401, "account no longer exists")
    return user


def require_admin(authorization: str | None = Header(default=None)) -> User:
    user = require_user(authorization)
    if user.role != "administrator":
        raise HTTPException(403, "administrator access required")
    return user


def banner() -> str:
    lines = ["", "  Seeded accounts for this prototype:"]
    for c in DEMO_CREDENTIALS:
        lines.append(f"    {c['email']:<26} {c['password']:<16} {c['role_label']}")
    lines.append("")
    return "\n".join(lines)
