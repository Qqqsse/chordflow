"""Command-line entry point.

`check` validates configuration and exits. `run` processes jobs from the web
app's worker API: forever by default, `--once` for one job, `--drain` until
the queue is empty.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import sys
import threading

from .client import WorkerApiClient
from .config import SettingsError, describe, load_settings
from .runner import Worker


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="chordflow-worker")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check", help="validate configuration and exit")
    run = sub.add_parser("run", help="process generation jobs")
    group = run.add_mutually_exclusive_group()
    group.add_argument("--once", action="store_true", help="process at most one job")
    group.add_argument("--drain", action="store_true", help="stop when the queue is empty")
    args = parser.parse_args(argv)

    try:
        settings = load_settings(os.environ)
    except SettingsError as exc:
        print(json.dumps({"status": "error", "message": str(exc)}), file=sys.stderr)
        return 2
    if args.command == "check":
        print(json.dumps({"status": "ok", "settings": describe(settings)}))
        return 0

    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stderr)
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    client = WorkerApiClient(str(settings.api_base_url), settings.token)
    worker = Worker(settings, client, stop=stop)
    mode = "once" if args.once else "drain" if args.drain else "forever"
    processed = worker.run(mode=mode)
    print(json.dumps({"status": "ok", "processed": processed}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
