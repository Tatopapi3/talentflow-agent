const ROBOT_STATES = {
  idle: {
    head: "#ffffff", body: "#ffffff", antenna: "#0072bb",
    mouth: "M 95 118 Q 120 122 145 118",
    speech: "Hi, I'm your TalentFlow AI agent — paste a job description and a resume below and I'll screen it.",
  },
  thinking: {
    head: "#eaf3fb", body: "#dbeaf7", antenna: "#00568c",
    mouth: "M 100 120 Q 120 116 140 120",
    speech: "Reading the resume against the job description…",
  },
  advance: {
    head: "#e4efe1", body: "#bfdcc4", antenna: "#3f6b4e",
    mouth: "M 92 110 Q 120 140 148 110",
    speech: "Good match — I'd advance this one.",
  },
  reject: {
    head: "#f7e6df", body: "#eec3b0", antenna: "#a8412f",
    mouth: "M 95 128 Q 120 106 145 128",
    speech: "This one is missing key requirements.",
  },
  ambiguous: {
    head: "#faf1d6", body: "#f0d27a", antenna: "#b8860b",
    mouth: "M 100 120 L 112 120 M 128 120 L 140 120",
    speech: "Mixed signals here — worth a closer look.",
  },
  error: {
    head: "#efe9dd", body: "#d9cdb8", antenna: "#7a6a55",
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

function renderResultCard(result) {
  const card = document.createElement("div");
  card.className = "result-card";

  if (result.verdict === "error") {
    card.innerHTML = `
      <div class="verdict-row">
        <span class="verdict-badge error">Error</span>
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
            ${item.suggestion ? `<span class="req-annotation">${escapeHtml(item.suggestion)}</span>` : ""}
          </li>
        `).join("")
      : '<li class="empty-note">Nothing to highlight — the resume already presents this clearly.</li>';

  const score = typeof result.score === "number" ? result.score : null;
  const scoreClass = score === null ? "" : score >= 75 ? "score-high" : score >= 50 ? "score-mid" : "score-low";

  card.innerHTML = `
    <div class="verdict-row">
      <span class="verdict-badge ${result.verdict}">${result.verdict}</span>
      ${score !== null ? `<span class="score-badge ${scoreClass}">${score}<span class="score-max">/100</span></span>` : ""}
      <span class="confidence">Confidence: ${escapeHtml(result.confidence || "")}</span>
    </div>
    <div class="tab-buttons">
      <button type="button" class="tab-btn active" data-tab="aligned">✅ Aligned Skills</button>
      <button type="button" class="tab-btn" data-tab="highlight">💡 Highlight More</button>
      <button type="button" class="tab-btn" data-tab="gaps">⚠️ Gaps</button>
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
  `;

  card.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      card.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      card.querySelectorAll(".tab-panel").forEach((p) => { p.hidden = true; });
      btn.classList.add("active");
      card.querySelector(`.tab-panel[data-panel="${btn.dataset.tab}"]`).hidden = false;
    });
  });

  return card;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

const DEFAULT_UPLOAD_HINT = "200MB per file · PDF, DOCX, TXT";

document.addEventListener("DOMContentLoaded", () => {
  setRobotState("idle");

  const form = document.getElementById("screen-form");
  const submitBtn = document.getElementById("submit-btn");
  const results = document.getElementById("results");
  const resumeFileInput = document.getElementById("resume-file");
  const uploadBtn = document.getElementById("upload-btn");
  const uploadFilename = document.getElementById("upload-filename");
  const resumeTextarea = document.getElementById("resume");

  uploadBtn.addEventListener("click", () => resumeFileInput.click());

  resumeFileInput.addEventListener("change", () => {
    if (resumeFileInput.files.length) {
      uploadFilename.textContent = resumeFileInput.files[0].name;
      resumeTextarea.value = "";
      resumeTextarea.disabled = true;
      resumeTextarea.placeholder = "Using uploaded file — clear it above to paste text instead.";
    } else {
      uploadFilename.textContent = DEFAULT_UPLOAD_HINT;
      resumeTextarea.disabled = false;
      resumeTextarea.placeholder = "Paste a candidate's resume here...";
    }
  });

  function resetResumeInputs() {
    resumeFileInput.value = "";
    uploadFilename.textContent = DEFAULT_UPLOAD_HINT;
    resumeTextarea.value = "";
    resumeTextarea.disabled = false;
    resumeTextarea.placeholder = "Paste a candidate's resume here...";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const jobDescription = document.getElementById("jd").value.trim();
    const resumeText = resumeTextarea.value.trim();
    const hasFile = resumeFileInput.files.length > 0;
    if (!jobDescription || !(hasFile || resumeText)) return;

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

    try {
      const response = await fetch("/api/screen", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();

      setRobotState(result.verdict === "error" ? "error" : result.verdict);
      results.prepend(renderResultCard(result));
      resetResumeInputs();
    } catch (err) {
      setRobotState("error", "Something went wrong talking to the server.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Screen this resume";
    }
  });
});
