const ROBOT_STATES = {
  idle: {
    head: "#ffffff", body: "#ffffff", antenna: "#2456a6",
    mouth: "M 95 118 Q 120 122 145 118",
    speech: "Hi, I'm your TalentFlow agent — add a resume and a job description, and I'll screen the match.",
  },
  thinking: {
    head: "#eaf1fb", body: "#dbeaf7", antenna: "#1c478c",
    mouth: "M 100 120 Q 120 116 140 120",
    speech: "Running the vote — reading the resume against every requirement…",
  },
  advance: {
    head: "#e6f2ec", body: "#bfdcc4", antenna: "#2e7d5b",
    mouth: "M 92 110 Q 120 140 148 110",
    speech: "Strong match — I'd advance this one.",
  },
  reject: {
    head: "#f8e9e4", body: "#eec3b0", antenna: "#c1472e",
    mouth: "M 95 128 Q 120 106 145 128",
    speech: "This one is missing key requirements.",
  },
  ambiguous: {
    head: "#f9efd9", body: "#f0d27a", antenna: "#9a6f14",
    mouth: "M 100 120 L 112 120 M 128 120 L 140 120",
    speech: "Mixed signals here — worth a closer look.",
  },
  error: {
    head: "#eceef1", body: "#d9cdb8", antenna: "#5c6b7a",
    mouth: "M 100 122 L 140 122",
    speech: "I couldn't screen that — check the input and try again.",
  },
};

const EYE_BUILDERS = {
  dot: () => `
    <circle class="eye" cx="92" cy="85" r="11"/>
    <circle class="eye" cx="148" cy="85" r="11"/>
  `,
  happy: () => `
    <path class="eye-line" d="M 80 88 Q 92 72 104 88" fill="none" stroke="#3a4a58" stroke-width="6" stroke-linecap="round"/>
    <path class="eye-line" d="M 136 88 Q 148 72 160 88" fill="none" stroke="#3a4a58" stroke-width="6" stroke-linecap="round"/>
  `,
  sad: () => `
    <path class="eye-line" d="M 80 90 Q 92 100 104 90" fill="none" stroke="#3a4a58" stroke-width="6" stroke-linecap="round"/>
    <path class="eye-line" d="M 136 90 Q 148 100 160 90" fill="none" stroke="#3a4a58" stroke-width="6" stroke-linecap="round"/>
  `,
  confused: () => `
    <circle class="eye" cx="92" cy="85" r="11"/>
    <path class="eye-line" d="M 136 90 Q 148 78 160 90" fill="none" stroke="#3a4a58" stroke-width="6" stroke-linecap="round"/>
  `,
  x: () => `
    <path class="eye-line" d="M 83 76 L 101 94 M 101 76 L 83 94" stroke="#3a4a58" stroke-width="5" stroke-linecap="round"/>
    <path class="eye-line" d="M 139 76 L 157 94 M 157 76 L 139 94" stroke="#3a4a58" stroke-width="5" stroke-linecap="round"/>
  `,
};

const EYE_TYPE_BY_STATE = {
  idle: "dot",
  thinking: "dot",
  advance: "happy",
  reject: "sad",
  ambiguous: "confused",
  error: "x",
};

function setRobotState(stateName, speechOverride) {
  const state = ROBOT_STATES[stateName] || ROBOT_STATES.idle;
  const robot = document.getElementById("robot");
  robot.dataset.state = stateName;

  document.getElementById("head").style.fill = state.head;
  document.getElementById("body").style.fill = state.body;
  ["arm-l", "arm-r", "hand-l", "hand-r", "shoulder-l", "shoulder-r"].forEach((id) => {
    document.getElementById(id).style.fill = state.body;
  });
  document.getElementById("antenna-tip").style.fill = state.antenna;
  document.getElementById("mouth").setAttribute("d", state.mouth);

  const eyeType = EYE_TYPE_BY_STATE[stateName] || "dot";
  document.getElementById("eyes").innerHTML = EYE_BUILDERS[eyeType]();

  document.getElementById("speech").textContent = speechOverride || state.speech;
}

const RING_CIRC = 2 * Math.PI * 20; // r = 20 in the 48x48 viewBox

