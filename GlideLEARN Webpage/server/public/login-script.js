/* =========================================================
   GlideLEARN — script.js
   Talks to the GlideLEARN backend (server/server.js): sign-up
   posts to /api/signup and is stored in SQLite; login posts to
   /api/login and is checked against that same storage.
   ========================================================= */

(function () {
  "use strict";

  // If there's already a valid session (e.g. the back button, or a
  // bookmark), skip straight to the study planner instead of making
  // the person log in again.
  fetch("/api/me").then(function (res) {
    if (res.ok) window.location.href = "study-planner.html";
  }).catch(function () {});

  // ---------------------------------------------------------
  // Entry gate: full-screen brand moment. A tap (or Enter/Space)
  // anywhere on it triggers an iris-wipe that opens from the
  // point of contact, revealing the sign-in experience beneath.
  // ---------------------------------------------------------
  (function initGate() {
    const gate = document.getElementById("gate");
    if (!gate) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.body.classList.add("gate-locked");
    let opened = false;

    function openGate(originX, originY) {
      if (opened) return;
      opened = true;

      const x = typeof originX === "number" ? originX : window.innerWidth / 2;
      const y = typeof originY === "number" ? originY : window.innerHeight / 2;
      gate.style.setProperty("--x", x + "px");
      gate.style.setProperty("--y", y + "px");

      document.body.classList.remove("gate-locked");
      gate.setAttribute("aria-hidden", "true");

      if (prefersReducedMotion) {
        gate.hidden = true;
        const loginId = document.getElementById("loginId");
        if (loginId) loginId.focus({ preventScroll: true });
        return;
      }

      gate.classList.add("gate-exit");
      let finished = false;
      function finish() {
        if (finished) return;
        finished = true;
        clearTimeout(forceClose);
        gate.hidden = true;
        const loginId = document.getElementById("loginId");
        if (loginId) loginId.focus({ preventScroll: true });
      }
      // Safety net: if for any reason the exit animation doesn't run
      // (a future CSS change, an unusual browser, etc.), don't let a
      // missing "animationend" strand the gate on screen forever the
      // way it did before this fix — force it closed after a bit
      // longer than the animation should ever take.
      const forceClose = setTimeout(finish, 700);
      gate.addEventListener("animationend", finish, { once: true });
    }

    gate.addEventListener("click", function (e) {
      openGate(e.clientX, e.clientY);
    });

    gate.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        openGate();
      }
    });
  })();

  // Demo account seeded server-side on first run (see server/db.js)
  // matches the hint shown under the login form: STU2026001 / Passw0rd!

  // ---------------------------------------------------------
  // Field definitions per role (id, label, input type, extras)
  // ---------------------------------------------------------
  const ROLE_FIELDS = {
    student: [
      { id: "fullName",   label: "Full name",         type: "text",  autocomplete: "name" },
      { id: "email",      label: "Email address",     type: "email", autocomplete: "email" },
      { id: "standard",   label: "Standard / class",  type: "text",  placeholder: "e.g. 10th Grade" },
      { id: "schoolName", label: "School name",       type: "text" }
    ],
    teacher: [
      { id: "fullName",   label: "Full name",         type: "text",  autocomplete: "name" },
      { id: "email",      label: "Email address",     type: "email", autocomplete: "email" },
      { id: "subject",    label: "Subject taught",    type: "text",  placeholder: "e.g. Mathematics" },
      { id: "schoolName", label: "School name",       type: "text" }
    ],
    parent: [
      { id: "fullName",       label: "Your full name",           type: "text",     autocomplete: "name" },
      { id: "studentEmail",   label: "Student's email ID",       type: "email" },
      { id: "studentPassword",label: "Student's login password", type: "password" }
    ],
    management: [
      { id: "fullName",   label: "Full name",                        type: "text",  autocomplete: "name" },
      { id: "email",      label: "Email address",                    type: "email", autocomplete: "email" },
      { id: "position",   label: "Position in school management",    type: "text",  placeholder: "e.g. Principal, Administrator" },
      { id: "schoolName", label: "School name",                      type: "text" }
    ]
  };

  const ROLE_META = {
    student:    { title: "Create your student account",   subtitle: "Set up access to your courses and progress." },
    teacher:    { title: "Create your teacher account",    subtitle: "Set up access to your classes and students." },
    parent:     { title: "Create your parent account",     subtitle: "Link your account to your child's, so you can follow along." },
    management: { title: "Create your management account", subtitle: "Set up access to oversee school operations." }
  };

  // ---------------------------------------------------------
  // Element references
  // ---------------------------------------------------------
  const views = {
    login:  document.getElementById("view-login"),
    role:   document.getElementById("view-role"),
    signup: document.getElementById("view-signup")
  };

  const loginForm       = document.getElementById("loginForm");
  const loginIdInput    = document.getElementById("loginId");
  const loginPwInput    = document.getElementById("loginPasswordField");
  const loginStatus     = document.getElementById("loginStatus");
  const loginBtn        = document.getElementById("loginBtn");

  const roleError       = document.getElementById("roleError");
  const continueBtn     = document.getElementById("continueBtn");

  const signupForm       = document.getElementById("signupForm");
  const dynamicFields    = document.getElementById("dynamicFields");
  const signupTitle      = document.getElementById("signupTitle");
  const signupSubtitle   = document.getElementById("signupSubtitle");
  const signupPassword   = document.getElementById("signupPassword");
  const confirmPassword  = document.getElementById("confirmPassword");
  const signupStatus     = document.getElementById("signupStatus");
  const signupBtn        = document.getElementById("signupBtn");

  let currentRole = null;

  // ---------------------------------------------------------
  // Show/hide password toggles
  // ---------------------------------------------------------
  function enhancePasswordField(input) {
    if (!input || input.dataset.pwEnhanced) return;
    input.dataset.pwEnhanced = "true";

    const wrap = document.createElement("div");
    wrap.className = "input-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "pw-toggle";
    toggle.setAttribute("aria-pressed", "false");
    toggle.setAttribute("aria-label", "Show password");
    toggle.innerHTML =
      '<svg class="icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/>' +
      "</svg>" +
      '<svg class="icon-eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M3 3l18 18"/><path d="M10.6 10.6a3 3 0 0 0 4.24 4.24"/>' +
        '<path d="M9.9 5.14A10.94 10.94 0 0 1 12 5c7 0 11 7 11 7a13.2 13.2 0 0 1-3.22 3.94M6.6 6.6C3.9 8.3 2 12 2 12s4 7 11 7c1.5 0 2.87-.32 4.09-.86"/>' +
      "</svg>";

    toggle.addEventListener("click", function () {
      const willShow = input.type === "password";
      input.type = willShow ? "text" : "password";
      toggle.setAttribute("aria-pressed", willShow ? "true" : "false");
      toggle.setAttribute("aria-label", willShow ? "Hide password" : "Show password");
      input.focus({ preventScroll: true });
    });

    wrap.appendChild(toggle);
  }

  [loginPwInput, signupPassword, confirmPassword].forEach(enhancePasswordField);

  // ---------------------------------------------------------
  // View switching
  // ---------------------------------------------------------
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pageEl = document.querySelector(".page");

  // The hero visual panel only belongs on the sign-in screen —
  // role selection and signup run the form panel full-width.
  function syncVisualPanel(name) {
    if (!pageEl) return;
    pageEl.classList.toggle("page--solo", name !== "login");
  }

  function showView(name) {
    const currentKey = Object.keys(views).find(function (key) {
      return !views[key].hidden;
    });
    const current = currentKey ? views[currentKey] : null;
    const next = views[name];

    syncVisualPanel(name);

    if (!current || current === next || prefersReducedMotion) {
      Object.keys(views).forEach(function (key) {
        views[key].hidden = key !== name;
      });
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
    });
  }

  document.getElementById("showRoleView").addEventListener("click", function (e) {
    e.preventDefault();
    roleError.textContent = "";
    const checked = document.querySelector('input[name="role"]:checked');
    if (checked) checked.checked = false;
    showView("role");
  });

  document.getElementById("showLoginFromRole").addEventListener("click", function (e) {
    e.preventDefault();
    showView("login");
  });

  document.getElementById("showLoginFromSignup").addEventListener("click", function (e) {
    e.preventDefault();
    showView("login");
  });

  document.getElementById("changeRoleLink").addEventListener("click", function (e) {
    e.preventDefault();
    showView("role");
  });

  // ---------------------------------------------------------
  // Role selection -> build the matching signup form
  // ---------------------------------------------------------
  continueBtn.addEventListener("click", function () {
    const checked = document.querySelector('input[name="role"]:checked');
    if (!checked) {
      roleError.textContent = "Choose an account type to continue.";
      roleError.className = "status-msg";
      // force a reflow so re-adding the class replays the shake animation
      // even if the same error is shown twice in a row
      void roleError.offsetWidth;
      roleError.className = "status-msg error";
      return;
    }
    roleError.textContent = "";
    roleError.className = "status-msg";
    currentRole = checked.value;
    buildSignupForm(currentRole);
    showView("signup");
  });

  function buildSignupForm(role) {
    const meta = ROLE_META[role];
    signupTitle.textContent = meta.title;
    signupSubtitle.textContent = meta.subtitle;

    dynamicFields.innerHTML = "";

    ROLE_FIELDS[role].forEach(function (field) {
      const wrap = document.createElement("div");
      wrap.className = "field";

      const label = document.createElement("label");
      label.setAttribute("for", field.id);
      label.textContent = field.label;

      const input = document.createElement("input");
      input.type = field.type;
      input.id = field.id;
      input.name = field.id;
      input.required = true;
      if (field.autocomplete) input.autocomplete = field.autocomplete;
      if (field.placeholder) input.placeholder = field.placeholder;

      wrap.appendChild(label);
      wrap.appendChild(input);
      dynamicFields.appendChild(wrap);

      if (field.type === "password") {
        enhancePasswordField(input);
      }
    });

    signupPassword.value = "";
    confirmPassword.value = "";
    signupStatus.textContent = "";
    signupStatus.className = "status-msg";
  }

  // ---------------------------------------------------------
  // Signup submit — posts to /api/signup and stores the
  // account server-side (SQLite, see server/db.js)
  // ---------------------------------------------------------
  signupForm.addEventListener("submit", function (event) {
    event.preventDefault();

    const fields = {};
    const dynamicInputs = dynamicFields.querySelectorAll("input");
    for (let i = 0; i < dynamicInputs.length; i++) {
      const input = dynamicInputs[i];
      if (!input.value.trim()) {
        signupStatus.textContent = "Please fill in every field.";
        signupStatus.className = "status-msg error";
        return;
      }
      fields[input.id] = input.value.trim();
    }

    if (signupPassword.value.length < 6) {
      signupStatus.textContent = "Login password must be at least 6 characters.";
      signupStatus.className = "status-msg error";
      return;
    }

    if (signupPassword.value !== confirmPassword.value) {
      signupStatus.textContent = "Passwords don't match.";
      signupStatus.className = "status-msg error";
      return;
    }

    signupBtn.disabled = true;
    signupBtn.classList.add("is-loading");
    signupBtn.textContent = "Creating account...";
    signupStatus.textContent = "";
    signupStatus.className = "status-msg";

    fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: currentRole,
        password: signupPassword.value,
        fields: fields
      })
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { status: response.status, data: data };
        });
      })
      .then(function (result) {
        signupBtn.disabled = false;
        signupBtn.classList.remove("is-loading");
        signupBtn.textContent = "Create account";

        if (!result.data.ok) {
          signupStatus.textContent = result.data.error || "Couldn't create the account.";
          signupStatus.className = "status-msg error";
          return;
        }

        const user = result.data.user;
        signupStatus.textContent =
          "Account created — your login ID is " + user.loginCode + ". Redirecting to log in...";
        signupStatus.className = "status-msg success";

        setTimeout(function () {
          showView("login");
          loginIdInput.value = user.loginCode;
          loginPwInput.value = "";
          loginStatus.textContent = "";
          loginStatus.className = "status-msg";
          loginIdInput.focus();
        }, 1100);
      })
      .catch(function () {
        signupBtn.disabled = false;
        signupBtn.classList.remove("is-loading");
        signupBtn.textContent = "Create account";
        signupStatus.textContent = "Couldn't reach the server. Is it running?";
        signupStatus.className = "status-msg error";
      });
  });

  // ---------------------------------------------------------
  // Login — verified against the backend (/api/login), which
  // checks the SQLite-stored accounts (including sign-ups).
  // ---------------------------------------------------------
  function setLoginStatus(message, type) {
    loginStatus.textContent = message;
    loginStatus.className = "status-msg" + (type ? " " + type : "");
  }

  function setLoginLoading(isLoading) {
    loginBtn.disabled = isLoading;
    loginBtn.classList.toggle("is-loading", isLoading);
    loginBtn.textContent = isLoading ? "Logging in..." : "Log in";
  }

  loginForm.addEventListener("submit", function (event) {
    event.preventDefault();

    const idValue = loginIdInput.value.trim();
    const pwValue = loginPwInput.value;

    if (!idValue) return setLoginStatus("Enter your login ID or email.", "error");
    if (!pwValue) return setLoginStatus("Enter your password.", "error");
    if (pwValue.length < 6) return setLoginStatus("Password must be at least 6 characters.", "error");

    setLoginLoading(true);
    setLoginStatus("", "");

    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: idValue, password: pwValue })
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { status: response.status, data: data };
        });
      })
      .then(function (result) {
        setLoginLoading(false);

        if (!result.data.ok) {
          setLoginStatus(
            result.data.error || "Invalid credentials — try the demo login below the form.",
            "error"
          );
          return;
        }

        setLoginStatus("Login successful. Welcome, " + result.data.user.fullName + ". Redirecting...", "success");
        loginForm.reset();
        setTimeout(function () {
          window.location.href = "study-planner.html";
        }, 700);
      })
      .catch(function () {
        setLoginLoading(false);
        setLoginStatus("Couldn't reach the server. Is it running?", "error");
      });
  });
})();
