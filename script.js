// ---------------------------------------------------------------
// Config
// ---------------------------------------------------------------
const API_URL = "https://mental-health-score-predictor-1-k94j.onrender.com";

// The API does not publish a fixed range for the score, but the
// dial needs one to draw an arc. 0–10 matches the scale this kind
// of wellbeing-score model is typically trained on; the dial simply
// clamps visually if a result ever falls outside it.
const DIAL_MAX = 10;
const DIAL_PATH_LENGTH = 314.159; // length of the semicircle path in the SVG

// Validation rules, mirroring the FastAPI/Pydantic constraints
const RULES = {
  age: { required: true, min: 10, max: 100, type: "number" },
  gender: { required: true, type: "select" },
  country: { required: true, type: "text" },
  academic_level: { required: true, type: "select" },
  most_used_platform: { required: true, type: "select" },
  purpose_of_use: { required: true, type: "select" },
  avg_daily_usage_hours: { required: true, min: 0, max: 24, type: "number" },
  daily_unlocks: { required: true, min: 0, type: "number" },
  study_hours: { required: true, min: 0, max: 24, type: "number" },
  physical_activity_hours: { required: true, min: 0, max: 24, type: "number" },
  sleep_hours_per_night: { required: true, min: 0, max: 24, type: "number" },
  stress_level: { required: true, type: "select" },
};

const INTEGER_FIELDS = new Set(["age", "daily_unlocks"]);

// ---------------------------------------------------------------
// Elements
// ---------------------------------------------------------------
const form = document.getElementById("predictorForm");
const submitBtn = document.getElementById("submitBtn");
const resetBtn = document.getElementById("resetBtn");
const formStatus = document.getElementById("formStatus");

const dial = document.getElementById("dial");
const dialFill = document.getElementById("dialFill");
const dialNumber = document.getElementById("dialNumber");
const dialCaption = document.getElementById("dialCaption");

// ---------------------------------------------------------------
// Validation
// ---------------------------------------------------------------
function readFieldValue(name) {
  const el = form.elements[name];
  return el ? el.value.trim() : "";
}

function validateField(name) {
  const rule = RULES[name];
  const rawValue = readFieldValue(name);
  const errorEl = form.querySelector(`[data-error-for="${name}"]`);
  const fieldEl = form.elements[name].closest(".field");

  let message = "";

  if (rule.required && rawValue === "") {
    message = "This field is required.";
  } else if (rule.type === "number") {
    const num = Number(rawValue);
    if (Number.isNaN(num)) {
      message = "Enter a valid number.";
    } else if (INTEGER_FIELDS.has(name) && !Number.isInteger(num)) {
      message = "Enter a whole number.";
    } else if (rule.min !== undefined && num < rule.min) {
      message = `Must be at least ${rule.min}.`;
    } else if (rule.max !== undefined && num > rule.max) {
      message = `Must be at most ${rule.max}.`;
    }
  }

  if (message) {
    errorEl.textContent = message;
    fieldEl.classList.add("has-error");
  } else {
    errorEl.textContent = "";
    fieldEl.classList.remove("has-error");
  }

  return message === "";
}

function validateForm() {
  let allValid = true;
  for (const name of Object.keys(RULES)) {
    const valid = validateField(name);
    if (!valid) allValid = false;
  }
  return allValid;
}

// Validate a field as soon as the user leaves it
Object.keys(RULES).forEach((name) => {
  const el = form.elements[name];
  if (!el) return;
  el.addEventListener("blur", () => validateField(name));
  el.addEventListener("change", () => validateField(name));
});

// ---------------------------------------------------------------
// Data collection
// ---------------------------------------------------------------
function collectPayload() {
  const payload = {};
  for (const name of Object.keys(RULES)) {
    const rule = RULES[name];
    const raw = readFieldValue(name);
    payload[name] = rule.type === "number" ? Number(raw) : raw;
  }
  return payload;
}