function scoreRing(score) {
  if (typeof score !== "number") return "";
  const cls = score >= 75 ? "score-high" : score >= 50 ? "score-mid" : "score-low";
  const offset = RING_CIRC - RING_CIRC * (score / 100);
  return `
    <div class="ring-wrap" role="img" aria-label="Match score ${score} of 100">
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle class="ring-track" cx="24" cy="24" r="20"></circle>
        <circle class="ring-value ${cls}" cx="24" cy="24" r="20"
          style="stroke-dasharray:${RING_CIRC.toFixed(2)};stroke-dashoffset:${offset.toFixed(2)}"></circle>
      </svg>
      <span class="ring-num">${score}</span>
    </div>`;
}

function buildSummary(result) {
  const matched = (result.matched || []).length;
  const missing = (result.missing || []).length;
  const total = matched + missing;
  if (!total) return "";
  const gaps = `${missing} gap${missing === 1 ? "" : "s"}`;
  switch (result.verdict) {
    case "advance":
      return `Strong alignment — ${matched} of ${total} requirements evidenced` +
        (missing ? `, ${gaps} left to probe in the interview.` : ".");
    case "reject":
      return `Key requirements unmet — ${gaps} against ${total} tracked, ${matched} aligned.`;
    case "ambiguous":
      return `Mixed signal — ${matched} aligned, ${gaps}. Worth a human read before deciding.`;
    default:
      return "";
  }
}

