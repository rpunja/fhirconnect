"""FHIRConnect: serves the UI and proxies Patient requests to a FHIR R4 server.

The bearer token stays server-side; the browser only talks to /api/*.
"""
import base64
import hmac
import json
import os
import re
import sys
import urllib.error
import time
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASE_URL = os.environ.get("FHIR_BASE_URL", "").rstrip("/")
TOKEN = os.environ.get("FHIR_BEARER_TOKEN", "")
APP_PASSWORD = os.environ.get("APP_PASSWORD", "")
PORT = int(os.environ.get("PORT", "8000"))
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
TIMEOUT = 30

RESOURCE_PATH = re.compile(r"^/api/(Patient|Observation|Condition|MedicationRequest)(/[A-Za-z0-9\-.]{1,64})?$")
READ_ONLY = {"Observation", "Condition", "MedicationRequest"}
DETAIL_PAGE = re.compile(r"^/patient/[A-Za-z0-9\-.]{1,64}/?$")


def fhir_request(method, url, body=None):
    headers = {"Accept": "application/fhir+json"}
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    if body is not None:
        headers["Content-Type"] = "application/fhir+json"
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    start = time.perf_counter()
    elapsed = lambda: (time.perf_counter() - start) * 1000
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = resp.read()
            return resp.status, data, elapsed()
    except urllib.error.HTTPError as e:
        data = e.read()
        return e.code, data, elapsed()
    except Exception as e:  # network errors, timeouts
        return 502, json.dumps(outcome(f"Could not reach FHIR server: {e}")).encode(), elapsed()


def outcome(message):
    return {
        "resourceType": "OperationOutcome",
        "issue": [{"severity": "error", "code": "exception", "diagnostics": message}],
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.command, fmt % args))

    def send_json(self, status, payload, upstream_ms=None):
        data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(status)
        if upstream_ms is not None:
            self.send_header("Server-Timing", f'fhir;dur={upstream_ms:.1f};desc="FHIR server"')
        self.send_header("Content-Type", "application/fhir+json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    def proxy(self, method):
        if not BASE_URL:
            return self.send_json(500, outcome("FHIR_BASE_URL is not configured"))
        parsed = urllib.parse.urlsplit(self.path)

        if parsed.path == "/api/config" and method == "GET":
            return self.send_json(200, {"server": urllib.parse.urlsplit(BASE_URL).netloc})

        if parsed.path == "/api/next" and method == "GET":
            target = urllib.parse.parse_qs(parsed.query).get("url", [""])[0]
            base = urllib.parse.urlsplit(BASE_URL)
            t = urllib.parse.urlsplit(target)
            if (t.scheme, t.netloc) != (base.scheme, base.netloc):
                return self.send_json(400, outcome("Paging link does not point at the FHIR server"))
            return self.send_json(*fhir_request("GET", target))

        m = RESOURCE_PATH.match(parsed.path)
        if not m:
            return self.send_json(404, outcome("Not found"))
        resource_type, has_id = m.group(1), bool(m.group(2))
        if method != "GET" and (resource_type in READ_ONLY
                                or (method == "POST" and has_id)
                                or (method == "PUT" and not has_id)):
            return self.send_json(405, outcome("Method not allowed"))

        url = BASE_URL + parsed.path[len("/api"):]
        if parsed.query:
            url += "?" + parsed.query
        body = self.read_body() if method in ("POST", "PUT") else None
        if body is not None:
            try:
                resource = json.loads(body)
            except ValueError:
                return self.send_json(400, outcome("Body must be JSON"))
            if resource.get("resourceType") != "Patient":
                return self.send_json(400, outcome("Only Patient resources are accepted"))
        self.send_json(*fhir_request(method, url, body))

    def authorized(self):
        """When APP_PASSWORD is set, require HTTP Basic auth (any username)."""
        if not APP_PASSWORD:
            return True
        header = self.headers.get("Authorization", "")
        if header.startswith("Basic "):
            try:
                _, _, password = base64.b64decode(header[6:]).decode("utf-8").partition(":")
                if hmac.compare_digest(password.encode(), APP_PASSWORD.encode()):
                    return True
            except (ValueError, UnicodeDecodeError):
                pass
        body = b"Password required"
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="FHIRConnect", charset="UTF-8"')
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return False

    def do_GET(self):
        if not self.authorized():
            return
        if self.path.startswith("/api/"):
            return self.proxy("GET")
        if DETAIL_PAGE.match(urllib.parse.urlsplit(self.path).path):
            self.path = "/patient.html"
        return super().do_GET()

    def do_POST(self):
        if self.authorized():
            self.proxy("POST")

    def do_PUT(self):
        if self.authorized():
            self.proxy("PUT")


if __name__ == "__main__":
    print(f"FHIRConnect on :{PORT} -> {urllib.parse.urlsplit(BASE_URL).netloc or '(unset)'}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
