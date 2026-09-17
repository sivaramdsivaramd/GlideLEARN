# GlideLEARN — sign-in + study planner (Python backend)

A dependency-free Python backend that serves **both** GlideLEARN
screens — the sign-in/sign-up gate and the study planner — from one
process, with real accounts, sessions, and saved study plans in
SQLite. Nothing to `pip install`.

## Requirements

- Python **3.8+** (uses `hashlib.scrypt`, available in the standard
  library on any Python built with OpenSSL support — the default on
  Ubuntu). Check with `python3 --version`.

## Run it

```
cd server
python3 server.py
```

Then open **http://localhost:3000** in your browser. To use a
different port: `PORT=4000 python3 server.py`.

Press **Ctrl+C** to stop the server. This also wipes `server/data/`
(the SQLite file and everything in it), so no account or plan data
is left behind between runs.

## How the two pages connect

1. **`login.html`** (served at `/`) — sign in or create an account.
   A successful login calls `POST /api/login`, which starts a
   session and sets an `HttpOnly` cookie, then the page redirects to
   `study-planner.html`.
2. **`study-planner.html`** — opens on a **Dashboard** (profile,
   course list with real progress bars, and Courses / Progress Level
   / Streak Score tiles). The server only serves this page if the
   request carries a valid session cookie; otherwise it redirects
   back to `login.html`.
3. **Courses** tile → the study wizard: **study time → subject →
   unit → per-topic AI quiz → AI SWOT analysis → AI syllabus (with a
   SWOT-weighted focus map) → AI flashcards**, then saves the
   finished session and returns to the dashboard.
4. **Progress Level** tile → real progress charts (overall + one per
   course) built from every saved session, each with a short AI
   coaching note.
5. **Streak Score** tile → a sub-tab per course (plus Overall)
   showing a real consecutive-day streak with a short AI remark.

Both pages share one visual theme (`style.css`) — a light theme
throughout, full-screen/edge-to-edge on every page except sign-in
(which keeps its centered two-panel card).

## AI features (Groq, free cloud API)

Every AI-driven piece of the study wizard runs through
[Groq](https://console.groq.com) — a free cloud AI API (no credit
card required, generous free-tier limits). **None of these have a
curated fallback** — if no key is set, the relevant step shows a
clear "AI unavailable" message with the reason, rather than silently
substituting canned content:

- **`POST /api/generate-topic-quiz`** — 2-3 multiple-choice questions
  per topic in the chosen unit.
- **`POST /api/generate-swot`** — a Strengths/Weaknesses/
  Opportunities/Threats analysis built from the per-topic quiz scores
  just achieved.
- **`POST /api/generate-syllabus`** — a syllabus plus a "focus map"
  (relative time/emphasis per topic) weighted toward the SWOT's
  weaknesses and threats.
- **`POST /api/generate-flashcards`** — 6-8 flashcards for the topics
  just covered.
- **`GET /api/progress`** / **`GET /api/streaks`** — the charts and
  streak counts themselves are computed from real saved sessions in
  SQLite; each just gets a short (1-2 sentence) AI coaching note
  layered on top. If the AI call fails, the chart/streak still shows
  — it just has no note.

### Setting up your API key

1. Create a free account at https://console.groq.com and generate an
   API key under **API Keys**.
2. Give the server that key one of two ways:
   - **Per-session (simplest):**
     ```
     export GROQ_API_KEY="your-key-here"
     python3 server.py
     ```
   - **Persistent (so you don't retype it every terminal session):**
     copy `.env.example` to `.env` in this folder and put your key in
     it. `ai.py` reads `.env` automatically if `GROQ_API_KEY` isn't
     already set as an environment variable. **Never commit or share
     your real `.env`** — `.gitignore` already excludes it, and if a
     key is ever pasted somewhere public (chat, a repo, a screenshot),
     regenerate it at the link above immediately.

To use a different Groq model:
```
GROQ_MODEL=openai/gpt-oss-20b python3 server.py
```

**If a wizard step keeps saying AI generation isn't available** even
with `GROQ_API_KEY` set, check the server's terminal output — a
failed Groq call prints the exact error there. Two common causes:
- **`model_not_found` / `model_decommissioned`** — the model name is stale;
  Groq regularly retires older models. Check the current list at
  https://console.groq.com/docs/models.
- **`403 error code: 1010`** — this is a Cloudflare block in front of Groq's
  API (Cloudflare rejects requests that look like default `Python-urllib`
  traffic), not an error from Groq itself. `ai.py` already sends a normal
  `User-Agent` header to avoid this; if you still see it, your network
  (corporate proxy/VPN/firewall) may be the one being flagged instead.

## API reference

- **`POST /api/signup`** — validates fields for the chosen role
  (student, teacher, parent, management), hashes the password
  (scrypt + per-user salt), generates a login code (e.g.
  `STU000002`), and stores the account.
- **`POST /api/login`** — checks a login code or email + password,
  and on success starts a session (sets the `glidelearn_session`
  cookie).
- **`POST /api/logout`** — ends the current session and clears the
  cookie.
- **`GET /api/me`** — returns the account behind the current session
  cookie, or 401 if there isn't one.
- **`GET /api/dashboard-summary`** — profile info, per-course
  progress %, and overall streak, for the dashboard.
- **`POST /api/generate-topic-quiz`**, **`POST /api/generate-swot`**,
  **`POST /api/generate-syllabus`**, **`POST /api/generate-flashcards`**
  — see "AI features" above.
- **`POST /api/study-plan`** — saves a finished wizard run (subject,
  unit, duration, quiz score, level, syllabus topics) for the
  logged-in user. Requires a session.
- **`GET /api/study-plans`** — lists the logged-in user's saved
  plans, most recent first (shown under "My past plans"). Requires a
  session.
- **`GET /api/progress`** / **`GET /api/streaks`** — see "AI
  features" above. Requires a session.
- **`GET /api/health`** — liveness check.

The database file is created automatically on first run at
`server/data/glidelearn.sqlite`, along with the same demo account the
UI already advertises (`STU2026001` / `Passw0rd!`).

## Project layout

```
server/
  server.py     — HTTP server, routing, sessions, request handling
  db.py         — SQLite schema (users, sessions, study_plans),
                  password hashing, progress/streak queries
  ai.py         — Groq cloud API integration for every AI feature
  roles.py      — per-role signup field definitions
  public/
    login.html          — sign-in / sign-up gate (centered card)
    study-planner.html  — dashboard + study wizard (protected, full-screen)
    login-script.js      — gate + auth logic, posts to /api/*
    planner-script.js    — dashboard/wizard/progress/streak logic
    style.css            — shared light theme for both pages
    logo.png
  data/         — SQLite database file (created automatically,
                  deleted automatically on Ctrl+C)
```

## Notes / things to harden before real use

This is intentionally minimal so it runs anywhere with zero setup.
Before using it for anything beyond a demo, you'd want to add:

- HTTPS (put it behind a reverse proxy, e.g. nginx or Caddy) and mark
  the session cookie `Secure` once you're on HTTPS
- CSRF protection on the state-changing POST endpoints
- Rate limiting on `/api/login` to slow down password guessing
- Server-side email format/verification beyond the basic regex check
- A process manager (systemd, supervisord) to keep it running and
  restart on crash
- Swap `http.server`'s threading model for a proper WSGI/ASGI server
  (e.g. gunicorn/uvicorn) if you outgrow a single dev process
- Persist data across restarts (currently wiped on Ctrl+C, matching
  the original demo behavior — remove the wipe in `close_and_wipe`
  callers if you want it to stick around)
