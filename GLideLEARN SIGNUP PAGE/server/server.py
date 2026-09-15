"""
GlideLEARN backend — server.py

Plain Python http.server (stdlib only, nothing to pip install):
  - serves the frontend from ./public
  - POST /api/signup  -> validates + stores a new account
  - POST /api/login   -> verifies credentials against storage
  - GET  /api/health  -> quick liveness check

Ctrl+C (SIGINT) closes the database and deletes ./data before exiting,
so no account data survives a stopped server.
"""

import json
import os
import re
import signal
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import db
import roles

PORT = int(os.environ.get("PORT", 3000))
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
}

EMAIL_RE = re.compile(r"^\S+@\S+\.\S+$")
BODY_LIMIT = 1_000_000  # 1MB is plenty for a signup/login payload


class BadRequest(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.status_code = status_code


class Handler(BaseHTTPRequestHandler):
    server_version = "GlideLEARN/1.0"

    # -----------------------------------------------------
    # Small helpers
    # -----------------------------------------------------
    def send_json(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        # HEAD responses must never have a body (RFC 9110 §9.3.2).
        if self.command != "HEAD":
            self.wfile.write(body)

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length > BODY_LIMIT:
            raise BadRequest("Payload too large", 413)
        raw = self.rfile.read(length) if length else b""
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise BadRequest("Invalid JSON body", 400)

    @staticmethod
    def is_non_empty_string(value):
        return isinstance(value, str) and value.strip() != ""

    # -----------------------------------------------------
    # HTTP verb entry points -> shared router
    # -----------------------------------------------------
    def do_GET(self):
        self.route("GET")

    def do_HEAD(self):
        self.route("HEAD")

    def do_POST(self):
        self.route("POST")

    def route(self, method):
        pathname = urllib.parse.urlsplit(self.path).path

        if pathname == "/api/health" and method in ("GET", "HEAD"):
            return self.send_json(200, {"ok": True, "service": "glidelearn-api"})

        if pathname == "/api/signup" and method == "POST":
            return self.handle_signup()

        if pathname == "/api/login" and method == "POST":
            return self.handle_login()

        if pathname.startswith("/api/"):
            return self.send_json(404, {"ok": False, "error": "Unknown API route."})

        if method in ("GET", "HEAD"):
            return self.serve_static(pathname, method)

        self.send_response(405)
        self.end_headers()
        self.wfile.write(b"Method not allowed")

    # -----------------------------------------------------
    # POST /api/signup
    # body: { role, password, fields: { fullName, email, ... } }
    # -----------------------------------------------------
    def handle_signup(self):
        try:
            body = self.read_json_body()
        except BadRequest as err:
            return self.send_json(err.status_code, {"ok": False, "error": str(err)})

        role = body.get("role")
        password = body.get("password")
        fields = body.get("fields") if isinstance(body.get("fields"), dict) else {}

        if role not in roles.VALID_ROLES:
            return self.send_json(400, {"ok": False, "error": "Choose a valid account type."})

        role_def = roles.ROLE_FIELDS[role]

        for field_name in role_def["fields"]:
            if not self.is_non_empty_string(fields.get(field_name)):
                return self.send_json(400, {"ok": False, "error": "Please fill in every field."})

        if not self.is_non_empty_string(password) or len(password) < 6:
            return self.send_json(
                400, {"ok": False, "error": "Login password must be at least 6 characters."}
            )

        identity_value = (fields.get(role_def["identityField"]) or "").strip()
        if not EMAIL_RE.match(identity_value):
            return self.send_json(400, {"ok": False, "error": "Enter a valid email address."})

        # Anything that isn't the identity field is stored as role-specific
        # metadata. We deliberately never persist studentPassword (the
        # parent form's linking field) — it's not a credential for this
        # account, just descriptive input.
        extra = {}
        for field_name in role_def["fields"]:
            if field_name == role_def["identityField"]:
                continue
            if field_name in ("studentPassword", "fullName"):
                continue
            extra[field_name] = fields[field_name].strip()

        # Parent accounts don't have their own login email — the "email"
        # they enter is the student's, used only to find and link to that
        # student's existing account. Storing it as *this* row's login
        # email would collide with the student's own account (and block
        # the student from signing up at all if the parent goes first), so
        # instead we look the student up and store a linked_student_id.
        linked_student_id = None
        account_email = identity_value
        if role == "parent":
            student = db.find_user_by_email(identity_value)
            if not student or student["role"] != "student":
                return self.send_json(
                    404,
                    {
                        "ok": False,
                        "error": "No student account found with that email. "
                        "Ask your child to create their account first.",
                    },
                )
            linked_student_id = student["id"]
            account_email = None
            extra["studentEmail"] = identity_value

        try:
            user = db.create_user(
                role=role,
                prefix=role_def["prefix"],
                email=account_email,
                full_name=fields.get("fullName", "").strip(),
                extra=extra,
                password=password,
                linked_student_id=linked_student_id,
            )
            return self.send_json(201, {"ok": True, "user": db.to_public_user(user)})
        except db.EmailTakenError as err:
            return self.send_json(409, {"ok": False, "error": str(err)})
        except Exception as err:  # noqa: BLE001 — mirror the JS catch-all
            print("Signup error:", err)
            return self.send_json(500, {"ok": False, "error": "Something went wrong. Try again."})

    # -----------------------------------------------------
    # POST /api/login
    # body: { identifier, password }
    # -----------------------------------------------------
    def handle_login(self):
        try:
            body = self.read_json_body()
        except BadRequest as err:
            return self.send_json(err.status_code, {"ok": False, "error": str(err)})

        identifier = body.get("identifier")
        password = body.get("password")

        if not self.is_non_empty_string(identifier):
            return self.send_json(400, {"ok": False, "error": "Enter your login ID or email."})
        if not self.is_non_empty_string(password):
            return self.send_json(400, {"ok": False, "error": "Enter your password."})

        row = db.find_user_by_identifier(identifier)
        if not row or not db.verify_password(password, row["password_salt"], row["password_hash"]):
            return self.send_json(401, {"ok": False, "error": "Invalid credentials."})

        return self.send_json(200, {"ok": True, "user": db.to_public_user(row)})

    # -----------------------------------------------------
    # Static file serving for the frontend in ./public
    # -----------------------------------------------------
    def serve_static(self, pathname, method):
        relative_path = "/login.html" if pathname == "/" else pathname
        # Guard against path traversal outside of PUBLIC_DIR
        safe_rel = os.path.normpath(relative_path).lstrip(os.sep)
        file_path = os.path.normpath(os.path.join(PUBLIC_DIR, safe_rel))

        if not (file_path == PUBLIC_DIR or file_path.startswith(PUBLIC_DIR + os.sep)):
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b"Forbidden")
            return

        if not os.path.isfile(file_path):
            self.send_response(404)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Not found")
            return

        with open(file_path, "rb") as f:
            data = f.read()

        ext = os.path.splitext(file_path)[1]
        self.send_response(200)
        self.send_header("Content-Type", MIME_TYPES.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if method != "HEAD":
            self.wfile.write(data)

    # Quieter, single-line access log (keeps the default format)
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    server = ThreadingHTTPServer(("", PORT), Handler)

    shutting_down = {"flag": False}

    def handle_shutdown(signum, frame):
        if shutting_down["flag"]:
            return
        shutting_down["flag"] = True
        print("\nReceived shutdown signal. Wiping stored data...")
        try:
            db.close_and_wipe()
            print("Data wiped (server/data/ removed).")
        except Exception as err:  # noqa: BLE001
            print("Failed to wipe data:", err)
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    print(f"GlideLEARN server running at http://localhost:{PORT}")
    print("Press Ctrl+C to stop and erase all stored data.")

    try:
        server.serve_forever()
    except SystemExit:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
