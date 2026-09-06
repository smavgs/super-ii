"""Provision the independent policy identity, storing secrets only in Keychain.

Run with the runtime venv after applying migration 0017. Reuses existing effects.
The web/runtime database owner remains the administrative trust root; the policy
login receives only the restricted superii_policy role, never owner membership.
"""

from __future__ import annotations

import base64
import json
import secrets
import subprocess

import psycopg
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from superii_runtime.publication_policy import POLICY_SHA256

ACCOUNT = "superii.site"
LOGIN = "superii_policy_service"


def read_secret(service: str) -> str | None:
    result = subprocess.run(
        ["security", "find-generic-password", "-w", "-s", service, "-a", ACCOUNT],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode == 44:
        return None
    if result.returncode:
        raise RuntimeError(f"Keychain could not read {service}; no secret was changed")
    return result.stdout.strip()


def save_secret(service: str, value: str) -> None:
    result = subprocess.run(
        [
            "security",
            "add-generic-password",
            "-U",
            "-s",
            service,
            "-a",
            ACCOUNT,
            "-w",
            value,
        ],
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(f"Keychain could not save {service}")


def main() -> None:
    owner = read_secret("superii-runtime-database-url")
    if not owner:
        raise RuntimeError("Existing runtime database credential is required")
    policy_url = read_secret("superii-policy-database-url")
    if not policy_url:
        password = secrets.token_urlsafe(48)
        values = conninfo_to_dict(owner)
        values.update(user=LOGIN, password=password)
        policy_url = make_conninfo(**values)
        # Persist before CREATE ROLE so a retried call uses the same credential.
        save_secret("superii-policy-database-url", policy_url)
    values = conninfo_to_dict(policy_url)
    if values.get("user") != LOGIN:
        raise RuntimeError("Policy credential must use the dedicated login")
    key_text = read_secret("superii-policy-signing-key")
    if not key_text:
        key_text = base64.b64encode(
            Ed25519PrivateKey.generate().private_bytes_raw()
        ).decode()
        save_secret("superii-policy-signing-key", key_text)
    key = Ed25519PrivateKey.from_private_bytes(
        base64.b64decode(key_text, validate=True)
    )
    public_key = base64.b64encode(key.public_key().public_bytes_raw()).decode()
    key_id = "superii-publication-v1-" + POLICY_SHA256[:12]
    token = read_secret("superii-policy-token")
    if not token:
        token = secrets.token_urlsafe(48)
        save_secret("superii-policy-token", token)
    if len(token) < 32:
        raise RuntimeError("Existing policy token does not meet the length requirement")
    with psycopg.connect(owner, connect_timeout=15) as conn:
        if not conn.execute("select to_regclass('app.publication_keys')").fetchone()[0]:
            raise RuntimeError("Apply migration 0017 first")
        role = conn.execute(
            "select 1 from pg_roles where rolname=%s", (LOGIN,)
        ).fetchone()
        if not role:
            conn.execute(
                sql.SQL(
                    "create role {} login password {} nosuperuser nocreatedb "
                    "nocreaterole noreplication nobypassrls"
                ).format(sql.Identifier(LOGIN), sql.Literal(values["password"]))
            )
        conn.execute(
            sql.SQL("grant superii_policy to {}").format(sql.Identifier(LOGIN))
        )
        conn.execute(
            "insert into app.publication_keys(id,public_key,policy_sha256) "
            "values (%s,%s,%s) on conflict(id) do nothing",
            (key_id, public_key, POLICY_SHA256),
        )
        registered = conn.execute(
            "select public_key,policy_sha256,enabled "
            "from app.publication_keys where id=%s",
            (key_id,),
        ).fetchone()
        if registered != (public_key, POLICY_SHA256, True):
            raise RuntimeError(
                "Existing policy identity differs or is disabled; refusing replacement"
            )
    with psycopg.connect(policy_url, connect_timeout=15) as conn:
        flags = conn.execute(
            "select rolsuper,rolcreatedb,rolcreaterole,rolbypassrls "
            "from pg_roles where rolname=current_user"
        ).fetchone()
        if any(flags):
            raise RuntimeError("Policy login has excessive administrative privileges")
        readable = conn.execute(
            "select public_key from app.publication_keys where id=%s", (key_id,)
        ).fetchone()
        if not readable or readable[0] != public_key:
            raise RuntimeError("Policy login cannot read its verified trust record")
        if conn.execute(
            "select has_table_privilege(current_user, 'app.publication_keys', 'UPDATE')"
        ).fetchone()[0]:
            raise RuntimeError("Policy login must not be able to alter signing trust")
    save_secret("superii-policy-key-id", key_id)
    print(
        json.dumps(
            {
                "configured": True,
                "key_id": key_id,
                "public_key": public_key,
                "policy_sha256": POLICY_SHA256,
                "secrets": "macOS Keychain",
                "restricted_role_verified": True,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except psycopg.Error as error:
        # Database errors can contain DSNs or SQL literals; never echo them.
        raise SystemExit(
            f"Database operation failed ({type(error).__name__}); secrets omitted"
        ) from None
