var SIGMA_CONFIG = {
  parentFolderId: "18HXcfD2LWVVcw4HL0n2i3vmtNVLfwfjZ",
  companyName: "Sigma Squared Transport Corporation",
  carrierAddress: "1101 N Cleveland Ave Apt 14, Sioux Falls, SD 57103",
  usdot: "4473629",
  mcNumber: "1547581",
  schemaVersion: "2.0.0",
  siteApplicationUrl: "https://sstransco.com/apply.html"
};

function doGet() {
  return HtmlService.createHtmlOutput("Sigma Squared driver-application save service");
}

/**
 * Run once from the editor after first deploy. Sets non-secret defaults and
 * reports whether the admin key is configured. It never overwrites an existing
 * value, so it is safe to re-run.
 */
function initializeScriptProperties() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty("ALLOWED_APPLICATION_ORIGINS")) {
    props.setProperty("ALLOWED_APPLICATION_ORIGINS", "https://sstransco.com,https://www.sstransco.com");
  }
  if (!props.getProperty("SITE_APPLICATION_URL")) {
    props.setProperty("SITE_APPLICATION_URL", SIGMA_CONFIG.siteApplicationUrl);
  }
  var generated = false;
  if (!props.getProperty("ADMIN_PREFILL_KEY")) {
    props.setProperty("ADMIN_PREFILL_KEY", (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ""));
    generated = true;
  }
  // Install the drag-drop watcher (step 3) so one Run does the whole setup.
  var triggerMessage;
  try {
    triggerMessage = ensureIngestTrigger_();
  } catch (triggerError) {
    triggerMessage = "Trigger not installed: " + triggerError;
  }

  // Backfill / process existing folders now (step 2), guarded so setup still succeeds.
  var ingestMessage;
  try {
    var result = ingestDriveDropIns();
    ingestMessage = "Initial ingest processed " + (result.processedFolders || 0) + " folder(s) with new files.";
  } catch (ingestError) {
    ingestMessage = "Initial ingest deferred to the scheduled watcher (" + ingestError + ").";
  }

  var message = "Origins: " + props.getProperty("ALLOWED_APPLICATION_ORIGINS") +
    "\nSite URL: " + props.getProperty("SITE_APPLICATION_URL") +
    "\nADMIN_PREFILL_KEY " + (generated ? "generated: " + props.getProperty("ADMIN_PREFILL_KEY") : "already set (unchanged).") +
    "\n" + triggerMessage +
    "\n" + ingestMessage +
    "\n\nUse the key in apply.html?mode=admin. Rotate it any time in Project Settings → Script properties.";
  Logger.log(message);
  return message;
}

function doPost(event) {
  var response;
  var targetOrigin = "https://sstransco.com";
  try {
    var payload = JSON.parse((event.parameter && event.parameter.payload) || "{}");
    targetOrigin = validateOrigin_(payload.pageOrigin);
    response = routeRequest_(payload);
  } catch (error) {
    response = { ok: false, message: error.message || String(error) };
  }
  return messageResponse_(response, targetOrigin);
}

function routeRequest_(payload) {
  if (!payload || !payload.action) throw new Error("Missing save-service action.");
  if (payload.schemaVersion !== SIGMA_CONFIG.schemaVersion) throw new Error("Unsupported application schema.");
  if (payload.action === "load") return loadApplication_(payload);
  if (payload.action === "regenerate") return regenerateSignedDocuments_(payload);
  if (payload.action === "send_request") return sendDriverRequest_(payload);
  if (payload.action === "ingest") { validateAdminKey_(payload.adminKey); return ingestDriveDropIns(); }
  if (payload.action !== "save" && payload.action !== "submit") throw new Error("Unsupported action.");
  return saveApplication_(payload);
}

function sendDriverRequest_(payload) {
  validateAdminKey_(payload.adminKey);
  var requestType = String(payload.requestType || "application").toLowerCase();
  if (["application", "psp", "mvr"].indexOf(requestType) === -1) throw new Error("Unsupported driver request type.");
  var recipient = normalizeRecipientEmail_(payload.recipientEmail || (payload.fields && payload.fields.applicant_email));
  var fields = payload.fields || {};
  fields.application_mode = "admin";
  fields.request_type = requestType;
  if (!fields.applicant_email) fields.applicant_email = recipient;

  var saved = saveApplication_({
    action: "save",
    schemaVersion: payload.schemaVersion,
    adminKey: payload.adminKey,
    pageOrigin: payload.pageOrigin,
    fields: fields,
    files: payload.files || [],
    audit: payload.audit || {}
  });
  if (!saved.continuationUrl) throw new Error("Could not create the private driver link.");
  var driverLink = saved.continuationUrl;
  if (requestType !== "application") driverLink += "&request=" + encodeURIComponent(requestType);
  sendDriverRequestEmail_(recipient, requestType, fields, driverLink);

  return {
    ok: true,
    applicationId: saved.applicationId,
    resumeToken: saved.resumeToken,
    continuationUrl: saved.continuationUrl,
    folderUrl: saved.folderUrl,
    recipientEmail: recipient,
    requestType: requestType,
    driverLink: driverLink,
    status: "sent"
  };
}

function normalizeRecipientEmail_(value) {
  var email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid driver email address.");
  return email;
}

function sendDriverRequestEmail_(recipient, requestType, fields, driverLink) {
  var firstName = String(fields.legal_first_name || "there").trim();
  var details = {
    application: {
      subject: "Sigma Squared driver application",
      title: "your driver application",
      instruction: "Please complete the remaining information, review the notices, and sign the application yourself."
    },
    psp: {
      subject: "Sigma Squared PSP disclosure and authorization",
      title: "your PSP disclosure and authorization",
      instruction: "Please review the stand-alone PSP disclosure and authorization, then acknowledge and sign it yourself."
    },
    mvr: {
      subject: "Sigma Squared MVR and CDLIS authorization",
      title: "your MVR and CDLIS authorization",
      instruction: "Please review the motor-vehicle record and CDLIS authorization, then acknowledge and sign it yourself."
    }
  }[requestType];
  var body = [
    "Hi " + firstName + ",",
    "",
    "Sigma Squared Transport Corporation has sent " + details.title + ".",
    details.instruction,
    "",
    "Open your private link:",
    driverLink,
    "",
    "Do not forward this link. If you did not expect this email, contact dispatch@sstransco.com.",
    "",
    "Sigma Squared Transport Corporation"
  ].join("\n");
  MailApp.sendEmail({ to: recipient, subject: details.subject, body: body, name: SIGMA_CONFIG.companyName });
}

function regenerateSignedDocuments_(payload) {
  var token = String((payload.fields && payload.fields.resume_token) || "").trim();
  if (!token) throw new Error("Missing continuation token.");
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty("resume:" + token);
  if (!spreadsheetId) throw new Error("Saved application not found or link expired.");
  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  var parents = DriveApp.getFileById(spreadsheetId).getParents();
  if (!parents.hasNext()) throw new Error("The saved application folder is unavailable.");
  var folder = parents.next();
  var fields = readFields_(spreadsheet);
  var audit = readLatestAudit_(spreadsheet);
  var applicationId = String(fields.application_id || readMetadataValue_(spreadsheet, "application_id") || makeApplicationId_());
  var signedPacket = createSignedPacket_(folder, fields, audit, applicationId);
  return {
    ok: true,
    action: "regenerate",
    applicationId: applicationId,
    folderUrl: folder.getUrl(),
    signedPacket: signedPacket
  };
}

