"""
GlideLEARN backend — ai.py

Talks to Groq's free cloud AI API (https://console.groq.com) to
generate quiz questions and study syllabi that adapt to a student's
past performance on that unit. Groq gives out free API keys with a
generous free-tier rate limit — no credit card, no local install.

The API key is read from, in order:
  1. the GROQ_API_KEY environment variable
  2. a GROQ_API_KEY=... line in a .env file next to this script

.env is entirely optional and is NEVER something to commit or share —
it exists purely so you don't have to `export GROQ_API_KEY=...` in
every new terminal. See the "GROQ_API_KEY" section in README.md.

If no key is found, or a request fails/times out/returns something
unusable, every function below returns None so the caller in
server.py falls back to the curated question/topic banks in the
frontend — nothing breaks either way.
"""

import json
import os
import urllib.error
import urllib.request

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
# llama-3.3-70b-versatile was Groq's default here previously, but Groq
# fully decommissioned it (along with llama-3.1-8b-instant) on
# August 16, 2026 — see https://console.groq.com/docs/deprecations.
# openai/gpt-oss-120b is Groq's recommended replacement: free-tier
# eligible, and supports the same JSON response_format mode used below.
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
TIMEOUT_SECONDS = int(os.environ.get("GROQ_TIMEOUT", "30"))

_ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")


def _load_dotenv_key():
    """Reads GROQ_API_KEY=... from a local .env file, if one exists.
    Deliberately minimal (no third-party dependency) — just looks for
    a single matching KEY=value line, ignores comments/blank lines."""
    if not os.path.isfile(_ENV_FILE):
        return ""
    try:
        with open(_ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                if key.strip() == "GROQ_API_KEY":
                    return value.strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "") or _load_dotenv_key()


def _call_ai(prompt):
    if not GROQ_API_KEY:
        return None

    payload = json.dumps(
        {
            "model": GROQ_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.6,
            "max_tokens": 800,
            "response_format": {"type": "json_object"},
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        GROQ_API_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {GROQ_API_KEY}",
            # Cloudflare (which fronts api.groq.com) runs a bot-signature
            # rule that blocks requests carrying Python's default
            # urllib User-Agent ("Python-urllib/3.x") — that's what a
            # bare "403 error code: 1010" from Groq actually is: a
            # Cloudflare block before the request ever reaches Groq's
            # own API logic. A normal-looking User-Agent avoids it.
            "User-Agent": "GlideLEARN-StudyPlanner/1.0 (+https://github.com/)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        print("Groq API returned an error:", err.code, err.read().decode("utf-8", "ignore"))
        return None
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError) as err:
        print("Groq API request failed:", err)
        return None

    try:
        text = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return None

    if not text:
        return None

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Occasionally a model wraps JSON in prose or a code fence even
        # when told not to — salvage the outermost {...} block.
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return None
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None


def _history_summary(plan_rows):
    if not plan_rows:
        return "This is the student's first attempt at this unit — no history yet."
    lines = [
        "- scored {}/{} ({} level) on {}".format(
            row["score_correct"], row["score_total"], row["level_label"], row["created_at"]
        )
        for row in plan_rows
    ]
    return "The student's past attempts at this unit, most recent first:\n" + "\n".join(lines)


def generate_quiz(subject, unit, notes, history_rows):
    """Returns a list of {q, options, correct} dicts, or None on failure."""
    history = _history_summary(history_rows)
    prompt = f"""You are writing a short multiple-choice knowledge check for a student.
Subject: {subject}
Unit: {unit}
Student's notes / focus request: {notes or "none given"}
{history}

Write exactly 3 multiple-choice questions for this unit, each with 4 options.
Calibrate difficulty to the student's history above: if they've scored well
before, make these noticeably harder and probe deeper into the unit; if
they've struggled, keep the questions foundational and clearly worded; if
there's no history yet, use a mixed, moderate difficulty.

Respond with ONLY valid JSON in exactly this shape, nothing else — no
markdown, no commentary:
{{"questions": [{{"q": "question text", "options": ["a", "b", "c", "d"], "correct": 0}}]}}
"correct" is the zero-based index of the right entry in "options".
"""
    data = _call_ai(prompt)
    if not data or not isinstance(data.get("questions"), list):
        return None

    cleaned = []
    for item in data["questions"]:
        if (
            isinstance(item, dict)
            and isinstance(item.get("q"), str)
            and item["q"].strip()
            and isinstance(item.get("options"), list)
            and len(item["options"]) >= 2
            and all(isinstance(o, str) and o.strip() for o in item["options"])
            and isinstance(item.get("correct"), int)
            and 0 <= item["correct"] < len(item["options"])
        ):
            cleaned.append(
                {"q": item["q"], "options": item["options"], "correct": item["correct"]}
            )

    return cleaned or None


def generate_syllabus(subject, unit, minutes, level, score_correct, score_total, notes):
    """Returns a list of topic strings, or None on failure."""
    prompt = f"""You are building a personalized study session plan for a student.
Subject: {subject}
Unit: {unit}
Session length: {minutes} minutes
Quick-check quiz result just now: {score_correct}/{score_total} correct — {level} level
Student's notes / focus request: {notes or "none given"}

List 4 to 6 topics to cover in this session, ordered and weighted to suit a
student at the {level} level: start more foundational and review-heavy for a
lower score, and weight toward practice, depth, or advanced material for a
higher score. Keep each topic to a short phrase (a few words).

Respond with ONLY valid JSON in exactly this shape, nothing else — no
markdown, no commentary:
{{"topics": ["topic one", "topic two"]}}
"""
    data = _call_ai(prompt)
    if not data or not isinstance(data.get("topics"), list):
        return None
    topics = [t.strip() for t in data["topics"] if isinstance(t, str) and t.strip()]
    return topics or None
