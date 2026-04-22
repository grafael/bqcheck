#!/usr/bin/env python3
"""Local HTTP server that exposes BigQuery cost estimation using gcloud credentials."""

import argparse
import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

from bqcheck import dry_run_bytes, format_bytes, normalize_sql

PORT = 7891
DEFAULT_PROJECT = None


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/projects":
            self.send_error(404)
            return

        try:
            proc = subprocess.run(
                ["gcloud", "projects", "list", "--format=json"],
                capture_output=True,
                text=True,
                check=True,
                timeout=20,
            )
            raw = json.loads(proc.stdout)
            projects = [
                {"projectId": p["projectId"], "name": p.get("name") or p["projectId"]}
                for p in raw
            ]
            projects.sort(key=lambda p: p["projectId"])
            self._json_response(200, {"projects": projects, "default": DEFAULT_PROJECT})
        except subprocess.CalledProcessError as e:
            self._json_response(500, {"error": e.stderr.strip() or str(e)})
        except FileNotFoundError:
            self._json_response(500, {"error": "gcloud not found on PATH"})
        except Exception as e:
            self._json_response(500, {"error": str(e)})

    def do_POST(self):
        if self.path != "/estimate":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))
        sql = body.get("sql", "")
        project = body.get("project") or DEFAULT_PROJECT

        if not sql.strip():
            self._json_response(400, {"error": "sql is required"})
            return

        try:
            total_bytes = dry_run_bytes(sql, project=project)
            self._json_response(200, {
                "total_bytes_processed": total_bytes,
                "bytes_human": format_bytes(total_bytes),
                "project": project,
            })
        except Exception as e:
            normalized = normalize_sql(sql)
            print(
                f"[bqcheck] estimate failed: {e}\n"
                f"[bqcheck] received SQL (repr):\n{sql!r}\n"
                f"[bqcheck] normalized SQL (repr):\n{normalized!r}",
                file=sys.stderr,
            )
            self._json_response(500, {"error": str(e)})

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _json_response(self, status, data):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(payload)

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, fmt, *args):
        print(f"[bqcheck] {args[0]}")


def main():
    global DEFAULT_PROJECT
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", default=None, help="Fallback GCP project ID (used when the client doesn't specify one)")
    parser.add_argument("--port", type=int, default=PORT, help="Port to listen on")
    args = parser.parse_args()

    DEFAULT_PROJECT = args.project
    server = HTTPServer(("127.0.0.1", args.port), Handler)
    fallback = args.project or "<none; client must pick>"
    print(f"bqcheck server listening on http://127.0.0.1:{args.port} (fallback project: {fallback})")
    server.serve_forever()


if __name__ == "__main__":
    main()