function saveApplication_(payload) {
  var fields = payload.fields || {};
  var mode = String(fields.application_mode || "driver");
  if (mode === "admin") validateAdminKey_(payload.adminKey);

  var parent = DriveApp.getFolderById(SIGMA_CONFIG.parentFolderId);
  var applicationId = String(fields.application_id || makeApplicationId_());
  var firstName = cleanName_(fields.legal_first_name || "PENDING");
  var lastName = cleanName_(fields.legal_last_name || applicationId);
  var folderName = lastName.toUpperCase() + "," + firstName.toUpperCase();
  var resumeToken = String(fields.resume_token || "").trim() || Utilities.getUuid() + Utilities.getUuid();
  var existingSheetId = PropertiesService.getScriptProperties().getProperty("resume:" + resumeToken);
  // A stale token can point at a sheet/folder that was deleted (in Trash).
  // Ignore it and create a fresh folder instead of writing into the Trash.
  if (existingSheetId) {
    try {
      if (DriveApp.getFileById(existingSheetId).isTrashed()) existingSheetId = null;
    } catch (lookupError) {
      existingSheetId = null;
    }
  }
  var folder;
  var sheet;
  if (existingSheetId) {
    sheet = SpreadsheetApp.openById(existingSheetId);
    var parents = DriveApp.getFileById(existingSheetId).getParents();
    if (!parents.hasNext()) throw new Error("The saved application folder is unavailable.");
    folder = parents.next();
    if (fields.legal_last_name && fields.legal_first_name && folder.getName() !== folderName) folder.setName(folderName);
  } else {
    folder = findOrCreateFolder_(parent, folderName);
    sheet = findOrCreateSpreadsheet_(folder, "application_data");
  }
  fields.application_id = applicationId;
  fields.resume_token = resumeToken;
  if (payload.action === "submit") {
    fields.form_submission_date = Utilities.formatDate(new Date(), "America/Chicago", "yyyy-MM-dd");
    fields.form_submitted_at_utc = new Date().toISOString();
  }

  writeApplicationSheet_(sheet, fields, payload.audit || {}, payload.action);
  var uploadSummary = saveUploads_(folder, payload.files || [], applicationId, fields);
  var signedPacket = null;
  if (payload.action === "submit") {
    signedPacket = isConsentRequest_(fields)
      ? createConsentRequestPacket_(folder, fields, payload.audit || {}, applicationId)
      : createSignedPacket_(folder, fields, payload.audit || {}, applicationId);
  }

  PropertiesService.getScriptProperties().setProperty("resume:" + resumeToken, sheet.getId());
  sendNotification_(payload.action, fields, folder, applicationId, uploadSummary, signedPacket);

  var baseUrl = String((payload.audit && payload.audit.applicationUrl) || "").split("?")[0];
  return {
    ok: true,
    applicationId: applicationId,
    resumeToken: resumeToken,
    continuationUrl: baseUrl ? baseUrl + "?resume=" + encodeURIComponent(resumeToken) : "",
    folderUrl: folder.getUrl(),
    status: payload.action === "submit" ? "submitted" : "saved"
  };
}

function loadApplication_(payload) {
  var token = String((payload.fields && payload.fields.resume_token) || "").trim();
  if (!token) throw new Error("Missing continuation token.");
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty("resume:" + token);
  if (!spreadsheetId) throw new Error("Saved application not found or link expired.");
  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  return {
    ok: true,
    applicationId: readMetadataValue_(spreadsheet, "application_id"),
    resumeToken: token,
    fields: readFields_(spreadsheet),
    savedFiles: readUploadSummary_(spreadsheet)
  };
}

function isConsentRequest_(fields) {
  return fields && (fields.request_type === "psp" || fields.request_type === "mvr");
}

function validateAdminKey_(provided) {
  var expected = PropertiesService.getScriptProperties().getProperty("ADMIN_PREFILL_KEY");
  if (!expected) throw new Error("Administrator prefill is not configured.");
  var left = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(provided || ""));
  var right = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, expected);
  if (left.length !== right.length) throw new Error("Administrator key is not valid.");
  var mismatch = 0;
  for (var i = 0; i < left.length; i += 1) mismatch |= left[i] ^ right[i];
  if (mismatch !== 0) throw new Error("Administrator key is not valid.");
}

function findOrCreateFolder_(parent, name) {
  var folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}

function findOrCreateSpreadsheet_(folder, name) {
  var files = folder.getFilesByName(name);
  if (files.hasNext()) return SpreadsheetApp.openById(files.next().getId());
  var spreadsheet = SpreadsheetApp.create(name);
  DriveApp.getFileById(spreadsheet.getId()).moveTo(folder);
  return spreadsheet;
}

