const ROBOT_STATES = {
  idle: {
    head: "#eef3f7", body: "#dfe7ee", antenna: "#8fa6b8",
    mouth: "M 75 118 Q 100 122 125 118",
    speech: "Ready when you are — paste a job description and a resume below.",
  },
  thinking: {
    head: "#fff6e0", body: "#ffedc2", antenna: "#f4b942",
    mouth: "M 80 120 Q 100 116 120 120",
    speech: "Reading the resume against the job description…",
  },
  advance: {
    head: "#e7f9ee", body: "#cdf1da", antenna: "#3fbf6f",
    mouth: "M 72 110 Q 100 140 128 110",
    speech: "Good match — I'd advance this one.",
  },
  reject: {
    head: "#fdeceb", body: "#f8d3d0", antenna: "#e5605a",
    mouth: "M 75 128 Q 100 106 125 128",
    speech: "This one is missing key requirements.",
  },
  ambiguous: {
    head: "#fff8e1", body: "#ffedb0", antenna: "#e0a72e",
    mouth: "M 80 120 L 92 120 M 108 120 L 120 120",
    speech: "Mixed signals here — worth a closer look.",
  },
  error: {
    head: "#f1f1f1", body: "#dcdcdc", antenna: "#9a9a9a",
    mouth: "M 80 122 L 120 122",
    speech: "I couldn't screen that — check the input and try again.",
  },
};

const EYE_BUILDERS = {
  dot: () => `
    <circle class="eye" cx="72" cy="85" r="11"/>
    <circle class="eye" cx="128" cy="85" r="11"/>
  `,
  happy: () => `
    <path class="eye-line" d="M 60 88 Q 72 72 84 88" fill="none" stroke="#3a4a58" stroke-width="6" stroke-linecap="round"/>
    <path class="eye-line" d="M 116 88 Q 128 72 140 88" fill="none" stroke="#3a4a58" stroke-width="6" stroke-linecap="round"/>
  `,
  sad: () => `
    <path class="eye-line" d="M 60 90 Q 72 100 84 90" fill="none" stroke="#3a4a58" stroke-width="6" stroke-linecap="round"/>
    <path class="eye-line" d="M 116 90 Q 128 100 140 90" fill="none" stroke="#3a4a58" stroke-width="6" stroke-linecap="round"/>
  `,
  confused: () => `
    <circle class="eye" cx="72" cy="85" r="11"/>
    <path class="eye-line" d="M 116 90 Q 128 78 140 90" fill="none" stroke="#3a4a58" stroke-width="6" stroke-linecap="round"/>
  `,
  x: () => `
    <path class="eye-line" d="M 63 76 L 81 94 M 81 76 L 63 94" stroke="#3a4a58" stroke-width="5" stroke-linecap="round"/>
    <path class="eye-line" d="M 119 76 L 137 94 M 137 76 L 119 94" stroke="#3a4a58" stroke-width="5" stroke-linecap="round"/>
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
