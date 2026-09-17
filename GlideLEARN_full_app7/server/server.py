"""
GlideLEARN backend — server.py

Plain Python http.server (stdlib only, nothing to pip install):
  - serves the frontend from ./public
  - POST /api/signup              -> validates + stores a new account
  - POST /api/login               -> verifies credentials, starts a session
  - POST /api/logout              -> ends the current session
  - GET  /api/me                  -> who's currently logged in (via cookie)
  - GET  /api/dashboard-summary   -> profile + per-course progress + streak
  - POST /api/generate-topic-quiz -> AI: 2-3 questions per topic in a unit
  - POST /api/generate-swot       -> AI: SWOT analysis from quiz results
  - POST /api/generate-syllabus   -> AI: syllabus + focus map from the SWOT
  - POST /api/generate-flashcards -> AI: flashcards for the finished unit
  - POST /api/study-plan          -> save a finished study plan for the user
  - GET  /api/study-plans         -> list the logged-in user's saved plans
  - GET  /api/progress            -> overall + per-course progress + AI insight
  - GET  /api/streaks             -> overall + per-course streaks + AI note + Glide COINS
  - GET  /api/leaderboard         -> all students ranked by Glide COINS + your rank
  - GET  /api/health              -> quick liveness check
  - GET  /study-planner.html      -> protected: redirects to /login.html
                                      unless a valid session cookie is present

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
from http.cookies import SimpleCookie

import db
import roles
import ai

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
BODY_LIMIT = 1_000_000  # 1MB is plenty for a signup/login/study-plan payload

SESSION_COOKIE = "glidelearn_session"

# Pages that require a logged-in session to view. Anything not in this
# set (login.html, static assets, etc.) is served as before.
PROTECTED_PAGES = {"/study-planner.html"}


class BadRequest(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.status_code = status_code


class Handler(BaseHTTPRequestHandler):
    server_version = "GlideLEARN/1.0"

    # Without this, a client that connects but stalls mid-request (or
    # never sends the body it promised via Content-Length) ties up a
    # server thread forever. 30s is generous for a local dev server
    # but guarantees every thread eventually frees itself.
    timeout = 30

    # -----------------------------------------------------
    # Small helpers
    # -----------------------------------------------------
    def send_json(self, status_code, payload, set_cookie=None, clear_cookie=False):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if set_cookie:
            self.send_header("Set-Cookie", set_cookie)
        if clear_cookie:
            self.send_header(
                "Set-Cookie",
                f"{SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
            )
        self.end_headers()
        # HEAD responses must never have a body (RFC 9110 §9.3.2).
        if self.command != "HEAD":
            self.wfile.write(body)

    def read_json_body(self):
        raw_length = self.headers.get("Content-Length", "0")
        try:
            length = int(raw_length)
        except (TypeError, ValueError):
            raise BadRequest("Invalid Content-Length header", 400)
        if length < 0:
            raise BadRequest("Invalid Content-Length header", 400)
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

    def get_session_token(self):
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        cookie = SimpleCookie()
        try:
            cookie.load(raw)
        except Exception:
            return None
        morsel = cookie.get(SESSION_COOKIE)
        return morsel.value if morsel else None

    def current_user(self):
        return db.find_session_user(self.get_session_token())

    def require_user(self):
        """Returns the logged-in user row, or sends a 401 and returns None."""
        user = self.current_user()
        if not user:
            self.send_json(401, {"ok": False, "error": "You need to be logged in."})
            return None
        return user

    # -----------------------------------------------------
    # HTTP verb entry points -> shared router
    # -----------------------------------------------------
    def do_GET(self):
        self.safe_route("GET")

    def do_HEAD(self):
        self.safe_route("HEAD")

    def do_POST(self):
        self.safe_route("POST")

    def safe_route(self, method):
        """Ensures the client always gets a response — an uncaught
        exception here would otherwise drop the connection with no
        reply, leaving the client hanging until its own timeout."""
        try:
            self.route(method)
        except (BrokenPipeError, ConnectionResetError):
            # The client went away mid-response; nothing to send.
            pass
        except Exception as err:  # noqa: BLE001 — last-resort safety net
            print("Unhandled error handling request:", err)
            try:
                self.send_json(500, {"ok": False, "error": "Internal server error."})
            except Exception:
                pass

    def route(self, method):
        pathname = urllib.parse.urlsplit(self.path).path

        if pathname == "/api/health" and method in ("GET", "HEAD"):
            return self.send_json(200, {"ok": True, "service": "glidelearn-api"})

        if pathname == "/api/signup" and method == "POST":
            return self.handle_signup()

        if pathname == "/api/login" and method == "POST":
            return self.handle_login()

        if pathname == "/api/logout" and method == "POST":
            return self.handle_logout()

        if pathname == "/api/me" and method == "GET":
            return self.handle_me()

        if pathname == "/api/study-plan" and method == "POST":
            return self.handle_save_study_plan()

        if pathname == "/api/study-plans" and method == "GET":
            return self.handle_list_study_plans()

        if pathname == "/api/generate-topic-quiz" and method == "POST":
            return self.handle_generate_topic_quiz()

        if pathname == "/api/generate-swot" and method == "POST":
            return self.handle_generate_swot()

        if pathname == "/api/generate-syllabus" and method == "POST":
            return self.handle_generate_syllabus()

        if pathname == "/api/generate-flashcards" and method == "POST":
            return self.handle_generate_flashcards()

        if pathname == "/api/dashboard-summary" and method == "GET":
            return self.handle_dashboard_summary()

        if pathname == "/api/progress" and method == "GET":
            return self.handle_progress()

        if pathname == "/api/streaks" and method == "GET":
            return self.handle_streaks()

        if pathname == "/api/leaderboard" and method == "GET":
            return self.handle_leaderboard()

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
    # On success, starts a session and sets an HttpOnly cookie so
    # /study-planner.html and the study-plan APIs recognize the user.
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

        token, _expires = db.create_session(row["id"])
        cookie = (
            f"{SESSION_COOKIE}={token}; Path=/; Max-Age={db.SESSION_LIFETIME_DAYS * 86400}; "
            "HttpOnly; SameSite=Lax"
        )
        return self.send_json(200, {"ok": True, "user": db.to_public_user(row)}, set_cookie=cookie)

    # -----------------------------------------------------
    # POST /api/logout
    # -----------------------------------------------------
    def handle_logout(self):
        token = self.get_session_token()
        if token:
            db.delete_session(token)
        return self.send_json(200, {"ok": True}, clear_cookie=True)

    # -----------------------------------------------------
    # GET /api/me — who does this session cookie belong to?
    # -----------------------------------------------------
    def handle_me(self):
        user = self.current_user()
        if not user:
            return self.send_json(401, {"ok": False, "error": "Not logged in."})
        return self.send_json(200, {"ok": True, "user": db.to_public_user(user)})

    # -----------------------------------------------------
    # POST /api/study-plan — save a finished wizard run for the
    # logged-in user.
    # -----------------------------------------------------
    def handle_save_study_plan(self):
        user = self.require_user()
        if not user:
            return

        try:
            body = self.read_json_body()
        except BadRequest as err:
            return self.send_json(err.status_code, {"ok": False, "error": str(err)})

        required_strings = [
            "subjectId", "subjectName", "unitId", "unitName",
            "durationLabel", "levelId", "levelLabel",
        ]
        for field_name in required_strings:
            if not self.is_non_empty_string(body.get(field_name)):
                return self.send_json(400, {"ok": False, "error": "Missing field: " + field_name})

        try:
            minutes = int(body.get("minutes"))
            score_correct = int(body.get("scoreCorrect"))
            score_total = int(body.get("scoreTotal"))
        except (TypeError, ValueError):
            return self.send_json(400, {"ok": False, "error": "Scores and minutes must be numbers."})

        topics = body.get("topics")
        if not isinstance(topics, list):
            topics = []

        plan = {
            "subjectId": body["subjectId"].strip(),
            "subjectName": body["subjectName"].strip(),
            "unitId": body["unitId"].strip(),
            "unitName": body["unitName"].strip(),
            "minutes": minutes,
            "durationLabel": body["durationLabel"].strip(),
            "notes": (body.get("notes") or "").strip(),
            "scoreCorrect": score_correct,
            "scoreTotal": score_total,
            "levelId": body["levelId"].strip(),
            "levelLabel": body["levelLabel"].strip(),
            "topics": topics,
            "source": body.get("source") or "standard",
        }

        row = db.save_study_plan(user["id"], plan)
        return self.send_json(201, {"ok": True, "plan": db.to_public_plan(row)})

    # -----------------------------------------------------
    # GET /api/study-plans — list the logged-in user's saved plans
    # -----------------------------------------------------
    def handle_list_study_plans(self):
        user = self.require_user()
        if not user:
            return
        rows = db.list_study_plans(user["id"])
        return self.send_json(200, {"ok": True, "plans": [db.to_public_plan(r) for r in rows]})

    # -----------------------------------------------------
    # POST /api/generate-topic-quiz
    # body: { subjectName, unitName, topics: [...], notes }
    # Asks the AI provider (Groq, see ai.py) for 2-3 questions per
    # topic in the unit. Returns {success:false} on any failure —
    # the frontend shows a retry prompt rather than fabricating quiz
    # content the AI didn't actually generate.
    # -----------------------------------------------------
    def handle_generate_topic_quiz(self):
        try:
            body = self.read_json_body()
        except BadRequest as err:
            return self.send_json(err.status_code, {"success": False, "error": str(err)})

        subject = body.get("subjectName") or ""
        unit = body.get("unitName") or ""
        notes = body.get("notes") or ""
        topics = body.get("topics")

        if not subject or not unit or not isinstance(topics, list) or not topics:
            return self.send_json(400, {"success": False, "error": "Missing subject/unit/topics."})
        topics = [t for t in topics if isinstance(t, str) and t.strip()]

        quizzes = ai.generate_topic_quizzes(subject, unit, topics, notes)
        if not quizzes:
            return self.send_json(200, {"success": False})
        return self.send_json(200, {"success": True, "quizzes": quizzes})

    # -----------------------------------------------------
    # POST /api/generate-swot
    # body: { subjectName, unitName, results: [{topic, correct, total}] }
    # -----------------------------------------------------
    def handle_generate_swot(self):
        try:
            body = self.read_json_body()
        except BadRequest as err:
            return self.send_json(err.status_code, {"success": False, "error": str(err)})

        subject = body.get("subjectName") or ""
        unit = body.get("unitName") or ""
        results = body.get("results")

        if not subject or not unit or not isinstance(results, list) or not results:
            return self.send_json(400, {"success": False, "error": "Missing subject/unit/results."})

        cleaned_results = []
        for r in results:
            if (
                isinstance(r, dict)
                and isinstance(r.get("topic"), str)
                and isinstance(r.get("correct"), int)
                and isinstance(r.get("total"), int)
            ):
                cleaned_results.append(r)
        if not cleaned_results:
            return self.send_json(400, {"success": False, "error": "Invalid results."})

        swot = ai.generate_swot(subject, unit, cleaned_results)
        if not swot:
            return self.send_json(200, {"success": False})
        return self.send_json(200, {"success": True, "swot": swot})

    # -----------------------------------------------------
    # POST /api/generate-syllabus
    # body: { subjectName, unitName, minutes, swot, notes }
    # Builds a syllabus + "focus map" weighted toward the SWOT
    # weaknesses/threats for this unit.
    # -----------------------------------------------------
    def handle_generate_syllabus(self):
        try:
            body = self.read_json_body()
        except BadRequest as err:
            return self.send_json(err.status_code, {"success": False, "error": str(err)})

        subject = body.get("subjectName") or ""
        unit = body.get("unitName") or ""
        notes = body.get("notes") or ""
        swot = body.get("swot")

        try:
            minutes = int(body.get("minutes") or 0)
        except (TypeError, ValueError):
            minutes = 0

        if not subject or not unit or not minutes or not isinstance(swot, dict):
            return self.send_json(400, {"success": False, "error": "Missing subject/unit/minutes/swot."})

        result = ai.generate_syllabus_from_swot(subject, unit, minutes, swot, notes)
        if not result:
            return self.send_json(200, {"success": False})
        return self.send_json(200, {"success": True, "topics": result["topics"], "focus": result["focus"]})

    # -----------------------------------------------------
    # POST /api/generate-flashcards
    # body: { subjectName, unitName, topics: [...] }
    # -----------------------------------------------------
    def handle_generate_flashcards(self):
        try:
            body = self.read_json_body()
        except BadRequest as err:
            return self.send_json(err.status_code, {"success": False, "error": str(err)})

        subject = body.get("subjectName") or ""
        unit = body.get("unitName") or ""
        topics = body.get("topics") or []

        if not subject or not unit:
            return self.send_json(400, {"success": False, "error": "Missing subject/unit."})

        cards = ai.generate_flashcards(subject, unit, [t for t in topics if isinstance(t, str)])
        if not cards:
            return self.send_json(200, {"success": False})
        return self.send_json(200, {"success": True, "cards": cards})

    # -----------------------------------------------------
    # GET /api/dashboard-summary — profile + per-course progress
    # (real, from saved study_plans) + overall streak, for the
    # dashboard tiles/course list.
    # -----------------------------------------------------
    def handle_dashboard_summary(self):
        user = self.require_user()
        if not user:
            return

        subjects = db.distinct_subjects(user["id"])
        courses = []
        for subject_id, subject_name in subjects:
            progress = db.subject_progress(user["id"], subject_id)
            courses.append({
                "id": subject_id,
                "name": subject_name,
                "progressPct": progress["avgPct"],
                "attempts": progress["attempts"],
            })

        return self.send_json(200, {
            "ok": True,
            "user": db.to_public_user(user),
            "courses": courses,
            "overallStreak": db.overall_streak(user["id"]),
            "overallProgressPct": db.overall_progress(user["id"])["avgPct"],
        })

    # -----------------------------------------------------
    # GET /api/progress — overall + per-course progress trends,
    # each with a short AI coaching insight. Falls back to no
    # "insight" text (chart still renders from real data) if the
    # AI call fails.
    # -----------------------------------------------------
    def handle_progress(self):
        user = self.require_user()
        if not user:
            return

        overall = db.overall_progress(user["id"])
        overall["insight"] = ai.generate_progress_insight(
            "Overall", overall["avgPct"], overall["attempts"], overall["trend"]
        )

        courses = []
        for subject_id, subject_name in db.distinct_subjects(user["id"]):
            stats = db.subject_progress(user["id"], subject_id)
            stats["id"] = subject_id
            stats["name"] = subject_name
            stats["insight"] = ai.generate_progress_insight(
                subject_name, stats["avgPct"], stats["attempts"], stats["trend"]
            )
            courses.append(stats)

        return self.send_json(200, {"ok": True, "overall": overall, "courses": courses})

    # -----------------------------------------------------
    # GET /api/streaks — overall + per-course streaks (real,
    # computed from consecutive study days), each with a short
    # AI remark.
    # -----------------------------------------------------
    def handle_streaks(self):
        user = self.require_user()
        if not user:
            return

        overall_days = db.overall_streak(user["id"])
        overall = {"days": overall_days, "note": ai.generate_streak_note("Overall", overall_days)}

        courses = []
        for subject_id, subject_name in db.distinct_subjects(user["id"]):
            days = db.subject_streak(user["id"], subject_id)
            courses.append({
                "id": subject_id,
                "name": subject_name,
                "days": days,
                "note": ai.generate_streak_note(subject_name, days),
            })

        coins = db.user_coins(user["id"])

        return self.send_json(200, {"ok": True, "overall": overall, "courses": courses, "coins": coins})

    # -----------------------------------------------------
    # GET /api/leaderboard — every student ranked by Glide COINS,
    # plus the logged-in user's own rank (None if they're not a
    # student account, e.g. a parent/teacher/management login).
    # -----------------------------------------------------
    def handle_leaderboard(self):
        user = self.require_user()
        if not user:
            return

        rows = db.leaderboard()
        my_rank = None
        for i, row in enumerate(rows):
            if row["userId"] == user["id"]:
                my_rank = i + 1
                break

        return self.send_json(200, {
            "ok": True,
            "leaderboard": [
                {"rank": i + 1, "userId": r["userId"], "name": r["name"], "coins": r["coins"]}
                for i, r in enumerate(rows)
            ],
            "myUserId": user["id"],
            "myRank": my_rank,
        })

    # -----------------------------------------------------
    # Static file serving for the frontend in ./public
    # -----------------------------------------------------
    def serve_static(self, pathname, method):
        relative_path = "/login.html" if pathname == "/" else pathname

        if relative_path in PROTECTED_PAGES and not self.current_user():
            self.send_response(302)
            self.send_header("Location", "/login.html")
            self.end_headers()
            return

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


class Server(ThreadingHTTPServer):
    # daemon_threads=True means a thread stuck on a slow/stalled client
    # (even bounded by Handler.timeout above) can never block process
    # shutdown — Python exits and kills it rather than hanging on join().
    daemon_threads = True
    allow_reuse_address = True


def main():
    server = Server(("", PORT), Handler)

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
    if not ai.GROQ_API_KEY:
        print(
            "WARNING: GROQ_API_KEY is not set — every AI feature (quick-check "
            "questions, SWOT, syllabus, flashcards, progress insights) will "
            "silently fall back and the frontend will show \"AI generation "
            "isn't available right now\". Get a free key at "
            "https://console.groq.com/keys, then copy server/.env.example to "
            "server/.env and paste it in (or `export GROQ_API_KEY=...` "
            "before starting the server), then restart."
        )

    try:
        server.serve_forever()
    except SystemExit:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