function sheetByName_(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function writeApplicationSheet_(spreadsheet, fields, audit, action) {
  var fieldSheet = sheetByName_(spreadsheet, "fields");
  var metadataSheet = sheetByName_(spreadsheet, "metadata");
  var auditSheet = sheetByName_(spreadsheet, "audit_log");
  var uploadSheet = sheetByName_(spreadsheet, "uploads");

  fieldSheet.clearContents();
  var rows = [["field_name", "occurrence", "value"]];
  Object.keys(fields).sort().forEach(function(name) {
    var value = fields[name];
    if (Array.isArray(value)) {
      value.forEach(function(item, index) { rows.push([name, index + 1, scalar_(item)]); });
    } else {
      rows.push([name, 1, scalar_(value)]);
    }
  });
  fieldSheet.getRange(1, 1, rows.length, 3).setNumberFormat("@").setValues(rows);
  fieldSheet.setFrozenRows(1);

  metadataSheet.clearContents();
  metadataSheet.getRange(1, 1, 7, 2).setValues([
    ["key", "value"],
    ["application_id", fields.application_id],
    ["resume_token", fields.resume_token],
    ["schema_version", SIGMA_CONFIG.schemaVersion],
    ["status", action === "submit" ? "submitted" : "saved"],
    ["updated_at_utc", new Date().toISOString()],
    ["applicant", [fields.legal_last_name, fields.legal_first_name].filter(Boolean).join(", ")]
  ]);
  metadataSheet.setFrozenRows(1);

  if (auditSheet.getLastRow() === 0) {
    auditSheet.appendRow(["timestamp_utc", "event", "application_id", "client_timestamp", "timezone", "user_agent"]);
    auditSheet.setFrozenRows(1);
  }
  auditSheet.appendRow([
    new Date().toISOString(),
    action,
    fields.application_id,
    audit.clientTimestamp || "",
    audit.timezone || "",
    audit.userAgent || ""
  ]);

  if (uploadSheet.getLastRow() === 0) {
    uploadSheet.appendRow(["timestamp_utc", "field", "occurrence", "file_name", "drive_file_id", "drive_url"]);
    uploadSheet.setFrozenRows(1);
  }

  var defaultSheet = spreadsheet.getSheetByName("Sheet1");
  if (defaultSheet && spreadsheet.getSheets().length > 1) spreadsheet.deleteSheet(defaultSheet);
}

function saveUploads_(folder, files, applicationId, fields) {
  if (!files.length) return [];
  var uploadFolder = findOrCreateFolder_(folder, "Uploads");
  var spreadsheet = findOrCreateSpreadsheet_(folder, "application_data");
  var uploadSheet = sheetByName_(spreadsheet, "uploads");
  var summary = [];
  files.forEach(function(file, index) {
    var parsed = parseDataUrl_(file.dataUrl);
    var occurrence = Number(file.occurrence || index + 1);
    var prefix = uploadNamePart_(fields.legal_last_name || applicationId) + "," +
      uploadNamePart_(fields.legal_first_name || "PENDING");
    var category = uploadCategory_(file.field, occurrence) + uploadDateSuffix_(file.field, occurrence, fields);
    var safeName = sanitizeFileName_(prefix + "_" + category + ".pdf");
    replacePreviousUpload_(uploadSheet, file.field || "", occurrence);
    var blob = uploadPdfBlob_(parsed, safeName);
    var existing = uploadFolder.getFilesByName(safeName);
    while (existing.hasNext()) existing.next().setTrashed(true);
    var driveFile = uploadFolder.createFile(blob);
    uploadSheet.appendRow([new Date().toISOString(), file.field || "", occurrence, safeName, driveFile.getId(), driveFile.getUrl()]);
    summary.push({ field: file.field || "", occurrence: occurrence, name: safeName, url: driveFile.getUrl() });
  });
  return summary;
}

function uploadPdfBlob_(parsed, fileName) {
  var bytes = Utilities.base64Decode(parsed.base64);
  var mimeType = String(parsed.mimeType || "").toLowerCase();
  var source = Utilities.newBlob(bytes, parsed.mimeType, fileName);
  if (mimeType === "application/pdf") return source.setName(fileName);
  if (!/^image\//.test(mimeType)) return source.setName(fileName);
  var doc = DocumentApp.create("Upload conversion");
  var file = DriveApp.getFileById(doc.getId());
  var body = doc.getBody();
  body.clear();
  body.setMarginTop(36).setMarginBottom(36).setMarginLeft(36).setMarginRight(36);
  try {
    var image = body.appendImage(source);
    var maxWidth = 520;
    if (image.getWidth() > maxWidth) {
      var ratio = maxWidth / image.getWidth();
      image.setWidth(maxWidth).setHeight(Math.round(image.getHeight() * ratio));
    }
    doc.saveAndClose();
    var pdf = file.getAs(MimeType.PDF).setName(fileName);
    file.setTrashed(true);
    return pdf;
  } catch (error) {
    file.setTrashed(true);
    throw new Error("Could not convert uploaded image to PDF: " + error.message);
  }
}

function replacePreviousUpload_(uploadSheet, field, occurrence) {
  if (uploadSheet.getLastRow() < 2) return;
  var rows = uploadSheet.getRange(2, 1, uploadSheet.getLastRow() - 1, 6).getValues();
  for (var index = rows.length - 1; index >= 0; index -= 1) {
    if (String(rows[index][1]) !== String(field) || Number(rows[index][2]) !== Number(occurrence)) continue;
    try {
      if (rows[index][4]) DriveApp.getFileById(String(rows[index][4])).setTrashed(true);
    } catch (error) {
      console.warn("Could not trash replaced upload: " + error.message);
    }
    uploadSheet.deleteRow(index + 2);
  }
}

function uploadNamePart_(value) {
  return cleanName_(value).toUpperCase().replace(/\s+/g, "_");
}

function uploadCategory_(field, occurrence) {
  var cleanField = String(field || "upload").replace(/\[\]/g, "");
  var categories = {
    current_cdl_front: "cdlfront",
    current_cdl_back: "cdlback",
    medical_card: "medicalcard",
    prior_cdl_front: "priorcdlfront",
    prior_cdl_back: "priorcdlback"
  };
  var category = categories[cleanField] || cleanField.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (/^prior_cdl_/.test(cleanField)) category += Utilities.formatString("%02d", Number(occurrence || 1));
  return category || "document";
}

function uploadDateSuffix_(field, occurrence, fields) {
  var cleanField = String(field || "").replace(/\[\]/g, "");
  if (cleanField === "medical_card") {
    return dateNamePart_("EXP", fields.medical_card_expiration);
  }
  if (cleanField === "current_cdl_front" || cleanField === "current_cdl_back") {
    return dateNamePart_("ISS", fields.license_issue_date) + dateNamePart_("EXP", fields.license_expiration_date);
  }
  if (cleanField === "prior_cdl_front" || cleanField === "prior_cdl_back") {
    var index = Math.max(0, Number(occurrence || 1) - 1);
    return dateNamePart_("ISS", arrayValue_(fields["prior_license_issue[]"], index)) +
      dateNamePart_("EXP", arrayValue_(fields["prior_license_expiration[]"], index));
  }
  return "";
}

function arrayValue_(value, index) {
  return Array.isArray(value) ? value[index] : (index === 0 ? value : "");
}

function dateNamePart_(label, value) {
  var match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? "_" + label + "_" + match.slice(1).join("_") : "";
}

function uploadExtension_(fileName, mimeType) {
  var match = String(fileName || "").match(/(\.[a-zA-Z0-9]{1,8})$/);
  if (match) return match[1].toLowerCase();
  var extensions = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif"
  };
  return extensions[String(mimeType || "").toLowerCase()] || "";
}

function parseDataUrl_(dataUrl) {
  var match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid uploaded-file encoding.");
  return { mimeType: match[1], base64: match[2] };
}

function createSignedPacket_(folder, fields, audit, applicationId) {
  var auditId = Utilities.getUuid();
  var canonical = JSON.stringify({
    fields: fields,
    documentVersions: audit.documentVersions || {},
    documentDigests: audit.documentDigests || {}
  });
  var digest = hexDigest_(canonical);
  var doc = DocumentApp.create("Signed_Application_and_Authorizations");
  DriveApp.getFileById(doc.getId()).moveTo(folder);
  var body = doc.getBody();
  body.clear();
  prepareOfficialBody_(body);

  appendOfficialHeader_(body, "Electronic Driver Application and Authorizations", "Signed packet for driver qualification file");
  appendCompactMetaTable_(body, [
    ["Application ID", applicationId],
    ["Applicant", applicantName_(fields)],
    ["Application date", humanDate_(fields.application_date)],
    ["Submitted", humanDateTime_(fields.form_submitted_at_utc || audit.clientTimestamp)],
    ["Carrier", SIGMA_CONFIG.companyName + " | USDOT " + SIGMA_CONFIG.usdot]
  ]);

  appendSecurityPanel_(body, fields, auditId, digest, "This packet was generated from the driver application answers and electronically acknowledged consent text.");

  appendHumanApplicationQuestions_(body, fields);

  body.appendPageBreak();
  appendSectionTitle_(body, "Signed Notices and Authorizations", "Each item below was acknowledged in the application flow. Verification hashes are recorded under each subtitle.");
  var documents = signedDocumentDefinitions_();
  documents.forEach(function(item) {
    if (fields[item.field]) {
      appendConsentSummary_(body, item, fields, audit);
    }
  });

  body.appendPageBreak();
  appendAuditTrail_(body, fields, audit, auditId, digest);
  doc.saveAndClose();

  var pdf = DriveApp.getFileById(doc.getId()).getAs(MimeType.PDF).setName("Signed_Application_and_Authorizations.pdf");
  var existing = folder.getFilesByName("Signed_Application_and_Authorizations.pdf");
  while (existing.hasNext()) existing.next().setTrashed(true);
  var pdfFile = folder.createFile(pdf);
  var forms = createSignedFormPdfs_(folder, fields, audit, applicationId, auditId, digest);
  if (fields.mvr_authorization || fields.mvr_release_consent) {
    try {
      forms.push(createMvrReleaseConsentPdf_(folder, fields, audit, applicationId, auditId, digest));
    } catch (mvrError) {
      console.warn("MVR release consent PDF skipped: " + mvrError);
    }
  }
  var printablePacket = createPrintableApplicationPacket_(folder, fields, audit, applicationId, auditId, digest);
  return { auditId: auditId, digest: digest, url: pdfFile.getUrl(), fileId: pdfFile.getId(), forms: forms, printablePacket: printablePacket };
}

function createConsentRequestPacket_(folder, fields, audit, applicationId) {
  var requestType = String(fields.request_type || "");
  var auditId = Utilities.getUuid();
  var canonical = JSON.stringify({
    fields: fields,
    documentVersions: audit.documentVersions || {},
    documentDigests: audit.documentDigests || {}
  });
  var digest = hexDigest_(canonical);
  if (requestType === "mvr") {
    var mvr = createMvrReleaseConsentPdf_(folder, fields, audit, applicationId, auditId, digest);
    return { auditId: auditId, digest: digest, url: mvr.url, fileId: mvr.fileId, forms: [mvr], printablePacket: null, documentId: mvr.documentId };
  }
  var forms = createSignedFormPdfs_(folder, fields, audit, applicationId, auditId, digest, "psp_authorization");
  if (!forms.length) throw new Error("The requested consent was not acknowledged.");
  return { auditId: auditId, digest: digest, url: forms[0].url, fileId: forms[0].fileId, forms: forms, printablePacket: null };
}

function mvrDocumentId_(applicationId, auditId) {
  var stamp = Utilities.formatDate(new Date(), "America/Chicago", "yyyyMMddHHmmss");
  var suffix = String(auditId || Utilities.getUuid()).replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase();
  return "SIG-MVR-" + stamp + "-" + suffix;
}

function createMvrReleaseConsentPdf_(folder, fields, audit, applicationId, auditId, digest) {
  var signedFolder = findOrCreateFolder_(folder, "Signed Forms");
  var prefix = uploadNamePart_(fields.legal_last_name || applicationId) + "," +
    uploadNamePart_(fields.legal_first_name || "PENDING");
  var name = sanitizeFileName_(prefix + "_mvr_release_consent_SIGNED.pdf");
  var documentId = mvrDocumentId_(applicationId, auditId);

  var doc = DocumentApp.create("MVR Release Consent Form");
  var driveFile = DriveApp.getFileById(doc.getId());
  var body = doc.getBody();
  body.clear();
  prepareOfficialBody_(body);

  var idLine = body.appendParagraph("Document ID: " + documentId);
  idLine.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  styleText_(idLine, 8, false, "#666666");
  idLine.setSpacingAfter(20);

  var title = body.appendParagraph("MVR RELEASE CONSENT FORM");
  title.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  styleText_(title, 15, true, "#000000");
  title.setSpacingAfter(16);

  appendLegalParagraph_(body, "In conjunction with my potential employment at " + SIGMA_CONFIG.companyName +
    " (“the Company”), I, " + applicantName_(fields) +
    " (applicant), consent to the release of my Motor Vehicle Records (MVR) to the Company. I understand the Company will use these records to evaluate my suitability to fulfill driving duties that may be related to the position for which I am applying. I also consent to the review, evaluation, and other use of any MVR I may have provided to the Company.");
  appendLegalParagraph_(body, "This consent is given in satisfaction of Public Law 18 U.S.C. 2721 et seq., the “Federal Driver’s Privacy Protection Act,” and is intended to constitute “written consent” as required by that Act.");

  body.appendHorizontalRule();
  var sig = body.appendParagraph("");
  sig.setSpacingBefore(10);
  sig.appendText("Signed (applicant):  ");
  var sigName = sig.appendText(answer_(fields.signature_name));
  sigName.setBold(true).setForegroundColor("#1f4e79");
  sig.editAsText().setFontFamily("Arial").setFontSize(11);
  var sigMeta = body.appendParagraph("Electronically signed — typed signature adopted by the applicant with intent to sign.");
  styleText_(sigMeta, 8, false, "#1f4e79");
  var dateP = body.appendParagraph("Date:  " + humanDate_(fields.signature_date || fields.form_submission_date));
  styleText_(dateP, 11, false, "#000000");
  dateP.setSpacingBefore(6);
  var dl = body.appendParagraph("Driver’s License Number:  " + answer_(fields.license_number) +
    "          State:  " + answer_(fields.license_state));
  styleText_(dl, 11, false, "#000000");
  dl.setSpacingBefore(6);

  var footer = body.appendParagraph(SIGMA_CONFIG.companyName + " · USDOT " + SIGMA_CONFIG.usdot + " · MC-" + SIGMA_CONFIG.mcNumber);
  footer.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  styleText_(footer, 8, false, "#666666");
  footer.setSpacingBefore(24);

  body.appendPageBreak();
  appendMvrAuditTrail_(body, fields, audit, documentId, auditId, digest);

  doc.saveAndClose();
  var pdf = driveFile.getAs(MimeType.PDF).setName(name);
  driveFile.setTrashed(true);
  var existing = signedFolder.getFilesByName(name);
  while (existing.hasNext()) existing.next().setTrashed(true);
  var file = signedFolder.createFile(pdf);
  return { name: name, url: file.getUrl(), fileId: file.getId(), documentId: documentId };
}

function appendMvrAuditTrail_(body, fields, audit, documentId, auditId, digest) {
  var heading = body.appendParagraph("Audit Trail");
  heading.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  styleText_(heading, 9, false, "#888888");
  heading.setSpacingAfter(12);

  var meta = body.appendTable([
    ["TITLE", "MVR Release Consent Form"],
    ["DOCUMENT ID", documentId],
    ["DOCUMENT PAGES", "1"],
    ["STATUS", "COMPLETED"],
    ["TIME ZONE", audit.timezone || "America/Chicago"]
  ]);
  styleTable_(meta, false);

  var signerName = answer_(fields.signature_name);
  var signerEmail = String(fields.applicant_email || fields.email || "").trim();
  var ip = String(audit.signerIp || "").trim();
  var identity = signerName + (signerEmail ? " (" + signerEmail + ")" : "") + (ip ? "   IP: " + ip : "");
  var started = humanDateTime_(audit.clientTimestamp) || humanDateTime_(new Date().toISOString());
  var signed = humanDateTime_(fields.form_submitted_at_utc || audit.clientTimestamp) || started;
  var completed = humanDateTime_(new Date().toISOString());

  appendSectionTitle_(body, "Document History", "");
  var history = body.appendTable([
    ["Process Started", started, "The document was generated and presented to the applicant for electronic signature."],
    ["Viewed", started, "Viewed by " + identity],
    ["Signed", signed, "Signed by " + identity],
    ["Process Completed", completed, "The document has been completed."]
  ]);
  styleTable_(history, false);

  appendSectionTitle_(body, "Signature Verification", "");
  var verify = body.appendTable([
    ["Signer", signerName],
    ["Signer email", signerEmail || "Not provided"],
    ["Signer IP address", ip || "Not captured"],
    ["Client timestamp", humanDateTime_(audit.clientTimestamp)],
    ["Time zone", audit.timezone || "America/Chicago"],
    ["User agent", audit.userAgent || "Not captured"],
    ["Audit ID", auditId],
    ["Content digest (SHA-256)", digest]
  ]);
  styleTable_(verify, false);

  var note = body.appendParagraph("This record constitutes an electronic signature executed under the U.S. ESIGN Act (15 U.S.C. § 7001 et seq.) and the Uniform Electronic Transactions Act. The applicant adopted the typed signature above with intent to sign, and this audit trail documents the signing events for " + SIGMA_CONFIG.companyName + ".");
  styleText_(note, 7, false, "#888888");
  note.setSpacingBefore(10);
}

function signedDocumentDefinitions_() {
  return [
    {
      title: "Application Certification",
      field: "certification",
      versionKey: "applicationCertification",
      fileKey: "application_certification",
      paragraphs: [
        "This certifies that this application was completed by me, and that all entries on it and information in it are true and complete to the best of my knowledge."
      ]
    },
    {
      title: "Driver Safety-Performance History Rights",
      field: "rights_acknowledgment",
      versionKey: "driverRights",
      fileKey: "driver_rights",
      paragraphs: [
        "If you had Department of Transportation-regulated employment during the preceding three years, Sigma Squared Transport Corporation will investigate information provided by prior employers.",
        "You have the right to review information provided by prior employers, have errors corrected by the prior employer and re-sent to Sigma Squared, and have a rebuttal statement attached if you and the prior employer cannot agree on accuracy.",
        "You may submit a written review request while applying, or as late as 30 days after you are employed or notified that employment was denied. Send requests to dispatch@sstransco.com."
      ]
    },
    {
      title: "FCRA Consumer-Report Disclosure",
      field: "fcra_disclosure_receipt",
      versionKey: "fcraDisclosure",
      fileKey: "fcra_disclosure",
      paragraphs: [
        "Sigma Squared Transport Corporation may obtain a consumer report about you for employment purposes, including to evaluate you for employment, reassignment, promotion, or retention.",
        "A consumer report may include information about your driving record, criminal history, employment history, education or license verification, public records, identity and Social Security number validation, and other lawful background information.",
        "This document is the disclosure. It is not an authorization, release of claims, or waiver of rights."
      ]
    },
    {
      title: "Background-Check Authorization",
      field: "fcra_authorization",
      versionKey: "fcraAuthorization",
      fileKey: "background_check_authorization",
      paragraphs: [
        "I authorize Sigma Squared Transport Corporation and its authorized consumer reporting agencies or screening providers to obtain consumer reports and investigative consumer reports about me for employment purposes.",
        "I authorize lawful sources to provide information needed to prepare those reports, including identity and Social Security number verification, employment and education verification, motor-vehicle and licensing records, criminal and public records, and other information described in the separate disclosure I received."
      ]
    },
    {
      title: "MVR and CDLIS Authorization",
      field: "mvr_authorization",
      versionKey: "mvrCdlisAuthorization",
      fileKey: "mvr_cdlis_authorization",
      paragraphs: [
        "I authorize Sigma Squared Transport Corporation and its authorized agents to request, obtain, and review my motor-vehicle records and commercial-driver licensing information from each State driver licensing agency where I held or hold a license or permit during the preceding three years, and from CDLIS, as permitted by law.",
        "This authorization is for commercial-driver employment verification, driver qualification, and safety-compliance purposes, including the initial inquiry required by 49 CFR 391.23 and lawful periodic inquiries during employment."
      ]
    },
    {
      title: "PSP Disclosure and Authorization",
      field: "psp_authorization",
      versionKey: "pspDisclosureAuthorization",
      fileKey: "psp_authorization",
      paragraphs: [
        "In connection with your application for employment with Sigma Squared Transport Corporation, the Prospective Employer, its employees, agents or contractors may obtain one or more reports regarding your driving and safety inspection history from the Federal Motor Carrier Safety Administration.",
        "The Prospective Employer cannot obtain background reports from FMCSA without your authorization.",
        "I authorize Sigma Squared Transport Corporation to access the FMCSA Pre-Employment Screening Program system to seek information regarding my commercial driving safety record and safety inspection history, including crash data from the previous five years and inspection history from the previous three years.",
        "I understand I may challenge the accuracy of data by submitting a request to https://dataqs.fmcsa.dot.gov."
      ]
    },
    {
      title: "Electronic Records and Signature Consent",
      field: "esign_consent",
      versionKey: "electronicSignatureConsent",
      fileKey: "electronic_signature_consent",
      paragraphs: [
        "You may receive, review, sign, and retain application records and disclosures electronically. Your electronic signature has the same intended effect as a handwritten signature.",
        "This consent applies to the driver application, disclosures, authorizations, acknowledgments, and related hiring records delivered in this process.",
        "You may request paper copies at no charge by contacting dispatch@sstransco.com or (605) 650-3870."
      ]
    },
    {
      title: "Clearinghouse Limited-Query Consent",
      field: "clearinghouse_limited_query_consent",
      versionKey: "clearinghouseLimitedQueryConsent",
      fileKey: "clearinghouse_limited_query_consent",
      paragraphs: [
        "I authorize Sigma Squared Transport Corporation to conduct limited queries of the FMCSA Drug and Alcohol Clearinghouse as required or permitted by 49 CFR part 382.",
        "A limited query tells the employer whether information exists in my Clearinghouse record, but does not release the detailed record.",
        "I understand Sigma Squared must send a separate pre-employment full-query request through the Clearinghouse after this application is submitted, and that I must provide specific electronic consent in the Clearinghouse before detailed information can be released for that full query."
      ]
    }
  ];
}

function createSignedFormPdfs_(folder, fields, audit, applicationId, auditId, digest, onlyFileKey) {
  var signedFolder = findOrCreateFolder_(folder, "Signed Forms");
  var prefix = uploadNamePart_(fields.legal_last_name || applicationId) + "," +
    uploadNamePart_(fields.legal_first_name || "PENDING");
  var forms = [];
  signedDocumentDefinitions_().forEach(function(definition) {
    if (onlyFileKey && definition.fileKey !== onlyFileKey) return;
    if (!fields[definition.field]) return;
    var name = sanitizeFileName_(prefix + "_" + definition.fileKey + "_SIGNED.pdf");
    var existing = signedFolder.getFilesByName(name);
    while (existing.hasNext()) existing.next().setTrashed(true);
    var pdf = signedFormPdfBlob_(definition, fields, audit, applicationId, auditId, digest, name);
    var file = signedFolder.createFile(pdf);
    forms.push({ name: name, url: file.getUrl(), fileId: file.getId() });
  });
  return forms;
}

function signedFormPdfBlob_(definition, fields, audit, applicationId, auditId, digest, fileName) {
  var doc = DocumentApp.create(definition.title);
  var driveFile = DriveApp.getFileById(doc.getId());
  var body = doc.getBody();
  body.clear();
  prepareOfficialBody_(body);
  appendOfficialHeader_(body, definition.title, "Signed notice / authorization");
  appendCompactMetaTable_(body, [
    ["Applicant", applicantName_(fields)],
    ["Application ID", applicationId],
    ["Application date", humanDate_(fields.application_date)],
    ["Carrier", SIGMA_CONFIG.companyName + " | USDOT " + SIGMA_CONFIG.usdot]
  ]);
  appendHashSubtitle_(body, definition, audit);
  body.appendHorizontalRule();
  definition.paragraphs.forEach(function(paragraph) {
    appendLegalParagraph_(body, paragraph);
  });
  body.appendHorizontalRule();
  appendSignatureSeal_(body, fields, auditId, digest);
  appendFooterHash_(body, definition, audit);
  doc.saveAndClose();
  var pdf = driveFile.getAs(MimeType.PDF).setName(fileName);
  driveFile.setTrashed(true);
  return pdf;
}

function createPrintableApplicationPacket_(folder, fields, audit, applicationId, auditId, digest) {
  var prefix = uploadNamePart_(fields.legal_last_name || applicationId) + "," +
    uploadNamePart_(fields.legal_first_name || "PENDING");
  var name = sanitizeFileName_(prefix + "_driver_application_consent_packet_SIGNED.pdf");
  var existing = folder.getFilesByName(name);
  while (existing.hasNext()) existing.next().setTrashed(true);
  var doc = DocumentApp.create("Printable Driver Application and Consent Packet");
  var driveFile = DriveApp.getFileById(doc.getId());
  DriveApp.getFileById(doc.getId()).moveTo(folder);
  var body = doc.getBody();
  body.clear();
  prepareOfficialBody_(body);
  appendOfficialHeader_(body, "Driver Application and Consent Packet", "Printable driver qualification file copy");
  appendCompactMetaTable_(body, [
    ["Application ID", applicationId],
    ["Applicant", applicantName_(fields)],
    ["Application date", humanDate_(fields.application_date)],
    ["Submitted", humanDateTime_(fields.form_submitted_at_utc || audit.clientTimestamp)],
    ["Generated", humanDateTime_(new Date().toISOString())],
    ["Carrier", SIGMA_CONFIG.companyName + " | USDOT " + SIGMA_CONFIG.usdot]
  ]);
  appendSecurityPanel_(body, fields, auditId, digest, "The signed name, audit ID, and content digest below verify the application answers and signed consent text captured for this packet.");
  appendHumanApplicationQuestions_(body, fields);

  body.appendPageBreak();
  appendSectionTitle_(body, "Signed Consents and Notices", "Applicant acknowledgments are shown in-line for printing. Individual signed PDFs are also saved in the Signed Forms folder.");
  signedDocumentDefinitions_().forEach(function(definition) {
    if (!fields[definition.field]) return;
    appendConsentFullText_(body, definition, fields, audit);
  });

  body.appendPageBreak();
  appendAuditTrail_(body, fields, audit, auditId, digest);
  appendCarrierReviewBlock_(body);
  doc.saveAndClose();
  var pdf = driveFile.getAs(MimeType.PDF).setName(name);
  driveFile.setTrashed(true);
  var file = folder.createFile(pdf);
  return { name: name, url: file.getUrl(), fileId: file.getId() };
}

function prepareOfficialBody_(body) {
  body.setMarginTop(42).setMarginBottom(42).setMarginLeft(50).setMarginRight(50);
  var attrs = {};
  attrs[DocumentApp.Attribute.FONT_FAMILY] = "Arial";
  attrs[DocumentApp.Attribute.FONT_SIZE] = 9;
  body.setAttributes(attrs);
}

function applicantName_(fields) {
  return [fields.legal_first_name, fields.legal_middle_name, fields.legal_last_name].filter(Boolean).join(" ") || "Not provided";
}

function appendOfficialHeader_(body, title, subtitle) {
  var company = body.appendParagraph(SIGMA_CONFIG.companyName.toUpperCase());
  styleText_(company, 11, true, "#000000");
  company.setSpacingAfter(1);
  var heading = body.appendParagraph(title.toUpperCase());
  styleText_(heading, 14, true, "#000000");
  heading.setSpacingAfter(0);
  var sub = body.appendParagraph(subtitle + " | " + SIGMA_CONFIG.carrierAddress + " | USDOT " + SIGMA_CONFIG.usdot);
  styleText_(sub, 8, false, "#4d4d4d");
  sub.setSpacingAfter(6);
  body.appendHorizontalRule();
}

function appendSectionTitle_(body, title, subtitle) {
  var heading = body.appendParagraph(title.toUpperCase());
  styleText_(heading, 10, true, "#000000");
  heading.setSpacingBefore(8).setSpacingAfter(0);
  if (subtitle) {
    var sub = body.appendParagraph(subtitle);
    styleText_(sub, 7, false, "#666666");
    sub.setSpacingAfter(4);
  }
}

function appendLegalParagraph_(body, text) {
  var paragraph = body.appendParagraph(text);
  styleText_(paragraph, 8, false, "#111111");
  paragraph.setLineSpacing(1.0).setSpacingAfter(4);
  return paragraph;
}

function styleText_(paragraph, size, bold, color) {
  var text = paragraph.editAsText();
  text.setFontFamily("Arial");
  text.setFontSize(size);
  text.setBold(Boolean(bold));
  if (color) text.setForegroundColor(color);
  return paragraph;
}

function styleTable_(table, hasHeader) {
  table.setBorderColor("#777777");
  table.setBorderWidth(0.5);
  for (var r = 0; r < table.getNumRows(); r += 1) {
    var row = table.getRow(r);
    for (var c = 0; c < row.getNumCells(); c += 1) {
      var cell = row.getCell(c);
      cell.setPaddingTop(2).setPaddingBottom(2).setPaddingLeft(4).setPaddingRight(4);
      var text = cell.editAsText();
      text.setFontFamily("Arial").setFontSize(8);
      if ((hasHeader && r === 0) || c === 0) text.setBold(true);
      if (hasHeader && r === 0) text.setForegroundColor("#000000");
    }
  }
  return table;
}

function appendCompactMetaTable_(body, rows) {
  var table = body.appendTable(rows.map(function(row) {
    return [row[0], answer_(row[1])];
  }));
  styleTable_(table, false);
  return table;
}

function appendSecurityPanel_(body, fields, auditId, digest, note) {
  appendSectionTitle_(body, "Verified Electronic Signature", "Lock ID " + auditId + " | Packet SHA-256 " + digest);
  var table = body.appendTable([
    ["🔒 Signed as", answer_(fields.signature_name)],
    ["Signature date", humanDate_(fields.signature_date)],
    ["Verification note", note]
  ]);
  styleTable_(table, false);
  var signedCell = table.getCell(0, 1).editAsText();
  signedCell.setBold(true).setForegroundColor("#1f4e79");
}

function appendSignatureSeal_(body, fields, auditId, digest) {
  appendSectionTitle_(body, "Verified Electronic Signature", "Lock ID " + auditId + " | Packet SHA-256 " + digest);
  var table = body.appendTable([
    ["🔒 Electronically signed by", answer_(fields.signature_name)],
    ["Signature date", humanDate_(fields.signature_date)],
    ["Recorded", humanDateTime_(new Date().toISOString())]
  ]);
  styleTable_(table, false);
  table.getCell(0, 1).editAsText().setBold(true).setForegroundColor("#1f4e79");
}

function appendHashSubtitle_(body, definition, audit) {
  var line = body.appendParagraph("Version " + documentVersion_(definition, audit) + " | Document SHA-256 " + documentDigest_(definition, audit));
  styleText_(line, 7, false, "#666666");
  line.setSpacingAfter(4);
}

function appendFooterHash_(body, definition, audit) {
  var line = body.appendParagraph("Verification: " + definition.fileKey + " | Version " + documentVersion_(definition, audit) + " | SHA-256 " + documentDigest_(definition, audit));
  styleText_(line, 7, false, "#666666");
}

function appendConsentSummary_(body, definition, fields, audit) {
  var paragraph = body.appendParagraph("☑ " + definition.title + " — acknowledged by " + answer_(fields.signature_name) + " on " + humanDate_(fields.signature_date));
  styleText_(paragraph, 8, true, "#000000");
  appendHashSubtitle_(body, definition, audit);
}

function appendConsentFullText_(body, definition, fields, audit) {
  appendSectionTitle_(body, definition.title, "Version " + documentVersion_(definition, audit) + " | SHA-256 " + documentDigest_(definition, audit));
  definition.paragraphs.forEach(function(paragraph) { appendLegalParagraph_(body, paragraph); });
  var acknowledgment = body.appendParagraph("☑ Applicant acknowledgment: electronically signed by " + answer_(fields.signature_name) + " on " + humanDate_(fields.signature_date) + ".");
  styleText_(acknowledgment, 8, true, "#1f4e79");
  acknowledgment.setSpacingAfter(6);
}

function appendAuditTrail_(body, fields, audit, auditId, digest) {
  appendSectionTitle_(body, "Electronic Signature Audit Trail", "Recorded verification details for the application packet.");
  appendCompactMetaTable_(body, [
    ["Signed by", fields.signature_name],
    ["Signature date", humanDate_(fields.signature_date)],
    ["Audit ID", auditId],
    ["Content digest (SHA-256)", digest],
    ["Client timestamp", humanDateTime_(audit.clientTimestamp)],
    ["Client timezone", audit.timezone],
    ["User agent", audit.userAgent]
  ]);
}

function appendCarrierReviewBlock_(body) {
  appendSectionTitle_(body, "Carrier Review / Signature / Stamp", "For company completion after application review.");
  appendLegalParagraph_(body, "Reviewed by: ________________________________________________");
  appendLegalParagraph_(body, "Title: _______________________________________________________");
  appendLegalParagraph_(body, "Date: ________________________________________________________");
  appendLegalParagraph_(body, "Carrier signature or stamp:");
  appendLegalParagraph_(body, "\n\n\n");
}

function appendHumanApplicationQuestions_(body, fields) {
  appendQaSection_(body, "Applicant Information", [
    ["Application date", humanDate_(fields.application_date)],
    ["Full legal name", applicantName_(fields)],
    ["Date of birth", humanDate_(fields.date_of_birth)],
    ["Social Security number", fields.ssn],
    ["Email address", fields.email || fields.applicant_email],
    ["Phone number", fields.phone || fields.applicant_phone],
    ["Submission date", humanDate_(fields.form_submission_date)]
  ]);

  appendQaSection_(body, "Current Residence", [
    ["What is your current street address?", fields.current_address_street],
    ["City", fields.current_address_city],
    ["State", fields.current_address_state],
    ["ZIP / postal code", fields.current_address_postal],
    ["When did you begin living at this address?", humanMonth_(fields.current_address_start)]
  ]);

  appendRepeatedQaSection_(body, "Prior Residence History", "Residence", [
    ["Street address", fields["prior_address_street[]"]],
    ["City", fields["prior_address_city[]"]],
    ["State", fields["prior_address_state[]"]],
    ["ZIP / postal code", fields["prior_address_postal[]"]]
  ]);

  appendQaSection_(body, "Current Commercial Driver License", [
    ["What state or licensing authority issued the current CDL?", fields.license_state],
    ["What is the current CDL number?", fields.license_number],
    ["What is the CDL class?", fields.license_class],
    ["What endorsements are listed?", fields.license_endorsements],
    ["What restrictions are listed?", fields.license_restrictions],
    ["What is the CDL issue date?", humanDate_(fields.license_issue_date)],
    ["What is the CDL expiration date?", humanDate_(fields.license_expiration_date)],
    ["Do you hold any other unexpired license or permit?", yesNo_(fields.other_unexpired_license)]
  ]);

  appendRepeatedQaSection_(body, "Prior CDL Records", "Prior CDL", [
    ["Licensing state / authority", fields["prior_license_state[]"]],
    ["License number", fields["prior_license_number[]"]],
    ["Issue date", mapDates_(fields["prior_license_issue[]"])],
    ["Expiration date", mapDates_(fields["prior_license_expiration[]"])]
  ]);

  appendQaSection_(body, "Medical Examiner Certificate", [
    ["What is the medical-card expiration date?", humanDate_(fields.medical_card_expiration)]
  ]);

  appendQaSection_(body, "Driving Record", [
    ["Have you had any DOT-reportable accidents during the preceding three years?", drivingAnswer_(fields.accident_attestation, "No accidents reported")],
    ["Have you had any non-parking traffic convictions or forfeitures during the preceding three years?", drivingAnswer_(fields.violation_attestation, "No convictions or forfeitures reported")],
    ["Has any license, permit, or privilege to operate a motor vehicle ever been denied, revoked, or suspended?", yesNo_(fields.license_action_attestation)],
    ["If yes, explain the license action.", fields.license_action_details],
    ["Have you ever been disqualified from operating a commercial motor vehicle, including a DOT drug/alcohol violation or SAP/return-to-duty issue?", yesNo_(fields.cmv_disqualified)],
    ["If yes, explain the qualification issue.", fields.qualification_details],
    ["SAP / return-to-duty status", fields.sap_rtd_status],
    ["SAP / return-to-duty notes", fields.sap_rtd_notes]
  ]);

  appendRepeatedQaSection_(body, "Accident Details", "Accident", [
    ["Date", mapDates_(fields["accident_date[]"])],
    ["Nature of accident", fields["accident_nature[]"]],
    ["Fatalities", fields["accident_fatalities[]"]],
    ["Injuries", fields["accident_injuries[]"]]
  ]);

  appendRepeatedQaSection_(body, "Violation Details", "Violation", [
    ["Date", mapDates_(fields["violation_date[]"])],
    ["Offense", fields["violation_offense[]"]],
    ["Location", fields["violation_place[]"]],
    ["Penalty", fields["violation_penalty[]"]]
  ]);

  appendRecentWorkHistory_(body, fields);
  appendEarlierWorkHistory_(body, fields);
}

function appendRecentWorkHistory_(body, fields) {
  var names = fields["recent_employer_name[]"];
  var max = arrayLength_(names);
  appendSectionTitle_(body, "Work History - Preceding Three Years", "Employment and safety-sensitive work entries supplied by the applicant.");
  if (!max) {
    appendLegalParagraph_(body, "No recent work-history entries were provided.");
    return;
  }
  for (var index = 0; index < max; index += 1) {
    appendQaTable_(body, "Recent work entry " + (index + 1), [
      ["Choose one", arrayValue_(fields["recent_entry_type[]"], index)],
      ["Employer / organization", arrayValue_(fields["recent_employer_name[]"], index)],
      ["Address", arrayValue_(fields["recent_employer_address[]"], index)],
      ["Start month", humanMonth_(arrayValue_(fields["recent_employment_start[]"], index))],
      ["Currently employed here?", yesNo_(indexedValue_(fields, "recent_current", index))],
      ["End month", humanMonth_(arrayValue_(fields["recent_employment_end[]"], index))],
      ["Reason for leaving", arrayValue_(fields["recent_reason_leaving[]"], index)],
      ["Do not contact this employer?", yesNo_(arrayValue_(fields["recent_do_not_contact[]"], index))],
      ["Do not contact explanation", arrayValue_(fields["recent_do_not_contact_explanation[]"], index)],
      ["Subject to FMCSR while employed?", yesNo_(indexedValue_(fields, "recent_fmcsr", index))],
      ["DOT drug/alcohol safety-sensitive position?", yesNo_(indexedValue_(fields, "recent_dot_sensitive", index))],
      ["Commercial motor vehicle driving?", yesNo_(indexedValue_(fields, "recent_cmv_driving", index))],
      ["Equipment operated", arrayValue_(fields["recent_experience_equipment[]"], index)],
      ["Nature of operation", arrayValue_(fields["recent_experience_nature[]"], index)],
      ["Approximate miles per week", arrayValue_(fields["recent_experience_miles_week[]"], index)]
    ]);
  }
}

function appendEarlierWorkHistory_(body, fields) {
  var names = fields["older_employer_name[]"];
  var max = arrayLength_(names);
  appendSectionTitle_(body, "Earlier Work History - CMV Only", "Commercial motor vehicle employers before the most recent three-year period.");
  if (!max) {
    appendLegalParagraph_(body, fields.older_cmv_employers_complete ? "Applicant indicated no additional earlier CMV employers were required." : "No earlier CMV work-history entries were provided.");
    return;
  }
  for (var index = 0; index < max; index += 1) {
    appendQaTable_(body, "Earlier CMV work entry " + (index + 1), [
      ["Employer", arrayValue_(fields["older_employer_name[]"], index)],
      ["Address", arrayValue_(fields["older_employer_address[]"], index)],
      ["Start month", humanMonth_(arrayValue_(fields["older_employment_start[]"], index))],
      ["End month", humanMonth_(arrayValue_(fields["older_employment_end[]"], index))],
      ["Reason for leaving", arrayValue_(fields["older_reason_leaving[]"], index)],
      ["Do not contact this employer?", yesNo_(arrayValue_(fields["older_do_not_contact[]"], index))],
      ["Do not contact explanation", arrayValue_(fields["older_do_not_contact_explanation[]"], index)],
      ["Equipment operated", arrayValue_(fields["older_experience_equipment[]"], index)],
      ["Nature of operation", arrayValue_(fields["older_experience_nature[]"], index)],
      ["Approximate miles per week", arrayValue_(fields["older_experience_miles_week[]"], index)]
    ]);
  }
}

function appendQaSection_(body, title, rows) {
  appendSectionTitle_(body, title, "");
  appendQaTable_(body, null, rows);
}

function appendRepeatedQaSection_(body, title, itemLabel, columns) {
  var max = 0;
  columns.forEach(function(column) { max = Math.max(max, arrayLength_(column[1])); });
  if (!max) return;
  appendSectionTitle_(body, title, "");
  for (var index = 0; index < max; index += 1) {
    var rows = columns.map(function(column) {
      return [column[0], arrayValue_(column[1], index)];
    });
    appendQaTable_(body, itemLabel + " " + (index + 1), rows);
  }
}

function appendQaTable_(body, label, rows) {
  if (label) {
    var paragraph = body.appendParagraph(label);
    styleText_(paragraph, 8, true, "#000000");
    paragraph.setSpacingBefore(4).setSpacingAfter(1);
  }
  var tableRows = rows
    .filter(function(row) { return answer_(row[1]) !== "Not provided"; })
    .map(function(row) { return [row[0], answer_(row[1])]; });
  if (!tableRows.length) {
    appendLegalParagraph_(body, "No entries provided.");
    return;
  }
  styleTable_(body.appendTable(tableRows), false);
}

function documentVersion_(definition, audit) {
  return scalar_((audit.documentVersions || {})[definition.versionKey]) || ("sigma-dqf-" + SIGMA_CONFIG.schemaVersion);
}

function documentDigest_(definition, audit) {
  return scalar_((audit.documentDigests || {})[definition.versionKey]) ||
    hexDigest_(JSON.stringify({ title: definition.title, version: documentVersion_(definition, audit), paragraphs: definition.paragraphs }));
}

function answer_(value) {
  var text = scalar_(value).trim();
  if (!text) return "Not provided";
  if (text === "TRUE") return "Yes";
  if (text === "FALSE") return "No";
  return text;
}

function yesNo_(value) {
  var text = scalar_(value).trim().toLowerCase();
  if (!text) return "";
  if (["yes", "true", "one_or_more", "current"].indexOf(text) !== -1) return "Yes";
  if (["no", "false", "none"].indexOf(text) !== -1) return "No";
  return scalar_(value);
}

function drivingAnswer_(value, noneText) {
  var text = scalar_(value).trim().toLowerCase();
  if (!text) return "";
  if (text === "none" || text === "no") return noneText;
  return scalar_(value);
}

function humanDate_(value) {
  var text = scalar_(value).trim();
  var match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[2] + "/" + match[3] + "/" + match[1] : text;
}

function humanMonth_(value) {
  var text = scalar_(value).trim();
  var match = text.match(/^(\d{4})-(\d{2})$/);
  return match ? match[2] + "/" + match[1] : text;
}

function humanDateTime_(value) {
  var text = scalar_(value).trim();
  if (!text) return "";
  return text.replace("T", " ").replace(/\.\d{3}Z$/, " UTC").replace(/Z$/, " UTC");
}

function mapDates_(values) {
  if (!Array.isArray(values)) return humanDate_(values);
  return values.map(function(value) { return humanDate_(value); });
}

function arrayLength_(value) {
  if (Array.isArray(value)) {
    for (var i = value.length - 1; i >= 0; i -= 1) if (scalar_(value[i]).trim()) return i + 1;
    return 0;
  }
  return scalar_(value).trim() ? 1 : 0;
}

function indexedValue_(fields, prefix, index) {
  if (fields[prefix + String(index + 1)] !== undefined) return fields[prefix + String(index + 1)];
  var explicit = fields[prefix + index];
  if (explicit !== undefined) return explicit;
  return fields[prefix + "INDEX__"];
}

function appendPacketSection_(body, title, rows) {
  body.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendTable([["Question / Field", "Answer"]].concat(rows.map(function(row) {
    return [row[0], scalar_(row[1]) || "Not provided"];
  })));
}

function appendRepeatedSection_(body, title, columns) {
  body.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  var max = 0;
  columns.forEach(function(column) {
    var value = column[1];
    max = Math.max(max, Array.isArray(value) ? value.length : (value ? 1 : 0));
  });
  if (!max) {
    body.appendParagraph("No entries provided.");
    return;
  }
  var tableRows = [["Entry", "Question / Field", "Answer"]];
  for (var index = 0; index < max; index += 1) {
    columns.forEach(function(column) {
      tableRows.push([String(index + 1), column[0], scalar_(arrayValue_(column[1], index)) || "Not provided"]);
    });
  }
  body.appendTable(tableRows);
}

function indexedRadioValues_(fields, prefix) {
  var result = [];
  Object.keys(fields).forEach(function(name) {
    if (name.indexOf(prefix) === 0) result.push(fields[name]);
  });
  return result;
}

function sendNotification_(action, fields, folder, applicationId, uploads, signedPacket) {
  var recipient = "dispatch@sstransco.com";
  var applicant = [fields.legal_first_name, fields.legal_last_name].filter(Boolean).join(" ") || "Pending applicant";
  var subject = "[Driver application] " + (action === "submit" ? "Submitted" : "Saved") + " — " + applicant;
  var lines = [
    "Status: " + (action === "submit" ? "Submitted" : "Saved for later"),
    "Applicant: " + applicant,
    "Application ID: " + applicationId,
    "Folder: " + folder.getUrl(),
    "Files received in this event: " + uploads.length
  ];
  if (signedPacket) lines.push("Signed packet: " + signedPacket.url, "Audit ID: " + signedPacket.auditId);
  if (signedPacket && signedPacket.forms) lines.push("Signed form PDFs: " + signedPacket.forms.length);
  if (signedPacket && signedPacket.printablePacket) lines.push("Printable packet: " + signedPacket.printablePacket.url);
  lines.push("", "This notification intentionally excludes SSN, license number, date of birth, and medical details.");
  MailApp.sendEmail({ to: recipient, subject: subject, body: lines.join("\n"), name: SIGMA_CONFIG.companyName });
}

function readFields_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName("fields");
  if (!sheet || sheet.getLastRow() < 2) return {};
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  var result = {};
  var counts = {};
  rows.forEach(function(row) {
    var name = String(row[0]);
    var occurrence = Number(row[1]) || 1;
    var value = normalizeFieldValue_(name, row[2]);
    counts[name] = Math.max(counts[name] || 0, occurrence);
    if (occurrence > 1 || /\[\]$/.test(name)) {
      if (!Array.isArray(result[name])) result[name] = [];
      result[name][occurrence - 1] = value;
    } else {
      result[name] = value;
    }
  });
  return result;
}

