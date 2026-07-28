/**
 * Reverse ingestion: watch the Applicants Shared Drive folder for manually
 * dragged-in CDL / medical-card / Lanefinder PDFs, OCR and parse them, prefill
 * the driver application (manual drag-drop wins priority over any form data),
 * standardize filenames + folder names, and drop clickable "open form" links
 * into Drive so admins never copy-paste continuation URLs.
 *
 * Public entry points:
 *   - ingestDriveDropIns()   run on a time trigger and manually from the editor
 *   - createIngestTrigger()  install the every-5-minute trigger (run once)
 *   - removeIngestTriggers() remove all ingest triggers
 */

var INGEST_SYSTEM_FOLDERS = ["Uploads", "Signed Forms", "_Unsorted", "_TEST ONLY"];
var INGEST_PROCESSED_PROP = "ingest:processedFileIds";
var INGEST_OPEN_DOC_PREFIX = "▶ OPEN"; // ▶ OPEN
var INGEST_INDEX_NAME = "⚡ Applicants — Open Links"; // ⚡ Applicants — Open Links

var INGEST_MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

/* ============================ Entry points ============================ */

function createIngestTrigger() {
  removeIngestTriggers();
  ScriptApp.newTrigger("ingestDriveDropIns").timeBased().everyMinutes(5).create();
  return "Ingest trigger installed (every 5 minutes).";
}

function ensureIngestTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === "ingestDriveDropIns";
  });
  if (exists) return "Ingest watcher already installed (every 5 minutes).";
  ScriptApp.newTrigger("ingestDriveDropIns").timeBased().everyMinutes(5).create();
  return "Ingest watcher installed (every 5 minutes).";
}

function removeIngestTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === "ingestDriveDropIns") ScriptApp.deleteTrigger(trigger);
  });
  return "Removed existing ingest triggers.";
}

