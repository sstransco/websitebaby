import { readBarcodes } from "https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.2/dist/es/reader/index.js";

const config = window.SIGMA_APPLICATION_CONFIG || {};
const intro = document.querySelector("[data-intro]");
const wizard = document.querySelector("[data-wizard]");
const startButton = document.querySelector("[data-start]");
const form = document.querySelector("#driver-application");
const stages = [...document.querySelectorAll("[data-stage]")];
const markers = [...document.querySelectorAll("[data-stage-marker]")];
const backButton = document.querySelector("[data-back]");
const nextButton = document.querySelector("[data-next]");
const submitButton = document.querySelector("[data-submit]");
const saveButton = document.querySelector("[data-save]");
const progress = document.querySelector("[data-progress]");
const currentStep = document.querySelector("[data-current-step]");
const saveState = document.querySelector("[data-save-state]");
const review = document.querySelector("[data-review]");
const resultPanel = document.querySelector("[data-submission-result]");
const autofillPanel = document.querySelector("[data-autofill-panel]");
const currentCdlStatus = document.querySelector("[data-cdl-status] span");
const medicalStatus = document.querySelector("[data-medical-status]");
const residenceStatus = document.querySelector("[data-residence-status]");
const employmentStatus = document.querySelector("[data-employment-status]");
const missingList = document.querySelector("[data-missing-list]");
const backendForm = document.querySelector("[data-backend-form]");
const backendPayload = document.querySelector("[data-backend-payload]");
const stepTotal = document.querySelector("[data-step-total]");
const requestPanel = document.querySelector("[data-request-panel]");
const adminRecipient = document.querySelector("[data-admin-recipient]");
const adminSendStatus = document.querySelector("[data-admin-send-status]");
const sessionKey = "sigma-driver-application-v2";
const applicationDate = new Date();
const today = toISODate(applicationDate);
const states = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"],
  ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"],
  ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"],
  ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"],
  ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"],
  ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"],
  ["WY", "Wyoming"], ["PR", "Puerto Rico"]
];
let stageIndex = 0;
let saveTimer;
let repeatIndex = 0;
let tesseractWorker;
let pendingBackendAction = "";
let activeOcrStatus = medicalStatus;
let requestMode = "";
let pendingSend = "";
let signerIp = "";

const consentRequests = {
  psp: {
    field: "psp_authorization",
    title: "PSP Disclosure and Authorization",
    description: "Review the required PSP disclosure and authorization below. You alone must acknowledge and sign this request before Sigma can obtain a PSP report."
  },
  mvr: {
    field: "mvr_authorization",
    title: "MVR and CDLIS Authorization",
    description: "Review the motor-vehicle record and CDLIS authorization below. You alone must acknowledge and sign this request before Sigma can request your records."
  }
};

function applicationDateValue() {
  return getField("application_date")?.value || today;
}

function applicationMonth() {
  return applicationDateValue().slice(0, 7);
}

function stateName(code) {
  return states.find(([value]) => value === String(code || "").toUpperCase())?.[1] || code || "Unknown state";
}

function toISODate(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addYears(value, amount) {
  const date = new Date(`${value}T12:00:00`);
  date.setFullYear(date.getFullYear() + amount);
  return toISODate(date);
}

function monthIndex(value) {
  if (!/^\d{4}-\d{2}$/.test(value || "")) return null;
  const [year, month] = value.split("-").map(Number);
  return year * 12 + month - 1;
}

function monthLabel(index) {
  const year = Math.floor(index / 12);
  const month = index % 12;
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month, 1)));
}

function getField(name) {
  return form.elements.namedItem(name);
}

function setField(name, value) {
  const field = getField(name);
  if (!field || value === undefined || value === null || value === "") return;
  if (field instanceof RadioNodeList) {
    [...field].forEach((option) => {
      option.checked = option.value === String(value);
    });
  } else {
    field.value = value;
  }
}

function setStatus(element, message, state = "") {
  if (!element) return;
  element.textContent = message;
  const container = element.closest(".scan-status, .timeline-status");
  if (container) {
    container.classList.toggle("is-working", state === "working");
    container.classList.toggle("is-success", state === "success");
    container.classList.toggle("is-error", state === "error");
  }
}

function smartScrollIntoView(element, block = "start") {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const topComfort = window.innerWidth <= 760 ? 90 : 24;
  const bottomComfort = window.innerHeight - (window.innerWidth <= 760 ? 110 : 32);
  if (rect.top < topComfort || rect.top > bottomComfort || rect.bottom > bottomComfort) {
    element.scrollIntoView({ behavior: "smooth", block });
  }
}

function isConsentRequestMode() {
  return Boolean(consentRequests[requestMode]);
}

function visibleAuthorizationItems() {
  return [...document.querySelectorAll("[data-authorization-item]")].filter((item) => !item.hidden);
}

function configureRequestMode() {
  const requested = new URLSearchParams(window.location.search).get("request");
  requestMode = consentRequests[requested] ? requested : "";
  if (!isConsentRequestMode()) return;

  const definition = consentRequests[requestMode];
  wizard.classList.add("is-consent-request");
  wizard.dataset.requestType = requestMode;
  document.body.dataset.requestType = requestMode;
  const requestField = getField("request_type");
  if (requestField) requestField.value = requestMode;
  if (requestPanel) {
    requestPanel.classList.remove("is-hidden");
    requestPanel.querySelector("[data-request-kicker]").textContent = "Requested consent";
    requestPanel.querySelector("[data-request-title]").textContent = definition.title;
    requestPanel.querySelector("[data-request-description]").textContent = definition.description;
  }
  document.querySelector("[data-sign-kicker]").textContent = "Requested consent";
  document.querySelector("[data-sign-subtitle]").textContent = "Only this consent is requested. Review it, acknowledge it, and sign it yourself.";
  document.querySelectorAll("[data-authorization-item]").forEach((item) => {
    item.hidden = item.dataset.authorizationType !== requestMode;
  });
  const selected = document.querySelector(`[data-authorization-type="${requestMode}"]`);
  if (selected) setAuthorizationOpen(selected, true);
  if (stepTotal) stepTotal.textContent = "1";
}

function showWizard() {
  intro.classList.add("is-hidden");
  wizard.classList.remove("is-hidden");
  restoreDraft();
  if (isConsentRequestMode()) {
    const requestField = getField("request_type");
    if (requestField) requestField.value = requestMode;
  }
  showStage(isConsentRequestMode() ? stages.length - 1 : 0);
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (pendingSend) window.requestAnimationFrame(applyPendingSend);
}

function showStage(index) {
  stageIndex = Math.max(0, Math.min(index, stages.length - 1));
  stages.forEach((stage, position) => {
    const active = position === stageIndex;
    stage.classList.toggle("is-active", active);
    stage.hidden = !active;
  });

  markers.forEach((marker, position) => {
    marker.classList.toggle("is-current", position === stageIndex);
    marker.classList.toggle("is-complete", position < stageIndex);
  });

  const consentRequest = isConsentRequestMode();
  backButton.disabled = stageIndex === 0 || consentRequest;
  backButton.classList.toggle("is-hidden", consentRequest);
  nextButton.classList.toggle("is-hidden", consentRequest || stageIndex === stages.length - 1);
  submitButton.classList.toggle("is-hidden", stageIndex !== stages.length - 1);
  progress.style.width = `${consentRequest ? 100 : (stageIndex / (stages.length - 1)) * 100}%`;
  currentStep.textContent = consentRequest ? "1" : String(stageIndex + 1);
  if (stageIndex === 2 || stageIndex === 3) updateHistoryCoverage();
  if (stageIndex === stages.length - 1) {
    renderReview();
    renderMissingItems();
    updateDocumentIdentity();
    ensureNextAuthorizationOpen();
  }
  window.requestAnimationFrame(() => smartScrollIntoView(stages[stageIndex]));
}

function focusInvalid(field) {
  field.reportValidity();
  field.focus({ preventScroll: true });
  field.scrollIntoView({ behavior: "smooth", block: "center" });
}

function validateDateWindows(stage) {
  for (const field of stage.querySelectorAll("[data-lookback-years]")) {
    if (!field.value) continue;
    const referenceDate = applicationDateValue();
    const earliest = addYears(referenceDate, -Number(field.dataset.lookbackYears));
    if (field.value < earliest || field.value > referenceDate) {
      field.setCustomValidity(`Enter a date from ${earliest} through ${referenceDate}.`);
      focusInvalid(field);
      return false;
    }
    field.setCustomValidity("");
  }

  const oldestMonth = addYears(applicationDateValue(), -10).slice(0, 7);
  const threeYearMonth = addYears(applicationDateValue(), -3).slice(0, 7);
  for (const entry of stage.querySelectorAll(".older-employment-entry")) {
    const start = entry.querySelector('[name="older_employment_start[]"]');
    const end = entry.querySelector('[name="older_employment_end[]"]');
    for (const field of [start, end]) {
      if (field?.value && (field.value < oldestMonth || field.value > threeYearMonth)) {
        field.setCustomValidity(`Use a month within the additional seven-year window (${oldestMonth} through ${threeYearMonth}).`);
        focusInvalid(field);
        return false;
      }
      field?.setCustomValidity("");
    }
    if (start?.value && end?.value && start.value > end.value) {
      end.setCustomValidity("The end month must be on or after the start month.");
      focusInvalid(end);
      return false;
    }
  }
  return true;
}

