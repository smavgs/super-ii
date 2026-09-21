#!/usr/bin/env python3
"""Read-only audit of the deployed Super ii database privilege boundary."""

from __future__ import annotations

import argparse
import json

import psycopg

from provision_database_roles import (
    DEFAULT_NAMESPACE,
    migration_service,
    read_secret,
    role_specs,
    verify_login,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--namespace",
        default=DEFAULT_NAMESPACE,
        help="Keychain service prefix used by the database environment",
    )
    args = parser.parse_args()
    if not args.namespace or any(
        character not in "abcdefghijklmnopqrstuvwxyz0123456789-"
        for character in args.namespace
    ):
        raise RuntimeError("Keychain namespace must contain only lowercase letters, digits, and hyphens")

    specs = role_specs(args.namespace)
    owner_url = read_secret(migration_service(args.namespace))
    if not owner_url:
        raise RuntimeError("Migration credential is missing from macOS Keychain")

    login_urls: dict[str, str] = {}
    with psycopg.connect(owner_url, connect_timeout=15) as connection:
        owner_flags = connection.execute(
            "select current_user, rolcanlogin from pg_roles where rolname=current_user"
        ).fetchone()
        if not owner_flags or not owner_flags[1]:
            raise RuntimeError("Migration identity is not a database login")

        rls_count, table_count = connection.execute(
            """
            select
              count(*) filter (where class.relrowsecurity),
              count(*)
            from pg_class class
            join pg_namespace namespace on namespace.oid=class.relnamespace
            where namespace.nspname='app' and class.relkind in ('r','p')
            """
        ).fetchone()
        if rls_count != table_count or table_count < 106:
            raise RuntimeError("Not every application table is protected by RLS")

        for spec in specs:
            database_url = read_secret(spec.url_service)
            if not database_url:
                raise RuntimeError(f"Missing Keychain credential for {spec.login}")
            login_urls[spec.purpose] = database_url
            memberships = connection.execute(
                """
                select parent.rolname
                from pg_auth_members membership
                join pg_roles child on child.oid=membership.member
                join pg_roles parent on parent.oid=membership.roleid
                where child.rolname=%s order by parent.rolname
                """,
                (spec.login,),
            ).fetchall()
            if memberships != [(spec.bundle,)]:
                raise RuntimeError(f"Unexpected role membership for {spec.login}")

            if spec.context_key_service and spec.context_secret_service:
                key_id = read_secret(spec.context_key_service)
                context_secret = read_secret(spec.context_secret_service)
                if not key_id or not context_secret:
                    raise RuntimeError(f"Missing context material for {spec.purpose}")
                matches = connection.execute(
                    """
                    select exists(
                      select 1 from app_private.context_secrets
                      where service=%s and key_id=%s and secret=%s
                        and revoked_at is null
                        and (expires_at is null or expires_at > clock_timestamp())
                    )
                    """,
                    (spec.purpose, key_id, context_secret),
                ).fetchone()[0]
                if not matches:
                    raise RuntimeError(f"Active context key mismatch for {spec.purpose}")

    for spec in specs:
        verify_login(login_urls[spec.purpose], spec)

    print(
        json.dumps(
            {
                "audit": "passed",
                "application_tables": table_count,
                "rls_tables": rls_count,
                "keychain_namespace": args.namespace,
                "isolated_logins": [spec.login for spec in specs],
                "database_roles_separated": True,
                "secrets_printed": False,
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
            f"Database audit failed ({type(error).__name__}); secrets omitted"
        ) from None
