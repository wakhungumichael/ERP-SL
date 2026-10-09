#!/usr/bin/env python3
"""Export the legacy Metrix weighbridge records into a portable JSON package."""

import argparse
import json
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import psycopg2
from psycopg2 import sql


TABLES = (
    "SL_Weighbridge_company",
    "SL_Weighbridge_branch",
    "SL_Weighbridge_currency",
    "SL_Weighbridge_customer",
    "SL_Weighbridge_vehicletype",
    "SL_Weighbridge_vehicle",
    "SL_Weighbridge_item",
    "SL_Weighbridge_customervehicletypediscount",
    "SL_Weighbridge_transaction",
)


def encode(value):
    if isinstance(value, (datetime, date, Decimal)):
        return str(value)
    raise TypeError(f"Cannot serialize {type(value).__name__}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", required=True, help="Legacy PostgreSQL connection URL")
    parser.add_argument("--output", required=True, type=Path, help="Destination JSON file")
    args = parser.parse_args()

    payload = {"format": "sl-erp-legacy-metrix-v1", "tables": {}}
    with psycopg2.connect(args.database_url) as connection:
        with connection.cursor() as cursor:
            for table in TABLES:
                cursor.execute(sql.SQL("SELECT * FROM {} ORDER BY id").format(sql.Identifier(table)))
                columns = [column.name for column in cursor.description]
                payload["tables"][table] = [dict(zip(columns, row)) for row in cursor.fetchall()]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, default=encode, indent=2), encoding="utf-8")
    print(f"Exported {sum(len(rows) for rows in payload['tables'].values())} records to {args.output}")


if __name__ == "__main__":
    main()
