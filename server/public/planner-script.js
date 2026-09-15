/* =========================================================
   GlideLEARN — study planner script.js
   Walks the student through subject -> duration -> unit ->
   quiz -> a syllabus sized to their answers and time. Content
   (subjects/quizzes/topics) lives in this file; account state
   and saved plans are backed by the GlideLEARN server (see
   server/server.py + server/db.py) via /api/me, /api/logout,
   /api/study-plan and /api/study-plans.
   ========================================================= */

(function () {
  "use strict";

  // ---------------------------------------------------------
  // Account: this page is only reachable with a valid session
  // (the server redirects to /login.html otherwise), but we still
  // confirm client-side and show who's signed in.
  // ---------------------------------------------------------
  const accountName = document.getElementById("accountName");
  const logoutBtn = document.getElementById("logoutBtn");
  const pastPlansBtn = document.getElementById("pastPlansBtn");
  const closeHistoryBtn = document.getElementById("closeHistoryBtn");
  const historyView = document.getElementById("view-history");
  const historyList = document.getElementById("historyList");
  const historyEmpty = document.getElementById("historyEmpty");

  let currentUser = null;

  fetch("/api/me")
    .then(function (res) { return res.ok ? res.json() : Promise.reject(); })
    .then(function (data) {
      currentUser = data.user;
      accountName.textContent = "Signed in as " + currentUser.fullName + " (" + currentUser.loginCode + ")";
    })
    .catch(function () {
      window.location.href = "login.html";
    });

  logoutBtn.addEventListener("click", function () {
    fetch("/api/logout", { method: "POST" }).finally(function () {
      window.location.href = "login.html";
    });
  });

  function renderHistory(plans) {
    historyList.innerHTML = "";
    historyEmpty.hidden = plans.length > 0;

    plans.forEach(function (plan) {
      const block = document.createElement("div");
      block.className = "syllabus-block";

      const heading = document.createElement("h3");
      const when = new Date(plan.createdAt + "Z");
      heading.textContent = plan.subjectName + " \u2014 " + plan.unitName;
      block.appendChild(heading);

      const meta = document.createElement("p");
      meta.className = "ai-note";
      meta.style.margin = "0 0 8px";
      meta.textContent =
        plan.durationLabel + " \u00B7 " + plan.scoreCorrect + "/" + plan.scoreTotal +
        " correct \u00B7 " + plan.levelLabel + " level \u00B7 " +
        (isNaN(when.getTime()) ? plan.createdAt : when.toLocaleDateString());
      block.appendChild(meta);

      const list = document.createElement("ul");
      plan.topics.forEach(function (topic) {
        const li = document.createElement("li");
        li.textContent = topic;
        list.appendChild(li);
      });
      block.appendChild(list);

      historyList.appendChild(block);
    });
  }

  pastPlansBtn.addEventListener("click", function () {
    historyList.innerHTML = "";
    historyEmpty.hidden = true;
    document.querySelectorAll(".step-view").forEach(function (el) { el.hidden = true; });
    historyView.hidden = false;

    fetch("/api/study-plans")
      .then(function (res) { return res.ok ? res.json() : Promise.reject(); })
      .then(function (data) { renderHistory(data.plans || []); })
      .catch(function () {
        historyEmpty.hidden = false;
        historyEmpty.textContent = "Couldn't load your saved plans right now.";
      });
  });

  closeHistoryBtn.addEventListener("click", function () {
    historyView.hidden = true;
    showStep("subject");
  });

  // ---------------------------------------------------------
  // Content data
  // ---------------------------------------------------------
  const SUBJECTS = [
    {
      id: "mathematics", name: "Mathematics", color: "#22D3EE",
      icon: '<path d="M4 20V4M4 20h16"/><path d="M7 16c2-6 5-6 7-10"/>'
    },
    {
      id: "physics", name: "Physics", color: "#6C6BFF",
      icon: '<circle cx="12" cy="12" r="1.8"/><ellipse cx="12" cy="12" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)"/>'
    },
    {
      id: "chemistry", name: "Chemistry", color: "#FF6B4A",
      icon: '<path d="M9 3h6"/><path d="M10 3v5l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/>'
    },
    {
      id: "biology", name: "Biology", color: "#33DE9E",
      icon: '<path d="M5 20c0-8 6-14 14-14 0 8-6 14-14 14Z"/><path d="M5 20c3-3 7-7 11-11"/>'
    },
    {
      id: "english", name: "English", color: "#FFB443",
      icon: '<path d="M4 5.5c2-1 5-1 8 .5 3-1.5 6-1.5 8-.5v13c-2-1-5-1-8 .5-3-1.5-6-1.5-8-.5V5.5Z"/><path d="M12 6v13"/>'
    },
    {
      id: "computer-science", name: "Computer Science", color: "#FF4FA3",
      icon: '<path d="M8 9 4 12l4 3"/><path d="M16 9l4 3-4 3"/><path d="M14 7l-4 10"/>'
    }
  ];

  const DURATIONS = [
    { id: "30m",  label: "30 mins", minutes: 30 },
    { id: "1h",   label: "1 hr",    minutes: 60 },
    { id: "1.5h", label: "1.5 hr",  minutes: 90 },
    { id: "2h",   label: "2 hr",    minutes: 120 },
    { id: "custom", label: "Custom", minutes: null }
  ];

  // Endpoints served by the optional AI backend (see README). If that
  // backend isn't running, every call below fails fast and the app
  // falls back to the curated question/topic banks further down.
  const AI_QUIZ_ENDPOINT = "/api/generate-quiz";
  const AI_SYLLABUS_ENDPOINT = "/api/generate-syllabus";
  // Local AI runs on the student's own CPU (via Ollama), which is much
  // slower than a cloud API — give it real time before giving up.
  const AI_TIMEOUT_MS = 45000;

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

  const QUIZZES = {
    "algebra-basics": [
      { q: "What is the value of x in 2x + 3 = 11?", options: ["2", "3", "4", "5"], correct: 2 },
      { q: "Which of these is a linear equation?", options: ["y = x\u00B2 + 1", "y = 2x + 3", "y = 1/x", "y = x\u00B3"], correct: 1 },
      { q: "Simplify: 3(x + 2)", options: ["3x + 2", "3x + 6", "x + 6", "3x + 5"], correct: 1 }
    ],
    "geometry-fundamentals": [
      { q: "How many degrees are in a triangle's interior angles combined?", options: ["90", "180", "270", "360"], correct: 1 },
      { q: "A triangle with all sides equal is called:", options: ["Scalene", "Isosceles", "Equilateral", "Right-angled"], correct: 2 },
      { q: "What is the formula for the area of a circle?", options: ["\u03C0r", "\u03C0r\u00B2", "2\u03C0r", "\u03C0d"], correct: 1 }
    ],
    "statistics-probability": [
      { q: "What is the average of 2, 4, 6, 8?", options: ["4", "5", "6", "20"], correct: 1 },
      { q: "What is the probability of flipping a coin and getting heads?", options: ["0", "0.25", "0.5", "1"], correct: 2 },
      { q: "The middle value in a sorted data set is called the:", options: ["Mean", "Median", "Mode", "Range"], correct: 1 }
    ],
    "motion-forces": [
      { q: "What force pulls objects toward the Earth?", options: ["Friction", "Gravity", "Tension", "Magnetism"], correct: 1 },
      { q: "Speed is calculated as:", options: ["Distance \u00D7 Time", "Distance \u00F7 Time", "Time \u00F7 Distance", "Distance + Time"], correct: 1 },
      { q: "\"An object at rest stays at rest unless acted on by a force\" is:", options: ["Newton's 1st Law", "Newton's 2nd Law", "Newton's 3rd Law", "Law of Gravity"], correct: 0 }
    ],
    "energy-work": [
      { q: "What is the SI unit of energy?", options: ["Watt", "Joule", "Newton", "Pascal"], correct: 1 },
      { q: "Work is done when a force causes what?", options: ["Heat", "Displacement", "Sound", "Light"], correct: 1 },
      { q: "Which of these is a renewable source of energy?", options: ["Coal", "Natural gas", "Solar", "Petroleum"], correct: 2 }
    ],
    "electricity-magnetism": [
      { q: "What is the SI unit of electric current?", options: ["Volt", "Ampere", "Ohm", "Watt"], correct: 1 },
      { q: "Which material is a good conductor of electricity?", options: ["Rubber", "Wood", "Copper", "Plastic"], correct: 2 },
      { q: "Like magnetic poles:", options: ["Attract each other", "Repel each other", "Have no effect", "Cancel out"], correct: 1 }
    ],
    "atoms-molecules": [
      { q: "What is the smallest unit of matter?", options: ["Molecule", "Atom", "Electron", "Compound"], correct: 1 },
      { q: "Water is made of which elements?", options: ["Hydrogen & Oxygen", "Carbon & Oxygen", "Hydrogen & Nitrogen", "Oxygen & Nitrogen"], correct: 0 },
      { q: "What is the charge of an electron?", options: ["Positive", "Negative", "Neutral", "None"], correct: 1 }
    ],
    "chemical-reactions": [
      { q: "What is produced when you mix an acid and a base?", options: ["Salt and water", "Gas only", "Metal", "Nothing"], correct: 0 },
      { q: "Which sign shows a chemical reaction has occurred?", options: ["Change in color", "Change in shape only", "No change", "Change in position"], correct: 0 },
      { q: "In a combustion reaction, a fuel reacts with:", options: ["Water", "Oxygen", "Nitrogen", "Carbon"], correct: 1 }
    ],
    "acids-bases-salts": [
      { q: "What does the pH scale measure?", options: ["Temperature", "Acidity / alkalinity", "Density", "Mass"], correct: 1 },
      { q: "A pH of 7 is considered:", options: ["Acidic", "Basic", "Neutral", "Unstable"], correct: 2 },
      { q: "Which of these is a common acid found at home?", options: ["Baking soda", "Vinegar", "Soap", "Salt"], correct: 1 }
    ],
    "cells-life-processes": [
      { q: "What is the basic unit of life?", options: ["Tissue", "Organ", "Cell", "Organism"], correct: 2 },
      { q: "Which part of the cell controls its activities?", options: ["Cell wall", "Nucleus", "Cytoplasm", "Membrane"], correct: 1 },
      { q: "Plants make their food through a process called:", options: ["Respiration", "Digestion", "Photosynthesis", "Excretion"], correct: 2 }
    ],
    "human-body-systems": [
      { q: "Which organ pumps blood through the body?", options: ["Lungs", "Heart", "Liver", "Kidney"], correct: 1 },
      { q: "The main function of the lungs is:", options: ["Digestion", "Breathing / gas exchange", "Filtering blood", "Movement"], correct: 1 },
      { q: "Which system protects the body from disease?", options: ["Digestive system", "Immune system", "Skeletal system", "Nervous system"], correct: 1 }
    ],
    "ecology-environment": [
      { q: "A group of different species living in the same area is called a:", options: ["Population", "Community", "Habitat", "Ecosystem"], correct: 1 },
      { q: "Producers in an ecosystem are usually:", options: ["Animals", "Plants", "Fungi", "Bacteria"], correct: 1 },
      { q: "What is the main cause of habitat loss?", options: ["Rainfall", "Human activity", "Wind", "Ocean currents"], correct: 1 }
    ],
    "grammar-essentials": [
      { q: "Which word is a verb?", options: ["Quickly", "Happiness", "Run", "Blue"], correct: 2 },
      { q: "Which sentence is correctly punctuated?", options: ["Where are you going", "Where are you going.", "Where are you going?", "where are you going?"], correct: 2 },
      { q: "What is the plural of \"child\"?", options: ["Childs", "Childes", "Children", "Child's"], correct: 2 }
    ],
    "reading-comprehension": [
      { q: "What does \"comprehension\" mean?", options: ["Writing quickly", "Understanding a text", "Speaking loudly", "Memorizing facts"], correct: 1 },
      { q: "The main idea of a passage is usually called the:", options: ["Theme", "Topic sentence", "Footnote", "Caption"], correct: 1 },
      { q: "Skimming a text means:", options: ["Reading every word slowly", "Reading quickly for an overview", "Reading backwards", "Ignoring the text"], correct: 1 }
    ],
    "creative-writing": [
      { q: "What is a metaphor?", options: ["A comparison using like/as", "A direct comparison without like/as", "A rhyme", "A question"], correct: 1 },
      { q: "The person telling the story is called the:", options: ["Author", "Narrator", "Editor", "Publisher"], correct: 1 },
      { q: "A story's setting refers to its:", options: ["Characters", "Time and place", "Theme", "Plot twist"], correct: 1 }
    ],
    "programming-basics": [
      { q: "What does \"output\" mean in programming?", options: ["Data going into a program", "Data coming out of a program", "A type of loop", "A syntax error"], correct: 1 },
      { q: "Which of these is a programming language?", options: ["HTML", "Python", "USB", "Wi-Fi"], correct: 1 },
      { q: "A \"loop\" is used to:", options: ["Store data", "Repeat a set of instructions", "Delete a file", "Connect to internet"], correct: 1 }
    ],
    "data-structures-intro": [
      { q: "Which of these stores multiple values in order?", options: ["Variable", "Array / list", "Boolean", "Function"], correct: 1 },
      { q: "A \"stack\" is often compared to:", options: ["A queue at a store", "A pile of plates", "A tree", "A circle"], correct: 1 },
      { q: "In a queue, items are removed from the:", options: ["Top", "Front", "Back", "Middle"], correct: 1 }
    ],
    "internet-web-basics": [
      { q: "What does \"URL\" stand for?", options: ["Uniform Resource Locator", "Universal Router Link", "User Resource Location", "Uniform Router Locator"], correct: 0 },
      { q: "What does \"HTTP\" primarily help with?", options: ["Storing files", "Transferring web pages", "Sending emails", "Playing videos"], correct: 1 },
      { q: "A web browser is used to:", options: ["Write code", "View websites", "Store passwords", "Send faxes"], correct: 1 }
    ]
  };

  const SYLLABUS_TOPICS = {
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

  const STEP_ORDER = ["subject", "duration", "unit", "quiz", "results"];
  const STEP_LABELS = {
    subject:  "Step 1 of 5 \u2014 Choose a subject",
    duration: "Step 2 of 5 \u2014 Choose your study time",
    unit:     "Step 3 of 5 \u2014 Choose a unit",
    quiz:     "Step 4 of 5 \u2014 Quick knowledge check",
    results:  "Step 5 of 5 \u2014 Your study plan"
  };

  // ---------------------------------------------------------
  // State
  // ---------------------------------------------------------
  const state = {
    subject: null,
    duration: null,
    durationLabel: null,
    minutes: null,
    unit: null,
    notes: "",
    quizData: null
  };

  // ---------------------------------------------------------
  // Element references
  // ---------------------------------------------------------
  const views = {};
  STEP_ORDER.forEach(function (key) {
    views[key] = document.getElementById("view-" + key);
  });

  const progressBar = document.getElementById("progressBar");
  const stepLabel = document.getElementById("stepLabel");

  const subjectGrid = document.getElementById("subjectGrid");
  const subjectError = document.getElementById("subjectError");

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
    const base = isNaN(current) ? (delta > 0 ? min : min + 1) : current;
    const next = Math.min(max, Math.max(min, base + delta));
    customDurationValue.value = next;
  }

  durationStepUp.addEventListener("click", function () { stepDuration(1); });
  durationStepDown.addEventListener("click", function () { stepDuration(-1); });

  const unitList = document.getElementById("unitList");
  const unitHeading = document.getElementById("unitHeading");
  const unitError = document.getElementById("unitError");
  const aiNotesInput = document.getElementById("aiNotes");

  const quizHeading = document.getElementById("quizHeading");
  const quizQuestions = document.getElementById("quizQuestions");
  const quizError = document.getElementById("quizError");
  const quizSourceNote = document.getElementById("quizSourceNote");
  const submitQuizBtn = document.getElementById("submitQuizBtn");

  const resultsSubtitle = document.getElementById("resultsSubtitle");
  const levelBadge = document.getElementById("levelBadge");
  const syllabusSourceNote = document.getElementById("syllabusSourceNote");
  const syllabusList = document.getElementById("syllabusList");

  // ---------------------------------------------------------
  // View switching + progress
  // ---------------------------------------------------------
  function showStep(name) {
    STEP_ORDER.forEach(function (key) {
      views[key].hidden = key !== name;
    });
    const index = STEP_ORDER.indexOf(name);
    progressBar.style.width = (((index + 1) / STEP_ORDER.length) * 100) + "%";
    stepLabel.textContent = STEP_LABELS[name];
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------------------------------------------------------
  // Step 1: build subject cards
  // ---------------------------------------------------------
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

  // ---------------------------------------------------------
  // Step 2: build duration pills
  // ---------------------------------------------------------
  function renderDurations() {
    durationGrid.innerHTML = "";
    DURATIONS.forEach(function (duration) {
      const label = document.createElement("label");
      label.className = "pill-card";
      label.innerHTML =
        '<input type="radio" name="duration" value="' + duration.id + '" class="pill-input">' +
        duration.label;
      durationGrid.appendChild(label);
    });

    durationGrid.querySelectorAll('input[name="duration"]').forEach(function (input) {
      input.addEventListener("change", function () {
        customDurationFields.hidden = input.value !== "custom";
      });
    });
  }

  // ---------------------------------------------------------
  // Step 3: build unit list for the chosen subject
  // ---------------------------------------------------------
  function renderUnits(subjectId) {
    const subjectName = SUBJECTS.find(function (s) { return s.id === subjectId; }).name;
    unitHeading.textContent = "Choose a " + subjectName + " unit";

    unitList.innerHTML = "";
    UNITS[subjectId].forEach(function (unit) {
      const label = document.createElement("label");
      label.className = "unit-card";
      label.innerHTML =
        '<input type="radio" name="unit" value="' + unit.id + '" class="unit-input">' +
        unit.name;
      unitList.appendChild(label);
    });
  }

  // ---------------------------------------------------------
  // Step 4: build the quiz for the chosen unit
  // ---------------------------------------------------------
  function renderQuizQuestions(questions) {
    quizQuestions.innerHTML = "";

    questions.forEach(function (question, qIndex) {
      const fieldset = document.createElement("fieldset");
      fieldset.className = "quiz-question";

      const legend = document.createElement("legend");
      legend.textContent = (qIndex + 1) + ". " + question.q;
      fieldset.appendChild(legend);

      const optionsWrap = document.createElement("div");
      optionsWrap.className = "quiz-options";

      question.options.forEach(function (optionText, oIndex) {
        const label = document.createElement("label");
        label.className = "quiz-option";
        label.innerHTML =
          '<input type="radio" name="q' + qIndex + '" value="' + oIndex + '" class="quiz-input">' +
          '<span class="option-marker"></span><span>' + optionText + '</span>';
        optionsWrap.appendChild(label);
      });

      fieldset.appendChild(optionsWrap);
      quizQuestions.appendChild(fieldset);
    });
  }

  function scoreQuiz(questions) {
    let answeredCount = 0;
    let correctCount = 0;

    questions.forEach(function (question, qIndex) {
      const checked = document.querySelector('input[name="q' + qIndex + '"]:checked');
      if (checked) {
        answeredCount++;
        if (parseInt(checked.value, 10) === question.correct) correctCount++;
      }
    });

    return { total: questions.length, answered: answeredCount, correct: correctCount };
  }

  // ---------------------------------------------------------
  // Step 5: build a time-boxed session plan from topics + minutes
  // ---------------------------------------------------------
  function buildSessionPlan(topics, totalMinutes) {
    const count = topics.length;
    const base = Math.floor(totalMinutes / count);
    const remainder = totalMinutes - base * count;
    let elapsed = 0;

    return topics.map(function (topic, i) {
      // Spread any leftover minutes across the first few topics
      // so the total always adds up exactly to totalMinutes.
      const duration = base + (i < remainder ? 1 : 0);
      const start = elapsed;
      elapsed += duration;
      return { topic: topic, start: start, end: elapsed };
    }).filter(function (block) { return block.end > block.start; });
  }

  function levelFromScore(correct, total) {
    const ratio = correct / total;
    if (ratio >= 1) return { key: "proficient", label: "Proficient", note: "You already know this unit well — the plan below leans toward practice and depth." };
    if (ratio >= 0.5) return { key: "developing", label: "Developing", note: "You have a solid start — the plan below fills the gaps and builds confidence." };
    return { key: "foundational", label: "Foundational", note: "You're just starting out here — the plan below begins from the basics." };
  }

  function renderResults(score, level, topics) {
    const subject = SUBJECTS.find(function (s) { return s.id === state.subject; });
    const unit = UNITS[state.subject].find(function (u) { return u.id === state.unit; });

    resultsSubtitle.textContent =
      subject.name + " \u2014 " + unit.name + " \u00B7 " + state.durationLabel +
      " \u00B7 " + score.correct + "/" + score.total + " correct";

    levelBadge.textContent = level.label + " level";
    levelBadge.className = "level-badge " + level.key;

    const plan = buildSessionPlan(topics, state.minutes);

    syllabusList.innerHTML = "";

    const noteEl = document.createElement("p");
    noteEl.className = "status-msg";
    noteEl.style.textAlign = "left";
    noteEl.style.marginBottom = "6px";
    noteEl.textContent = level.note;
    syllabusList.appendChild(noteEl);

    const block = document.createElement("div");
    block.className = "syllabus-block";

    const heading = document.createElement("h3");
    heading.textContent = "Your " + state.durationLabel + " session";
    block.appendChild(heading);

    const list = document.createElement("ul");
    plan.forEach(function (item) {
      const li = document.createElement("li");
      li.textContent = item.start + "\u2013" + item.end + " min: " + item.topic;
      list.appendChild(li);
    });
    block.appendChild(list);

    syllabusList.appendChild(block);
  }

  // ---------------------------------------------------------
  // AI generation (optional backend — see README). Any failure
  // here (no server, no network, bad response, timeout) resolves
  // to null so the caller can fall back to the curated content.
  // ---------------------------------------------------------
  function tryFetchJSON(url, payload) {
    return new Promise(function (resolve) {
      const controller = new AbortController();
      const timer = setTimeout(function () { controller.abort(); }, AI_TIMEOUT_MS);

      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

  // ---------------------------------------------------------
  // Reset helpers
  // ---------------------------------------------------------
  function resetAll() {
    state.subject = null;
    state.duration = null;
    state.durationLabel = null;
    state.minutes = null;
    state.unit = null;
    state.notes = "";
    state.quizData = null;
    renderSubjects();
    renderDurations();
    customDurationFields.hidden = true;
    customDurationValue.value = "";
    aiNotesInput.value = "";
    subjectError.textContent = "";
    durationError.textContent = "";
    unitError.textContent = "";
    quizError.textContent = "";
    quizSourceNote.textContent = "";
    syllabusSourceNote.textContent = "";
    showStep("subject");
  }

  // ---------------------------------------------------------
  // Navigation: Continue buttons
  // ---------------------------------------------------------
  document.querySelector('[data-next="subject"]').addEventListener("click", function () {
    const checked = document.querySelector('input[name="subject"]:checked');
    if (!checked) {
      subjectError.textContent = "Choose a subject to continue.";
      return;
    }
    subjectError.textContent = "";
    state.subject = checked.value;
    showStep("duration");
  });

  document.querySelector('[data-next="duration"]').addEventListener("click", function () {
    const checked = document.querySelector('input[name="duration"]:checked');
    if (!checked) {
      durationError.textContent = "Choose how long you want to study.";
      return;
    }

    let minutes;
    let label;

    if (checked.value === "custom") {
      const rawValue = parseFloat(customDurationValue.value);
      if (!rawValue || rawValue <= 0) {
        durationError.textContent = "Enter how long you want to study.";
        return;
      }
      const unit = customDurationUnit.value;
      minutes = Math.round(unit === "hours" ? rawValue * 60 : rawValue);
      label = unit === "hours"
        ? (rawValue + (rawValue === 1 ? " hour" : " hours"))
        : (rawValue + " mins");
    } else {
      const preset = DURATIONS.find(function (d) { return d.id === checked.value; });
      minutes = preset.minutes;
      label = preset.label;
    }

    durationError.textContent = "";
    state.duration = checked.value;
    state.minutes = minutes;
    state.durationLabel = label;
    renderUnits(state.subject);
    showStep("unit");
  });

  document.querySelector('[data-next="unit"]').addEventListener("click", function () {
    const checked = document.querySelector('input[name="unit"]:checked');
    if (!checked) {
      unitError.textContent = "Choose a unit to continue.";
      return;
    }
    unitError.textContent = "";
    state.unit = checked.value;
    state.notes = aiNotesInput.value.trim();

    const subjectObj = SUBJECTS.find(function (s) { return s.id === state.subject; });
    const unitObj = UNITS[state.subject].find(function (u) { return u.id === state.unit; });

    quizHeading.textContent = "Quick check: " + unitObj.name;
    quizQuestions.innerHTML = "";
    quizError.textContent = "";
    quizSourceNote.textContent = "Preparing your questions\u2026 (this can take a bit if generating with AI on your device)";
    showStep("quiz");

    tryFetchJSON(AI_QUIZ_ENDPOINT, {
      subjectId: subjectObj.id,
      subjectName: subjectObj.name,
      unitId: unitObj.id,
      unitName: unitObj.name,
      notes: state.notes
    }).then(function (result) {
      if (result && result.success && Array.isArray(result.questions) && result.questions.length) {
        state.quizData = result.questions;
        quizSourceNote.textContent = "These questions were generated by AI, adjusted to your progress on this unit.";
      } else {
        state.quizData = QUIZZES[state.unit];
        quizSourceNote.textContent = "Showing our standard question set (AI generation wasn't available).";
      }
      renderQuizQuestions(state.quizData);
    });
  });

  // ---------------------------------------------------------
  // Navigation: Back buttons
  // ---------------------------------------------------------
  document.querySelector('[data-back="duration"]').addEventListener("click", function () {
    showStep("subject");
  });

  document.querySelector('[data-back="unit"]').addEventListener("click", function () {
    showStep("duration");
  });

  document.querySelector('[data-back="quiz"]').addEventListener("click", function () {
    renderUnits(state.subject);
    showStep("unit");
  });

  document.getElementById("changeUnitBtn").addEventListener("click", function () {
    renderUnits(state.subject);
    showStep("unit");
  });

  document.getElementById("restartBtn").addEventListener("click", resetAll);

  // ---------------------------------------------------------
  // Quiz submit
  // ---------------------------------------------------------
  submitQuizBtn.addEventListener("click", function () {
    const score = scoreQuiz(state.quizData);
    if (score.answered < score.total) {
      quizError.textContent = "Please answer every question before continuing.";
      return;
    }
    quizError.textContent = "";

    const level = levelFromScore(score.correct, score.total);
    const subjectObj = SUBJECTS.find(function (s) { return s.id === state.subject; });
    const unitObj = UNITS[state.subject].find(function (u) { return u.id === state.unit; });

    resultsSubtitle.textContent = "";
    levelBadge.textContent = "";
    levelBadge.className = "level-badge";
    syllabusList.innerHTML = "";
    syllabusSourceNote.textContent = "Building your session plan\u2026 (this can take a bit if generating with AI on your device)";
    showStep("results");

    tryFetchJSON(AI_SYLLABUS_ENDPOINT, {
      subjectId: subjectObj.id,
      subjectName: subjectObj.name,
      unitId: unitObj.id,
      unitName: unitObj.name,
      minutes: state.minutes,
      level: level.label,
      scoreCorrect: score.correct,
      scoreTotal: score.total,
      notes: state.notes
    }).then(function (result) {
      let topics;
      if (result && result.success && Array.isArray(result.topics) && result.topics.length) {
        topics = result.topics;
        syllabusSourceNote.textContent = "This session plan was generated by AI, customized to your quick-check score.";
      } else {
        topics = SYLLABUS_TOPICS[state.unit];
        syllabusSourceNote.textContent = "Showing our standard syllabus (AI generation wasn't available).";
      }
      renderResults(score, level, topics);
      saveStudyPlan(subjectObj, unitObj, score, level, topics);
    });
  });

  // ---------------------------------------------------------
  // Persist the finished plan to the server so it shows up
  // under "My past plans" next time this user signs in.
  // ---------------------------------------------------------
  function saveStudyPlan(subjectObj, unitObj, score, level, topics) {
    const plan = buildSessionPlan(topics, state.minutes);
    fetch("/api/study-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subjectId: subjectObj.id,
        subjectName: subjectObj.name,
        unitId: unitObj.id,
        unitName: unitObj.name,
        minutes: state.minutes,
        durationLabel: state.durationLabel,
        notes: state.notes,
        scoreCorrect: score.correct,
        scoreTotal: score.total,
        levelId: level.key,
        levelLabel: level.label,
        topics: plan.map(function (item) {
          return item.start + "\u2013" + item.end + " min: " + item.topic;
        })
      })
    }).catch(function () {
      // Saving is a nice-to-have; a failed save shouldn't block viewing results.
    });
  }

  // ---------------------------------------------------------
  // Init
  // ---------------------------------------------------------
  renderSubjects();
  renderDurations();
  showStep("subject");
})();
