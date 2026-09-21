#!/usr/bin/env python3
"""Provision Super ii runtime logins without printing or committing secrets.

The schema migration creates NOLOGIN privilege bundles. This tool creates the
four stable LOGIN identities, stores their credentials and request-context keys
in macOS Keychain, and verifies that every login inherits exactly one bundle.
"""

from __future__ import annotations

import argparse
import json
import secrets
import subprocess
from dataclasses import dataclass
from urllib.parse import quote, unquote, urlsplit, urlunsplit

import psycopg
from psycopg import sql


ACCOUNT = "superii.site"
DEFAULT_NAMESPACE = "superii"


@dataclass(frozen=True)
class RoleSpec:
    purpose: str
    login: str
    bundle: str
    url_service: str
    context_key_service: str | None = None
    context_secret_service: str | None = None


def migration_service(namespace: str) -> str:
    return f"{namespace}-migration-database-url"


def role_specs(namespace: str) -> tuple[RoleSpec, ...]:
    return (
        RoleSpec(
            "web",
            "superii_web_service",
            "superii_web_backend",
            f"{namespace}-web-database-url",
            f"{namespace}-web-database-context-key-id",
            f"{namespace}-web-database-context-secret",
        ),
        RoleSpec(
            "payment",
            "superii_payment_service",
            "superii_payment_backend",
            f"{namespace}-payment-database-url",
            f"{namespace}-payment-database-context-key-id",
            f"{namespace}-payment-database-context-secret",
        ),
        RoleSpec(
            "publishing",
            "superii_publishing_service",
            "superii_publishing_backend",
            f"{namespace}-publishing-database-url",
            f"{namespace}-publishing-database-context-key-id",
            f"{namespace}-publishing-database-context-secret",
        ),
        RoleSpec(
            "runtime",
            "superii_runtime_service",
            "superii_runtime_backend",
            f"{namespace}-runtime-database-url",
        ),
    )


ROLE_SPECS = role_specs(DEFAULT_NAMESPACE)


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
        raise RuntimeError(f"Keychain could not read {service}; nothing was changed")
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


def login_url(owner_url: str, username: str, password: str) -> str:
    parsed = urlsplit(owner_url)
    if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname:
        raise RuntimeError("Migration credential must be a PostgreSQL URL")
    host = parsed.hostname
    if ":" in host:
        host = f"[{host}]"
    if parsed.port:
        host = f"{host}:{parsed.port}"
    netloc = f"{quote(username, safe='')}:{quote(password, safe='')}@{host}"
    return urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment))


def password_from_url(database_url: str, expected_user: str) -> str:
    parsed = urlsplit(database_url)
    if unquote(parsed.username or "") != expected_user or parsed.password is None:
        raise RuntimeError(f"Keychain credential for {expected_user} has an invalid identity")
    return unquote(parsed.password)


def role_exists(connection: psycopg.Connection[tuple], role_name: str) -> bool:
    return bool(
        connection.execute(
            "select 1 from pg_roles where rolname=%s", (role_name,)
        ).fetchone()
    )


def provision_login(
    connection: psycopg.Connection[tuple],
    spec: RoleSpec,
    password: str,
) -> None:
    if not role_exists(connection, spec.bundle):
        raise RuntimeError(f"Required privilege bundle {spec.bundle} is missing")
    if not role_exists(connection, spec.login):
        connection.execute(
            sql.SQL(
                "create role {} login inherit password {} nosuperuser nocreatedb "
                "nocreaterole noreplication nobypassrls"
            ).format(sql.Identifier(spec.login), sql.Literal(password))
        )
    else:
        connection.execute(
            sql.SQL(
                "alter role {} login inherit password {}"
            ).format(sql.Identifier(spec.login), sql.Literal(password))
        )

    memberships = connection.execute(
        """
        select parent.rolname
        from pg_auth_members membership
        join pg_roles child on child.oid = membership.member
        join pg_roles parent on parent.oid = membership.roleid
        where child.rolname = %s
        """,
        (spec.login,),
    ).fetchall()
    for (parent_role,) in memberships:
        if parent_role != spec.bundle:
            connection.execute(
                sql.SQL("revoke {} from {}").format(
                    sql.Identifier(parent_role), sql.Identifier(spec.login)
                )
            )

    for schema_name in ("app", "app_private"):
        connection.execute(
            sql.SQL("revoke all on schema {} from {}").format(
                sql.Identifier(schema_name), sql.Identifier(spec.login)
            )
        )
        for object_kind in ("tables", "sequences", "functions"):
            connection.execute(
                sql.SQL("revoke all on all {} in schema {} from {}").format(
                    sql.SQL(object_kind),
                    sql.Identifier(schema_name),
                    sql.Identifier(spec.login),
                )
            )

    connection.execute(
        sql.SQL("grant {} to {}").format(
            sql.Identifier(spec.bundle), sql.Identifier(spec.login)
        )
    )
    connection.execute(
        sql.SQL("alter role {} set statement_timeout = '15s'").format(
            sql.Identifier(spec.login)
        )
    )
    connection.execute(
        sql.SQL("alter role {} set idle_in_transaction_session_timeout = '15s'").format(
            sql.Identifier(spec.login)
        )
    )