function ingestDriveDropIns() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: false, message: "Another ingest run is in progress." };
  try {
    var parent = DriveApp.getFolderById(SIGMA_CONFIG.parentFolderId);
    var processed = getProcessedSet_();
    var summary = [];
    var folders = parent.getFolders();
    while (folders.hasNext()) {
      var folder = folders.next();
      if (isSystemFolderName_(folder.getName())) continue;
      try {
        var result = processApplicantFolder_(folder, processed);
        if (result) summary.push(result);
      } catch (error) {
        console.error("Ingest failed for folder " + folder.getName() + ": " + (error && error.stack || error));
      }
    }
    saveProcessedSet_(processed);
    if (summary.length) {
      rebuildIndexSheet_(parent);
      notifyIngest_(summary);
    }
    return { ok: true, processedFolders: summary.length, summary: summary };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Maintenance: re-derive every applicant folder from the source files it already
 * holds (top level + Uploads/), applying the current parser. Fixes filenames,
 * folder names, and sheet fields in place — run after parser improvements without
 * re-dragging anything.
 */
function reprocessApplicantFolders() {
  var parent = DriveApp.getFolderById(SIGMA_CONFIG.parentFolderId);
  var folders = parent.getFolders();
  var summary = [];
  while (folders.hasNext()) {
    var folder = folders.next();
    if (isSystemFolderName_(folder.getName())) continue;
    try {
      var result = reprocessFolder_(folder);
      if (result) summary.push(result);
    } catch (error) {
      console.error("Reprocess failed for " + folder.getName() + ": " + (error && error.stack || error));
    }
  }
  rebuildIndexSheet_(parent);
  return { ok: true, folders: summary.length, summary: summary };
}

function reprocessFolder_(folder) {
  var uploadsFolder = folder.getFoldersByName("Uploads").hasNext()
    ? folder.getFoldersByName("Uploads").next()
    : findOrCreateFolder_(folder, "Uploads");

  // Pull loose top-level source docs into Uploads/, then gather everything there.
  var loose = folder.getFiles();
  var toMove = [];
  while (loose.hasNext()) {
    var lf = loose.next();
    if (!isGeneratedFile_(lf) && isDocLikeFile_(lf)) toMove.push(lf);
  }
  toMove.forEach(function(file) { file.moveTo(uploadsFolder); });

  var files = [];
  var it = uploadsFolder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (isDocLikeFile_(f)) files.push(f);
  }
  if (!files.length) return null;

  var stored = files.map(function(file) {
    var text = "";
    try { text = extractDriveFileText_(file); } catch (error) { console.warn("OCR " + file.getName() + ": " + error); }
    var classification = classifyIngestFile_(file.getName(), text);
    return { file: file, classification: classification, fields: parseDriverFields_(text, classification) };
  });
  stored.sort(function(a, b) { return ingestReliability_(a.classification) - ingestReliability_(b.classification); });

  var state = ensureApplicantSheet_(folder);
  var reDerived = {};
  stored.forEach(function(item) { reDerived = mergeIngestFields_(reDerived, item.fields); });
  var merged = mergeIngestFields_(state.fields, reDerived);
  if (!merged.application_date) merged.application_date = todayCentral_();
  if (!merged.application_id) merged.application_id = makeApplicationId_();
  merged.resume_token = state.resumeToken;
  merged.schema_version = SIGMA_CONFIG.schemaVersion;
  if (!merged.application_mode) merged.application_mode = "driver";
  var names = resolveName_(merged);
  merged.legal_first_name = names.first || merged.legal_first_name || "";
  merged.legal_last_name = names.last || merged.legal_last_name || "";

  writeApplicationSheet_(state.sheet, merged, { source: "reprocess" }, "ingest");
  PropertiesService.getScriptProperties().setProperty("resume:" + state.resumeToken, state.sheet.getId());

  // Rebuild the uploads tab and correct physical filenames.
  var uploadSheet = sheetByName_(state.sheet, "uploads");
  clearUploadsRows_(uploadSheet);
  var counts = {};
  stored.forEach(function(item) {
    var map = ingestCategory_(item.classification);
    var key = map.field || map.category;
    counts[key] = (counts[key] || 0) + 1;
    var ext = fileExtension_(item.file.getName(), item.file.getMimeType());
    var newName = ingestUploadName_(merged, map.category, item.classification, ext);
    if (item.file.getName() !== newName) {
      try { item.file.setName(newName); } catch (error) { console.warn("rename " + error); }
    }
    uploadSheet.appendRow([new Date().toISOString(), map.field || "", counts[key], newName, item.file.getId(), item.file.getUrl()]);
  });

  var standardFolder = standardFolderName_(merged, folder.getName());
  if (standardFolder && folder.getName() !== standardFolder) {
    try { folder.setName(standardFolder); } catch (error) { console.warn("folder rename " + error); }
  }
  var openUrl = writeOpenLinkDoc_(folder, merged, state.resumeToken);

  return {
    applicant: applicantDisplayName_(merged),
    folderName: folder.getName(),
    folderUrl: folder.getUrl(),
    openUrl: openUrl,
    files: files.length,
    medicalCardExpiration: merged.medical_card_expiration || "",
    licenseExpiration: merged.license_expiration_date || ""
  };
}

function clearUploadsRows_(uploadSheet) {
  if (uploadSheet.getLastRow() > 1) {
    uploadSheet.getRange(2, 1, uploadSheet.getLastRow() - 1, uploadSheet.getLastColumn()).clearContent();
  }
}

function isDocLikeFile_(file) {
  var mime = file.getMimeType();
  return mime === "application/pdf" || mime.indexOf("image/") === 0;
}

/* ======================== Per-folder processing ======================= */