// ---------------------------------------------------------------
// Dial rendering
// ---------------------------------------------------------------
function setDialLoading(isLoading) {
  dial.classList.toggle("is-loading", isLoading);
  if (isLoading) {
    dialNumber.textContent = "";
    dialCaption.textContent = "analyzing your data…";
  }
}

function animateCountUp(target, durationMs = 900) {
  const start = performance.now();
  function tick(now) {
    const progress = Math.min((now - start) / durationMs, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = (target * eased).toFixed(2);
    dialNumber.textContent = value;
    if (progress < 1) requestAnimationFrame(tick);
    else dialNumber.textContent = target.toFixed(2);
  }
  requestAnimationFrame(tick);
}

function renderScore(score) {
  const fraction = Math.max(0, Math.min(score / DIAL_MAX, 1));
  const offset = DIAL_PATH_LENGTH * (1 - fraction);

  dial.classList.remove("is-loading");
  dialFill.style.strokeDashoffset = offset;
  dialCaption.textContent = "predicted mental health score";

  dial.classList.remove("is-revealed");
  void dial.offsetWidth; // restart the reveal animation
  dial.classList.add("is-revealed");

  animateCountUp(score);
}

function resetDial() {
  dial.classList.remove("is-loading", "is-revealed");
  dialFill.style.strokeDashoffset = DIAL_PATH_LENGTH;
  dialNumber.textContent = "–";
  dialCaption.textContent = "awaiting your answers";
}

// ---------------------------------------------------------------
// Status messaging
// ---------------------------------------------------------------
function setStatus(message, kind) {
  formStatus.textContent = message;
  formStatus.classList.remove("is-error", "is-success");
  if (kind) formStatus.classList.add(kind === "error" ? "is-error" : "is-success");
}

// ---------------------------------------------------------------
// Submit handling
// ---------------------------------------------------------------
async function handleSubmit(event) {
  event.preventDefault();
  setStatus("", null);

  if (!validateForm()) {
    setStatus("Please fix the highlighted fields before submitting.", "error");
    const firstError = form.querySelector(".field.has-error input, .field.has-error select");
    if (firstError) firstError.focus();
    return;
  }

  const payload = collectPayload();

  submitBtn.disabled = true;
  submitBtn.classList.add("is-loading");
  resetBtn.disabled = true;
  setDialLoading(true);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let detailMessage = "The server rejected the request.";
      try {
        const errorBody = await response.json();
        if (Array.isArray(errorBody.detail)) {
          detailMessage = errorBody.detail
            .map((d) => d.msg || "Invalid value")
            .join(" ");
        } else if (typeof errorBody.detail === "string") {
          detailMessage = errorBody.detail;
        }
      } catch (_) {
        // response body wasn't JSON — keep the generic message
      }
      throw new Error(detailMessage);
    }

    const data = await response.json();
    const score = Number(data.predicted_mental_health_score);

    if (Number.isNaN(score)) {
      throw new Error("The server response didn't include a valid score.");
    }

    renderScore(score);
    setStatus("Prediction generated by the model.", "success");
  } catch (err) {
    resetDial();
    if (err instanceof TypeError) {
      // fetch() throws a TypeError on network failure / CORS / connection refused
      setStatus(
        "Unable to connect to the prediction server. Please make sure the FastAPI backend is running at " + API_URL + ".",
        "error"
      );
    } else {
      setStatus(err.message || "Something went wrong while generating the prediction.", "error");
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove("is-loading");
    resetBtn.disabled = false;
  }
}

// ---------------------------------------------------------------
// Reset handling
// ---------------------------------------------------------------
function handleReset() {
  form.reset();
  Object.keys(RULES).forEach((name) => {
    const errorEl = form.querySelector(`[data-error-for="${name}"]`);
    const fieldEl = form.elements[name].closest(".field");
    if (errorEl) errorEl.textContent = "";
    if (fieldEl) fieldEl.classList.remove("has-error");
  });
  setStatus("", null);
  resetDial();
}

// ---------------------------------------------------------------
// Init
// ---------------------------------------------------------------
form.addEventListener("submit", handleSubmit);
resetBtn.addEventListener("click", handleReset);
resetDial();