def verify_login(database_url: str, spec: RoleSpec) -> None:
    with psycopg.connect(database_url, connect_timeout=15) as connection:
        flags = connection.execute(
            """
            select rolname, rolsuper, rolcreatedb, rolcreaterole,
                   rolreplication, rolbypassrls, rolinherit
            from pg_roles where rolname=current_user
            """
        ).fetchone()
        if flags != (spec.login, False, False, False, False, False, True):
            raise RuntimeError(f"{spec.login} has unsafe cluster capabilities")
        if not connection.execute(
            "select pg_has_role(current_user,%s,'member')", (spec.bundle,)
        ).fetchone()[0]:
            raise RuntimeError(f"{spec.login} does not inherit {spec.bundle}")
        if connection.execute(
            "select has_schema_privilege(current_user,'app_private','usage')"
        ).fetchone()[0]:
            raise RuntimeError(f"{spec.login} can access private security state")

        expected = {
            "web": ("app.repositories", "SELECT", True),
            "payment": ("app.payment_orders", "SELECT", True),
            "publishing": ("app.trusted_publishers", "SELECT", True),
            "runtime": ("app.repository_files", "SELECT", True),
        }[spec.purpose]
        if connection.execute(
            "select has_table_privilege(current_user,%s,%s)", expected[:2]
        ).fetchone()[0] is not expected[2]:
            raise RuntimeError(f"{spec.login} is missing its required table boundary")

        forbidden_table = {
            "web": "app.publication_decisions",
            "payment": "app.agent_access_tokens",
            "publishing": "app.payment_orders",
            "runtime": "app.payment_orders",
        }[spec.purpose]
        forbidden_privilege = "INSERT" if spec.purpose == "web" else "SELECT"
        if connection.execute(
            "select has_table_privilege(current_user,%s,%s)",
            (forbidden_table, forbidden_privilege),
        ).fetchone()[0]:
            raise RuntimeError(f"{spec.login} crosses a forbidden table boundary")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--namespace",
        default=DEFAULT_NAMESPACE,
        help="Keychain service prefix; use a distinct value for test branches",
    )
    parser.add_argument(
        "--bootstrap-owner-from-runtime",
        action="store_true",
        help="one-time migration of the pre-cutover owner URL into its dedicated Keychain item",
    )
    args = parser.parse_args()

    if not args.namespace or any(
        character not in "abcdefghijklmnopqrstuvwxyz0123456789-"
        for character in args.namespace
    ):
        raise RuntimeError("Keychain namespace must contain only lowercase letters, digits, and hyphens")

    specs = role_specs(args.namespace)
    owner_service = migration_service(args.namespace)

    owner_url = read_secret(owner_service)
    if not owner_url and args.bootstrap_owner_from_runtime:
        owner_url = read_secret(f"{args.namespace}-runtime-database-url")
        if owner_url:
            save_secret(owner_service, owner_url)
    if not owner_url:
        raise RuntimeError(
            "Migration credential is missing from macOS Keychain; no role was changed"
        )

    credentials: dict[str, tuple[RoleSpec, str, str]] = {}
    for spec in specs:
        existing_url = read_secret(spec.url_service)
        if existing_url and spec.purpose != "runtime":
            password = password_from_url(existing_url, spec.login)
            database_url = existing_url
        elif existing_url and spec.purpose == "runtime":
            parsed_user = unquote(urlsplit(existing_url).username or "")
            if parsed_user == spec.login:
                password = password_from_url(existing_url, spec.login)
                database_url = existing_url
            else:
                password = secrets.token_urlsafe(48)
                database_url = login_url(owner_url, spec.login, password)
                save_secret(spec.url_service, database_url)
        else:
            password = secrets.token_urlsafe(48)
            database_url = login_url(owner_url, spec.login, password)
            save_secret(spec.url_service, database_url)
        credentials[spec.purpose] = (spec, password, database_url)

    contexts: dict[str, tuple[str, str]] = {}
    for spec in specs:
        if not spec.context_key_service or not spec.context_secret_service:
            continue
        key_id = read_secret(spec.context_key_service)
        context_secret = read_secret(spec.context_secret_service)
        if bool(key_id) != bool(context_secret):
            raise RuntimeError(f"Incomplete Keychain context pair for {spec.purpose}")
        if not key_id:
            key_id = f"{spec.purpose}-{secrets.token_hex(8)}"
            context_secret = secrets.token_urlsafe(48)
            save_secret(spec.context_key_service, key_id)
            save_secret(spec.context_secret_service, context_secret)
        if len(context_secret or "") < 32:
            raise RuntimeError(f"Context secret for {spec.purpose} is too short")
        contexts[spec.purpose] = (key_id, context_secret or "")

    with psycopg.connect(owner_url, connect_timeout=15) as connection:
        if not connection.execute(
            "select to_regclass('app_private.context_secrets') is not null"
        ).fetchone()[0]:
            raise RuntimeError("Apply migration 0023 before provisioning logins")
        for spec, password, _database_url in credentials.values():
            provision_login(connection, spec, password)
        for purpose, (key_id, context_secret) in contexts.items():
            connection.execute(
                """
                insert into app_private.context_secrets(service,key_id,secret)
                values (%s,%s,%s)
                on conflict(service,key_id) do update
                set secret=excluded.secret, revoked_at=null, expires_at=null
                """,
                (purpose, key_id, context_secret),
            )

    for spec, _password, database_url in credentials.values():
        verify_login(database_url, spec)

    print(
        json.dumps(
            {
                "configured": True,
                "migration_identity": "macOS Keychain only",
                "keychain_namespace": args.namespace,
                "logins": [spec.login for spec in specs],
                "context_services": sorted(contexts),
                "secrets_printed": False,
                "least_privilege_verified": True,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except psycopg.Error as error:
        raise SystemExit(
            f"Database operation failed ({type(error).__name__}); secrets omitted"
        ) from None