function renderResultCard(result) {
  const card = document.createElement("div");
  card.className = "result-card";

  if (result.verdict === "error") {
    card.innerHTML = `
      <div class="verdict-row">
        <div class="verdict-headline">
          <div class="verdict-word error">Couldn't screen</div>
          <div class="verdict-meta">no verdict produced</div>
        </div>
      </div>
      <div class="error-reason">${escapeHtml(result.reason || "Unknown error")}</div>
    `;
    return card;
  }

  const GENERIC_MISSING = "no evidence found in resume";

  const requirementItems = (items, annotationKey, emptyNote) =>
    items.length
      ? items.map((item) => {
          const showDetail = item.detail && item.detail.toLowerCase() !== GENERIC_MISSING;
          const priorityTag = item.priority === "nice-to-have" ? "nice-to-have" : "required";
          const annotation = item[annotationKey];
          return `
          <li>
            <span class="req-name">${escapeHtml(item.requirement)}</span>
            <span class="priority-tag priority-${priorityTag}">${priorityTag}</span>
            ${showDetail ? `<span class="req-detail">${escapeHtml(item.detail)}</span>` : ""}
            ${annotation ? `<span class="req-annotation">${escapeHtml(annotation)}</span>` : ""}
          </li>
        `;
        }).join("")
      : `<li class="empty-note">${emptyNote}</li>`;

  const highlightItems = (items) =>
    items.length
      ? items.map((item) => `
          <li>
            <span class="req-name">${escapeHtml(item.detail)}</span>
            ${item.current_mention ? `<span class="req-detail">"${escapeHtml(item.current_mention)}"</span>` : ""}
            ${item.requirement ? `<span class="req-annotation">Addresses: ${escapeHtml(item.requirement)}</span>` : ""}
            ${item.suggestion ? `<span class="req-annotation">${escapeHtml(item.suggestion)}</span>` : ""}
          </li>
        `).join("")
      : '<li class="empty-note">Nothing to highlight — the resume already presents this clearly.</li>';

  const score = typeof result.score === "number" ? result.score : null;
  const matchedCount = (result.matched || []).length;
  const highlightCount = (result.highlights || []).length;
  const missingCount = (result.missing || []).length;
  const summary = buildSummary(result);

  card.innerHTML = `
    <div class="verdict-row">
      ${scoreRing(score)}
      <div class="verdict-headline">
        <div class="verdict-word ${result.verdict}">${escapeHtml(result.verdict)}</div>
        <div class="verdict-meta">3-model vote<span class="dot">·</span>confidence: ${escapeHtml(result.confidence || "—")}</div>
      </div>
    </div>
    ${summary ? `<p class="verdict-summary">${escapeHtml(summary)}</p>` : ""}
    <div class="tab-buttons">
      <button type="button" class="tab-btn active" data-tab="aligned">Aligned skills<span class="tab-count">${matchedCount}</span></button>
      <button type="button" class="tab-btn" data-tab="highlight">Highlight more<span class="tab-count">${highlightCount}</span></button>
      <button type="button" class="tab-btn" data-tab="gaps">Gaps<span class="tab-count">${missingCount}</span></button>
    </div>
    <div class="tab-panel" data-panel="aligned">
      <ul class="req-list">${requirementItems(result.matched || [], "relevance", "No aligned skills found.")}</ul>
    </div>
    <div class="tab-panel" data-panel="highlight" hidden>
      <ul class="req-list">${highlightItems(result.highlights || [])}</ul>
    </div>
    <div class="tab-panel" data-panel="gaps" hidden>
      <ul class="req-list">${requirementItems(result.missing || [], "importance", "No gaps found.")}</ul>
    </div>
    <div class="feedback-row">
      <span class="feedback-label">Your actual call on this candidate:</span>
      <button type="button" class="feedback-btn feedback-advance" data-decision="advance">Advance them</button>
      <button type="button" class="feedback-btn feedback-reject" data-decision="reject">Not a fit</button>
      <span class="feedback-note"></span>
    </div>
    <div class="schedule-row" ${result.verdict === "advance" ? "" : "hidden"}>
      <span class="schedule-label">Schedule a real interview</span>
      <div class="schedule-inputs">
        <input type="text" class="schedule-name" placeholder="Candidate name" />
        <input type="email" class="schedule-email" placeholder="Candidate email" />
        <input type="text" class="schedule-title" placeholder="Job title" value="${escapeHtml(guessJobTitle(result.job_description))}" />
        <button type="button" class="schedule-check-btn">Check available times</button>
      </div>
      <div class="schedule-slots" hidden>
        <p class="schedule-slots-label">Pick a day/time — nothing is created until you confirm one below:</p>
        <div class="schedule-slots-list"></div>
        <button type="button" class="schedule-confirm-btn" disabled>Confirm &amp; schedule interview</button>
      </div>
      <div class="schedule-note"></div>
    </div>
  `;

  card.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      card.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      card.querySelectorAll(".tab-panel").forEach((p) => { p.hidden = true; });
      btn.classList.add("active");
      card.querySelector(`.tab-panel[data-panel="${btn.dataset.tab}"]`).hidden = false;
    });
  });

  const feedbackNote = card.querySelector(".feedback-note");
  card.querySelectorAll(".feedback-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      card.querySelectorAll(".feedback-btn").forEach((b) => { b.disabled = true; });
      try {
        const response = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            job_description: result.job_description,
            resume_text: result.resume_text,
            decision: btn.dataset.decision,
          }),
        });
        const body = await response.json();
        feedbackNote.textContent = body.status === "ok"
          ? "Saved — I'll factor this in for future candidates against this same job description."
          : "Couldn't save that — try again.";
        // Your actual call overrides the AI's verdict for what you can act
        // on — an AI reject you overturn to "advance them" should still let
        // you schedule them, not just an AI-confirmed advance.
        if (body.status === "ok" && btn.dataset.decision === "advance") {
          card.querySelector(".schedule-row").hidden = false;
        }
      } catch (err) {
        feedbackNote.textContent = "Couldn't save that — try again.";
        card.querySelectorAll(".feedback-btn").forEach((b) => { b.disabled = false; });
      }
    });
  });

  const checkBtn = card.querySelector(".schedule-check-btn");
  if (checkBtn) {
    const nameInput = card.querySelector(".schedule-name");
    const emailInput = card.querySelector(".schedule-email");
    const titleInput = card.querySelector(".schedule-title");
    const scheduleNote = card.querySelector(".schedule-note");
    const slotsSection = card.querySelector(".schedule-slots");
    const slotsList = card.querySelector(".schedule-slots-list");
    const confirmBtn = card.querySelector(".schedule-confirm-btn");
    let selectedSlot = null;

    const formatSlot = (slot) => {
      const start = new Date(slot.start);
      return start.toLocaleString(undefined, {
        weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit",
      });
    };

    checkBtn.addEventListener("click", async () => {
      const candidateName = nameInput.value.trim();
      const candidateEmail = emailInput.value.trim();
      const jobTitle = titleInput.value.trim();
      if (!candidateName || !candidateEmail || !jobTitle) {
        scheduleNote.textContent = "Candidate name, email, and job title are all required.";
        return;
      }

      checkBtn.disabled = true;
      checkBtn.textContent = "Checking your calendar…";
      scheduleNote.textContent = "";

      try {
        const response = await fetch("/api/available-slots");
        const body = await response.json();
        if (body.status !== "ok" || !body.free_blocks?.length) {
          scheduleNote.textContent = body.reason || "No available slots found on your calendar.";
          return;
        }

        slotsList.innerHTML = body.free_blocks.map((slot, i) => `
          <label class="schedule-slot-option">
            <input type="radio" name="schedule-slot-${card.dataset.cardId || Math.random()}" value="${i}" />
            ${escapeHtml(formatSlot(slot))}
          </label>
        `).join("");
        slotsSection.hidden = false;
        checkBtn.hidden = true;

        slotsList.querySelectorAll("input[type=radio]").forEach((radio) => {
          radio.addEventListener("change", () => {
            selectedSlot = body.free_blocks[Number(radio.value)];
            confirmBtn.disabled = false;
          });
        });
      } catch (err) {
        scheduleNote.textContent = "Couldn't reach the server — try again.";
      } finally {
        checkBtn.disabled = false;
        checkBtn.textContent = "Check available times";
      }
    });

    confirmBtn.addEventListener("click", async () => {
      if (!selectedSlot) return;
      const candidateName = nameInput.value.trim();
      const candidateEmail = emailInput.value.trim();
      const jobTitle = titleInput.value.trim();

      const confirmed = window.confirm(
        `This creates a real Calendar event for ${formatSlot(selectedSlot)}, plus a real Gmail draft ` +
        `(and a Slack post, if enabled) — using your connected accounts. Continue?`
      );
      if (!confirmed) return;

      confirmBtn.disabled = true;
      confirmBtn.textContent = "Scheduling…";
      scheduleNote.textContent = "";

      try {
        const response = await fetch("/api/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidate_name: candidateName,
            candidate_email: candidateEmail,
            job_title: jobTitle,
            slot: selectedSlot,
          }),
        });
        const body = await response.json();

        if (body.status !== "ok") {
          scheduleNote.innerHTML = `<span class="schedule-badge schedule-badge--error">Failed: ${escapeHtml(body.reason || "unknown error")}</span>`;
          return;
        }

        const badge = (label, entry) => {
          if (!entry) return "";
          return entry.created
            ? `<span class="schedule-badge schedule-badge--success">${label} created</span>`
            : `<span class="schedule-badge schedule-badge--error">${label} failed: ${escapeHtml(entry.error || "unknown error")}</span>`;
        };
        const badges = [
          badge("Calendar event", body.calendar_event),
          badge("Gmail draft", body.gmail_draft),
          badge("Slack notification", body.slack_notification),
        ].filter(Boolean).join(" ");

        scheduleNote.innerHTML = badges || "No real integrations are enabled (USE_REAL_* flags are off) — nothing was created.";
        slotsSection.hidden = true;
      } catch (err) {
        scheduleNote.textContent = "Couldn't reach the server — try again.";
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Confirm & schedule interview";
      }
    });
  }

  return card;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function guessJobTitle(jobDescription) {
  // Just a starting guess — real job descriptions often open with a company
  // blurb rather than a clean title line. Always shown in an editable field so
  // a human confirms or fixes it before anything real is created.
  const firstLine = (jobDescription || "").split("\n")[0].trim();
  if (!firstLine) return "";
  return firstLine.length > 70 ? firstLine.slice(0, 70) + "…" : firstLine;
}

