"""scripts/check-supabase-exposure.sh against a local fake of Supabase's REST and Auth endpoints and our API."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SCRIPT = os.path.join(ROOT, "scripts", "check-supabase-exposure.sh")

LOCKED = {
    "public": (404, {"code": "PGRST205", "message": "Could not find the table 'public.papers'"}),
    "journey": (406, {"code": "PGRST106", "message": "Invalid schema: journey"}),
    "settings": (200, {"disable_signup": True, "external": {"anonymous_users": False}}),
    "alembic": (401, {"code": "42501", "message": "permission denied for table alembic_version"}),
    "api_list": (401, {"error": {"code": "unauthorized", "message": "Sign in first"}}),
    "api_edit": (401, {"error": {"code": "unauthorized", "message": "Sign in first"}}),
}


def _serve(answers):
    seen = []

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _answer(self, key):
            status, body = answers.get(key, (404, {}))
            raw = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def _record(self, method):
            n = int(self.headers.get("Content-Length") or 0)
            if n:
                self.rfile.read(n)
            seen.append((method + " " + self.path if method != "GET" else self.path,
                         self.headers.get("apikey"), self.headers.get("Accept-Profile"),
                         self.headers.get("Authorization")))

        def do_GET(self):
            self._record("GET")
            if self.path == "/api/v1/papers":
                key = "api_list"
            elif self.path.startswith("/rest/v1/papers"):
                key = "journey" if self.headers.get("Accept-Profile") == "journey" else "public"
            elif self.path.startswith("/rest/v1/alembic_version"):
                key = "alembic"
            elif self.path == "/auth/v1/settings":
                key = "settings"
            else:
                key = None
            self._answer(key)

        def do_PATCH(self):
            self._record("PATCH")
            self._answer("api_edit" if self.path.startswith("/api/v1/papers/") else None)

        def do_POST(self):
            self._record("POST")
            self.send_response(500)
            self.end_headers()

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, seen


def _sandbox(tmp, prod_api):
    """A copy of the script beside a web/js/config.js whose PROD_API we choose, so a test never
    reaches the real API named in the repo's config.js."""
    os.makedirs(os.path.join(tmp, "scripts"))
    os.makedirs(os.path.join(tmp, "web", "js"))
    script = os.path.join(tmp, "scripts", os.path.basename(SCRIPT))
    shutil.copy(SCRIPT, script)
    with open(os.path.join(ROOT, "web", "js", "config.js")) as f:
        config = f.read()
    config, n = re.subn(r"^export const PROD_API = '[^']*';", f"export const PROD_API = '{prod_api}';", config, flags=re.M)
    assert n == 1
    with open(os.path.join(tmp, "web", "js", "config.js"), "w") as f:
        f.write(config)
    return script


def _run(answers, api=False, prod_api=False):
    srv, seen = _serve(answers)
    base = f"http://127.0.0.1:{srv.server_port}"
    try:
        with tempfile.TemporaryDirectory() as tmp:
            script = _sandbox(tmp, base if prod_api else "")
            env = {k: v for k, v in os.environ.items() if k != "API_URL"}
            env["SUPABASE_URL"] = base
            if api:
                env["API_URL"] = base
            r = subprocess.run(["bash", script], env=env, capture_output=True, text=True, timeout=30)
    finally:
        srv.shutdown()
        srv.server_close()
    return r, seen


def test_locked_down_project_passes_and_sends_only_the_publishable_key():
    r, seen = _run(LOCKED)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "OK: tables not exposed, sign-up closed" in r.stdout
    assert all(k and k.startswith("sb_publishable_") for p, k, *_ in seen if not p.startswith("POST"))
    assert not any(p.startswith("POST") for p, *_ in seen), "the check never creates anything"


def test_data_api_turned_off_also_passes():
    r, _ = _run({**LOCKED, "public": (404, {}), "journey": (404, {}), "alembic": (404, {})})
    assert r.returncode == 0, r.stdout + r.stderr


@pytest.mark.parametrize(
    "name, answer, words",
    [
        ("public", (200, []), "public.papers is readable"),
        ("journey", (200, []), "journey schema is exposed"),
        ("settings", (200, {"disable_signup": False}), "sign-up is open"),
        ("journey", (500, {}), "unexpected answer"),
        ("alembic", (200, [{"version_num": "0001"}]), "alembic_version is reachable"),
        ("alembic", (200, []), "alembic_version is reachable"),
        ("settings", (200, {"disable_signup": True, "external": {"anonymous_users": True}}), "anonymous sign-ins are on"),
    ],
)
def test_each_exposure_fails(name, answer, words):
    r, _ = _run({**LOCKED, name: answer})
    assert r.returncode == 1
    assert words in r.stdout


def test_api_checks_pass_when_anonymous_calls_are_refused():
    r, seen = _run(LOCKED, api=True)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "ok: anonymous list refused" in r.stdout
    assert "ok: anonymous edit refused" in r.stdout
    assert "/api/v1/papers" in [p for p, *_ in seen]
    assert any(p.startswith("PATCH /api/v1/papers/") for p, *_ in seen)


def test_anonymous_api_read_fails_the_check():
    r, _ = _run({**LOCKED, "api_list": (200, [])}, api=True)
    assert r.returncode == 1
    assert "FAIL: anonymous list is readable" in r.stdout


def test_anonymous_api_edit_fails_the_check():
    r, _ = _run({**LOCKED, "api_edit": (404, {})}, api=True)
    assert r.returncode == 1
    assert "anonymous edit" in r.stdout


def test_api_checks_never_send_authorization():
    _r, seen = _run(LOCKED, api=True)
    assert seen and all(auth is None for *_, auth in seen)
    assert not any(p.startswith("POST") for p, *_ in seen)


def test_no_api_url_skips_api_checks():
    r, seen = _run(LOCKED)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "skip: API checks (no API URL yet)" in r.stdout
    assert not any("/api/v1/" in p for p, *_ in seen)


def test_api_url_defaults_to_prod_api_in_config():
    r, seen = _run(LOCKED, prod_api=True)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "ok: anonymous list refused" in r.stdout
    assert "/api/v1/papers" in [p for p, *_ in seen]
