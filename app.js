"use strict";

(function () {
  // Helpers
  function toYMD(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function parseYMD(ymd) {
    if (!ymd || typeof ymd !== "string") return null;
    const [y, m, d] = ymd.split("-").map((n) => Number(n));
    if (!y || !m || !d) return null;
    // Use midday local time to avoid DST issues
    return new Date(y, m - 1, d, 12);
  }

  function normalizeNoTime(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  }

  function daysBetween(later, earlier) {
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.round((normalizeNoTime(later) - normalizeNoTime(earlier)) / msPerDay);
  }

  function clampDate(date, minDate, maxDate) {
    const t = date.getTime();
    const min = minDate.getTime();
    const max = maxDate.getTime();
    return new Date(Math.max(min, Math.min(max, t)));
  }

  // Map 0%->red, 50%->yellow, 100%->green using hue 0..120
  function colorForProgress(pct) {
    const clamped = Math.max(0, Math.min(100, pct));
    const hue = (clamped / 100) * 120; // 0=red, 60=yellow, 120=green
    return `hsl(${hue}, 85%, 50%)`;
  }

  function init() {
    // Element refs
    const elStart = document.getElementById("start");
    const elToday = document.getElementById("today");
    const elEnd = document.getElementById("end");

    const percentValue = document.getElementById("percentValue");
    const statusLabel = document.getElementById("statusLabel");

    const startLabel = document.getElementById("startLabel");
    const todayLabel = document.getElementById("todayLabel");
    const endLabel = document.getElementById("endLabel");

    const timelineFill = document.getElementById("timelineFill");
    const timelineMarker = document.getElementById("timelineMarker");

    const themeToggle = document.getElementById("themeToggle");

    // SVG ring
    const ringBar = document.querySelector(".ring-bar");
    if (!elStart || !elToday || !elEnd || !themeToggle || !ringBar) {
      console.error("Initialization error: required elements not found.");
      return;
    }
    const rAttr = ringBar.getAttribute("r");
    const r = rAttr ? parseFloat(rAttr) : 84;
    const CIRCUMFERENCE = 2 * Math.PI * r;

    // Theme
    function setTheme(theme) {
      const root = document.body;
      if (theme === "dark") {
        root.classList.add("dark");
        themeToggle.textContent = "🌞";
        themeToggle.setAttribute("aria-pressed", "true");
      } else {
        root.classList.remove("dark");
        themeToggle.textContent = "🌙";
        themeToggle.setAttribute("aria-pressed", "false");
      }
      try {
        localStorage.setItem("daytoday:theme", theme);
      } catch {}
    }

    function initTheme() {
      let saved = null;
      try {
        saved = localStorage.getItem("daytoday:theme");
      } catch {}
      const systemPrefersDark =
        window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      setTheme(saved || (systemPrefersDark ? "dark" : "light"));
    }

    // Constraints
    function updateMinMaxConstraints() {
      if (elStart.value) elEnd.min = elStart.value;
      else elEnd.removeAttribute("min");

      if (elEnd.value) elStart.max = elEnd.value;
      else elStart.removeAttribute("max");

      if (elStart.value) elToday.min = elStart.value;
      else elToday.removeAttribute("min");

      if (elEnd.value) elToday.max = elEnd.value;
      else elToday.removeAttribute("max");
    }

    // Inject custom date-picker buttons so icon color can follow theme (without editing HTML)
    function enhanceDatePickers() {
      // Firefox renders its own calendar icon and ignores -webkit- pseudo-elements.
      // If we also inject our custom button, Firefox will show two icons.
      const isFF =
        typeof InstallTrigger !== "undefined" ||
        ("MozAppearance" in document.documentElement.style) ||
        (navigator.userAgent && navigator.userAgent.toLowerCase().includes("firefox"));

      if (isFF) {
        document.body.classList.add("is-firefox");
        // Defensive cleanup: remove any previously injected buttons if present
        document.querySelectorAll(".date-picker-btn").forEach((btn) => btn.remove());
        document.querySelectorAll(".field.has-date-button").forEach((f) =>
          f.classList.remove("has-date-button")
        );
        return; // rely on Firefox's native icon only
      }

      const inputs = document.querySelectorAll('.field input[type="date"]');
      inputs.forEach(addDatePickerButton);
    }

    function addDatePickerButton(input) {
      if (!input) return;
      const field = input.closest(".field");
      if (!field) return;
      if (field.querySelector(".date-picker-btn")) return; // already added

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "date-picker-btn";
      btn.setAttribute("aria-label", "Open date picker");
      // SVG uses currentColor so it adapts to light/dark automatically
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1zm12 8H5v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8zM6 9h12V6H6v3z"/>
        </svg>
      `.trim();

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          if (typeof input.showPicker === "function") {
            input.showPicker();
          } else {
            input.focus();
            // Some browsers open the picker on click/focus
            try { input.click(); } catch {}
            // Fallback: send ArrowDown which often opens native picker
            const ev = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true });
            input.dispatchEvent(ev);
          }
        } catch {
          input.focus();
        }
      });

      field.appendChild(btn);
      field.classList.add("has-date-button");
    }

    function layoutDatePickerButtons() {
      const fields = document.querySelectorAll('.field.has-date-button');
      fields.forEach((field) => {
        const input = field.querySelector('input[type="date"]');
        const btn = field.querySelector('.date-picker-btn');
        if (!input || !btn) return;
        const inputRect = input.getBoundingClientRect();
        const fieldRect = field.getBoundingClientRect();
        const top = inputRect.top - fieldRect.top + (inputRect.height / 2);
        btn.style.top = `${top}px`;
      });
    }

    // Compute + render
    function computeAndRender() {
      const sStr = elStart.value;
      const tStr = elToday.value;
      const eStr = elEnd.value;

      const s = parseYMD(sStr);
      const t = parseYMD(tStr);
      const e = parseYMD(eStr);

      if (!s || !t || !e) return;

      const totalDaysRaw = daysBetween(e, s);
      const totalDays = Math.max(0, totalDaysRaw);

      const tClamped = clampDate(t, s, e);
      const elapsedDays =
        totalDays > 0 ? Math.max(0, Math.min(daysBetween(tClamped, s), totalDays)) : 0;

      let progressPct;
      if (totalDays > 0) {
        progressPct = (elapsedDays / totalDays) * 100;
      } else {
        // start == end
        progressPct = t.getTime() >= e.getTime() ? 100 : 0;
      }
      progressPct = Math.max(0, Math.min(100, progressPct));

      // Gauge ring + color
      const color = colorForProgress(progressPct);
      ringBar.style.stroke = color;
      ringBar.style.strokeDasharray = `${CIRCUMFERENCE} ${CIRCUMFERENCE}`;
      ringBar.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - progressPct / 100));

      // Percent text
      const pctText = progressPct.toFixed(1).replace(/\.0$/, "");
      percentValue.textContent = pctText;

      // Status label
      statusLabel.textContent = `${elapsedDays} of ${totalDays} days`;

      // Timeline
      timelineFill.style.width = `${progressPct}%`;
      timelineFill.style.background = color;
      timelineMarker.style.borderColor = color;
      let markerPosPct;
      if (totalDaysRaw <= 0) {
        markerPosPct = t.getTime() >= e.getTime() ? 100 : 0;
      } else {
        const pos = (daysBetween(t, s) / totalDaysRaw) * 100;
        markerPosPct = Math.max(0, Math.min(100, pos));
      }
      timelineMarker.style.left = `${markerPosPct}%`;

      // Labels
      const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
      startLabel.textContent = fmt.format(s);
      todayLabel.textContent = fmt.format(t);
      endLabel.textContent = fmt.format(e);

      // Constraints + persist
      updateMinMaxConstraints();
      try {
        localStorage.setItem(
          "daytoday:dates",
          JSON.stringify({ start: sStr, today: tStr, end: eStr })
        );
      } catch {}
    }

    function loadInitialDates() {
      const today = new Date();
      const todayStr = toYMD(today);

      let stored = null;
      try {
        stored = JSON.parse(localStorage.getItem("daytoday:dates"));
      } catch {
        stored = null;
      }

      if (stored && stored.start && stored.today && stored.end) {
        elStart.value = stored.start;
        elToday.value = stored.today;
        elEnd.value = stored.end;
      } else {
        // Default range: start = today - 30d, end = today + 30d, today = today
        const start = new Date(today);
        start.setDate(today.getDate() - 30);
        const end = new Date(today);
        end.setDate(today.getDate() + 30);
        elStart.value = toYMD(start);
        elToday.value = todayStr;
        elEnd.value = toYMD(end);
      }
    }

    function bindEvents() {
      ["input", "change"].forEach((evt) => {
        elStart.addEventListener(evt, computeAndRender);
        elToday.addEventListener(evt, computeAndRender);
        elEnd.addEventListener(evt, computeAndRender);
      });

      themeToggle.addEventListener("click", () => {
        const isDark = document.body.classList.contains("dark");
        setTheme(isDark ? "light" : "dark");
      });
    }

    // Initialize sequence
    initTheme();
    loadInitialDates();
    updateMinMaxConstraints();
    enhanceDatePickers();
    layoutDatePickerButtons();
    computeAndRender();
    bindEvents();

    window.addEventListener("resize", layoutDatePickerButtons);
    window.addEventListener("orientationchange", layoutDatePickerButtons);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(layoutDatePickerButtons).catch(() => {});
    }
    setTimeout(layoutDatePickerButtons, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