function validateDocumentStage() {
  const expiry = getField("license_expiration_date");
  const issue = getField("license_issue_date");
  if (issue?.value && issue.value > today) {
    issue.setCustomValidity("The issue date cannot be in the future.");
    focusInvalid(issue);
    return false;
  }
  issue?.setCustomValidity("");
  if (expiry?.value && expiry.value < today) {
    expiry.setCustomValidity("The current CDL appears expired. Upload a current CDL or correct the date.");
    focusInvalid(expiry);
    return false;
  }
  expiry?.setCustomValidity("");

  const medicalExpiry = getField("medical_card_expiration");
  if (medicalExpiry?.value && medicalExpiry.value < today) {
    medicalExpiry.setCustomValidity("The medical card appears expired. Upload a current card or correct the date.");
    focusInvalid(medicalExpiry);
    return false;
  }
  medicalExpiry?.setCustomValidity("");

  if (!updateLicenseCoverage(true)) return false;
  const reconciliation = document.querySelector("[data-reconciliation]");
  const reconciliationCheck = getField("license_reconciliation_confirmed");
  if (!reconciliation.classList.contains("is-hidden") && !reconciliationCheck.checked) {
    reconciliationCheck.setCustomValidity("Review and confirm the license differences.");
    focusInvalid(reconciliationCheck);
    return false;
  }
  reconciliationCheck?.setCustomValidity("");
  return true;
}

function validateCurrentStage() {
  const stage = stages[stageIndex];
  stage.querySelectorAll("input, select, textarea").forEach((field) => field.setCustomValidity(""));
  if (isConsentRequestMode()) {
    const definition = consentRequests[requestMode];
    const authorization = getField(definition.field);
    const signature = getField("signature_name");
    const certification = getField("certification");
    if (!authorization?.checked) {
      authorization?.setCustomValidity(`Review and acknowledge the ${definition.title}.`);
      focusInvalid(authorization);
      return false;
    }
    if (!signature?.value.trim()) {
      signature?.setCustomValidity("Type your full legal name to sign.");
      focusInvalid(signature);
      return false;
    }
    if (!certification?.checked) {
      certification?.setCustomValidity("Check the certification to sign this consent.");
      focusInvalid(certification);
      return false;
    }
    return true;
  }
  if (stageIndex === 0) {
    updateLicenseCoverage(false);
    reconcileLicenses();
  }
  if (stageIndex === 2 || stageIndex === 3) updateHistoryCoverage(false);
  return true;
}

function safeDraftData() {
  const values = {};
  form.querySelectorAll("input, select, textarea").forEach((field) => {
    if (!field.name || field.type === "file" || field.type === "password" || field.hasAttribute("data-sensitive") || field.hasAttribute("data-admin-control")) return;
    if (field.matches("[data-indexed-checkbox]")) {
      if (!values[field.name]) values[field.name] = [];
      values[field.name].push(field.checked);
      return;
    }
    if ((field.type === "checkbox" || field.type === "radio") && !field.checked) return;
    if (field.name.endsWith("[]")) {
      if (!values[field.name]) values[field.name] = [];
      values[field.name].push(field.value);
    } else {
      values[field.name] = field.type === "checkbox" ? "checked" : field.value;
    }
  });
  return values;
}

function saveDraftLocal() {
  try {
    localStorage.setItem(sessionKey, JSON.stringify(safeDraftData()));
    saveState.innerHTML = "<i></i> Saved on this device";
  } catch {
    saveState.innerHTML = "<i></i> Draft active";
  }
}

function ensureRepeatersForDraft(values) {
  const definitions = [
    ["prior_license_state[]", "prior-license"],
    ["other_license_authority[]", "other-license"],
    ["accident_date[]", "accident"],
    ["violation_date[]", "violation"],
    ["residence_street[]", "residence"],
    ["recent_entry_type[]", "recent-employment"],
    ["older_employer_name[]", "older-employment"]
  ];
  definitions.forEach(([name, type]) => {
    const count = Array.isArray(values[name]) ? values[name].length : 0;
    const existing = repeatContainer(type)?.children.length || 0;
    for (let index = existing; index < count; index += 1) addRepeatItem(type, false);
  });
}

function restoreDraft() {
  const values = readDraftData();
  ensureRepeatersForDraft(values);
  Object.entries(values).forEach(([name, value]) => {
    const fields = [...form.querySelectorAll(`[name="${CSS.escape(name)}"]`)];
    if (!fields.length) return;
    if (Array.isArray(value)) {
      fields.forEach((field, index) => {
        if (value[index] === undefined) return;
        if (field.type === "checkbox") field.checked = checkboxValue(value[index]);
        else field.value = value[index];
      });
      return;
    }
    fields.forEach((field) => {
      if (field.type === "checkbox") field.checked = checkboxValue(value);
      else if (field.type === "radio") field.checked = field.value === value;
      else field.value = value;
    });
  });
  if (Object.keys(values).length) {
    autofillPanel.classList.remove("is-hidden");
    refreshAllConditionals();
  }
}

function checkboxValue(value) {
  return value === true || value === "true" || value === "TRUE" || value === "checked" || value === "yes";
}

function readDraftData() {
  try {
    return JSON.parse(localStorage.getItem(sessionKey) || sessionStorage.getItem(sessionKey) || "{}");
  } catch {
    return {};
  }
}

function scheduleSave() {
  saveState.innerHTML = "<i></i> Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraftLocal, 350);
}

function repeatContainer(type) {
  const selectors = {
    "prior-license": "[data-prior-license-list]",
    "other-license": "[data-other-license-list]",
    accident: "[data-accident-list]",
    violation: "[data-violation-list]",
    residence: "[data-residence-list]",
    "recent-employment": "[data-recent-employment-list]",
    "older-employment": "[data-older-employment-list]"
  };
  return document.querySelector(selectors[type]);
}

function addRepeatItem(type, save = true) {
  const template = document.querySelector(`#${type}-template`);
  const list = repeatContainer(type);
  if (!template || !list) return null;
  repeatIndex += 1;
  const html = template.innerHTML.replaceAll("__INDEX__", String(repeatIndex));
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html.trim();
  const item = wrapper.firstElementChild;
  list.append(item);

  if (type === "recent-employment") {
    const no = item.querySelector('[data-current-toggle][value="no"]');
    if (no) {
      no.checked = true;
      updateCurrentToggle(no);
    }
  }
  if (type === "residence") updateResidenceAddButton();
  if (type === "recent-employment") updateEmploymentType(item);
  populateStateSelects(item);
  applyDateLimits(item);
  if (save) scheduleSave();
  return item;
}

function applyDateLimits(scope = document) {
  scope.querySelectorAll('input[type="date"]').forEach((field) => field.removeAttribute("max"));
  scope.querySelectorAll('input[type="month"]').forEach((field) => {
    if (!field.closest(".older-employment-entry")) field.max = applicationMonth();
  });
  scope.querySelectorAll("[data-lookback-years]").forEach((field) => {
    field.min = addYears(applicationDateValue(), -Number(field.dataset.lookbackYears));
    field.max = applicationDateValue();
  });
  scope.querySelectorAll("[data-future-expiration]").forEach((field) => {
    field.min = applicationDateValue();
  });
  const oldestMonth = addYears(applicationDateValue(), -10).slice(0, 7);
  const threeYearMonth = addYears(applicationDateValue(), -3).slice(0, 7);
  scope.querySelectorAll(".older-employment-entry input[type='month']").forEach((field) => {
    field.min = oldestMonth;
    field.max = threeYearMonth;
  });
}

function populateStateSelects(scope = document) {
  scope.querySelectorAll("select[data-state-select]").forEach((select) => {
    const current = select.value;
    select.replaceChildren(new Option("Choose state", ""), ...states.map(([value, label]) => new Option(label, value)));
    if (current) select.value = current;
  });
}

function updateTemporalLabels() {
  const year = new Date(`${applicationDateValue()}T12:00:00`).getFullYear();
  document.querySelectorAll("[data-recent-history-kicker]").forEach((element) => {
    element.textContent = `${year - 3}-Today`;
  });
  document.querySelectorAll("[data-older-history-kicker]").forEach((element) => {
    element.textContent = `${year - 10}-${year - 3}`;
  });
  document.querySelectorAll("[data-work-history-title]").forEach((element) => {
    element.textContent = "Work History";
  });
  document.querySelectorAll("[data-work-history-legend]").forEach((element) => {
    element.textContent = `Work History - ${year - 3}-Today`;
  });
  document.querySelectorAll("[data-older-history-title]").forEach((element) => {
    element.textContent = "Earlier Work History";
  });
  document.querySelectorAll("[data-older-history-legend]").forEach((element) => {
    element.textContent = `Trucking/CMV employers - ${year - 10}-${year - 3}`;
  });
  applyDateLimits();
  updateLicenseCoverage();
  updateHistoryCoverage();
}

function extractAamvaFields(text) {
  const codes = ["DAQ", "DCS", "DAC", "DAD", "DCT", "DBB", "DBA", "DBD", "DAG", "DAI", "DAJ", "DAK", "DCA", "DCB", "DCD"];
  const codePattern = codes.join("|");
  const cleaned = String(text || "")
    .replace(/\0/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u001c-\u001f]/g, "\n")
    .replace(/ANSI[^\n]*/g, (header) => {
      const embedded = header.match(new RegExp(`(?:DL|ID)((?:${codePattern})[\\s\\S]*)`));
      return embedded ? `\n${embedded[1]}` : "\n";
    });
  const values = {};
  codes.forEach((code) => {
    const otherCodes = codes.filter((item) => item !== code).join("|");
    const pattern = new RegExp(`(?:^|\\n|DL|ID)${code}([^\\n]+?)(?=\\n|${otherCodes}|$)`, "m");
    const match = cleaned.match(pattern) || cleaned.match(new RegExp(`${code}([^\\n]+?)(?=\\n|${otherCodes}|$)`));
    if (match) values[code] = match[1].trim().replace(/[\u001d\u001e]+$/g, "");
  });
  const given = (values.DCT || "").trim().split(/\s+/);
  return {
    licenseNumber: values.DAQ?.replace(/\s+/g, ""),
    lastName: values.DCS,
    firstName: values.DAC || given[0],
    middleName: values.DAD || given.slice(1).join(" "),
    dateOfBirth: parseAamvaDate(values.DBB),
    expirationDate: parseAamvaDate(values.DBA),
    issueDate: parseAamvaDate(values.DBD),
    street: values.DAG,
    city: values.DAI,
    state: values.DAJ,
    postalCode: values.DAK?.slice(0, 10),
    licenseClass: values.DCA,
    restrictions: values.DCB,
    endorsements: values.DCD
  };
}

