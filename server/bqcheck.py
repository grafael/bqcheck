#!/usr/bin/env python3
"""Dry-run a BigQuery SQL file and report bytes + estimated cost."""

import argparse
import sys
import unicodedata

from google.cloud import bigquery
from rich.console import Console


# CLI default. The Chrome extension stores its own price and ignores this.
DEFAULT_COST_PER_TIB = 6.25
BYTES_PER_TIB = 1024**4

# Characters that commonly sneak in via copy-paste (docs, Slack, Word) and
# trip up BigQuery's parser. Mapped to ASCII equivalents.
_SQL_CHAR_REPLACEMENTS = {
    # smart single quotes -> '
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    # smart double quotes -> "
    "“": '"', "”": '"', "„": '"', "‟": '"',
    # en dash / em dash / minus sign -> -
    "–": "-", "—": "-", "−": "-",
    # assorted non-ASCII spaces -> regular space
    " ": " ",  # no-break space
    " ": " ",  # figure space
    " ": " ",  # thin space
    " ": " ",  # hair space
    " ": " ",  # narrow no-break space
    " ": " ",  # medium mathematical space
    "　": " ",  # ideographic space
    # line / paragraph separators -> newline
    " ": "\n",
    " ": "\n",
    # NOTE: ellipsis (U+2026) is intentionally NOT mapped to "..." — when it
    # appears in SQL it almost always came from a page truncating the displayed
    # text. Expanding it would hide the real problem (incomplete SQL).
    # zero-width chars / BOM -> drop
    "​": "",  # zero-width space
    "‌": "",  # zero-width non-joiner
    "‍": "",  # zero-width joiner
    "﻿": "",  # BOM
}
_SQL_TRANSLATION = str.maketrans(_SQL_CHAR_REPLACEMENTS)


def normalize_sql(sql: str) -> str:
    """Replace non-ASCII punctuation and strip invisible/control chars so BigQuery parses cleanly."""
    sql = sql.translate(_SQL_TRANSLATION)
    # Drop any remaining Unicode Control (Cc) or Format (Cf) characters — things
    # like soft hyphens, word joiners, bidi marks, BOMs not in the table above.
    # Keep \t, \n, \r (which are Cc but legitimate whitespace).
    return "".join(
        c for c in sql
        if c in "\t\n\r" or unicodedata.category(c) not in ("Cc", "Cf")
    )


def dry_run_bytes(sql: str, project: str | None = None) -> int:
    """Run a dry-run query and return total bytes that would be processed."""
    sql = normalize_sql(sql)
    if "…" in sql:
        raise ValueError(
            "Selected SQL contains an ellipsis (…). The source page is likely "
            "truncating the displayed query — copy the full SQL from the source."
        )
    client = bigquery.Client(project=project)
    job_config = bigquery.QueryJobConfig(dry_run=True, use_query_cache=False)
    job = client.query(sql, job_config=job_config)
    return job.total_bytes_processed


def format_bytes(n: int) -> str:
    """Return a human-readable byte string."""
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if abs(n) < 1024:
            return f"{n:.2f} {unit}"
        n /= 1024
    return f"{n:.2f} PiB"


def main():
    parser = argparse.ArgumentParser(description="Estimate the BigQuery cost of a SQL file.")
    parser.add_argument("sql_file", help="Path to the .sql file")
    parser.add_argument("--project", default=None, help="GCP project ID (defaults to gcloud config)")
    parser.add_argument("--price", type=float, default=DEFAULT_COST_PER_TIB, help="USD per TiB processed")
    args = parser.parse_args()

    console = Console()
    err_console = Console(stderr=True)

    try:
        with open(args.sql_file) as f:
            sql = f.read()
    except FileNotFoundError:
        err_console.print(f"[bold red]Error:[/] file not found: [cyan]{args.sql_file}[/]")
        sys.exit(1)

    try:
        total_bytes = dry_run_bytes(sql, project=args.project)
    except Exception as e:
        err_console.print(f"[bold red]Error:[/] {e}")
        sys.exit(1)

    cost = (total_bytes / BYTES_PER_TIB) * args.price
    cost_color = "green" if cost < 0.01 else "yellow" if cost < 1 else "red"

    console.print(f"[bold]File:[/]       [cyan]{args.sql_file}[/]")
    console.print(f"[bold]Bytes:[/]      [magenta]{format_bytes(total_bytes)}[/]")
    console.print(
        f"[bold]Est. cost:[/]  [{cost_color}]${cost:.4f}[/]  "
        f"[dim](@ ${args.price}/TiB)[/]"
    )


if __name__ == "__main__":
    main()
