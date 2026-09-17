/* =========================================================
   GlideLEARN — study planner script.js

   Flow: Dashboard -> (Courses) -> study time -> subject -> unit
   -> per-topic AI quiz -> AI SWOT analysis -> AI syllabus + focus
   map -> AI flashcards -> back to Dashboard. Dashboard also opens
   Progress Level and Streak Score, both backed by real saved
   session data (server/db.py) plus a short AI note (server/ai.py).
   ========================================================= */

(function () {
  "use strict";

  // ---------------------------------------------------------
  // Account
  // ---------------------------------------------------------
  const accountName = document.getElementById("accountName");
  const logoutBtn = document.getElementById("logoutBtn");
  const pastPlansBtn = document.getElementById("pastPlansBtn");

  let currentUser = null;

  fetch("/api/me")
    .then(function (res) { return res.ok ? res.json() : Promise.reject(); })
    .then(function (data) {
      currentUser = data.user;
      accountName.textContent = "Signed in as " + currentUser.fullName + " (" + currentUser.loginCode + ")";
      renderDashboard();
    })
    .catch(function () {
      window.location.href = "login.html";
    });

  logoutBtn.addEventListener("click", function () {
    fetch("/api/logout", { method: "POST" }).finally(function () {
      window.location.href = "login.html";
    });
  });

  // ---------------------------------------------------------
  // Content data
  // ---------------------------------------------------------
  const SUBJECTS = [
    { id: "mathematics", name: "Mathematics", color: "#0E9CB8",
      icon: '<path d="M4 20V4M4 20h16"/><path d="M7 16c2-6 5-6 7-10"/>' },
    { id: "physics", name: "Physics", color: "#5352D6",
      icon: '<circle cx="12" cy="12" r="1.8"/><ellipse cx="12" cy="12" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)"/>' },
    { id: "chemistry", name: "Chemistry", color: "#E0553A",
      icon: '<path d="M9 3h6"/><path d="M10 3v5l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/>' },
    { id: "biology", name: "Biology", color: "#1FA97A",
      icon: '<path d="M5 20c0-8 6-14 14-14 0 8-6 14-14 14Z"/><path d="M5 20c3-3 7-7 11-11"/>' },
    { id: "english", name: "English", color: "#E08A00",
      icon: '<path d="M4 5.5c2-1 5-1 8 .5 3-1.5 6-1.5 8-.5v13c-2-1-5-1-8 .5-3-1.5-6-1.5-8-.5V5.5Z"/><path d="M12 6v13"/>' },
    { id: "computer-science", name: "Computer Science", color: "#D63C87",
      icon: '<path d="M8 9 4 12l4 3"/><path d="M16 9l4 3-4 3"/><path d="M14 7l-4 10"/>' }
  ];

  const DURATIONS = [
    { id: "30m",  label: "30 mins", minutes: 30 },
    { id: "1h",   label: "1 hr",    minutes: 60 },
    { id: "1.5h", label: "1.5 hr",  minutes: 90 },
    { id: "2h",   label: "2 hr",    minutes: 120 },
    { id: "custom", label: "Custom", minutes: null }
  ];

  const UNITS = {
    mathematics: [
      { id: "algebra-basics",          name: "Algebra Basics" },
      { id: "geometry-fundamentals",   name: "Geometry Fundamentals" },
      { id: "statistics-probability",  name: "Statistics & Probability" }
    ],
    physics: [
      { id: "motion-forces",             name: "Motion & Forces" },
      { id: "energy-work",               name: "Energy & Work" },
      { id: "electricity-magnetism",     name: "Electricity & Magnetism" }
    ],
    chemistry: [
      { id: "atoms-molecules",       name: "Atoms & Molecules" },
      { id: "chemical-reactions",    name: "Chemical Reactions" },
      { id: "acids-bases-salts",     name: "Acids, Bases & Salts" }
    ],
    biology: [
      { id: "cells-life-processes",   name: "Cells & Life Processes" },
      { id: "human-body-systems",     name: "Human Body Systems" },
      { id: "ecology-environment",    name: "Ecology & Environment" }
    ],
    english: [
      { id: "grammar-essentials",       name: "Grammar Essentials" },
      { id: "reading-comprehension",    name: "Reading Comprehension" },
      { id: "creative-writing",         name: "Creative Writing" }
    ],
    "computer-science": [
      { id: "programming-basics",      name: "Programming Basics" },
      { id: "data-structures-intro",   name: "Data Structures — Introduction" },
      { id: "internet-web-basics",     name: "Internet & Web Basics" }
    ]
  };

  // Topic names per unit — the wizard asks the AI for 2-3 quiz
  // questions on each of these, then a SWOT + syllabus + flashcards
  // that build on how the student did per topic.
  const UNIT_TOPICS = {
    "algebra-basics": ["Understanding variables and constants", "Solving one-step equations", "Solving two-step equations", "Simplifying expressions", "Word problems using algebra"],
    "geometry-fundamentals": ["Types of angles", "Properties of triangles", "Circles and their parts", "Area and perimeter basics", "Introduction to polygons"],
    "statistics-probability": ["Collecting and organizing data", "Mean, median and mode", "Understanding probability", "Reading graphs and charts", "Introduction to standard deviation"],
    "motion-forces": ["Understanding speed and velocity", "Newton's laws of motion", "Types of forces", "Friction and its effects", "Simple machines"],
    "energy-work": ["Understanding work and energy", "Kinetic vs. potential energy", "Conservation of energy", "Power and its units", "Renewable vs. non-renewable energy"],
    "electricity-magnetism": ["Basics of electric current", "Circuits — series and parallel", "Conductors and insulators", "Introduction to magnets", "Electromagnets and their uses"],
    "atoms-molecules": ["Structure of an atom", "Elements, compounds and mixtures", "The periodic table — the basics", "Chemical bonding, introduced", "Balancing simple equations"],
    "chemical-reactions": ["Signs of a chemical reaction", "Types of chemical reactions", "Balancing chemical equations", "Combustion reactions", "Reaction rates — an introduction"],
    "acids-bases-salts": ["Properties of acids and bases", "The pH scale explained", "Common acids and bases at home", "Neutralization reactions", "Uses of salts in daily life"],
    "cells-life-processes": ["Cell structure and function", "Plant vs. animal cells", "Photosynthesis basics", "Human organ systems, an overview", "Life processes in living things"],
    "human-body-systems": ["Overview of body systems", "The circulatory system", "The respiratory system", "The digestive system", "Introduction to the immune system"],
    "ecology-environment": ["Understanding ecosystems", "Food chains and food webs", "Producers, consumers and decomposers", "Human impact on the environment", "Conservation basics"],
    "grammar-essentials": ["Parts of speech", "Sentence structure", "Tenses, an overview", "Punctuation basics", "Common grammar mistakes"],
    "reading-comprehension": ["Identifying main ideas", "Making inferences", "Understanding context clues", "Summarizing a passage", "Analyzing the author's purpose"],
    "creative-writing": ["Elements of a story", "Using descriptive language", "Character development", "Plot structure basics", "Editing and revising your work"],
    "programming-basics": ["What is a program?", "Variables and data types", "Conditional statements", "Loops and repetition", "Writing your first simple program"],
    "data-structures-intro": ["Introduction to arrays / lists", "Understanding stacks", "Understanding queues", "Basic sorting concepts", "Choosing the right data structure"],
    "internet-web-basics": ["How the internet works", "Understanding web browsers", "Basics of websites and web pages", "Introduction to HTML", "Staying safe online"]
  };

  function subjectById(id) { return SUBJECTS.find(function (s) { return s.id === id; }); }
  function unitById(subjectId, unitId) {
    return (UNITS[subjectId] || []).find(function (u) { return u.id === unitId; });
  }

  // ---------------------------------------------------------
  // State
  // ---------------------------------------------------------
  const state = {
    subject: null, unit: null,
    duration: null, durationLabel: null, minutes: null,
    notes: "",
    topics: [],           // topic names for the chosen unit
    quizByTopic: {},       // topic -> [{q, options, correct}]
    topicIndex: 0,
    topicResults: [],      // [{topic, correct, total}]
    swot: null,
    syllabusTopics: [],
    focusMap: []
  };

  // ---------------------------------------------------------
  // View switching — same view-leave/view-enter handoff the login
  // page uses (see login-script.js showView()), so moving between
  // wizard steps, quiz, SWOT, syllabus, flashcards etc. animates
  // instead of hard-cutting. Respects prefers-reduced-motion.
  // ---------------------------------------------------------
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function showStep(name) {
    const current = document.querySelector(".step-view:not([hidden])");
    const next = document.getElementById("view-" + name);
    if (!next || current === next) return;

    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });

    if (!current || prefersReducedMotion) {
      document.querySelectorAll(".step-view").forEach(function (el) { el.hidden = true; });
      next.hidden = false;
      return;
    }

    current.classList.add("view-leave");
    current.addEventListener("animationend", function handoff() {
      current.removeEventListener("animationend", handoff);
      current.classList.remove("view-leave");
      current.hidden = true;

      next.hidden = false;
      next.classList.add("view-enter");
      next.addEventListener("animationend", function cleanup() {
        next.removeEventListener("animationend", cleanup);
        next.classList.remove("view-enter");
      });
    }, { once: true });
  }

  document.querySelectorAll("[data-back]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const target = btn.getAttribute("data-back");
      if (target === "dashboard") renderDashboard();
      showStep(target);
    });
  });

  // ---------------------------------------------------------
  // AI fetch helper — resolves to null (never rejects) so callers
  // can show a clear "AI unavailable" state instead of a fallback.
  // ---------------------------------------------------------
  const AI_TIMEOUT_MS = 45000;
  function callApi(url, payload, method) {
    return new Promise(function (resolve) {
      const controller = new AbortController();
      const timer = setTimeout(function () { controller.abort(); }, AI_TIMEOUT_MS);
      fetch(url, {
        method: method || "POST",
        headers: payload ? { "Content-Type": "application/json" } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
        signal: controller.signal
      }).then(function (res) {
        clearTimeout(timer);
        if (!res.ok) return resolve(null);
        res.json().then(resolve).catch(function () { resolve(null); });
      }).catch(function () {
        clearTimeout(timer);
        resolve(null);
      });
    });
  }

  // AI-generated text (flashcard fronts/backs, quiz options, etc.) can
  // legitimately contain "<", ">", "&" — inequality signs, chemical
  // formulas, "A & B" — and inserting that raw into innerHTML makes the
  // browser treat it as markup, which silently mangles or blanks the
  // card. Escape any AI/user text before it goes into innerHTML.
  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // =========================================================
  // DASHBOARD
  // =========================================================
  const dashboardName = document.getElementById("dashboardName");
  const dashboardRole = document.getElementById("dashboardRole");
  const avatarInitial = document.getElementById("avatarInitial");
  const tileProgressMetric = document.getElementById("tileProgressMetric");
  const tileStreakMetric = document.getElementById("tileStreakMetric");
  const dashboardCourseList = document.getElementById("dashboardCourseList");

  function renderDashboard() {
    showStep("dashboard");
    if (currentUser) {
      dashboardName.textContent = "Welcome back, " + currentUser.fullName.split(" ")[0] + "!";
      dashboardRole.textContent = currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1) + " · " + currentUser.loginCode;
      avatarInitial.textContent = currentUser.fullName.trim().charAt(0).toUpperCase() || "?";
    }

    callApi("/api/dashboard-summary", null, "GET").then(function (data) {
      if (!data || !data.ok) return;
      tileProgressMetric.innerHTML = data.overallProgressPct + "<span> % avg score</span>";
      tileStreakMetric.innerHTML = data.overallStreak + "<span> day streak</span>";

      dashboardCourseList.innerHTML = "";
      if (!data.courses.length) {
        const p = document.createElement("p");
        p.className = "ai-note";
        p.textContent = "No sessions yet — click Courses below to start your first one.";
        dashboardCourseList.appendChild(p);
        return;
      }
      data.courses.forEach(function (course) {
        const subj = subjectById(course.id);
        const color = subj ? subj.color : "#0E9CB8";
        const row = document.createElement("div");
        row.className = "course-row";
        row.innerHTML =
          '<span class="course-dot" style="background:' + color + '"></span>' +
          '<span class="course-name">' + course.name + '</span>' +
          '<span class="course-bar-track"><span class="course-bar-fill" style="width:' + course.progressPct + '%;background:' + color + '"></span></span>' +
          '<span class="course-pct">' + course.progressPct + '%</span>';
        dashboardCourseList.appendChild(row);
      });
    });
  }

  document.getElementById("tileCourses").addEventListener("click", function () {
    startCoursesFlow();
  });
  document.getElementById("tileProgress").addEventListener("click", loadProgressView);
  document.getElementById("tileStreak").addEventListener("click", loadStreakView);

  // =========================================================
  // COURSES WIZARD — Step 1: duration
  // =========================================================
  const durationGrid = document.getElementById("durationGrid");
  const durationError = document.getElementById("durationError");
  const customDurationFields = document.getElementById("customDurationFields");
  const customDurationValue = document.getElementById("customDurationValue");
  const customDurationUnit = document.getElementById("customDurationUnit");
  const durationStepUp = document.getElementById("durationStepUp");
  const durationStepDown = document.getElementById("durationStepDown");

  function stepDuration(delta) {
    const min = parseFloat(customDurationValue.min) || 1;
    const max = parseFloat(customDurationValue.max) || 600;
    const current = parseFloat(customDurationValue.value);
    // Bug fix: this used to compute a "base" of min (or min+1) and then
    // add delta on top of it, so the very first click from an empty
    // field jumped straight to 2 (up) or 1 (down) instead of landing on
    // min itself — skipping a value and being inconsistent between the
    // two directions. Starting empty at min is simpler and correct.
    if (isNaN(current)) {
      customDurationValue.value = min;
      return;
    }
    customDurationValue.value = Math.min(max, Math.max(min, current + delta));
  }
  durationStepUp.addEventListener("click", function () { stepDuration(1); });
  durationStepDown.addEventListener("click", function () { stepDuration(-1); });

  function renderDurations() {
    durationGrid.innerHTML = "";
    DURATIONS.forEach(function (d) {
      const label = document.createElement("label");
      label.className = "pill-card";
      label.innerHTML =
        '<input type="radio" name="duration" value="' + d.id + '" class="option-input">' + d.label;
      durationGrid.appendChild(label);
    });
    durationGrid.addEventListener("change", function () {
      const checked = document.querySelector('input[name="duration"]:checked');
      customDurationFields.hidden = !checked || checked.value !== "custom";
    });
  }

  function startCoursesFlow() {
    state.subject = null; state.unit = null;
    state.duration = null; state.durationLabel = null; state.minutes = null;
    state.notes = ""; state.topics = []; state.quizByTopic = {};
    state.topicIndex = 0; state.topicResults = []; state.swot = null;
    state.syllabusTopics = []; state.focusMap = [];
    renderDurations();
    customDurationFields.hidden = true;
    customDurationValue.value = "";
    durationError.textContent = "";
    showStep("duration");
  }

  document.querySelector('[data-next="duration"]').addEventListener("click", function () {
    const checked = document.querySelector('input[name="duration"]:checked');
    if (!checked) { durationError.textContent = "Choose how long you want to study."; return; }

    let minutes, label;
    if (checked.value === "custom") {
      const rawValue = parseFloat(customDurationValue.value);
      if (!rawValue || rawValue <= 0) { durationError.textContent = "Enter how long you want to study."; return; }
      const unit = customDurationUnit.value;
      minutes = Math.round(unit === "hours" ? rawValue * 60 : rawValue);
      label = unit === "hours" ? (rawValue + (rawValue === 1 ? " hour" : " hours")) : (rawValue + " mins");
    } else {
      const preset = DURATIONS.find(function (d) { return d.id === checked.value; });
      minutes = preset.minutes; label = preset.label;
    }

    durationError.textContent = "";
    state.duration = checked.value; state.minutes = minutes; state.durationLabel = label;
    renderSubjects();
    showStep("subject");
  });

  // =========================================================
  // COURSES WIZARD — Step 2: subject
  // =========================================================
  const subjectGrid = document.getElementById("subjectGrid");
  const subjectError = document.getElementById("subjectError");

  function renderSubjects() {
    subjectGrid.innerHTML = "";
    SUBJECTS.forEach(function (subject) {
      const label = document.createElement("label");
      label.className = "option-card";
      label.style.setProperty("--subj-color", subject.color);
      label.innerHTML =
        '<input type="radio" name="subject" value="' + subject.id + '" class="option-input">' +
        '<svg class="option-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + subject.icon + '</svg>' +
        '<span class="option-name">' + subject.name + '</span>';
      subjectGrid.appendChild(label);
    });
  }

  document.querySelector('[data-next="subject"]').addEventListener("click", function () {
    const checked = document.querySelector('input[name="subject"]:checked');
    if (!checked) { subjectError.textContent = "Choose a subject to continue."; return; }
    subjectError.textContent = "";
    state.subject = checked.value;
    renderUnits(state.subject);
    showStep("unit");
  });

  // =========================================================
  // COURSES WIZARD — Step 3: unit
  // =========================================================
  const unitGrid = document.getElementById("unitGrid");
  const unitError = document.getElementById("unitError");
  const aiNotesInput = document.getElementById("aiNotesInput");

  function renderUnits(subjectId) {
    unitGrid.innerHTML = "";
    (UNITS[subjectId] || []).forEach(function (unit) {
      const label = document.createElement("label");
      label.className = "option-card";
      label.innerHTML =
        '<input type="radio" name="unit" value="' + unit.id + '" class="option-input">' +
        '<span class="option-name">' + unit.name + '</span>';
      unitGrid.appendChild(label);
    });
  }

  document.querySelector('[data-next="unit"]').addEventListener("click", function () {
    const checked = document.querySelector('input[name="unit"]:checked');
    if (!checked) { unitError.textContent = "Choose a unit to continue."; return; }
    unitError.textContent = "";
    state.unit = checked.value;
    state.notes = aiNotesInput.value.trim();
    state.topics = UNIT_TOPICS[state.unit] || [];
    startTopicQuiz();
  });

  // =========================================================
  // COURSES WIZARD — Step 4: per-topic quiz
  // =========================================================
  const quizHeading = document.getElementById("quizHeading");
  const quizStatus = document.getElementById("quizStatus");
  const topicQuizContainer = document.getElementById("topicQuizContainer");
  const quizError = document.getElementById("quizError");
  const submitQuizBtn = document.getElementById("submitQuizBtn");

  function startTopicQuiz() {
    const subject = subjectById(state.subject);
    const unit = unitById(state.subject, state.unit);
    quizHeading.textContent = "Quick check: " + unit.name;
    topicQuizContainer.innerHTML = "";
    quizError.textContent = "";
    quizStatus.hidden = false;
    quizStatus.classList.add("is-loading");
    quizStatus.textContent = "Generating your questions with AI, 2–3 per topic…";
    submitQuizBtn.disabled = true;
    showStep("topic-quiz");

    callApi("/api/generate-topic-quiz", {
      subjectName: subject.name,
      unitName: unit.name,
      topics: state.topics,
      notes: state.notes
    }).then(function (result) {
      submitQuizBtn.disabled = false;
      quizStatus.classList.remove("is-loading");
      if (result && result.success && result.quizzes && Object.keys(result.quizzes).length) {
        state.quizByTopic = result.quizzes;
        quizStatus.textContent = "Questions generated by AI for every topic in this unit.";
        renderTopicQuiz();
      } else {
        quizStatus.textContent = "";
        topicQuizContainer.innerHTML = "";
        quizError.textContent = "AI question generation isn't available right now (check GROQ_API_KEY on the server). Try again in a moment.";
        submitQuizBtn.disabled = true;
      }
    });
  }

  function renderTopicQuiz() {
    topicQuizContainer.innerHTML = "";
    Object.keys(state.quizByTopic).forEach(function (topic, topicIdx) {
      const block = document.createElement("div");
      block.className = "topic-quiz-block";
      block.innerHTML =
        '<h3>' + topic + '</h3><p class="topic-progress">Topic ' + (topicIdx + 1) + ' of ' + Object.keys(state.quizByTopic).length + '</p>';

      state.quizByTopic[topic].forEach(function (q, qIdx) {
        const name = "t" + topicIdx + "_q" + qIdx;
        const qWrap = document.createElement("div");
        qWrap.className = "quiz-question";
        const p = document.createElement("p");
        p.className = "q-text";
        p.textContent = q.q;
        qWrap.appendChild(p);

        const optsWrap = document.createElement("div");
        optsWrap.className = "quiz-options";
        q.options.forEach(function (opt, optIdx) {
          const optLabel = document.createElement("label");
          optLabel.className = "quiz-option";
          optLabel.innerHTML =
            '<input type="radio" name="' + name + '" value="' + optIdx + '"> <span>' + opt + '</span>';
          optsWrap.appendChild(optLabel);
        });
        qWrap.appendChild(optsWrap);
        block.appendChild(qWrap);
      });

      topicQuizContainer.appendChild(block);
    });
  }

  submitQuizBtn.addEventListener("click", function () {
    const topics = Object.keys(state.quizByTopic);
    const results = [];
    let unanswered = 0;

    topics.forEach(function (topic, topicIdx) {
      const questions = state.quizByTopic[topic];
      let correct = 0;
      questions.forEach(function (q, qIdx) {
        const checked = document.querySelector('input[name="t' + topicIdx + '_q' + qIdx + '"]:checked');
        if (!checked) { unanswered++; return; }
        if (parseInt(checked.value, 10) === q.correct) correct++;
      });
      results.push({ topic: topic, correct: correct, total: questions.length });
    });

    if (unanswered > 0) {
      quizError.textContent = "Please answer every question before continuing.";
      return;
    }
    quizError.textContent = "";
    state.topicResults = results;
    startSwot();
  });

  // =========================================================
  // COURSES WIZARD — Step 5: SWOT
  // =========================================================
  const swotHeading = document.getElementById("swotHeading");
  const swotSubtitle = document.getElementById("swotSubtitle");
  const swotStatus = document.getElementById("swotStatus");
  const swotGrid = document.getElementById("swotGrid");
  const toSyllabusBtn = document.getElementById("toSyllabusBtn");

  function fillList(elId, items) {
    const el = document.getElementById(elId);
    el.innerHTML = "";
    (items || []).forEach(function (item) {
      const li = document.createElement("li");
      li.textContent = item;
      el.appendChild(li);
    });
  }

  function startSwot() {
    const subject = subjectById(state.subject);
    const unit = unitById(state.subject, state.unit);
    const totalCorrect = state.topicResults.reduce(function (s, r) { return s + r.correct; }, 0);
    const totalQs = state.topicResults.reduce(function (s, r) { return s + r.total; }, 0);

    swotHeading.textContent = "Your SWOT analysis: " + unit.name;
    swotSubtitle.textContent = subject.name + " · " + totalCorrect + "/" + totalQs + " correct on the quick check";
    swotGrid.hidden = true;
    swotStatus.hidden = false;
    swotStatus.classList.add("is-loading");
    swotStatus.textContent = "Analyzing your per-topic results with AI…";
    toSyllabusBtn.disabled = true;
    showStep("swot");

    callApi("/api/generate-swot", {
      subjectName: subject.name,
      unitName: unit.name,
      results: state.topicResults
    }).then(function (result) {
      toSyllabusBtn.disabled = false;
      swotStatus.classList.remove("is-loading");
      if (result && result.success && result.swot) {
        state.swot = result.swot;
        fillList("swotStrengths", result.swot.strengths);
        fillList("swotWeaknesses", result.swot.weaknesses);
        fillList("swotOpportunities", result.swot.opportunities);
        fillList("swotThreats", result.swot.threats);
        swotStatus.hidden = true;
        swotGrid.hidden = false;
      } else {
        swotStatus.textContent = "AI SWOT analysis isn't available right now (check GROQ_API_KEY on the server).";
        toSyllabusBtn.disabled = true;
      }
    });
  }

  // =========================================================
  // COURSES WIZARD — Step 6: syllabus + focus map (visuals)
  // =========================================================
  const syllabusHeading = document.getElementById("syllabusHeading");
  const syllabusSubtitle = document.getElementById("syllabusSubtitle");
  const syllabusStatus = document.getElementById("syllabusStatus");
  const focusMapHeading = document.getElementById("focusMapHeading");
  const focusMapSub = document.getElementById("focusMapSub");
  const focusMap = document.getElementById("focusMap");
  const syllabusList = document.getElementById("syllabusList");
  const toFlashcardsBtn = document.getElementById("toFlashcardsBtn");

  toSyllabusBtn.addEventListener("click", function () {
    const subject = subjectById(state.subject);
    const unit = unitById(state.subject, state.unit);

    syllabusHeading.textContent = "Your syllabus: " + unit.name;
    syllabusSubtitle.textContent = subject.name + " · " + state.durationLabel + " session";
    focusMapHeading.hidden = true; focusMapSub.hidden = true;
    focusMap.innerHTML = ""; syllabusList.innerHTML = "";
    syllabusStatus.hidden = false;
    syllabusStatus.classList.add("is-loading");
    syllabusStatus.textContent = "Building your syllabus and study focus map with AI…";
    toFlashcardsBtn.disabled = true;
    showStep("syllabus");

    callApi("/api/generate-syllabus", {
      subjectName: subject.name,
      unitName: unit.name,
      minutes: state.minutes,
      swot: state.swot,
      notes: state.notes
    }).then(function (result) {
      toFlashcardsBtn.disabled = false;
      syllabusStatus.classList.remove("is-loading");
      if (result && result.success && result.topics && result.topics.length) {
        state.syllabusTopics = result.topics;
        state.focusMap = result.focus || [];
        renderSyllabus();
        syllabusStatus.hidden = true;
      } else {
        syllabusStatus.textContent = "AI syllabus generation isn't available right now (check GROQ_API_KEY on the server).";
        toFlashcardsBtn.disabled = true;
      }
    });
  });

  function renderSyllabus() {
    // Focus map: visual bars showing session-time weight per topic,
    // derived from the SWOT analysis (heavier weight on weak areas).
    if (state.focusMap.length) {
      focusMapHeading.hidden = false; focusMapSub.hidden = false;
      focusMap.innerHTML = "";
      const sorted = state.focusMap.slice().sort(function (a, b) { return b.pct - a.pct; });
      const subjColor = subjectById(state.subject).color;
      sorted.forEach(function (item) {
        const row = document.createElement("div");
        row.className = "focus-row";
        row.innerHTML =
          '<span class="focus-label">' + item.topic + '</span>' +
          '<span class="focus-track"><span class="focus-fill" style="width:' + item.pct + '%;background:' + subjColor + '"></span></span>' +
          '<span class="focus-pct">' + item.pct + '%</span>';
        focusMap.appendChild(row);
      });
    }

    // Time-boxed schedule from the syllabus topics + chosen duration.
    const topics = state.syllabusTopics;
    const count = topics.length;
    const base = Math.floor(state.minutes / count);
    const remainder = state.minutes - base * count;
    let elapsed = 0;
    const schedule = topics.map(function (topic, i) {
      const duration = base + (i < remainder ? 1 : 0);
      const start = elapsed; elapsed += duration;
      return { topic: topic, start: start, end: elapsed };
    }).filter(function (b) { return b.end > b.start; });

    syllabusList.innerHTML = "";
    const block = document.createElement("div");
    block.className = "syllabus-block";
    block.innerHTML = "<h3>Your " + state.durationLabel + " session</h3>";
    const ul = document.createElement("ul");
    schedule.forEach(function (item) {
      const li = document.createElement("li");
      li.textContent = item.start + "–" + item.end + " min: " + item.topic;
      ul.appendChild(li);
    });
    block.appendChild(ul);
    syllabusList.appendChild(block);
  }

  // =========================================================
  // COURSES WIZARD — Step 7: flashcards
  // =========================================================
  const flashcardsHeading = document.getElementById("flashcardsHeading");
  const flashcardsStatus = document.getElementById("flashcardsStatus");
  const flashcardGrid = document.getElementById("flashcardGrid");
  const finishUnitBtn = document.getElementById("finishUnitBtn");

  toFlashcardsBtn.addEventListener("click", function () {
    const subject = subjectById(state.subject);
    const unit = unitById(state.subject, state.unit);

    flashcardsHeading.textContent = "Flashcards: " + unit.name;
    flashcardGrid.innerHTML = "";
    flashcardsStatus.hidden = false;
    flashcardsStatus.classList.add("is-loading");
    flashcardsStatus.textContent = "Generating flashcards with AI…";
    finishUnitBtn.disabled = true;
    showStep("flashcards");

    callApi("/api/generate-flashcards", {
      subjectName: subject.name,
      unitName: unit.name,
      topics: state.syllabusTopics
    }).then(function (result) {
      finishUnitBtn.disabled = false;
      flashcardsStatus.classList.remove("is-loading");
      if (result && result.success && result.cards && result.cards.length) {
        renderFlashcards(result.cards);
        flashcardsStatus.hidden = true;
      } else {
        flashcardsStatus.textContent = "AI flashcard generation isn't available right now (check GROQ_API_KEY on the server).";
      }
    });
  });

  function renderFlashcards(cards) {
    flashcardGrid.innerHTML = "";
    cards.forEach(function (card, i) {
      const el = document.createElement("div");
      el.className = "flashcard";
      el.style.animationDelay = (i * 0.06) + "s";
      el.innerHTML =
        '<div class="flashcard-inner">' +
          '<div class="flashcard-face flashcard-front">' + escapeHtml(card.front) + '</div>' +
          '<div class="flashcard-face flashcard-back">' + escapeHtml(card.back) + '</div>' +
        '</div>';
      el.addEventListener("click", function () { el.classList.toggle("flipped"); });
      flashcardGrid.appendChild(el);
    });
  }

  document.getElementById("studyAnotherBtn").addEventListener("click", startCoursesFlow);

  finishUnitBtn.addEventListener("click", function () {
    const subject = subjectById(state.subject);
    const unit = unitById(state.subject, state.unit);
    const totalCorrect = state.topicResults.reduce(function (s, r) { return s + r.correct; }, 0);
    const totalQs = state.topicResults.reduce(function (s, r) { return s + r.total; }, 0);
    const ratio = totalQs ? totalCorrect / totalQs : 0;
    const level = ratio >= 1
      ? { id: "proficient", label: "Proficient" }
      : ratio >= 0.5
        ? { id: "developing", label: "Developing" }
        : { id: "foundational", label: "Foundational" };

    fetch("/api/study-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subjectId: subject.id, subjectName: subject.name,
        unitId: unit.id, unitName: unit.name,
        minutes: state.minutes, durationLabel: state.durationLabel,
        notes: state.notes,
        scoreCorrect: totalCorrect, scoreTotal: totalQs,
        levelId: level.id, levelLabel: level.label,
        topics: state.syllabusTopics,
        source: "ai"
      })
    }).finally(renderDashboard);
  });

  // =========================================================
  // PROGRESS LEVEL
  // =========================================================
  const progressStatus = document.getElementById("progressStatus");
  const overallChartCard = document.getElementById("overallChartCard");
  const courseProgressHeading = document.getElementById("courseProgressHeading");
  const courseChartsGrid = document.getElementById("courseChartsGrid");

  function buildLineGraph(trend) {
    // Animated SVG line/area graph (was a bar chart) — draws itself
    // in on load via stroke-dashoffset, then each point pops in.
    const W = 300, H = 130, PAD_X = 14, PAD_Y = 18;
    const n = trend.length;
    const xAt = function (i) { return n > 1 ? PAD_X + (i * (W - PAD_X * 2)) / (n - 1) : W / 2; };
    const yAt = function (pct) { return H - PAD_Y - (Math.max(0, Math.min(100, pct)) / 100) * (H - PAD_Y * 2); };

    const points = trend.map(function (pct, i) { return [xAt(i), yAt(pct)]; });
    const linePath = points.map(function (p, i) { return (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");
    const areaPath = n
      ? linePath + " L" + points[n - 1][0].toFixed(1) + "," + (H - PAD_Y) + " L" + points[0][0].toFixed(1) + "," + (H - PAD_Y) + " Z"
      : "";

    const dotsHtml = points.map(function (p, i) {
      return '<circle class="line-graph-dot" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4" ' +
        'style="animation-delay:' + (0.9 + i * 0.08) + 's"><title>Session ' + (i + 1) + ': ' + trend[i] + '%</title></circle>';
    }).join("");

    const ticksHtml = trend.map(function (pct, i) {
      return '<span>#' + (i + 1) + '</span>';
    }).join("");

    return (
      '<div class="line-graph">' +
        '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Score trend across sessions">' +
          '<defs><linearGradient id="lgFill" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="var(--teal)" stop-opacity="0.35"/>' +
            '<stop offset="100%" stop-color="var(--teal)" stop-opacity="0"/>' +
          '</linearGradient></defs>' +
          (n > 1 ? '<path class="line-graph-area" d="' + areaPath + '" fill="url(#lgFill)"></path>' : "") +
          (n > 1 ? '<path class="line-graph-line" d="' + linePath + '"></path>' : "") +
          dotsHtml +
        '</svg>' +
        '<div class="line-graph-ticks">' + ticksHtml + '</div>' +
      '</div>'
    );
  }

  function buildChartCard(title, stats) {
    const card = document.createElement("div");
    card.className = "chart-card";
    const graphHtml = stats.trend.length ? buildLineGraph(stats.trend) : "";
    card.innerHTML =
      '<h3>' + escapeHtml(title) + ' — ' + stats.avgPct + '% avg (' + stats.attempts + ' session' + (stats.attempts === 1 ? "" : "s") + ')</h3>' +
      (graphHtml || '<p class="ai-note">No sessions yet.</p>') +
      (stats.insight ? '<p class="chart-insight">🤖 ' + escapeHtml(stats.insight) + '</p>' : "");
    return card;
  }

  function loadProgressView() {
    showStep("progress");
    progressStatus.hidden = false;
    progressStatus.textContent = "Loading your progress and AI insights…";
    overallChartCard.innerHTML = "";
    courseChartsGrid.innerHTML = "";
    courseProgressHeading.hidden = true;

    callApi("/api/progress", null, "GET").then(function (data) {
      progressStatus.hidden = true;
      if (!data || !data.ok) {
        progressStatus.hidden = false;
        progressStatus.textContent = "Couldn't load your progress right now.";
        return;
      }
      overallChartCard.appendChild(buildChartCard("Overall progress", data.overall));
      if (data.courses.length) {
        courseProgressHeading.hidden = false;
        data.courses.forEach(function (c) {
          courseChartsGrid.appendChild(buildChartCard(c.name, c));
        });
      }
    });
  }

  // =========================================================
  // STREAK SCORE
  // =========================================================
  const streakStatus = document.getElementById("streakStatus");
  const streakTabs = document.getElementById("streakTabs");
  const streakContent = document.getElementById("streakContent");
  const coinsCard = document.getElementById("coinsCard");
  const coinsTotal = document.getElementById("coinsTotal");
  const coinsBreakdown = document.getElementById("coinsBreakdown");
  const viewRankBtn = document.getElementById("viewRankBtn");

  function buildStreakCard(name, streak) {
    const card = document.createElement("div");
    card.className = "streak-card";
    card.innerHTML =
      '<div class="streak-flame">🔥</div>' +
      '<div><div class="streak-name">' + escapeHtml(name) + '</div>' +
      '<div class="streak-count">' + streak.days + '-day streak</div>' +
      (streak.note ? '<div class="streak-note">🤖 ' + escapeHtml(streak.note) + '</div>' : '') +
      '</div>';
    return card;
  }

  // Animates a number counting up from 0 — used for the Glide COINS
  // total so it feels like a tally being racked up, not a static label.
  function animateCount(el, to, duration) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = to;
      return;
    }
    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(to * eased);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function loadStreakView() {
    showStep("streak");
    streakStatus.hidden = false;
    streakStatus.textContent = "Loading your streaks and AI notes…";
    streakTabs.hidden = true; streakTabs.innerHTML = "";
    streakContent.innerHTML = "";
    coinsCard.hidden = true;

    callApi("/api/streaks", null, "GET").then(function (data) {
      streakStatus.hidden = true;
      if (!data || !data.ok) {
        streakStatus.hidden = false;
        streakStatus.textContent = "Couldn't load your streaks right now.";
        return;
      }

      if (data.coins) {
        coinsCard.hidden = false;
        animateCount(coinsTotal, data.coins.total, 900);
        coinsBreakdown.textContent =
          data.coins.sessionCoins + " from sessions + " + data.coins.streakBonus +
          " streak bonus (" + data.coins.streakDays + "-day streak)";
      }

      const tabs = [{ id: "overall", name: "Overall", streak: data.overall }].concat(
        data.courses.map(function (c) { return { id: c.id, name: c.name, streak: c }; })
      );

      function selectTab(tabId) {
        streakTabs.querySelectorAll(".streak-tab-btn").forEach(function (b) {
          b.classList.toggle("active", b.dataset.tab === tabId);
        });
        const tab = tabs.find(function (t) { return t.id === tabId; });
        streakContent.innerHTML = "";
        streakContent.appendChild(buildStreakCard(tab.name, tab.streak));
      }

      if (tabs.length > 1) {
        streakTabs.hidden = false;
        streakTabs.innerHTML = "";
        tabs.forEach(function (t, i) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "streak-tab-btn" + (i === 0 ? " active" : "");
          btn.dataset.tab = t.id;
          btn.textContent = t.name;
          btn.addEventListener("click", function () { selectTab(t.id); });
          streakTabs.appendChild(btn);
        });
      }
      selectTab("overall");
    });
  }

  viewRankBtn.addEventListener("click", loadRankView);

  // =========================================================
  // GLIDE COINS RANK
  // =========================================================
  const rankStatus = document.getElementById("rankStatus");
  const myRankBanner = document.getElementById("myRankBanner");
  const rankList = document.getElementById("rankList");
  const MEDALS = { 1: "🥇", 2: "🥈", 3: "🥉" };

  function loadRankView() {
    showStep("rank");
    rankStatus.hidden = false;
    rankStatus.textContent = "Loading the leaderboard…";
    myRankBanner.hidden = true;
    rankList.innerHTML = "";

    callApi("/api/leaderboard", null, "GET").then(function (data) {
      if (!data || !data.ok) {
        rankStatus.textContent = "Couldn't load the leaderboard right now.";
        return;
      }
      rankStatus.hidden = true;

      if (data.myRank) {
        myRankBanner.hidden = false;
        myRankBanner.innerHTML =
          '<span class="my-rank-num">#' + data.myRank + '</span>' +
          '<span>your rank out of ' + data.leaderboard.length + ' student' + (data.leaderboard.length === 1 ? "" : "s") + '</span>';
      } else {
        myRankBanner.hidden = false;
        myRankBanner.innerHTML = '<span>Finish a study session to start earning Glide COINS and appear on the leaderboard.</span>';
      }

      if (!data.leaderboard.length) {
        rankList.innerHTML = '<p class="ai-note">No students have earned Glide COINS yet.</p>';
        return;
      }

      rankList.innerHTML = "";
      data.leaderboard.forEach(function (row, i) {
        const li = document.createElement("li");
        li.className = "rank-row" + (row.userId === data.myUserId ? " is-you" : "") + (row.rank <= 3 ? " is-top" : "");
        li.style.animationDelay = (i * 0.05) + "s";
        li.innerHTML =
          '<span class="rank-pos">' + (MEDALS[row.rank] || ("#" + row.rank)) + '</span>' +
          '<span class="rank-name">' + escapeHtml(row.name) + (row.userId === data.myUserId ? ' <span class="rank-you-tag">you</span>' : '') + '</span>' +
          '<span class="rank-coins">🪙 ' + row.coins + '</span>';
        rankList.appendChild(li);
      });
    });
  }

  // =========================================================
  // PAST PLANS
  // =========================================================
  const historyList = document.getElementById("historyList");
  const historyEmpty = document.getElementById("historyEmpty");

  pastPlansBtn.addEventListener("click", function () {
    historyList.innerHTML = "";
    historyEmpty.hidden = true;
    showStep("history");

    callApi("/api/study-plans", null, "GET").then(function (data) {
      const plans = (data && data.plans) || [];
      historyEmpty.hidden = plans.length > 0;
      plans.forEach(function (plan) {
        const block = document.createElement("div");
        block.className = "syllabus-block";
        const when = new Date(plan.createdAt + "Z");
        block.innerHTML =
          "<h3>" + plan.subjectName + " — " + plan.unitName + "</h3>" +
          '<p class="ai-note" style="margin:0 0 8px">' +
          plan.durationLabel + " · " + plan.scoreCorrect + "/" + plan.scoreTotal +
          " correct · " + plan.levelLabel + " level · " +
          (isNaN(when.getTime()) ? plan.createdAt : when.toLocaleDateString()) +
          "</p><ul>" + plan.topics.map(function (t) { return "<li>" + t + "</li>"; }).join("") + "</ul>";
        historyList.appendChild(block);
      });
    });
  });

})();