function parseAamvaDate(raw) {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, 8);
  if (digits.length !== 8) return "";
  const firstFour = Number(digits.slice(0, 4));
  let year;
  let month;
  let day;
  if (firstFour >= 1900 && firstFour <= 2200) {
    year = digits.slice(0, 4);
    month = digits.slice(4, 6);
    day = digits.slice(6, 8);
  } else {
    month = digits.slice(0, 2);
    day = digits.slice(2, 4);
    year = digits.slice(4, 8);
  }
  const candidate = `${year}-${month}-${day}`;
  return Number.isNaN(new Date(`${candidate}T12:00:00`).getTime()) ? "" : candidate;
}

async function scanBarcode(file) {
  if (isPdf(file)) throw new Error("PDF barcode scanning is not available");

  const options = {
    formats: ["PDF417"],
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: true,
    maxNumberOfSymbols: 1,
    textMode: "Plain"
  };
  let results = await withTimeout(readBarcodes(file, options), 5500, "Barcode scan timed out");
  if (!results.length || !results[0].text) {
    const enhanced = await enhanceBarcodeImage(file);
    results = await withTimeout(readBarcodes(enhanced, {
      ...options,
      tryDenoise: true,
      downscaleFactor: 2,
      downscaleThreshold: 900,
      binarizer: "LocalAverage"
    }), 6500, "Enhanced barcode scan timed out");
  }
  if (!results.length || !results[0].text) throw new Error("No PDF417 barcode found");
  return extractAamvaFields(results[0].text);
}

function withTimeout(promise, milliseconds, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function isPdf(file) {
  return file?.type === "application/pdf" || /\.pdf$/i.test(file?.name || "");
}

async function enhanceBarcodeImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const longestSide = Math.max(bitmap.width, bitmap.height);
  let scale = Math.min(1, 2400 / longestSide);
  if (longestSide < 1400) scale = Math.min(2, 1400 / longestSide);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  const histogram = new Uint32Array(256);
  for (let index = 0; index < pixels.length; index += 16) {
    const gray = Math.round(pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114);
    histogram[gray] += 1;
  }
  const samples = histogram.reduce((sum, count) => sum + count, 0);
  const lowTarget = samples * 0.02;
  const highTarget = samples * 0.98;
  let cumulative = 0;
  let low = 0;
  let high = 255;
  let lowFound = false;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value];
    if (!lowFound && cumulative >= lowTarget) {
      low = value;
      lowFound = true;
    }
    if (cumulative >= highTarget) {
      high = value;
      break;
    }
  }
  const range = Math.max(36, high - low);
  for (let index = 0; index < pixels.length; index += 4) {
    const gray = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
    const leveled = Math.max(0, Math.min(255, ((gray - low) * 255) / range));
    pixels[index] = leveled;
    pixels[index + 1] = leveled;
    pixels[index + 2] = leveled;
  }
  return imageData;
}

function populateBarcodeFields(data, scope = document, selector = "data-barcode") {
  let count = 0;
  scope.querySelectorAll(`[${selector}]`).forEach((field) => {
    const key = field.getAttribute(selector);
    if (data[key]) {
      field.value = data[key];
      field.classList.add("is-autofilled");
      if (field.type !== "hidden") count += 1;
    }
  });
  return count;
}

function markAutofilled() {
  const marker = markers[0];
  marker.classList.add("is-complete");
}

async function handleCurrentCdl(file) {
  if (!file) return;
  if (isPdf(file)) {
    autofillPanel.classList.remove("is-hidden");
    setStatus(currentCdlStatus, "PDF attached. For barcode autofill, replace it with a photo; otherwise enter the CDL details below.", "");
    return;
  }
  setStatus(currentCdlStatus, "Reading PDF417 barcode on this device…", "working");
  try {
    const data = await scanBarcode(file);
    const count = populateBarcodeFields(data);
    if (!count) throw new Error("Barcode contained no supported fields");
    autofillPanel.classList.remove("is-hidden");
    markAutofilled();
    setStatus(currentCdlStatus, `${count} values autofilled. Review them against the card.`, "success");
    updateLicenseCoverage();
    reconcileLicenses();
    scheduleSave();
  } catch (error) {
    autofillPanel.classList.remove("is-hidden");
    setStatus(currentCdlStatus, "We could not read that barcode. Retake the image in bright, even light or enter the fields manually.", "error");
  }
}

