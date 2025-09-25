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
    // Use 10:30 local time as business cutoff
    return new Date(y, m - 1, d, 10, 30);
  }

  function normalizeNoTime(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10, 30);
  }

  function daysBetween(later, earlier) {
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.round((normalizeNoTime(later) - normalizeNoTime(earlier)) / msPerDay);
  }

  // UTC helpers for live mode
  function parseYMDUTC(ymd) {
    if (!ymd || typeof ymd !== "string") return null;
    const [y, m, d] = ymd.split("-").map((n) => Number(n));
    if (!y || !m || !d) return null;
    // 10:30 UTC as business cutoff
    return new Date(Date.UTC(y, m - 1, d, 10, 30, 0, 0));
  }

  function normalizeNoonUTC(d) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 10, 30, 0, 0));
  }

  function daysBetweenUTC(later, earlier) {
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.round((normalizeNoonUTC(later) - normalizeNoonUTC(earlier)) / msPerDay);
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
    const elIsLive = document.getElementById("isLive");

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
    if (!elStart || !elToday || !elEnd || !elIsLive || !themeToggle || !ringBar) {
      console.error("Initialization error: required elements not found.");
      return;
    }
    const rAttr = ringBar.getAttribute("r");
    const r = rAttr ? parseFloat(rAttr) : 84;
    const CIRCUMFERENCE = 2 * Math.PI * r;
    let liveTimer = null;

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

    // Live mode
    function startLiveTicker() {
      if (liveTimer) return;
      // Update at least once per second; use 500ms for smoother updates
      liveTimer = setInterval(() => {
        computeAndRender();
      }, 100);
    }

    function stopLiveTicker() {
      if (liveTimer) {
        clearInterval(liveTimer);
        liveTimer = null;
      }
    }

    function setLiveEnabled(enabled) {
      elIsLive.checked = !!enabled;
      elToday.disabled = !!enabled;
      try {
        localStorage.setItem("daytoday:isLive", enabled ? "1" : "0");
      } catch {}
      if (enabled) {
        startLiveTicker();
      } else {
        stopLiveTicker();
      }
      computeAndRender();
    }

    function initLive() {
      let savedLive = "0";
      try {
        const v = localStorage.getItem("daytoday:isLive");
        if (v === "1" || v === "true") savedLive = "1";
      } catch {}
      setLiveEnabled(savedLive === "1");
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

      const live = elIsLive && elIsLive.checked;

      // Parse start/end
      const s = live ? parseYMDUTC(sStr) : parseYMD(sStr);
      const e = live ? parseYMDUTC(eStr) : parseYMD(eStr);

      if (!s || !e) return;

      let progressPct = 0;
      let elapsedDays = 0;
      let totalDays = 0;
      let totalDaysRaw = 0;
      let t;

      if (live) {
        // Real-time UTC progress, ms-based
        const nowMs = Date.now();
        const startMs = s.getTime();
        const endMs = e.getTime();
        const clampedNow = Math.max(startMs, Math.min(endMs, nowMs));
        const totalMs = Math.max(0, endMs - startMs);
        const elapsedMs = Math.max(0, clampedNow - startMs);

        progressPct = totalMs > 0 ? (elapsedMs / totalMs) * 100 : (nowMs >= endMs ? 100 : 0);
        progressPct = Math.max(0, Math.min(100, progressPct));

        // For labels/status, compute day counts using UTC noon alignment
        totalDaysRaw = daysBetweenUTC(e, s);
        totalDays = Math.max(0, totalDaysRaw);

        const nowDateUTC = new Date(clampedNow);
        elapsedDays = totalDays > 0
          ? Math.max(0, Math.min(daysBetweenUTC(nowDateUTC, s), totalDays))
          : 0;

        t = new Date(nowMs); // For display only
      } else {
        // Non-live behavior (unchanged)
        const tParsed = parseYMD(tStr);
        if (!tParsed) return;
        t = tParsed;

        totalDaysRaw = daysBetween(e, s);
        totalDays = Math.max(0, totalDaysRaw);

        const tClamped = clampDate(t, s, e);
        elapsedDays =
          totalDays > 0 ? Math.max(0, Math.min(daysBetween(tClamped, s), totalDays)) : 0;

        if (totalDays > 0) {
          progressPct = (elapsedDays / totalDays) * 100;
        } else {
          // start == end
          progressPct = t.getTime() >= e.getTime() ? 100 : 0;
        }
        progressPct = Math.max(0, Math.min(100, progressPct));
      }

      // Gauge ring + color
      const color = colorForProgress(progressPct);
      ringBar.style.stroke = color;
      ringBar.style.strokeDasharray = `${CIRCUMFERENCE} ${CIRCUMFERENCE}`;
      ringBar.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - progressPct / 100));

      // Percent text
      const pctText = progressPct.toFixed(5);
      percentValue.textContent = pctText;

      // Status label
      statusLabel.textContent = `${elapsedDays} of ${totalDays} days`;

      // Timeline
      timelineFill.style.width = `${progressPct}%`;
      timelineFill.style.background = color;
      timelineMarker.style.borderColor = color;
      let markerPosPct;
      if (totalDaysRaw <= 0) {
        markerPosPct = (live ? Date.now() : t.getTime()) >= e.getTime() ? 100 : 0;
      } else {
        if (live) {
          markerPosPct = progressPct;
        } else {
          const pos = (daysBetween(t, s) / totalDaysRaw) * 100;
          markerPosPct = Math.max(0, Math.min(100, pos));
        }
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
        // Default range: start = today - 15d, end = today + 15d, today = today
        const start = new Date(today);
        start.setDate(today.getDate() - 15);
        const end = new Date(today);
        end.setDate(today.getDate() + 15);
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

      if (elIsLive) {
        elIsLive.addEventListener("change", () => setLiveEnabled(elIsLive.checked));
      }

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
    initLive();
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
