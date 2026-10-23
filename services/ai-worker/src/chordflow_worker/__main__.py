"""Command-line entry point.

`check` validates configuration and exits. The job loop (claim/heartbeat/
complete) is implemented in milestone M7 against the worker API contract.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from .config import SettingsError, describe, load_settings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="chordflow-worker")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check", help="validate configuration and exit")
    args = parser.parse_args(argv)

    if args.command == "check":
        try:
            settings = load_settings(os.environ)
        except SettingsError as exc:
            print(json.dumps({"status": "error", "message": str(exc)}), file=sys.stderr)
            return 2
        print(json.dumps({"status": "ok", "settings": describe(settings)}))
        return 0
    return 1  # pragma: no cover - argparse rejects unknown commands


if __name__ == "__main__":
    sys.exit(main())