function parseNameFromFrontText(text) {
  const lines = String(text || "").split(/\n/).map((line) => line.trim()).filter(Boolean);
  const joined = lines.join(" ");
  const labelMatch = joined.match(/(?:name|ln|last name)\s*[:\-]?\s*([A-Z][A-Z'\-]+)[,\s]+([A-Z][A-Z'\-]+)(?:\s+([A-Z][A-Z'\-]+))?/i);
  if (labelMatch) {
    return { lastName: labelMatch[1], firstName: labelMatch[2], middleName: labelMatch[3] || "" };
  }
  const allCaps = lines.find((line) => /^[A-Z][A-Z'\-]+,\s*[A-Z][A-Z'\-]+/.test(line));
  if (!allCaps) return {};
  const [lastName, rest = ""] = allCaps.split(",");
  const [firstName, ...middle] = rest.trim().split(/\s+/);
  return { lastName: lastName.trim(), firstName, middleName: middle.join(" ") };
}

function parseCdlFrontText(text) {
  const normalized = String(text || "").replace(/\s+/g, " ");
  const dates = [...normalized.matchAll(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})\b/g)]
    .map((match) => normalizeOcrDate(match[1]))
    .filter(Boolean);
  const stateMatch = normalized.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/);
  const numberMatch = normalized.match(/\b(?:DL|DLN|LIC|LICENSE|LIC\.|NO|NUMBER|DAQ)\s*[:#]?\s*([A-Z0-9-]{5,18})\b/i) ||
    normalized.match(/\b([A-Z]\d{7,14}|\d{7,14})\b/);
  const expiry = dates.find((date) => date >= applicationDateValue()) || "";
  const issue = dates.filter((date) => !expiry || date < expiry).at(-1) || "";
  return {
    ...parseNameFromFrontText(text),
    licenseNumber: numberMatch?.[1]?.replace(/[^A-Z0-9]/gi, ""),
    state: stateMatch?.[1],
    issueDate: issue,
    expirationDate: expiry
  };
}

function needsFrontOcrFallback() {
  return ["legal_first_name", "legal_last_name", "license_number", "license_expiration_date"]
    .some((name) => !getField(name)?.value);
}

async function handleCurrentCdlFront(file) {
  if (!file || isPdf(file) || !needsFrontOcrFallback()) return;
  setStatus(currentCdlStatus, "Reading the CDL front for fallback OCR...", "working");
  try {
    activeOcrStatus = currentCdlStatus;
    const worker = await getTesseractWorker();
    const { data } = await worker.recognize(file);
    const parsed = parseCdlFrontText(data.text || "");
    const count = populateBarcodeFields(parsed);
    autofillPanel.classList.remove("is-hidden");
    setStatus(
      currentCdlStatus,
      count ? `${count} values filled from the CDL front. Please verify them against the card.` : "CDL front uploaded. Enter any missing details below.",
      count ? "success" : ""
    );
    scheduleSave();
  } catch {
    autofillPanel.classList.remove("is-hidden");
    setStatus(currentCdlStatus, "CDL front uploaded. Enter any missing details below.", "");
  }
}

async function handlePriorCdl(input) {
  const entry = input.closest("[data-license-entry]");
  const status = entry?.querySelector("[data-prior-status]");
  if (!entry || !status || !input.files[0]) return;
  if (isPdf(input.files[0])) {
    setStatus(status, "PDF attached. Enter the four license values below or replace it with a barcode photo.", "");
    return;
  }
  setStatus(status, "Reading prior-card barcode…", "working");
  try {
    const data = await scanBarcode(input.files[0]);
    const count = populateBarcodeFields(data, entry, "data-license-field");
    addResidenceFromCdl(data);
    setStatus(status, `${count} prior-license values autofilled.`, "success");
    updateLicenseCoverage();
    reconcileLicenses();
  } catch {
    setStatus(status, "Barcode not found. Enter the four values below.", "error");
  }
}

function addResidenceFromCdl(data) {
  const street = String(data.street || "").trim();
  const city = String(data.city || "").trim();
  const state = String(data.state || "").trim();
  const postal = String(data.postalCode || "").trim();
  if (!street && !city) return;
  const key = [street, city, state, postal].join("|").toLowerCase();
  const currentKey = [
    getField("current_address_street")?.value,
    getField("current_address_city")?.value,
    getField("current_address_state")?.value,
    getField("current_address_postal")?.value
  ].join("|").toLowerCase();
  const duplicate = [...document.querySelectorAll(".residence-entry")].some((entry) => {
    return [
      entry.querySelector('[name="residence_street[]"]')?.value,
      entry.querySelector('[name="residence_city[]"]')?.value,
      entry.querySelector('[name="residence_state[]"]')?.value,
      entry.querySelector('[name="residence_postal[]"]')?.value
    ].join("|").toLowerCase() === key;
  });
  if (key === currentKey || duplicate) return;
  const entry = addRepeatItem("residence", false);
  if (!entry) return;
  entry.querySelector(".repeat-heading strong").textContent = "Address found on a previous CDL";
  entry.querySelector('[name="residence_street[]"]').value = street;
  entry.querySelector('[name="residence_city[]"]').value = city;
  entry.querySelector('[name="residence_state[]"]').value = state;
  entry.querySelector('[name="residence_postal[]"]').value = postal;
  updateHistoryCoverage();
}

function licenseIntervals() {
  const intervals = [];
  const issue = getField("license_issue_date")?.value;
  const expiry = getField("license_expiration_date")?.value;
  if (issue && expiry) intervals.push({ start: issue, end: expiry, label: "current CDL" });
  document.querySelectorAll("[data-license-entry]").forEach((entry) => {
    const start = entry.querySelector('[name="prior_license_issue[]"]')?.value;
    const end = entry.querySelector('[name="prior_license_expiration[]"]')?.value;
    if (start && end) intervals.push({ start, end, label: "prior CDL" });
  });
  return intervals;
}

function findDateGap(intervals, start, end) {
  const day = 24 * 60 * 60 * 1000;
  const startTime = new Date(`${start}T12:00:00`).getTime();
  const endTime = new Date(`${end}T12:00:00`).getTime();
  const normalized = intervals
    .map((item) => ({
      start: new Date(`${item.start}T12:00:00`).getTime(),
      end: new Date(`${item.end}T12:00:00`).getTime()
    }))
    .filter((item) => item.start <= endTime && item.end >= startTime)
    .sort((a, b) => a.start - b.start);
  let cursor = startTime;
  for (const interval of normalized) {
    if (interval.start > cursor) return { start: toISODate(cursor), end: toISODate(interval.start - day) };
    if (interval.end + day > cursor) cursor = interval.end + day;
    if (cursor > endTime) return null;
  }
  return cursor <= endTime ? { start: toISODate(cursor), end } : null;
}

function updateLicenseCoverage(report = false) {
  const section = document.querySelector("[data-prior-license-section]");
  const gapText = document.querySelector("[data-license-gap]");
  const addButton = document.querySelector("[data-add-prior-license]");
  const end = applicationDateValue();
  const start = addYears(end, -2);
  const intervals = licenseIntervals();
  const gap = findDateGap(intervals, start, end);
  const currentIssue = getField("license_issue_date")?.value;
  const shouldShow = Boolean(currentIssue && currentIssue > start) || (intervals.length > 0 && gap);
  section.classList.toggle("is-hidden", !shouldShow);
  const override = getField("license_coverage_override")?.value === "yes";
  if (gap) {
    gapText.textContent = override
      ? `Two-year CDL coverage is still incomplete (${gap.start} through ${gap.end}). Safety will follow up after submission.`
      : `CDL coverage is missing from approximately ${gap.start} through ${gap.end}. Save the previous CDL below; if more time remains, we’ll prompt for another.`;
    if (shouldShow && !document.querySelector("[data-license-entry]")) addRepeatItem("prior-license", false);
  } else {
    gapText.textContent = "The uploaded cards document the requested two-year period.";
  }
  const savedEntries = [...document.querySelectorAll("[data-license-entry][data-license-saved='true']")];
  const unsavedEntry = [...document.querySelectorAll("[data-license-entry]")]
    .some((entry) => entry.dataset.licenseSaved !== "true");
  if (addButton) {
    addButton.classList.toggle("is-hidden", unsavedEntry || (!gap && !savedEntries.length));
    addButton.innerHTML = gap
      ? "<span>+</span> Add the next CDL card"
      : "<span>+</span> Record another license number <small>(optional)</small>";
  }
  document.querySelectorAll("[data-license-entry] input").forEach((field) => field.setCustomValidity(""));
  return !gap || override;
}

function licenseRecords() {
  const records = [{
    label: "Current CDL",
    state: getField("license_state")?.value.trim(),
    licenseNumber: getField("license_number")?.value.trim(),
    issueDate: getField("license_issue_date")?.value,
    expirationDate: getField("license_expiration_date")?.value
  }];
  document.querySelectorAll("[data-license-entry]").forEach((entry, index) => {
    records.push({
      label: `Prior CDL ${index + 1}`,
      state: entry.querySelector('[name="prior_license_state[]"]')?.value.trim(),
      licenseNumber: entry.querySelector('[name="prior_license_number[]"]')?.value.trim(),
      issueDate: entry.querySelector('[name="prior_license_issue[]"]')?.value,
      expirationDate: entry.querySelector('[name="prior_license_expiration[]"]')?.value
    });
  });
  return records.filter((record) => record.issueDate || record.licenseNumber);
}

function reconcileLicenses() {
  const records = licenseRecords();
  const reconciliation = document.querySelector("[data-reconciliation]");
  const list = document.querySelector("[data-reconciliation-list]");
  const differences = [];
  const seen = new Set();
  records.forEach((record, index) => {
    const duplicateKey = [record.state, record.licenseNumber, record.issueDate, record.expirationDate].join("|").toLowerCase();
    if (seen.has(duplicateKey) && duplicateKey.replaceAll("|", "")) {
      differences.push(`${record.label} duplicates another uploaded license record.`);
    }
    seen.add(duplicateKey);
    if (index > 0 && ((records[0].state && record.state && records[0].state !== record.state) ||
      (records[0].licenseNumber && record.licenseNumber && records[0].licenseNumber !== record.licenseNumber))) {
      differences.push(
        `Driver’s License ${index}: ${stateName(record.state)}, ${record.licenseNumber || "number not provided"} → ` +
        `${stateName(records[0].state)}, ${records[0].licenseNumber || "number not provided"}`
      );
    }
  });
  reconciliation.classList.toggle("is-hidden", !differences.length);
  list.replaceChildren(...differences.map((message) => {
    const item = document.createElement("li");
    item.textContent = message;
    return item;
  }));
}

async function getTesseractWorker() {
  if (tesseractWorker) return tesseractWorker;
  if (!window.Tesseract) throw new Error("OCR library unavailable");
  tesseractWorker = await window.Tesseract.createWorker("eng", 1, {
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js",
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0",
    langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int",
    logger(message) {
      if (message.status === "recognizing text") {
        setStatus(activeOcrStatus, `Reading document... ${Math.round((message.progress || 0) * 100)}%`, "working");
      }
    }
  });
  return tesseractWorker;
}

function normalizeOcrDate(raw) {
  const match = String(raw || "").match(/(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!match) return "";
  let [, first, second, third] = match;
  let year;
  let month;
  let day;
  if (first.length === 4) {
    year = first;
    month = second;
    day = third;
  } else {
    month = first;
    day = second;
    year = third.length === 2 ? `20${third}` : third;
  }
  const value = `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return Number.isNaN(new Date(`${value}T12:00:00`).getTime()) ? "" : value;
}

function findMedicalExpiration(text) {
  const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const datePattern = /\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/g;
  const certificateLabelLines = [];
  const ombLines = [];
  lines.forEach((line, index) => {
    const normalized = line.toLowerCase();
    if (/medical\s+examiner.?s?\s+certificate\s+expiration\s+date/.test(normalized)) {
      certificateLabelLines.push(index);
    }
    if (/(omb|control\s+number|form\s+expiration|paperwork|public\s+burden)/.test(normalized)) {
      ombLines.push(index);
    }
  });
  const candidates = [];
  lines.forEach((line, index) => {
    const matches = [...line.matchAll(datePattern)];
    matches.forEach((match) => {
      const value = normalizeOcrDate(match[0]);
      if (!value) return;
      const normalizedLine = line.toLowerCase();
      const context = lines.slice(Math.max(0, index - 2), index + 3).join(" ").toLowerCase();
      let score = 0;
      const certificateDistance = certificateLabelLines.length
        ? Math.min(...certificateLabelLines.map((lineIndex) => Math.abs(lineIndex - index)))
        : Infinity;
      const ombDistance = ombLines.length
        ? Math.min(...ombLines.map((lineIndex) => Math.abs(lineIndex - index)))
        : Infinity;
      if (certificateDistance <= 3) score += 180 - certificateDistance * 25;
      else if (/certificate\s+expiration\s+date/.test(context)) score += 100;
      else if (/(expires|expiration|valid\s+until)/.test(context)) score += 30;
      if (/(omb|control\s+number|form\s+expiration|paperwork|public\s+burden)/.test(normalizedLine)) score -= 240;
      else if (ombDistance <= 1) score -= 110;
      if (/(clinic|laboratory|specimen|test\s+kit|facility\s+license)/.test(normalizedLine)) score -= 160;
      else if (/(clinic|laboratory|specimen|test\s+kit|facility\s+license)/.test(context)) score -= 70;
      if (value >= applicationDateValue() && value <= addYears(applicationDateValue(), 3)) score += 15;
      if (value < addYears(applicationDateValue(), -1)) score -= 25;
      candidates.push({ value, score, index });
    });
  });
  candidates.sort((left, right) => right.score - left.score || left.index - right.index);
  return candidates[0]?.value || "";
}

async function handleMedicalCard(file) {
  if (!file) return;
  if (isPdf(file)) {
    setStatus(medicalStatus, "PDF saved. Enter the expiration date shown on the card.", "");
    return;
  }
  setStatus(medicalStatus, "Preparing on-device OCR…", "working");
  try {
    activeOcrStatus = medicalStatus;
    const worker = await getTesseractWorker();
    const { data } = await worker.recognize(file);
    const expiry = findMedicalExpiration(data.text || "");
    if (!expiry) throw new Error("Expiration not found");
    setField("medical_card_expiration", expiry);
    setStatus(medicalStatus, `Expiration date autofilled as ${expiry}. Please verify it.`, "success");
    scheduleSave();
  } catch {
    setStatus(medicalStatus, "We could not confidently read the expiration date. Enter it manually.", "error");
  }
}

function refreshConditional(name) {
  const selected = form.querySelector(`[name="${CSS.escape(name)}"]:checked`);
  if (!selected) return;
  const key = selected.dataset.conditional;
  const panel = document.querySelector(`[data-conditional-panel="${CSS.escape(key)}"]`);
  if (!panel) return;
  const show = selected.value === "yes" || selected.value === "one_or_more";
  panel.classList.toggle("is-hidden", !show);
  panel.querySelectorAll("[data-conditional-required]").forEach((field) => {
    field.required = false;
    field.dataset.followupRecommended = String(show);
    if (!show) field.setCustomValidity("");
  });
  const repeatTypes = { accidents: "accident", violations: "violation", "other-licenses": "other-license" };
  const repeatType = repeatTypes[key];
  if (show && repeatType && !repeatContainer(repeatType)?.children.length) addRepeatItem(repeatType, false);
}

function refreshAllConditionals() {
  ["other_unexpired_license", "accident_attestation", "violation_attestation", "license_action_attestation", "cmv_disqualified"]
    .forEach(refreshConditional);
  document.querySelectorAll("[data-current-toggle]:checked").forEach(updateCurrentToggle);
  document.querySelectorAll(".employment-entry").forEach(updateEmploymentType);
  document.querySelectorAll("[data-employment-cmv]:checked").forEach(updateCmvExperience);
  document.querySelectorAll("[data-do-not-contact]").forEach(updateContactPreference);
}

function updateCurrentToggle(input) {
  const entry = input.closest("[data-timeline-entry]");
  const endWrap = entry?.querySelector(".end-month");
  const end = entry?.querySelector("[data-timeline-end]");
  if (!entry || !endWrap || !end) return;
  const current = input.value === "yes";
  endWrap.classList.toggle("is-hidden", current);
  end.required = false;
  if (current) end.value = "";
  entry.querySelector(".reason-leaving")?.classList.toggle("is-hidden", current);
  if (entry.classList.contains("residence-entry")) updateResidenceAddButton();
  updateHistoryCoverage();
}

function updateResidenceAddButton() {
  const button = document.querySelector("[data-add-residence]");
  if (!button) return;
  const entries = [...document.querySelectorAll(".residence-entry")];
  if (!entries.length) {
    button.classList.remove("is-hidden");
    return;
  }
  const lastEntry = entries[entries.length - 1];
  const currentChoice = lastEntry.querySelector('[data-current-toggle]:checked')?.value;
  button.classList.toggle("is-hidden", currentChoice !== "no");
}

function updateEmploymentType(entry) {
  const type = entry.querySelector("[data-employment-type]")?.value;
  const employer = type === "employer" || type === "self_employed";
  entry.querySelectorAll(".employer-only").forEach((element) => element.classList.toggle("is-hidden", !employer));
  entry.querySelectorAll("[data-employer-required]").forEach((field) => {
    field.required = false;
    if (!employer) {
      if (field.type === "radio") field.checked = false;
      else field.value = "";
    }
  });
  const current = entry.querySelector('[data-current-toggle][value="yes"]')?.checked;
  entry.querySelector(".reason-leaving")?.classList.toggle("is-hidden", !employer || current);
}

function updateCmvExperience(input) {
  const entry = input.closest(".employment-entry");
  const panel = entry?.querySelector("[data-cmv-experience]");
  if (!panel) return;
  const show = input.value === "yes";
  panel.classList.toggle("is-hidden", !show);
}

function updateContactPreference(input) {
  const entry = input.closest(".employment-entry, .older-employment-entry");
  const explanation = entry?.querySelector(".contact-explanation");
  if (!explanation) return;
  explanation.classList.toggle("is-hidden", !input.checked);
  explanation.querySelector("textarea").required = false;
}

function setAuthorizationOpen(item, open) {
  const body = item.querySelector(".authorization-body");
  const header = item.querySelector("[data-authorization-toggle]");
  item.classList.toggle("is-open", open);
  if (body) body.hidden = !open;
  if (header) {
    header.setAttribute("aria-expanded", String(open));
    const icon = header.querySelector("b");
    if (icon) icon.textContent = open ? "−" : "+";
  }
}

function advanceAuthorization(input) {
  const item = input.closest("[data-authorization-item]");
  if (!item || !input.checked) return;
  setAuthorizationOpen(item, false);
  const items = visibleAuthorizationItems();
  const next = items.slice(items.indexOf(item) + 1).find((candidate) => !candidate.querySelector("[data-authorization-ack]")?.checked);
  if (next) {
    setAuthorizationOpen(next, true);
    window.requestAnimationFrame(() => smartScrollIntoView(next, "nearest"));
  }
  ensureNextAuthorizationOpen();
  renderMissingItems();
}

function ensureNextAuthorizationOpen() {
  const items = visibleAuthorizationItems();
  if (!items.length || items.some((item) => item.classList.contains("is-open"))) return;
  const next = items.find((item) => !item.querySelector("[data-authorization-ack]")?.checked);
  if (next) setAuthorizationOpen(next, true);
}

function updateDocumentIdentity() {
  const name = [getField("legal_first_name")?.value, getField("legal_middle_name")?.value, getField("legal_last_name")?.value]
    .filter(Boolean).join(" ") || "Not yet provided";
  const date = applicationDateValue();
  document.querySelectorAll("[data-document-identity]").forEach((element) => {
    element.textContent = `Applicant: ${name} · Application date: ${date}`;
  });
  const signature = getField("signature_name");
  if (signature && !signature.value && name !== "Not yet provided" && !isConsentRequestMode()) signature.value = name;
}

function timelineIntervals(kind) {
  const entries = [];
  if (kind === "residence") {
    const start = getField("current_address_start")?.value;
    if (start) entries.push({ start, end: applicationMonth() });
  }
  const selector = kind === "residence" ? ".residence-entry" : ".employment-entry";
  document.querySelectorAll(selector).forEach((entry) => {
    const start = entry.querySelector("[data-timeline-start]")?.value;
    const current = entry.querySelector('[data-current-toggle][value="yes"]')?.checked;
    const end = current ? applicationMonth() : entry.querySelector("[data-timeline-end]")?.value;
    if (start && end) entries.push({ start, end });
  });
  return entries;
}

function uncoveredMonths(intervals, months = 36) {
  const end = monthIndex(applicationMonth());
  const start = end - months + 1;
  const covered = new Set();
  intervals.forEach((interval) => {
    const intervalStart = Math.max(start, monthIndex(interval.start) ?? end + 1);
    const intervalEnd = Math.min(end, monthIndex(interval.end) ?? start - 1);
    for (let month = intervalStart; month <= intervalEnd; month += 1) covered.add(month);
  });
  const missing = [];
  for (let month = start; month <= end; month += 1) {
    if (!covered.has(month)) missing.push(month);
  }
  return missing;
}

function describeMissing(missing) {
  if (!missing.length) return "";
  const groups = [];
  let start = missing[0];
  let previous = missing[0];
  missing.slice(1).forEach((month) => {
    if (month !== previous + 1) {
      groups.push([start, previous]);
      start = month;
    }
    previous = month;
  });
  groups.push([start, previous]);
  return groups.map(([from, to]) => from === to ? monthLabel(from) : `${monthLabel(from)}–${monthLabel(to)}`).join(", ");
}

function updateCoverageStatus(kind, report = false) {
  const status = kind === "residence" ? residenceStatus : employmentStatus;
  const intervals = timelineIntervals(kind);
  const missing = uncoveredMonths(intervals);
  if (!missing.length) {
    setStatus(status, `✓ Continuous ${kind} coverage for the preceding 36 calendar months.`, "success");
    return true;
  }
  const description = describeMissing(missing);
  setStatus(status, `Add an entry covering: ${description}. A one-month gap is not allowed.`, report ? "error" : "");
  if (report) {
    const add = document.querySelector(kind === "residence" ? "[data-add-residence]" : "[data-add-recent-employment]");
    add?.focus();
    add?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  return false;
}

function updateHistoryCoverage(report = false) {
  const residenceComplete = updateCoverageStatus("residence", report);
  const employmentComplete = updateCoverageStatus("employment", report);
  return residenceComplete && employmentComplete;
}

function renderReview() {
  const value = (name) => getField(name)?.value?.trim() || "Not provided";
  const selected = (name) => form.querySelector(`[name="${name}"]:checked`)?.value || "Not provided";
  if (isConsentRequestMode()) {
    const definition = consentRequests[requestMode];
    const cards = [
      ["Requested form", definition.title, 5],
      ["Authorization", getField(definition.field)?.checked ? "Complete" : "Needs attention", 5],
      ["Electronic signature", getField("signature_name")?.value?.trim() && getField("certification")?.checked ? "Complete" : "Needs attention", 5]
    ];
    review.replaceChildren(...cards.map(([label, detail, stage]) => {
      const article = document.createElement("article");
      const icon = document.createElement("i");
      const heading = document.createElement("span");
      const text = document.createElement("strong");
      const complete = detail && !/Needs attention/.test(detail);
      article.className = complete ? "is-complete" : "needs-attention";
      icon.textContent = complete ? "✓" : "[!]";
      heading.textContent = label;
      text.textContent = detail;
      article.append(icon, heading, text);
      if (!complete) {
        const edit = document.createElement("button");
        edit.type = "button";
        edit.dataset.goStage = String(stage);
        edit.textContent = "Edit";
        article.append(edit);
      }
      return article;
    }));
    return;
  }
  const fullName = [value("legal_first_name"), value("legal_middle_name"), value("legal_last_name")]
    .filter((part) => part !== "Not provided").join(" ") || "Not provided";
  const cards = [
    ["Application date", value("application_date"), 0],
    ["Applicant", fullName, 0],
    ["Current address", `${value("current_address_city")}, ${value("current_address_state")} ${value("current_address_postal")}`, 0],
    ["Current license", `${value("license_state")} · Class ${value("license_class")} · expires ${value("license_expiration_date")}`, 0],
    ["Medical card", `Expires ${value("medical_card_expiration")}`, 0],
    ["Accident history", selected("accident_attestation"), 1],
    ["Violation history", selected("violation_attestation"), 1],
    ["License action", selected("license_action_attestation"), 1],
    ["CMV disqualification", selected("cmv_disqualified"), 1],
    ["Three-year residence", uncoveredMonths(timelineIntervals("residence")).length ? "Needs attention" : "Complete", 2],
    ["Three-year employment", uncoveredMonths(timelineIntervals("employment")).length ? "Needs attention" : "Complete", 3],
    ["Signed authorizations", [...form.querySelectorAll("[data-authorization-ack]")].every((input) => input.checked) ? "Complete" : "Needs attention", 5],
    ["Application certification", getField("certification")?.checked ? "Complete" : "Needs attention", 5]
  ];
  review.replaceChildren(...cards.map(([label, detail, stage]) => {
    const article = document.createElement("article");
    const icon = document.createElement("i");
    const heading = document.createElement("span");
    const text = document.createElement("strong");
    const complete = detail && !/Not provided|Needs attention/.test(detail);
    article.className = complete ? "is-complete" : "needs-attention";
    icon.textContent = complete ? "✓" : "[!]";
    heading.textContent = label;
    text.textContent = detail;
    article.append(icon, heading, text);
    if (!complete) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.dataset.goStage = String(stage);
      edit.textContent = "Edit";
      article.append(edit);
    }
    return article;
  }));
}

function fileSlotSatisfied(name) {
  return [...form.querySelectorAll('input[type="file"]')].some((input) => {
    const logicalName = input.dataset.uploadField || input.name;
    return logicalName === name && (input.files.length > 0 || input.dataset.savedFileId);
  });
}

function renderMissingItems() {
  if (!missingList) return [];
  const hasValue = (name) => Boolean(getField(name)?.value?.trim());
  if (isConsentRequestMode()) {
    const definition = consentRequests[requestMode];
    const items = [
      { missing: !getField(definition.field)?.checked, label: `${definition.title} has not been acknowledged`, action: "Review", stage: 5 },
      { missing: !hasValue("signature_name"), label: "Electronic signature is missing", action: "Sign", stage: 5 },
      { missing: !getField("certification")?.checked, label: "Consent certification is not signed", action: "Sign", stage: 5 }
    ].filter((item) => item.missing);
    if (!items.length) {
      const complete = document.createElement("div");
      complete.className = "missing-item is-complete";
      complete.innerHTML = "<span>✓</span><strong>This consent is ready to submit.</strong>";
      missingList.replaceChildren(complete);
    } else {
      missingList.replaceChildren(...items.map((item) => {
        const row = document.createElement("div");
        row.className = "missing-item";
        const icon = document.createElement("span");
        const label = document.createElement("strong");
        const button = document.createElement("button");
        icon.textContent = "!";
        label.textContent = item.label;
        button.type = "button";
        button.dataset.goStage = String(item.stage);
        button.textContent = item.action;
        row.append(icon, label, button);
        return row;
      }));
    }
    submitButton.innerHTML = items.length
      ? `Submit signed ${requestMode.toUpperCase()} consent <span aria-hidden="true">→</span>`
      : `Submit signed ${requestMode.toUpperCase()} consent <span aria-hidden="true">→</span>`;
    return items;
  }
  const hasSelection = (name) => Boolean(form.querySelector(`[name="${CSS.escape(name)}"]:checked`));
  const contactExplanationMissing = [...form.querySelectorAll("[data-do-not-contact]:checked")].some((checkbox) => {
    return !checkbox.closest(".employment-entry, .older-employment-entry")?.querySelector("[data-contact-explanation]")?.value.trim();
  });
  const items = [
    { missing: !fileSlotSatisfied("current_cdl_back"), label: "CDL back is not attached", action: "Upload", stage: 0 },
    { missing: !fileSlotSatisfied("current_cdl_front"), label: "CDL front is not attached", action: "Upload", stage: 0 },
    { missing: !hasValue("legal_first_name") || !hasValue("legal_last_name"), label: "Legal name is incomplete", action: "Edit", stage: 0 },
    { missing: !hasValue("ssn"), label: "Social Security number is missing", action: "Edit", stage: 0 },
    { missing: !hasValue("current_address_street") || !hasValue("current_address_city") || !hasValue("current_address_state"), label: "Current address is incomplete", action: "Edit", stage: 0 },
    { missing: !hasValue("license_number"), label: "Current CDL number is missing", action: "Edit", stage: 0 },
    { missing: !hasValue("license_expiration_date"), label: "Current CDL expiration date is missing", action: "Edit", stage: 0 },
    { missing: !fileSlotSatisfied("medical_card"), label: "Medical card is not attached", action: "Upload", stage: 0 },
    { missing: !hasValue("medical_card_expiration"), label: "Medical-card expiration date is missing", action: "Edit", stage: 0 },
    { missing: !updateLicenseCoverage(false), label: "Two continuous years of CDL cards are not documented", action: "Review", stage: 0 },
    { missing: !hasSelection("accident_attestation") || !hasSelection("violation_attestation") || !hasSelection("license_action_attestation") || !hasSelection("cmv_disqualified"), label: "One or more driving-record questions are unanswered", action: "Edit", stage: 1 },
    { missing: uncoveredMonths(timelineIntervals("residence")).length > 0, label: "Three-year residence coverage has gaps or missing dates", action: "Edit", stage: 2 },
    { missing: uncoveredMonths(timelineIntervals("employment")).length > 0, label: "Three-year work/activity coverage has gaps", action: "Edit", stage: 3 },
    { missing: contactExplanationMissing, label: "A “do not contact” employer request needs an explanation", action: "Edit", stage: 3 },
    { missing: [...form.querySelectorAll("[data-authorization-ack]")].some((input) => !input.checked), label: "One or more notices or authorizations have not been acknowledged", action: "Review", stage: 5 },
    { missing: !hasValue("signature_name") || !getField("certification")?.checked, label: "Application certification is not signed", action: "Sign", stage: 5 }
  ].filter((item) => item.missing);

  const differences = [...document.querySelectorAll("[data-reconciliation-list] li")].map((item) => item.textContent);
  differences.forEach((label) => items.push({ label, action: "Review", stage: 0, difference: true }));

  if (!items.length) {
    const complete = document.createElement("div");
    complete.className = "missing-item is-complete";
    complete.innerHTML = "<span>✓</span><strong>No missing items or unresolved differences.</strong>";
    missingList.replaceChildren(complete);
  } else {
    missingList.replaceChildren(...items.map((item) => {
      const row = document.createElement("div");
      row.className = `missing-item${item.difference ? " is-difference" : ""}`;
      const icon = document.createElement("span");
      icon.textContent = item.difference ? "↔" : "!";
      const label = document.createElement("strong");
      label.textContent = item.label;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.goStage = String(item.stage);
      button.textContent = item.action;
      row.append(icon, label, button);
      return row;
    }));
  }
  const followupCount = items.filter((item) => !item.difference).length;
  renderReview();
  submitButton.innerHTML = items.length
    ? `Submit with ${followupCount} follow-up item${followupCount === 1 ? "" : "s"} <span aria-hidden="true">→</span>`
    : `Submit application <span aria-hidden="true">→</span>`;
  return items;
}

function serializeFields() {
  const fields = {};
  form.querySelectorAll("input, select, textarea").forEach((field) => {
    if (!field.name || field.type === "file" || field.disabled || field.hasAttribute("data-admin-control")) return;
    if (field.matches("[data-indexed-checkbox]")) {
      if (!fields[field.name]) fields[field.name] = [];
      fields[field.name].push(field.checked);
      return;
    }
    if ((field.type === "checkbox" || field.type === "radio") && !field.checked) return;
    const value = field.type === "checkbox" ? true : field.value;
    if (field.name.endsWith("[]")) {
      if (!fields[field.name]) fields[field.name] = [];
      fields[field.name].push(value);
    } else {
      fields[field.name] = value;
    }
  });
  return fields;
}

function hydrateSavedFiles(savedFiles) {
  const grouped = {};
  (savedFiles || []).forEach((file) => {
    if (!grouped[file.field]) grouped[file.field] = [];
    grouped[file.field].push(file);
  });
  Object.entries(grouped).forEach(([name, files]) => {
    const inputs = [...form.querySelectorAll(`input[type="file"][name="${CSS.escape(name)}"]`)];
    files.forEach((file, fallbackIndex) => {
      const input = inputs[Math.max(0, Number(file.occurrence || fallbackIndex + 1) - 1)];
      if (!input) return;
      input.required = false;
      input.dataset.savedFileId = file.fileId || "";
      input.dataset.savedFileUrl = file.url || "";
      updateUploadLabel(input, file.name || "Document", true, file.url || "");
    });
  });
}

function updateUploadLabel(input, fileName, saved = false, fileUrl = "") {
  const logicalName = input.dataset.uploadField;
  const entry = input.closest("[data-license-entry]");
  const scopedPrimary = logicalName
    ? entry?.querySelector(`input[name="${CSS.escape(logicalName)}"]`)
    : null;
  const primary = logicalName ? scopedPrimary || form.querySelector(`input[name="${CSS.escape(logicalName)}"]`) : input;
  const label = primary?.closest(".upload-field") || input.closest(".upload-field, .alternate-upload");
  if (!label) return;
  label.classList.add("has-file");
  label.classList.add("is-collapsed");
  input.required = false;
  if (fileUrl) input.dataset.savedFileUrl = fileUrl;
  const detail = label.querySelector("small");
  if (detail) detail.textContent = saved ? "Saved in Drive" : fileName;
  const icon = label.querySelector(".upload-icon");
  if (icon) icon.textContent = "✓";
  const title = label.querySelector("strong");
  if (title) title.textContent = "Uploaded";
  let replace = label.querySelector(".upload-replace");
  if (!replace) {
    replace = document.createElement("span");
    replace.className = "upload-replace";
    label.append(replace);
  }
  replace.textContent = "Upload New Picture";
  let actions = label.querySelector(".upload-actions");
  if (!actions) {
    actions = document.createElement("span");
    actions.className = "upload-actions";
    label.append(actions);
  }
  actions.replaceChildren();
  const uploadNew = document.createElement("button");
  uploadNew.type = "button";
  uploadNew.dataset.uploadNew = "";
  uploadNew.textContent = "Upload New";
  actions.append(uploadNew);
  const viewUrl = fileUrl || input.dataset.objectUrl;
  if (viewUrl) {
    const view = document.createElement("a");
    view.href = viewUrl;
    view.target = "_blank";
    view.rel = "noopener";
    view.textContent = "View Document";
    actions.append(view);
  }
}

function clearAlternateFileInputs(activeInput) {
  const logicalName = activeInput.dataset.uploadField || activeInput.name;
  const scope = activeInput.closest("[data-license-entry]") || form;
  scope.querySelectorAll('input[type="file"]').forEach((input) => {
    if (input === activeInput) return;
    if ((input.dataset.uploadField || input.name) === logicalName) input.value = "";
  });
}

function hydrateFields(fields, savedFiles = []) {
  ensureRepeatersForDraft(fields);
  Object.entries(fields || {}).forEach(([name, value]) => {
    if (name === "application_mode") return;
    const controls = [...form.querySelectorAll(`[name="${CSS.escape(name)}"]`)];
    if (!controls.length) return;
    if (Array.isArray(value)) {
      controls.forEach((control, index) => {
        if (value[index] === undefined) return;
        if (control.type === "checkbox") control.checked = checkboxValue(value[index]);
        else control.value = String(value[index]);
      });
      return;
    }
    controls.forEach((control) => {
      if (control.type === "checkbox") control.checked = checkboxValue(value);
      else if (control.type === "radio") control.checked = control.value === String(value);
      else control.value = String(value ?? "");
    });
  });
  autofillPanel.classList.remove("is-hidden");
  refreshAllConditionals();
  updateLicenseCoverage();
  reconcileLicenses();
  updateHistoryCoverage();
  hydrateSavedFiles(savedFiles);
  saveDraftLocal();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function compressImage(file) {
  if (!file.type.startsWith("image/")) return fileToDataUrl(file);
  const bitmap = await createImageBitmap(file);
  const maxDimension = 2200;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.86);
}

async function serializeFiles() {
  const files = [];
  let totalBytes = 0;
  const occurrences = {};
  for (const input of form.querySelectorAll('input[type="file"]')) {
    for (const file of input.files) {
      const fieldName = input.dataset.uploadField || input.name;
      occurrences[fieldName] = (occurrences[fieldName] || 0) + 1;
      if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name} is larger than 12 MB.`);
      const dataUrl = await compressImage(file);
      totalBytes += Math.ceil(dataUrl.length * 0.75);
      if (totalBytes > 24 * 1024 * 1024) throw new Error("The combined uploads are too large. Use smaller images or PDFs.");
      files.push({
        field: fieldName,
        occurrence: occurrences[fieldName],
        name: file.name,
        type: file.type || "application/octet-stream",
        dataUrl
      });
    }
  }
  return files;
}

function setWorking(action, working) {
  saveButton.disabled = working;
  submitButton.disabled = working;
  if (working) {
    const label = action === "submit" ? "Submitting" : action === "send_request" ? "Sending" : "Saving";
    saveState.innerHTML = `<i></i> ${label}…`;
  }
}

function setAdminSendStatus(message, isError = false) {
  if (!adminSendStatus) return;
  adminSendStatus.textContent = message;
  adminSendStatus.classList.toggle("is-error", isError);
}

function adminRecipientEmail() {
  return String(adminRecipient?.value || getField("applicant_email")?.value || "").trim().toLowerCase();
}

async function sendDriverRequest(requestType) {
  const recipient = adminRecipientEmail();
  const adminKey = document.querySelector('[name="admin_access_key"]')?.value || "";
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    setAdminSendStatus("Enter the driver’s valid email address before sending.", true);
    adminRecipient?.focus();
    return;
  }
  if (!adminKey) {
    setAdminSendStatus("Enter the administrator key before sending.", true);
    document.querySelector('[name="admin_access_key"]')?.focus();
    return;
  }
  const emailField = getField("applicant_email");
  if (emailField && !emailField.value) emailField.value = recipient;
  const requestField = getField("request_type");
  if (requestField) requestField.value = requestType;
  setAdminSendStatus("Creating the private driver link and sending email…");
  await sendToBackend("send_request", { recipientEmail: recipient, requestType });
}

