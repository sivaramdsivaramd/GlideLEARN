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
# openai/gpt-oss-120b (like every current Groq "reasoning" model) spends
# part of this budget on an internal reasoning pass BEFORE it writes the
# JSON we actually asked for — that reasoning isn't optional and isn't
# free, so a budget sized only for the visible answer routinely gets
# exhausted by reasoning alone. When that happens the API returns
# finish_reason:"length" with message.content == "" (no error, no
# exception — just silence), which every function below already treats
# as "the model produced nothing", so it falls back to the curated
# banks. 2000 leaves enough headroom for a "low"-effort reasoning pass
# (see REASONING_EFFORT below) plus the largest JSON shape we ask for
# (generate_topic_quizzes, several topics x 2-3 questions x 4 options).
MAX_TOKENS = int(os.environ.get("GROQ_MAX_TOKENS", "2000"))
# 'low' is the smallest reasoning budget Groq exposes for this model
# ('low' | 'medium' | 'high' — 'medium' is Groq's own default). Every
# prompt below is a well-specified extraction/generation task, not a
# multi-step problem that benefits from heavier deliberation, so 'low'
# both frees up tokens for the actual answer and speeds up every call.
REASONING_EFFORT = os.environ.get("GROQ_REASONING_EFFORT", "low")

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
        print(
            "Groq API: no GROQ_API_KEY found (checked the GROQ_API_KEY "
            "environment variable and " + _ENV_FILE + ") — skipping AI call "
            "and falling back. Get a free key at "
            "https://console.groq.com/keys, then either "
            "`export GROQ_API_KEY=...` or copy .env.example to .env and "
            "fill it in, then restart the server."
        )
        return None

    payload = json.dumps(
        {
            "model": GROQ_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.6,
            # max_tokens is Groq's deprecated name for this field (still
            # accepted, but max_completion_tokens is the current one —
            # see https://console.groq.com/docs/api-reference). It caps
            # reasoning + visible output together, hence MAX_TOKENS
            # being sized well above just the visible JSON; see the
            # comment on MAX_TOKENS above.
            "max_completion_tokens": MAX_TOKENS,
            "reasoning_effort": REASONING_EFFORT,
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
        choice = body["choices"][0]
        text = choice["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return None

    if not text:
        # Distinguish "the reasoning pass ate the whole token budget"
        # (finish_reason "length" with nothing written yet) from other
        # empty-content cases — same fallback either way, but this is
        # the one that's actually fixable by raising GROQ_MAX_TOKENS or
        # lowering GROQ_REASONING_EFFORT, so it's worth calling out
        # rather than logging nothing (or the same message as every
        # other failure).
        if choice.get("finish_reason") == "length":
            print(
                "Groq API: response truncated before any content was "
                "written (finish_reason=length, empty content) — the "
                f"reasoning pass likely used the full {MAX_TOKENS}-token "
                "budget. Try raising GROQ_MAX_TOKENS or lowering "
                "GROQ_REASONING_EFFORT (currently "
                f"'{REASONING_EFFORT}')."
            )
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


def generate_topic_quizzes(subject, unit, topics, notes):
    """Returns {topic: [{q, options, correct}, ...]} covering every
    topic in `topics` with 2-3 questions each, or None on failure."""
    topic_list = "\n".join(f"- {t}" for t in topics)
    prompt = f"""You are writing a short multiple-choice knowledge check for a student.
Subject: {subject}
Unit: {unit}
Student's notes / focus request: {notes or "none given"}

The unit covers these topics:
{topic_list}

For EVERY topic listed above, write 2 or 3 multiple-choice questions (4
options each) that specifically test that topic. Keep difficulty moderate
and foundational — this is a first quick-check, not a final exam.

Respond with ONLY valid JSON in exactly this shape, nothing else — no
markdown, no commentary. Use the exact topic text as given above as the
"topic" key for each group, and include every topic:
{{"topics": [{{"topic": "exact topic text", "questions": [{{"q": "question text", "options": ["a","b","c","d"], "correct": 0}}]}}]}}
"correct" is the zero-based index of the right entry in "options".
"""
    data = _call_ai(prompt)
    if not data or not isinstance(data.get("topics"), list):
        return None

    result = {}
    for group in data["topics"]:
        if not isinstance(group, dict) or not isinstance(group.get("topic"), str):
            continue
        questions = group.get("questions")
        if not isinstance(questions, list):
            continue
        cleaned = []
        for item in questions:
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
        if cleaned:
            result[group["topic"].strip()] = cleaned

    return result or None


def generate_swot(subject, unit, topic_results):
    """topic_results: [{topic, correct, total}, ...] from the quick-check
    just taken. Returns {strengths, weaknesses, opportunities, threats}
    (each a list of short strings), or None on failure."""
    lines = "\n".join(
        f"- {r['topic']}: {r['correct']}/{r['total']} correct" for r in topic_results
    )
    prompt = f"""You are a tutor analyzing a student's quick-check quiz results for one
study unit, to build a SWOT analysis (Strengths, Weaknesses, Opportunities,
Threats) specific to their performance on THIS unit.

Subject: {subject}
Unit: {unit}
Per-topic results just now:
{lines}

Write a SWOT analysis grounded in these actual per-topic scores:
- Strengths: topics they clearly did well on
- Weaknesses: topics they scored poorly on
- Opportunities: specific, actionable ways they could improve (study tactics,
  what to revisit, how to practice)
- Threats: risks if the weak topics aren't addressed (e.g. topics that build
  on each other, exam relevance)
2-4 short bullet points per quadrant.

Respond with ONLY valid JSON in exactly this shape, nothing else — no
markdown, no commentary:
{{"strengths": ["..."], "weaknesses": ["..."], "opportunities": ["..."], "threats": ["..."]}}
"""
    data = _call_ai(prompt)
    if not data:
        return None
    quadrants = {}
    for key in ("strengths", "weaknesses", "opportunities", "threats"):
        items = data.get(key)
        if not isinstance(items, list):
            return None
        quadrants[key] = [i.strip() for i in items if isinstance(i, str) and i.strip()]
    if not any(quadrants.values()):
        return None
    return quadrants


def generate_syllabus_from_swot(subject, unit, minutes, swot, notes):
    """Builds a syllabus + a "focus map" (relative emphasis per topic,
    0-100) weighted toward the SWOT weaknesses/threats. Returns
    {"topics": [...], "focus": [{"topic":..., "pct":...}, ...]} or None."""
    prompt = f"""You are building a personalized study session plan for a student, based
on a SWOT analysis of their quick-check quiz performance on one unit.

Subject: {subject}
Unit: {unit}
Session length: {minutes} minutes
Student's notes / focus request: {notes or "none given"}

SWOT analysis for this unit:
Strengths: {swot.get("strengths", [])}
Weaknesses: {swot.get("weaknesses", [])}
Opportunities: {swot.get("opportunities", [])}
Threats: {swot.get("threats", [])}

Build a syllabus of 4 to 7 topics/activities to cover in this session,
weighted toward the weaknesses and threats above (more time/coverage on
weak areas) while still briefly reinforcing strengths. Also produce a
"focus map": for each topic, a rough percentage (all percentages should
sum to roughly 100) of how much of the session's time/emphasis it should
get, higher for weaker areas.

Respond with ONLY valid JSON in exactly this shape, nothing else — no
markdown, no commentary:
{{"topics": ["topic one", "topic two"], "focus": [{{"topic": "topic one", "pct": 40}}, {{"topic": "topic two", "pct": 60}}]}}
"""
    data = _call_ai(prompt)
    if not data or not isinstance(data.get("topics"), list):
        return None
    topics = [t.strip() for t in data["topics"] if isinstance(t, str) and t.strip()]
    if not topics:
        return None

    focus = []
    if isinstance(data.get("focus"), list):
        for item in data["focus"]:
            if (
                isinstance(item, dict)
                and isinstance(item.get("topic"), str)
                and isinstance(item.get("pct"), (int, float))
            ):
                focus.append({"topic": item["topic"].strip(), "pct": max(0, min(100, round(item["pct"])))})
    if not focus:
        # Even split fallback if the model skipped the focus map.
        share = round(100 / len(topics))
        focus = [{"topic": t, "pct": share} for t in topics]

    return {"topics": topics, "focus": focus}


def generate_flashcards(subject, unit, topics):
    """Returns a list of {front, back} dicts, or None on failure."""
    topic_list = ", ".join(topics) if topics else "the unit's key ideas"
    prompt = f"""Create study flashcards for a student who just finished a study session.
Subject: {subject}
Unit: {unit}
Topics covered: {topic_list}

Write 6 to 8 flashcards. Each "front" is a short question or term, each
"back" is a concise answer/definition (1-2 sentences max).

Respond with ONLY valid JSON in exactly this shape, nothing else — no
markdown, no commentary:
{{"cards": [{{"front": "...", "back": "..."}}]}}
"""
    data = _call_ai(prompt)
    if not data or not isinstance(data.get("cards"), list):
        return None
    cards = [
        {"front": c["front"].strip(), "back": c["back"].strip()}
        for c in data["cards"]
        if isinstance(c, dict)
        and isinstance(c.get("front"), str) and c["front"].strip()
        and isinstance(c.get("back"), str) and c["back"].strip()
    ]
    return cards or None


def generate_progress_insight(subject_name, avg_pct, attempts, trend):
    """Short (1-2 sentence) coaching note on a student's progress trend
    for one subject (or overall, if subject_name is 'Overall'). Returns
    a string, or None on failure."""
    trend_txt = ", ".join(f"{p}%" for p in trend) if trend else "no sessions yet"
    prompt = f"""A student has an average quiz score of {avg_pct}% across {attempts} study
session(s) in "{subject_name}". Their scores over time, oldest to newest:
{trend_txt}.

Write one short, encouraging, specific coaching sentence (max 25 words)
about their trend — improving, plateauing, or needs more practice.

Respond with ONLY valid JSON in exactly this shape, nothing else:
{{"insight": "..."}}
"""
    data = _call_ai(prompt)
    if not data or not isinstance(data.get("insight"), str) or not data["insight"].strip():
        return None
    return data["insight"].strip()


def generate_streak_note(subject_name, streak_days):
    """Short remark on a study streak for one subject. Returns a string,
    or None on failure."""
    prompt = f"""A student has a {streak_days}-day study streak in "{subject_name}"
(consecutive days with a completed study session).

Write one short, motivating sentence (max 18 words) reacting to this
streak — celebrate it if it's strong, gently encourage consistency if
it's short (1-2 days) or zero.

Respond with ONLY valid JSON in exactly this shape, nothing else:
{{"note": "..."}}
"""
    data = _call_ai(prompt)
    if not data or not isinstance(data.get("note"), str) or not data["note"].strip():
        return None
    return data["note"].strip()
