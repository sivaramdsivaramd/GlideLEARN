"""
GlideLEARN backend — db.py

Persistence for signup / login data using Python's built-in sqlite3.
No external dependencies, no pip install required.
"""

import hashlib
import json
import os
import secrets
import shutil
import sqlite3
import threading

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
DB_PATH = os.path.join(DATA_DIR, "glidelearn.sqlite")

os.makedirs(DATA_DIR, exist_ok=True)

_conn = sqlite3.connect(DB_PATH, check_same_thread=False)
_conn.row_factory = sqlite3.Row
_lock = threading.Lock()

_conn.execute(
    """
    CREATE TABLE IF NOT EXISTS users (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        role               TEXT    NOT NULL,
        login_code         TEXT    NOT NULL UNIQUE,
        -- Nullable: parent accounts don't have their own login email (see
        -- linked_student_id below), so this column only holds a *login*
        -- email address for roles that actually have one. SQLite treats
        -- each NULL as distinct for UNIQUE purposes, so any number of
        -- parent rows can have a NULL email here without colliding.
        email              TEXT    UNIQUE,
        full_name          TEXT    NOT NULL,
        extra_json         TEXT    NOT NULL DEFAULT '{}',
        password_salt      TEXT    NOT NULL,
        password_hash      TEXT    NOT NULL,
        -- For parent accounts: the id of the student account they're
        -- linked to. Never a login credential itself.
        linked_student_id  INTEGER REFERENCES users(id),
        created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
    )
    """
)
_conn.commit()


class EmailTakenError(Exception):
    """Raised when a signup email is already registered."""


# ---------------------------------------------------------
# Password hashing — scrypt with a random salt per user.
# ---------------------------------------------------------
def hash_password(password):
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt.encode("utf-8"), n=16384, r=8, p=1, dklen=64
    ).hex()
    return salt, digest


def verify_password(password, salt, expected_hash):
    computed = hashlib.scrypt(
        password.encode("utf-8"), salt=salt.encode("utf-8"), n=16384, r=8, p=1, dklen=64
    ).hex()
    return secrets.compare_digest(computed, expected_hash)


# ---------------------------------------------------------
# Login code generation — e.g. STU000001, TCH000004
# ---------------------------------------------------------
def _next_login_code(role, prefix):
    row = _conn.execute("SELECT COUNT(*) AS n FROM users WHERE role = ?", (role,)).fetchone()
    seq = (row["n"] or 0) + 1
    return f"{prefix}{seq:06d}"


# ---------------------------------------------------------
# Public data access functions
# ---------------------------------------------------------
def find_user_by_email(email):
    normalized = str(email or "").strip().lower()
    if not normalized:
        return None
    return _conn.execute(
        "SELECT * FROM users WHERE email = ?", (normalized,)
    ).fetchone()


def find_user_by_login_code(login_code):
    return _conn.execute(
        "SELECT * FROM users WHERE login_code = ?", (str(login_code).strip().upper(),)
    ).fetchone()


def find_user_by_identifier(identifier):
    raw = str(identifier or "").strip()
    return find_user_by_login_code(raw) or find_user_by_email(raw.lower())


def find_user_by_id(user_id):
    return _conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def create_user(role, prefix, email, full_name, extra, password, linked_student_id=None):
    # `email` is the account's own login email. Parent accounts don't have
    # one (they link to a student via linked_student_id instead), so callers
    # pass email=None for parent signups rather than reusing the student's
    # address here — that's what previously caused parent signup to collide
    # with the very student account it was trying to link to.
    normalized_email = str(email).strip().lower() if email else None

    with _lock:
        if normalized_email and find_user_by_email(normalized_email):
            raise EmailTakenError("An account with that email already exists.")

        login_code = _next_login_code(role, prefix)
        salt, digest = hash_password(password)

        _conn.execute(
            """INSERT INTO users
               (role, login_code, email, full_name, extra_json,
                password_salt, password_hash, linked_student_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                role,
                login_code,
                normalized_email,
                full_name,
                json.dumps(extra or {}),
                salt,
                digest,
                linked_student_id,
            ),
        )
        _conn.commit()

    return find_user_by_login_code(login_code)


def to_public_user(row):
    if row is None:
        return None
    return {
        "id": row["id"],
        "role": row["role"],
        "loginCode": row["login_code"],
        "email": row["email"],
        "fullName": row["full_name"],
        "extra": json.loads(row["extra_json"] or "{}"),
        "linkedStudentId": row["linked_student_id"],
        "createdAt": row["created_at"],
    }


# ---------------------------------------------------------
# Seed the same demo account the frontend has always
# advertised, so the "Demo account" hint keeps working.
# ---------------------------------------------------------
def _seed_demo_account():
    if find_user_by_email("test@example.com"):
        return
    if find_user_by_login_code("STU2026001"):
        return

    salt, digest = hash_password("Passw0rd!")
    _conn.execute(
        """INSERT INTO users
           (role, login_code, email, full_name, extra_json, password_salt, password_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            "student",
            "STU2026001",
            "test@example.com",
            "Test Student",
            json.dumps({"standard": "10th Grade", "schoolName": "GlideLEARN Demo School"}),
            salt,
            digest,
        ),
    )
    _conn.commit()


_seed_demo_account()


# ---------------------------------------------------------
# Shutdown helper — closes the SQLite handle and deletes the
# data directory (used by server.py on Ctrl+C).
# ---------------------------------------------------------
def close_and_wipe():
    try:
        _conn.close()
    except Exception:
        pass
    if os.path.exists(DATA_DIR):
        shutil.rmtree(DATA_DIR, ignore_errors=True)