async function captureSignerIp() {
  if (signerIp) return signerIp;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const response = await fetch("https://api.ipify.org?format=json", { signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);
    const data = await response.json();
    signerIp = String(data.ip || "").trim();
  } catch {
    signerIp = "";
  }
  return signerIp;
}

async function sendToBackend(action, request = {}) {
  if (!config.appsScriptUrl) {
    resultPanel.classList.remove("is-hidden");
    resultPanel.classList.add("is-error");
    resultPanel.innerHTML = "<strong>Google save service is not deployed yet.</strong><p>Your non-document fields remain saved in this tab. An administrator must deploy the included Google Apps Script and add its URL to <code>application-config.js</code>.</p>";
    resultPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  setWorking(action, true);
  try {
    const files = await serializeFiles();
    const payload = {
      action,
      schemaVersion: config.schemaVersion || "2.0.0",
      parentFolderId: config.parentFolderId,
      adminKey: document.querySelector('[name="admin_access_key"]')?.value || "",
      recipientEmail: request.recipientEmail || "",
      requestType: request.requestType || "",
      pageOrigin: window.location.origin,
      fields: serializeFields(),
      files,
      audit: {
        clientTimestamp: new Date().toISOString(),
        applicationUrl: `${window.location.origin}${window.location.pathname}`,
        userAgent: navigator.userAgent,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        signerIp: (action === "submit" || action === "send_request") ? (signerIp || (await captureSignerIp())) : signerIp,
        documentVersions: config.documentVersions || {},
        documentDigests: config.documentDigests || {}
      }
    };
    backendForm.action = config.appsScriptUrl;
    backendPayload.value = JSON.stringify(payload);
    pendingBackendAction = action;
    backendForm.submit();
  } catch (error) {
    setWorking(action, false);
    if (action === "send_request") setAdminSendStatus(error.message || "Could not send the driver request.", true);
    resultPanel.classList.remove("is-hidden");
    resultPanel.classList.add("is-error");
    resultPanel.innerHTML = `<strong>Could not ${action}.</strong><p>${error.message}</p>`;
  }
}

function handleBackendMessage(event) {
  const data = event.data;
  if (!data || data.namespace !== "sigma-driver-application") return;
  // Apps Script serves HtmlService responses from a sandbox host like
  // "n-<hash>-0lu-script.googleusercontent.com" — note the hyphen before
  // "script", so an exact ".script.googleusercontent.com" suffix never matches.
  // Trust any https googleusercontent.com host (Google-controlled); the
  // namespace check above already gates the payload.
  let host = "";
  try { host = new URL(event.origin).hostname; } catch { host = ""; }
  const trustedOrigin = config.appsScriptOrigin
    ? event.origin === config.appsScriptOrigin
    : host === "googleusercontent.com" || host.endsWith(".googleusercontent.com");
  if (!trustedOrigin) return;
  setWorking(pendingBackendAction, false);
  resultPanel.classList.remove("is-hidden", "is-error");
  if (data.ok) {
    if (pendingBackendAction === "load" && data.fields) {
      hydrateFields(data.fields, data.savedFiles || []);
      resultPanel.innerHTML = `<strong>Saved application restored.</strong><p>Previously saved documents remain attached. Review the values, replace any file if needed, and continue where you left off.</p>`;
      saveState.innerHTML = "<i></i> Restored from Drive";
      pendingBackendAction = "";
      return;
    }
    if (pendingBackendAction === "send_request") {
      setField("application_id", data.applicationId);
      setField("resume_token", data.resumeToken);
      saveDraftLocal();
      const title = data.requestType === "psp"
        ? "PSP consent email sent."
        : data.requestType === "mvr"
          ? "MVR/CDLIS consent email sent."
          : "Incomplete application email sent.";
      resultPanel.innerHTML = `<strong>${title}</strong><p>Sent to ${data.recipientEmail || "the driver"}. The driver link is private and the driver must complete and sign the request personally.</p>`;
      setAdminSendStatus(`${title} Sent to ${data.recipientEmail || "the driver"}.`);
      saveState.innerHTML = "<i></i> Driver request sent";
      pendingBackendAction = "";
      resultPanel.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setField("application_id", data.applicationId);
    setField("resume_token", data.resumeToken);
    saveDraftLocal();
    const continuation = data.continuationUrl
      ? `<p><a href="${data.continuationUrl}">Copy or bookmark the private continuation link</a></p>`
      : "";
    resultPanel.innerHTML = `<strong>${pendingBackendAction === "submit" ? "Application submitted." : "Application saved."}</strong><p>Reference: ${data.applicationId}</p>${continuation}`;
    saveState.innerHTML = `<i></i> ${pendingBackendAction === "submit" ? "Submitted" : "Saved to Drive"}`;
  } else {
    resultPanel.classList.add("is-error");
    resultPanel.innerHTML = `<strong>Could not ${pendingBackendAction}.</strong><p>${data.message || "The save service returned an error."}</p>`;
    if (pendingBackendAction === "send_request") setAdminSendStatus(data.message || "Could not send the driver request.", true);
  }
  resultPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  pendingBackendAction = "";
}

function initializeMode() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("mode") === "admin") {
    document.querySelector("[data-admin-intro]")?.classList.remove("is-hidden");
    document.querySelector("[data-admin-bar]")?.classList.remove("is-hidden");
    setField("application_mode", "admin");
    saveButton.textContent = "Save prefill";
    startButton.textContent = "Start administrator prefill →";
  }
  configureRequestMode();
  if (isConsentRequestMode()) startButton.textContent = "Review requested consent →";
  const resumeToken = params.get("resume");
  if (resumeToken) {
    setField("resume_token", resumeToken);
    startButton.textContent = "Continue saved application →";
  }
  const sendType = params.get("send");
  if (sendType === "mvr" || sendType === "psp") {
    pendingSend = sendType;
    document.querySelector("[data-admin-intro]")?.classList.remove("is-hidden");
    document.querySelector("[data-admin-bar]")?.classList.remove("is-hidden");
    setField("application_mode", "admin");
    setField("request_type", sendType);
    startButton.textContent = "Open to send consent →";
  }
}