function processApplicantFolder_(folder, processedSet) {
  var candidates = collectCandidateFiles_(folder, processedSet);
  var hasSheet = folder.getFilesByName("application_data").hasNext();
  if (!candidates.length && !hasSheet) return null; // empty/unrelated folder — leave it alone
  var state = ensureApplicantSheet_(folder);
  var hadNew = candidates.length > 0;

  var stored = candidates.map(function(file) {
    var text = "";
    try {
      text = extractDriveFileText_(file);
    } catch (error) {
      console.warn("OCR failed for " + file.getName() + ": " + error);
    }
    var classification = classifyIngestFile_(file.getName(), text);
    return { file: file, classification: classification, fields: parseDriverFields_(text, classification) };
  });
  // Merge least-reliable first so the clean Lanefinder application text wins over noisy image OCR.
  stored.sort(function(a, b) { return ingestReliability_(a.classification) - ingestReliability_(b.classification); });
  var parsed = {};
  stored.forEach(function(item) { parsed = mergeIngestFields_(parsed, item.fields); });

  // Manual drag-drop wins priority: parsed values overwrite the saved sheet.
  var merged = mergeIngestFields_(state.fields, parsed);
  if (!merged.application_date) merged.application_date = todayCentral_();
  if (!merged.application_id) merged.application_id = makeApplicationId_();
  merged.resume_token = state.resumeToken;
  merged.schema_version = SIGMA_CONFIG.schemaVersion;
  if (!merged.application_mode) merged.application_mode = "driver";

  var names = resolveName_(merged);
  merged.legal_first_name = names.first || merged.legal_first_name || "";
  merged.legal_last_name = names.last || merged.legal_last_name || "";
  if (names.middle && !merged.legal_middle_name) merged.legal_middle_name = names.middle;

  // Persist merged fields first so the uploads tab + headers exist, then store files.
  if (hadNew || !state.hadResume) {
    writeApplicationSheet_(state.sheet, merged, { source: "drive_ingest" }, "ingest");
    PropertiesService.getScriptProperties().setProperty("resume:" + state.resumeToken, state.sheet.getId());
  }

  if (hadNew) {
    var uploadsFolder = findOrCreateFolder_(folder, "Uploads");
    var uploadSheet = sheetByName_(state.sheet, "uploads");
    stored.forEach(function(item) {
      try {
        storeIngestedFile_(uploadsFolder, uploadSheet, item.file, item.classification, merged);
      } catch (error) {
        console.error("Could not store " + item.file.getName() + ": " + error);
      }
      processedSet[item.file.getId()] = true;
    });
  }

  var standardFolder = standardFolderName_(merged, folder.getName());
  if (standardFolder && folder.getName() !== standardFolder) {
    try { folder.setName(standardFolder); } catch (error) { console.warn("Rename folder failed: " + error); }
  }

  var openUrl = (hadNew || !state.hadResume || !findOpenDoc_(folder))
    ? writeOpenLinkDoc_(folder, merged, state.resumeToken)
    : resumeUrlFor_(state.resumeToken);

  if (!hadNew) return null;
  return {
    applicant: applicantDisplayName_(merged),
    folderName: folder.getName(),
    folderUrl: folder.getUrl(),
    openUrl: openUrl,
    files: stored.length,
    medicalCardExpiration: merged.medical_card_expiration || "",
    licenseExpiration: merged.license_expiration_date || ""
  };
}

function collectCandidateFiles_(folder, processedSet) {
  var files = folder.getFiles();
  var candidates = [];
  while (files.hasNext()) {
    var file = files.next();
    if (processedSet[file.getId()]) continue;
    if (isGeneratedFile_(file)) continue;
    var mime = file.getMimeType();
    var isDocLike = mime === "application/pdf" || mime.indexOf("image/") === 0;
    if (!isDocLike) continue;
    candidates.push(file);
  }
  return candidates;
}

function ensureApplicantSheet_(folder) {
  var files = folder.getFilesByName("application_data");
  var sheet;
  var hadResume = false;
  if (files.hasNext()) {
    sheet = SpreadsheetApp.openById(files.next().getId());
  } else {
    sheet = SpreadsheetApp.create("application_data");
    DriveApp.getFileById(sheet.getId()).moveTo(folder);
  }
  var fields = readFields_(sheet);
  var resumeToken = String(fields.resume_token || "").trim();
  if (resumeToken) {
    hadResume = Boolean(PropertiesService.getScriptProperties().getProperty("resume:" + resumeToken));
  } else {
    resumeToken = Utilities.getUuid() + Utilities.getUuid();
  }
  return { sheet: sheet, fields: fields, resumeToken: resumeToken, hadResume: hadResume };
}

/* ============================ File storage =========================== */

function storeIngestedFile_(uploadsFolder, uploadSheet, file, classification, fields) {
  if (!uploadsFolder) return;
  var map = ingestCategory_(classification);
  var occurrence = nextOccurrence_(uploadSheet, map.field);
  var ext = fileExtension_(file.getName(), file.getMimeType());
  var newName = ingestUploadName_(fields, map.category, classification, ext);
  if (map.field) replacePreviousUpload_(uploadSheet, map.field, occurrence);
  var existing = uploadsFolder.getFilesByName(newName);
  while (existing.hasNext()) {
    var dup = existing.next();
    if (dup.getId() !== file.getId()) dup.setTrashed(true);
  }
  file.moveTo(uploadsFolder);
  file.setName(newName);
  uploadSheet.appendRow([new Date().toISOString(), map.field || "", occurrence, newName, file.getId(), file.getUrl()]);
}

