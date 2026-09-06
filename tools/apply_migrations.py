#!/usr/bin/env python3
"""Apply the checked-in Super ii SQL migrations without printing credentials."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import psycopg


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "database" / "migrations"


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key.strip()] = value
    return values


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", type=Path, default=ROOT / ".dev.vars")
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()

    local_values = read_env_file(args.env_file)
    database_url = os.environ.get("DATABASE_URL") or local_values.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("ERROR: DATABASE_URL is not configured")

    migrations = sorted(MIGRATIONS.glob("*.sql"))
    with psycopg.connect(
        database_url,
        autocommit=True,
        connect_timeout=15,
        application_name="superii-schema-manager",
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select
                  count(*) filter (where table_schema = 'app')::integer,
                  to_regclass('app.repositories') is not null
                from information_schema.tables
                """
            )
            app_table_count, has_repositories = cursor.fetchone()
            repository_count = 0
            if has_repositories:
                cursor.execute("select count(*)::integer from app.repositories")
                repository_count = cursor.fetchone()[0]
            print(
                f"Connected: app_tables={app_table_count}, "
                f"public_repositories={repository_count}"
            )
            if args.check_only:
                return 0

            for migration in migrations:
                cursor.execute(migration.read_text(encoding="utf-8"))
                print(f"Applied {migration.name}")

            cursor.execute(
                """
                select
                  (select count(*)::integer from information_schema.tables where table_schema = 'app'),
                  (select count(*)::integer from app.repositories),
                  (select count(*)::integer from app.search_public_repositories(null)),
                  to_regclass('app.commerce_delegations') is not null,
                  to_regclass('app.commerce_orders') is not null,
                  to_regclass('app.commerce_receipts') is not null,
                  to_regclass('app.commerce_quote_requests') is not null
                """
            )
            (
                relation_count,
                repository_count,
                public_count,
                has_commerce_delegations,
                has_commerce_orders,
                has_commerce_receipts,
                has_commerce_quotes,
            ) = cursor.fetchone()
            if relation_count < 87:
                raise RuntimeError(
                    f"too few app relations after migration: {relation_count}"
                )
            if not all(
                (
                    has_commerce_delegations,
                    has_commerce_orders,
                    has_commerce_receipts,
                    has_commerce_quotes,
                )
            ):
                raise RuntimeError("agent commerce relations are incomplete")
            print(
                f"Verified: app_relations={relation_count}, repositories={repository_count}, "
                f"public_search_rows={public_count}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