function applyPendingSend() {
  if (!pendingSend) return;
  const bar = document.querySelector("[data-admin-bar]");
  bar?.classList.remove("is-hidden");
  const button = document.querySelector(`[data-send-request="${pendingSend}"]`);
  if (button) button.classList.add("is-highlighted");
  const keyField = document.querySelector('[name="admin_access_key"]');
  smartScrollIntoView(bar || form, "start");
  keyField?.focus({ preventScroll: true });
  setAdminSendStatus(
    pendingSend === "mvr"
      ? "Enter the admin key and confirm the driver’s email, then choose Send MVR/CDLIS consent."
      : "Enter the admin key and confirm the driver’s email, then choose Send PSP consent."
  );
}

function initializeForm() {
  const draft = readDraftData();
  populateStateSelects();
  if (draft.application_date) setField("application_date", draft.application_date);
  if (draft.resume_token) setField("resume_token", draft.resume_token);
  if (!getField("application_date")?.value) setField("application_date", today);
  setField("signature_date", today);
  if (!getField("application_id")?.value) {
    setField("application_id", `SIG-${today.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`);
  }
  initializeMode();
  updateTemporalLabels();
  updateHistoryCoverage();
  const resumeToken = getField("resume_token")?.value;
  if (resumeToken && config.appsScriptUrl) {
    window.setTimeout(() => {
      showWizard();
      sendToBackend("load");
    }, 0);
  } else if (Object.keys(draft).length) {
    startButton.textContent = "Continue saved application →";
  }
}