function ingestCategory_(classification) {
  var map = {
    cdl: { field: "current_cdl_front", category: "cdlfront" },
    medcard: { field: "medical_card", category: "medicalcard" },
    application: { field: "", category: "lanefinderapplication" },
    mvr_consent: { field: "", category: "mvrconsent" },
    psp_consent: { field: "", category: "pspconsent" },
    safety_history: { field: "", category: "safetyhistory" },
    release: { field: "", category: "releaseforms" },
    other: { field: "", category: "document" }
  };
  return map[classification] || map.other;
}

function ingestUploadName_(fields, category, classification, ext) {
  var prefix = uploadNamePart_(fields.legal_last_name || "PENDING") + "," +
    uploadNamePart_(fields.legal_first_name || "PENDING");
  var dates = "";
  if (classification === "medcard") {
    dates = dateNamePart_("EXP", fields.medical_card_expiration);
  } else if (classification === "cdl") {
    dates = dateNamePart_("ISS", fields.license_issue_date) + dateNamePart_("EXP", fields.license_expiration_date);
  }
  return sanitizeFileName_(prefix + "_" + category + dates + ext);
}

function nextOccurrence_(uploadSheet, field) {
  if (!field || uploadSheet.getLastRow() < 2) return 1;
  var rows = uploadSheet.getRange(2, 2, uploadSheet.getLastRow() - 1, 2).getValues();
  var max = 0;
  rows.forEach(function(row) {
    if (String(row[0]) === String(field)) max = Math.max(max, Number(row[1]) || 0);
  });
  return max + 1;
}

function fileExtension_(fileName, mimeType) {
  var match = String(fileName || "").match(/(\.[A-Za-z0-9]{1,8})$/);
  if (match) return match[1].toLowerCase();
  var byMime = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif"
  };
  return byMime[String(mimeType || "").toLowerCase()] || ".pdf";
}

/* ============================ Text + OCR ============================= */

function extractDriveFileText_(file) {
  var resource = { title: "ingest-ocr-temp", mimeType: MimeType.GOOGLE_DOCS };
  var converted = Drive.Files.copy(resource, file.getId(), { ocr: true, ocrLanguage: "en", supportsAllDrives: true });
  try {
    var text = DocumentApp.openById(converted.id).getBody().getText();
    return text || "";
  } finally {
    try { DriveApp.getFileById(converted.id).setTrashed(true); } catch (error) { console.warn("temp doc cleanup: " + error); }
  }
}