function readLatestAudit_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName("audit_log");
  if (!sheet || sheet.getLastRow() < 2) return {};
  var row = sheet.getRange(sheet.getLastRow(), 1, 1, Math.max(sheet.getLastColumn(), 6)).getValues()[0];
  return {
    clientTimestamp: row[3] || "",
    timezone: row[4] || "",
    userAgent: row[5] || "",
    documentVersions: {},
    documentDigests: {}
  };
}

function normalizeFieldValue_(name, value) {
  if (Object.prototype.toString.call(value) !== "[object Date]") return value;
  var format = /(^|_)(start|end)$/.test(name) ? "yyyy-MM" : "yyyy-MM-dd";
  return Utilities.formatDate(value, "America/Chicago", format);
}

function readUploadSummary_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName("uploads");
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 2, sheet.getLastRow() - 1, 5).getValues().map(function(row) {
    return { field: row[0], occurrence: row[1], name: row[2], fileId: row[3], url: row[4] };
  });
}

function readMetadataValue_(spreadsheet, key) {
  var sheet = spreadsheet.getSheetByName("metadata");
  if (!sheet || sheet.getLastRow() < 2) return "";
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < rows.length; i += 1) if (rows[i][0] === key) return rows[i][1];
  return "";
}

function makeApplicationId_() {
  return "SIG-" + Utilities.formatDate(new Date(), "America/Chicago", "yyyyMMdd") + "-" + Utilities.getUuid().slice(0, 8).toUpperCase();
}