startButton.addEventListener("click", showWizard);
backButton.addEventListener("click", () => showStage(stageIndex - 1));
nextButton.addEventListener("click", () => {
  if (validateCurrentStage()) showStage(stageIndex + 1);
});
saveButton.addEventListener("click", () => sendToBackend("save"));
// Admin send buttons live in the admin bar, outside <form>, so the form-level
// click delegation never sees them — bind them directly.
document.querySelectorAll("[data-send-request]").forEach((button) => {
  button.addEventListener("click", () => sendDriverRequest(button.dataset.sendRequest || "application"));
});
window.addEventListener("message", handleBackendMessage);

form.addEventListener("input", (event) => {
  if (event.target.matches("[data-timeline-start], [data-timeline-end], [name='current_address_start']")) updateHistoryCoverage();
  if (event.target.closest("[data-license-entry]") || ["license_issue_date", "license_expiration_date"].includes(event.target.name)) {
    updateLicenseCoverage();
    reconcileLicenses();
  }
  if (["legal_first_name", "legal_middle_name", "legal_last_name", "application_date"].includes(event.target.name)) {
    updateDocumentIdentity();
  }
  if (stageIndex === stages.length - 1) renderMissingItems();
  scheduleSave();
});

form.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches('[data-document="current-cdl-back"]')) handleCurrentCdl(target.files[0]);
  if (target.matches('[data-document="current-cdl-front"]')) handleCurrentCdlFront(target.files[0]);
  if (target.matches("[data-prior-back]")) handlePriorCdl(target);
  if (target.matches('[data-document="medical-card"]')) handleMedicalCard(target.files[0]);
  if (target.matches("[data-conditional]")) refreshConditional(target.name);
  if (target.matches("[data-current-toggle]")) updateCurrentToggle(target);
  if (target.matches("[data-employment-type]")) updateEmploymentType(target.closest(".employment-entry"));
  if (target.matches("[data-employment-cmv]")) updateCmvExperience(target);
  if (target.matches("[data-do-not-contact]")) updateContactPreference(target);
  if (target.matches("[data-authorization-ack]")) advanceAuthorization(target);
  if (target.matches("[data-application-date]")) updateTemporalLabels();
  if (target.type === "file" && target.files[0]) {
    clearAlternateFileInputs(target);
    if (target.dataset.objectUrl) URL.revokeObjectURL(target.dataset.objectUrl);
    target.dataset.objectUrl = URL.createObjectURL(target.files[0]);
    updateUploadLabel(target, target.files[0].name, false, target.dataset.objectUrl);
  }
  if (stageIndex === stages.length - 1) renderMissingItems();
  scheduleSave();
});