function classifyIngestFile_(fileName, text) {
  var name = String(fileName || "").toLowerCase();
  var body = String(text || "").toLowerCase();
  // Content signals win first — filenames for consent forms are ambiguous
  // (e.g. "mvr_release_consent" vs "release_forms").
  if (/mvr release consent|release of my motor vehicle records|driver'?s privacy protection act/.test(body)) return "mvr_consent";
  if (/pre-employment screening program|psp online|fmcsa[^.]*\bpsp\b/.test(body)) return "psp_consent";
  if (/safety performance history/.test(body)) return "safety_history";
  if (/driver employment application|driver'?s employment application/.test(body)) return "application";
  if (/medical examiner'?s? certificate/.test(body)) return "medcard";
  // Filename signals (underscore/dash/space tolerant).
  if (/med[\s_-]*card|medcard|medical[\s_-]*(examiner|card|cert)/.test(name)) return "medcard";
  if (/employment[\s_-]*application|driver[\s_-]*application|lanefinder[\s_-]*application/.test(name)) return "application";
  if (/(^|[^a-z])mvr([^a-z]|$)|motor[\s_-]*vehicle[\s_-]*record/.test(name)) return "mvr_consent";
  if (/(^|[^a-z])psp([^a-z]|$)|pre[\s_-]*employment[\s_-]*screening/.test(name)) return "psp_consent";
  if (/safety[\s_-]*(performance|history)/.test(name)) return "safety_history";
  if (/release[\s_-]*form|fcra|fair[\s_-]*credit/.test(name)) return "release";
  if (/(^|[^a-z])cdl([^a-z]|$)|licen[sc]e|commercial[\s_-]*driver/.test(name)) return "cdl";
  // Weak content fallback.
  if (/commercial driver'?s? license|class [abc]\b/.test(body)) return "cdl";
  return "other";
}

function ingestReliability_(classification) {
  var rank = {
    other: 0, release: 0, safety_history: 0,
    mvr_consent: 1, psp_consent: 1,
    cdl: 2, application: 3, medcard: 4
  };
  return rank[classification] === undefined ? 0 : rank[classification];
}

/* ============================== Parsing ============================== */

function parseDriverFields_(text, classification) {
  var out = {};
  var body = String(text || "");
  if (!body.trim()) return out;

  // Name from the Lanefinder application title line: "Jason Tucker's Driver Employment Application".
  var titleName = body.match(/([A-Z][A-Za-z'\-]+)\s+([A-Z][A-Za-z'\-]+)'s\s+Driver Employment Application/);
  if (titleName) {
    out.legal_first_name = titleName[1];
    out.legal_last_name = titleName[2];
  }

  // Same-line labelled values (Lanefinder renders many of these cleanly).
  setIfDate_(out, "date_of_birth", labelDate_(body, "Date of Birth"));
  var medExp = labelDate_(body, "expires") || labelDate_(body, "Med(?:ical)? Card[^\\n]*?expires");
  setIfDate_(out, "medical_card_expiration", medExp || bestMedicalExpiration_(body, classification));
  setIfText_(out, "legal_first_name", labelWord_(body, "First Name"));
  setIfText_(out, "legal_middle_name", labelWord_(body, "Middle Name"));

  var mailing = body.match(/(?:Mailing Address|Current Address)\s+(.+?)(?:\n|Move-in|Middle Name|$)/);
  if (mailing) {
    var addr = splitUsAddress_(mailing[1]);
    setIfText_(out, "current_address_street", addr.street);
    setIfText_(out, "current_address_city", addr.city);
    setIfText_(out, "current_address_state", addr.state);
    setIfText_(out, "current_address_postal", addr.zip);
  }

  var classMatch = body.match(/\bClass\s+([ABC])\b/);
  if (classMatch) out.license_class = classMatch[1];

  // Disqualification / CMV status from the FMCSR section.
  var disq = body.match(/currently disqualified from (?:operating|driving) a commercial motor vehicle[^\n]*?\]?\s*(Yes|No)/i);
  if (disq) out.cmv_disqualified = /yes/i.test(disq[1]) ? "yes" : "no";

  var license = parseLicenseBlock_(body);
  Object.keys(license).forEach(function(key) { if (license[key]) out[key] = license[key]; });

  // Consent forms sometimes carry the only reliable name + license number.
  var consentName = body.match(/\bI[,\s]+([A-Z][a-z'\-]+)\s+([A-Z][a-z'\-]+)\b[\s\S]{0,60}?\(applicant\)/);
  if (consentName) {
    if (!out.legal_first_name) out.legal_first_name = consentName[1];
    if (!out.legal_last_name) out.legal_last_name = consentName[2];
  }
  var consentLicense = body.match(/Driver'?s?\s*License Number[:\s]+([A-Z0-9\-]{5,})\s*(?:State[:\s]+([A-Z]{2}))?/i);
  if (consentLicense) {
    if (!out.license_number) out.license_number = consentLicense[1].replace(/[^A-Z0-9]/gi, "");
    if (consentLicense[2] && !out.license_state) out.license_state = consentLicense[2].toUpperCase();
  }

  return out;
}

function parseLicenseBlock_(body) {
  var out = {};
  var start = body.search(/Issuing State|License Number/i);
  if (start === -1) return out;
  var region = body.slice(start, start + 400);

  var stateMatch = region.match(/(?:Issuing State|Restrictions)\s+([A-Z]{2})\b/);
  if (stateMatch) out.license_state = stateMatch[1];

  var numberMatch = region.match(/\b([A-Z]?\d[\dA-Z]{5,12})\b/);
  if (numberMatch && !/^\d{5}(?:-\d{4})?$/.test(numberMatch[1])) out.license_number = numberMatch[1];

  var expMatch = region.match(/([A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
  if (expMatch) {
    var iso = parseHumanDateToIso_(expMatch[1]);
    if (iso) out.license_expiration_date = iso;
  }

  var endMatch = region.match(/Endorsements\s+([A-Z](?:,\s?[A-Z]){0,6})/) ||
    region.match(/\b([A-Z](?:,\s?[A-Z]){1,6})\b/);
  if (endMatch) out.license_endorsements = endMatch[1].replace(/\s+/g, "");

  return out;
}

function bestMedicalExpiration_(body, classification) {
  if (classification !== "medcard") return "";
  var candidates = [];
  var re = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|[A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4})/g;
  var match;
  while ((match = re.exec(body))) {
    var iso = parseHumanDateToIso_(match[1]);
    if (!iso) continue;
    var priorContext = body.slice(Math.max(0, match.index - 40), match.index).toLowerCase();
    var score = 0;
    if (/expir|valid|through|until/.test(priorContext)) score += 3;
    if (/omb|expires 20\d\d clinic|form|test/.test(priorContext)) score -= 3;
    candidates.push({ iso: iso, score: score });
  }
  candidates.sort(function(a, b) { return b.score - a.score; });
  return candidates.length ? candidates[0].iso : "";
}

/* ============================ Merge + names ========================== */

function mergeIngestFields_(base, incoming) {
  var out = {};
  Object.keys(base || {}).forEach(function(key) { out[key] = base[key]; });
  Object.keys(incoming || {}).forEach(function(key) {
    var value = incoming[key];
    if (value === undefined || value === null) return;
    if (typeof value === "string" && !value.trim()) return;
    out[key] = value; // drag-drop wins priority
  });
  return out;
}

function resolveName_(fields) {
  return {
    first: cleanNamePart_(fields.legal_first_name),
    middle: cleanNamePart_(fields.legal_middle_name),
    last: cleanNamePart_(fields.legal_last_name)
  };
}

function cleanNamePart_(value) {
  var text = String(value || "").replace(/[^A-Za-z'\-\s]/g, "").trim();
  return text.split(/\s+/)[0] || "";
}

function standardFolderName_(fields, currentName) {
  var last = uploadNamePart_(fields.legal_last_name || "");
  var first = uploadNamePart_(fields.legal_first_name || "");
  if (!last || !first) return "";
  return last + "," + first;
}

function applicantDisplayName_(fields) {
  return [fields.legal_first_name, fields.legal_last_name].filter(Boolean).join(" ") || "Pending applicant";
}

/* ========================= Drive open-links ========================== */

function siteApplicationUrl_() {
  return PropertiesService.getScriptProperties().getProperty("SITE_APPLICATION_URL") ||
    SIGMA_CONFIG.siteApplicationUrl || "https://sstransco.com/apply.html";
}

function resumeUrlFor_(resumeToken, extra) {
  var url = siteApplicationUrl_() + "?resume=" + encodeURIComponent(resumeToken) + "&mode=admin";
  if (extra) url += extra;
  return url;
}

function writeOpenLinkDoc_(folder, fields, resumeToken) {
  var display = applicantDisplayName_(fields);
  var docName = INGEST_OPEN_DOC_PREFIX + " — " + display;
  var doc = findOrCreateOpenDoc_(folder, docName);
  var body = doc.getBody();
  body.clear();
  body.setMarginTop(48).setMarginBottom(48).setMarginLeft(56).setMarginRight(56);

  var heading = body.appendParagraph(display);
  heading.setHeading(DocumentApp.ParagraphHeading.TITLE);

  var sub = body.appendParagraph("Sigma Squared driver application — admin quick links");
  sub.editAsText().setForegroundColor("#666666").setFontSize(10);

  appendLinkLine_(body, "▶  Open & complete this application", resumeUrlFor_(resumeToken));
  appendLinkLine_(body, "✉  Send MVR / CDLIS consent to the driver", resumeUrlFor_(resumeToken, "&send=mvr"));
  appendLinkLine_(body, "✉  Send PSP consent to the driver", resumeUrlFor_(resumeToken, "&send=psp"));

  var note = body.appendParagraph("To send a consent: open the link, enter the admin key in the bar at the top, confirm the driver’s email, then choose Send. The driver signs it personally.");
  note.editAsText().setForegroundColor("#888888").setFontSize(9);
  note.setSpacingBefore(10);

  var status = [];
  if (fields.medical_card_expiration) status.push("Med card expires " + humanDate_(fields.medical_card_expiration));
  if (fields.license_expiration_date) status.push("CDL expires " + humanDate_(fields.license_expiration_date));
  if (status.length) {
    var line = body.appendParagraph(status.join("   •   "));
    line.editAsText().setForegroundColor("#444444").setFontSize(9);
  }

  doc.saveAndClose();
  return resumeUrlFor_(resumeToken);
}

function findOpenDoc_(folder) {
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    if (file.getMimeType() === MimeType.GOOGLE_DOCS && file.getName().indexOf(INGEST_OPEN_DOC_PREFIX) === 0) return file;
  }
  return null;
}

function findOrCreateOpenDoc_(folder, docName) {
  var existing = findOpenDoc_(folder);
  if (existing) {
    if (existing.getName() !== docName) existing.setName(docName);
    return DocumentApp.openById(existing.getId());
  }
  var doc = DocumentApp.create(docName);
  DriveApp.getFileById(doc.getId()).moveTo(folder);
  return doc;
}

function appendLinkLine_(body, label, url) {
  var paragraph = body.appendParagraph("");
  paragraph.setSpacingBefore(8).setSpacingAfter(0);
  var text = paragraph.appendText(label);
  text.setLinkUrl(url);
  text.setForegroundColor("#1155cc").setBold(true).setFontSize(12).setUnderline(true);
  return paragraph;
}

function rebuildIndexSheet_(parent) {
  var files = parent.getFilesByName(INGEST_INDEX_NAME);
  var spreadsheet = files.hasNext() ? SpreadsheetApp.openById(files.next().getId()) : createIndexSheet_(parent);
  var sheet = spreadsheet.getSheets()[0];
  sheet.clear();
  var rows = [["Applicant", "Open / review", "Med card exp", "CDL exp", "Folder", "Updated"]];
  var folders = parent.getFolders();
  var records = [];
  while (folders.hasNext()) {
    var folder = folders.next();
    if (isSystemFolderName_(folder.getName())) continue;
    var dataFiles = folder.getFilesByName("application_data");
    if (!dataFiles.hasNext()) continue;
    var fields = readFields_(SpreadsheetApp.openById(dataFiles.next().getId()));
    if (!fields.resume_token) continue;
    records.push({
      name: applicantDisplayName_(fields),
      open: resumeUrlFor_(String(fields.resume_token)),
      med: fields.medical_card_expiration ? humanDate_(fields.medical_card_expiration) : "",
      cdl: fields.license_expiration_date ? humanDate_(fields.license_expiration_date) : "",
      folder: folder.getUrl()
    });
  }
  records.sort(function(a, b) { return a.name.localeCompare(b.name); });
  records.forEach(function(record) {
    rows.push([
      record.name,
      '=HYPERLINK("' + record.open + '","Open application")',
      record.med,
      record.cdl,
      '=HYPERLINK("' + record.folder + '","Folder")',
      new Date().toISOString().slice(0, 10)
    ]);
  });
  sheet.getRange(1, 1, rows.length, 6).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, 6).setFontWeight("bold");
}

function createIndexSheet_(parent) {
  var spreadsheet = SpreadsheetApp.create(INGEST_INDEX_NAME);
  DriveApp.getFileById(spreadsheet.getId()).moveTo(parent);
  return spreadsheet;
}

/* ============================ Notifications ========================== */

function notifyIngest_(summary) {
  var lines = ["New driver files were dragged into the Applicants drive and prefilled onto the application:", ""];
  summary.forEach(function(item) {
    lines.push("• " + item.applicant + " (" + item.files + " file(s))");
    lines.push("   Open: " + item.openUrl);
    lines.push("   Folder: " + item.folderUrl);
    if (item.medicalCardExpiration) lines.push("   Med card expires: " + humanDate_(item.medicalCardExpiration));
    lines.push("");
  });
  lines.push("This notification intentionally excludes SSN, license number, and medical details.");
  MailApp.sendEmail({
    to: "dispatch@sstransco.com",
    subject: "[Driver application] " + summary.length + " applicant folder(s) prefilled from Drive",
    body: lines.join("\n"),
    name: SIGMA_CONFIG.companyName
  });
}

/* ============================== Helpers ============================== */

function getProcessedSet_() {
  var raw = PropertiesService.getScriptProperties().getProperty(INGEST_PROCESSED_PROP);
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch (error) { return {}; }
}

function saveProcessedSet_(set) {
  var keys = Object.keys(set);
  if (keys.length > 4000) keys = keys.slice(keys.length - 4000); // cap property size
  var trimmed = {};
  keys.forEach(function(key) { trimmed[key] = true; });
  PropertiesService.getScriptProperties().setProperty(INGEST_PROCESSED_PROP, JSON.stringify(trimmed));
}

function isSystemFolderName_(name) {
  var value = String(name || "");
  for (var i = 0; i < INGEST_SYSTEM_FOLDERS.length; i += 1) {
    if (value.indexOf(INGEST_SYSTEM_FOLDERS[i]) === 0) return true;
  }
  return false;
}

function isGeneratedFile_(file) {
  var name = file.getName();
  var mime = file.getMimeType();
  if (name === "application_data") return true;
  if (name === INGEST_INDEX_NAME) return true;
  if (name.indexOf(INGEST_OPEN_DOC_PREFIX) === 0) return true;
  if (mime === MimeType.GOOGLE_DOCS || mime === MimeType.GOOGLE_SHEETS) return true;
  if (/_SIGNED\.pdf$/i.test(name)) return true;
  if (/^Signed_Application/i.test(name)) return true;
  return false;
}

function labelDate_(body, label) {
  var re = new RegExp(label + "[^\\n]*?([A-Z][a-z]{2,8}\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}[\\/\\-]\\d{1,2}[\\/\\-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2})", "i");
  var match = body.match(re);
  return match ? match[1] : "";
}

function labelWord_(body, label) {
  var re = new RegExp(label + "\\s+([A-Za-z][A-Za-z'\\-]+)");
  var match = body.match(re);
  if (!match) return "";
  if (/^(Last|Middle|Name|Address|Date)$/i.test(match[1])) return "";
  return match[1];
}

function setIfText_(out, key, value) {
  var text = String(value || "").trim();
  if (text) out[key] = text;
}

function setIfDate_(out, key, value) {
  var iso = parseHumanDateToIso_(value);
  if (iso) out[key] = iso;
}

function parseHumanDateToIso_(raw) {
  var text = String(raw || "").trim();
  if (!text) return "";
  var y, mo, d;
  var m = text.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    mo = INGEST_MONTHS[m[1].slice(0, 3).toLowerCase()];
    d = Number(m[2]);
    y = Number(m[3]);
  } else if ((m = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/))) {
    mo = Number(m[1]);
    d = Number(m[2]);
    y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  } else if ((m = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))) {
    y = Number(m[1]);
    mo = Number(m[2]);
    d = Number(m[3]);
  }
  // Reject impossible / garbage dates (e.g. OCR "month 28") instead of storing them.
  if (!y || !mo || !d) return "";
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1920 || y > 2100) return "";
  return y + "-" + pad2_(mo) + "-" + pad2_(d);
}

function splitUsAddress_(raw) {
  var text = String(raw || "").replace(/\s+/g, " ").trim();
  var out = { street: "", city: "", state: "", zip: "" };
  var zip = text.match(/(\d{5})(?:-\d{4})?\s*$/);
  if (zip) {
    out.zip = zip[1];
    text = text.slice(0, zip.index).trim().replace(/,\s*$/, "");
  }
  var state = text.match(/,?\s*([A-Z]{2})\s*$/);
  if (state) {
    out.state = state[1];
    text = text.slice(0, state.index).trim().replace(/,\s*$/, "");
  }
  var parts = text.split(",");
  if (parts.length >= 2) {
    out.city = parts.pop().trim();
    out.street = parts.join(",").trim();
  } else {
    var words = text.trim().split(/\s+/);
    if (words.length >= 3) {
      out.city = words.pop();
      out.street = words.join(" ");
    } else {
      out.street = text.trim();
    }
  }
  return out;
}

function pad2_(value) {
  return ("0" + Number(value)).slice(-2);
}

function todayCentral_() {
  return Utilities.formatDate(new Date(), "America/Chicago", "yyyy-MM-dd");
}
