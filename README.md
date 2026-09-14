# GlideLEARN — backend (Python)

A tiny, dependency-free Python backend for the GlideLEARN sign-in / sign-up
screen. It serves the frontend and stores accounts in a real SQLite database
using Python's built-in `sqlite3` module — nothing to `pip install`.

## Requirements

- Python **3.8+** (uses `hashlib.scrypt`, available in the standard library
  on any Python built with OpenSSL support — the default on Ubuntu). Check
  with `python3 --version`.

## Run it

```
cd server
python3 server.py
```

Then open **http://localhost:3000** in your browser. That's the whole app —
gate, sign in, sign up — served from this one process.

To use a different port: `PORT=4000 python3 server.py`.

Press **Ctrl+C** to stop the server. This also wipes `server/data/`
(the SQLite file and everything in it), so no account data is left behind.

## What it does

- **`POST /api/signup`** — validates the fields for the chosen role (student,
  teacher, parent, management), hashes the password (scrypt + per-user salt,
  via `hashlib`), generates a login code (e.g. `STU000002`), and stores the
  account in `server/data/glidelearn.sqlite`.
- **`POST /api/login`** — looks the account up by login code *or* email and
  verifies the password against the stored hash.
- **`GET /api/health`** — liveness check.

The database file is created automatically on first run at
`server/data/glidelearn.sqlite`, along with the same demo account the UI
already advertises (`STU2026001` / `Passw0rd!`), so that hint keeps working.

## Project layout

```
server/
  server.py     — HTTP server, routing, request handling
  db.py         — SQLite schema, password hashing, queries
  roles.py      — per-role field definitions (mirrors the frontend form)
  public/       — the frontend (login.html, style.css, script.js, logo.png)
  data/         — SQLite database file lives here (created automatically,
                  deleted automatically on Ctrl+C)
```

## Notes / things to harden before real use

This is intentionally minimal so it runs anywhere with zero setup. Before
using it for anything beyond a demo, you'd want to add:

- HTTPS (put it behind a reverse proxy, e.g. nginx or Caddy)
- Sessions or a signed token so "logged in" persists across page loads
- Rate limiting on `/api/login` to slow down password guessing
- Server-side email format/verification beyond the basic regex check
- A process manager (pm2-equivalent: systemd, supervisord) to keep it
  running and restart on crash
- Swap `http.server`'s threading model for a proper WSGI/ASGI server
  (e.g. gunicorn/uvicorn) if you outgrow a single dev process