form.addEventListener("click", (event) => {
  const addTypes = {
    "add-prior-license": "prior-license",
    "add-other-license": "other-license",
    "add-accident": "accident",
    "add-violation": "violation",
    "add-residence": "residence",
    "add-recent-employment": "recent-employment",
    "add-older-employment": "older-employment"
  };
  const add = Object.keys(addTypes).find((attribute) => event.target.closest(`[data-${attribute}]`));
  if (add) addRepeatItem(addTypes[add]);

  const removeButton = event.target.closest("[data-remove]");
  if (removeButton) {
    removeButton.closest(".repeat-item")?.remove();
    updateLicenseCoverage();
    reconcileLicenses();
    updateHistoryCoverage();
    updateResidenceAddButton();
    scheduleSave();
  }

  if (event.target.closest("[data-manual-cdl]")) {
    autofillPanel.classList.remove("is-hidden");
    setStatus(currentCdlStatus, "Manual entry opened. Enter the values exactly as shown on the CDL.", "");
    autofillPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const savedLicense = event.target.closest("[data-save-license]");
  if (savedLicense) {
    const entry = savedLicense.closest("[data-license-entry]");
    entry.dataset.licenseSaved = "true";
    savedLicense.textContent = "Saved ✓";
    const addressData = {
      street: entry.querySelector('[name="prior_address_street[]"]')?.value,
      city: entry.querySelector('[name="prior_address_city[]"]')?.value,
      state: entry.querySelector('[name="prior_address_state[]"]')?.value,
      postalCode: entry.querySelector('[name="prior_address_postal[]"]')?.value
    };
    addResidenceFromCdl(addressData);
    updateLicenseCoverage();
    scheduleSave();
  }

  if (event.target.closest("[data-license-force]")) {
    setField("license_coverage_override", "yes");
    updateLicenseCoverage();
    renderMissingItems();
    scheduleSave();
  }

  const authorizationToggle = event.target.closest("[data-authorization-toggle]");
  if (authorizationToggle) {
    const item = authorizationToggle.closest("[data-authorization-item]");
    const open = !item.classList.contains("is-open");
    document.querySelectorAll("[data-authorization-item]").forEach((candidate) => setAuthorizationOpen(candidate, candidate === item && open));
  }

  const goStage = event.target.closest("[data-go-stage]");
  if (goStage) showStage(Number(goStage.dataset.goStage));

  if (event.target.closest("[data-save-review]")) sendToBackend("save");

  const uploadNew = event.target.closest("[data-upload-new]");
  if (uploadNew) {
    event.preventDefault();
    event.stopPropagation();
    const label = uploadNew.closest(".upload-field");
    label?.classList.remove("is-collapsed");
    label?.querySelector('input[type="file"]')?.click();
  }

  const help = event.target.closest("[data-cmv-help]");
  if (help) {
    const panel = document.querySelector("[data-cmv-help-panel]");
    const show = panel.classList.toggle("is-hidden") === false;
    help.setAttribute("aria-expanded", String(show));
  }

  const sendRequest = event.target.closest("[data-send-request]");
  if (sendRequest) sendDriverRequest(sendRequest.dataset.sendRequest || "application");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showStage(stages.length - 1);
  if (!validateCurrentStage()) return;
  renderReview();
  renderMissingItems();
  await sendToBackend("submit");
});

window.addEventListener("beforeunload", () => {
  if (tesseractWorker) tesseractWorker.terminate();
});

initializeForm();
