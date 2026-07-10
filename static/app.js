const ROBOT_STATES = {
  idle: {
    head: "#f2e4b8", body: "#e3bf5c", antenna: "#b8860b",
    mouth: "M 95 118 Q 120 122 145 118",
    speech: "Hi, I'm your TalentFlow AI agent — paste a job description and a resume below and I'll screen it.",
  },
  thinking: {
    head: "#f7ecc9", body: "#f0d27a", antenna: "#c9980f",
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

  const listItems = (items) =>
    items.length
      ? items.map((item) => `
          <li>
            <span class="req-name">${escapeHtml(item.requirement)}</span>
            <span class="req-detail">${escapeHtml(item.detail)}</span>
          </li>
        `).join("")
      : '<li><span class="req-detail">None</span></li>';

  card.innerHTML = `
    <div class="verdict-row">
      <span class="verdict-badge ${result.verdict}">${result.verdict}</span>
      <span class="confidence">Confidence: ${escapeHtml(result.confidence || "")}</span>
    </div>
    <div class="req-section">
      <h4>Matched requirements</h4>
      <ul class="req-list">${listItems(result.matched || [])}</ul>
    </div>
    <div class="req-section">
      <h4>Missing requirements</h4>
      <ul class="req-list">${listItems(result.missing || [])}</ul>
    </div>
  `;
  return card;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", () => {
  setRobotState("idle");

  const form = document.getElementById("screen-form");
  const submitBtn = document.getElementById("submit-btn");
  const results = document.getElementById("results");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const jobDescription = document.getElementById("jd").value.trim();
    const resumeText = document.getElementById("resume").value.trim();
    if (!jobDescription || !resumeText) return;

    submitBtn.disabled = true;
    submitBtn.textContent = "Screening…";
    setRobotState("thinking");

    try {
      const response = await fetch("/api/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume_text: resumeText, job_description: jobDescription }),
      });
      const result = await response.json();

      setRobotState(result.verdict === "error" ? "error" : result.verdict);
      results.prepend(renderResultCard(result));
      document.getElementById("resume").value = "";
    } catch (err) {
      setRobotState("error", "Something went wrong talking to the server.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Screen this resume";
    }
  });
});