function wordCount(str) {
  const trimmed = (str || "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

document.addEventListener("DOMContentLoaded", () => {
  setRobotState("idle");

  const form = document.getElementById("screen-form");
  const submitBtn = document.getElementById("submit-btn");
  const screenStatus = document.getElementById("screen-status");
  const results = document.getElementById("results");
  const emptyState = document.getElementById("empty-state");
  const resumeFileInput = document.getElementById("resume-file");
  const resumeTextarea = document.getElementById("resume");
  const jdTextarea = document.getElementById("jd");

  /* ---- resume input mode (segmented control) ---- */
  const modeUpload = document.getElementById("mode-upload");
  const modePaste = document.getElementById("mode-paste");
  const panelUpload = document.getElementById("panel-upload");
  const panelPaste = document.getElementById("panel-paste");

  function setMode(mode) {
    const upload = mode === "upload";
    modeUpload.setAttribute("aria-selected", String(upload));
    modePaste.setAttribute("aria-selected", String(!upload));
    panelUpload.hidden = !upload;
    panelPaste.hidden = upload;
  }
  modeUpload.addEventListener("click", () => setMode("upload"));
  modePaste.addEventListener("click", () => setMode("paste"));

  /* ---- dropzone ---- */
  const dropzone = document.getElementById("dropzone");
  const dzPrimary = document.getElementById("dropzone-primary");
  const dzHint = document.getElementById("dropzone-hint");
  const fileClear = document.getElementById("file-clear");

  function showFile(name) {
    dropzone.classList.add("has-file");
    dzPrimary.textContent = name;
    dzHint.textContent = "Ready to screen";
    fileClear.hidden = false;
  }

  function clearFile() {
    resumeFileInput.value = "";
    dropzone.classList.remove("has-file");
    dzPrimary.innerHTML = 'Drop a resume here or <u>browse</u>';
    dzHint.textContent = "PDF, DOCX or TXT";
    fileClear.hidden = true;
  }

  dropzone.addEventListener("click", (event) => {
    if (event.target !== fileClear) resumeFileInput.click();
  });
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      resumeFileInput.click();
    }
  });
  fileClear.addEventListener("click", (event) => {
    event.stopPropagation();
    clearFile();
  });
  resumeFileInput.addEventListener("change", () => {
    if (resumeFileInput.files.length) showFile(resumeFileInput.files[0].name);
    else clearFile();
  });

  ["dragenter", "dragover"].forEach((ev) =>
    dropzone.addEventListener(ev, (event) => {
      event.preventDefault();
      dropzone.classList.add("is-dragging");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropzone.addEventListener(ev, (event) => {
      event.preventDefault();
      dropzone.classList.remove("is-dragging");
    })
  );
  dropzone.addEventListener("drop", (event) => {
    const files = event.dataTransfer && event.dataTransfer.files;
    if (!files || !files.length) return;
    resumeFileInput.files = files;
    showFile(files[0].name);
  });

  /* ---- word counts ---- */
  function bindCount(el, out) {
    const update = () => {
      out.textContent = `${wordCount(el.value).toLocaleString()} words`;
    };
    el.addEventListener("input", update);
    update();
  }
  bindCount(resumeTextarea, document.getElementById("resume-count"));
  bindCount(jdTextarea, document.getElementById("jd-count"));

  function resetResumeInputs() {
    clearFile();
    resumeTextarea.value = "";
    resumeTextarea.dispatchEvent(new Event("input"));
    setMode("upload");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const jobDescription = jdTextarea.value.trim();
    const resumeText = resumeTextarea.value.trim();
    const hasFile = resumeFileInput.files.length > 0;
    if (!jobDescription || !(hasFile || resumeText)) {
      setRobotState("error", "I need a job description and a resume before I can screen.");
      return;
    }

    const formData = new FormData();
    formData.append("job_description", jobDescription);
    if (hasFile) {
      formData.append("resume_file", resumeFileInput.files[0]);
    } else {
      formData.append("resume_text", resumeText);
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Screening…";
    setRobotState("thinking");

    // Real voting runs multiple full LLM calls — usually a few seconds, but a
    // long resume/JD pair can take a couple of minutes. Only reassure the user
    // it's not frozen if it's actually taking a while.
    const slowNoticeTimer = setTimeout(() => {
      screenStatus.textContent = "Still working — longer resumes and job descriptions can take a couple of minutes.";
      screenStatus.hidden = false;
    }, 8000);

    try {
      const response = await fetch("/api/screen", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();

      setRobotState(result.verdict === "error" ? "error" : result.verdict);
      emptyState.hidden = true;
      results.prepend(renderResultCard(result));
      resetResumeInputs();
    } catch (err) {
      setRobotState("error", "Something went wrong talking to the server.");
    } finally {
      clearTimeout(slowNoticeTimer);
      screenStatus.hidden = true;
      submitBtn.disabled = false;
      submitBtn.textContent = "Screen this resume";
    }
  });
});