function cleanName_(value) {
  return String(value || "").normalize("NFKD").replace(/[^\w\- ]/g, "").trim() || "PENDING";
}

function sanitizeFileName_(value) {
  return String(value || "document").replace(/[\/\\:*?"<>|]/g, "_").slice(0, 180);
}

function scalar_(value) {
  if (value === true) return "TRUE";
  if (value === false) return "FALSE";
  if (value === null || value === undefined) return "";
  return String(value);
}

function hexDigest_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(function(byte) { return ("0" + (byte & 255).toString(16)).slice(-2); }).join("");
}

function validateOrigin_(requested) {
  var configured = PropertiesService.getScriptProperties().getProperty("ALLOWED_APPLICATION_ORIGINS") ||
    "https://sstransco.com,https://www.sstransco.com";
  var allowed = configured.split(",").map(function(item) { return item.trim(); }).filter(Boolean);
  var origin = String(requested || "");
  if (allowed.indexOf(origin) === -1) throw new Error("Application origin is not allowed.");
  return origin;
}

function messageResponse_(data, targetOrigin) {
  var json = JSON.stringify(Object.assign({ namespace: "sigma-driver-application" }, data))
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return HtmlService.createHtmlOutput(
    "<!doctype html><meta charset=\"utf-8\"><script>window.top.postMessage(" + json + "," +
    JSON.stringify(targetOrigin) + ");<\/script>"
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
