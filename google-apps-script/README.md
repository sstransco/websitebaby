# Sigma driver-application save service

Apps Script backend and Drive automation for the native DOT driver application. It is the credential boundary between the public application page and the restricted `Sigma` Shared Drive — it runs as the deploying Workspace owner, so no Google credential ever lives in the website.

**Owner / deploy account: `admin@sstransco.com`.** The old `jbeutz@gmail.com` project is retired.

## Files (pushed by clasp)

- `Code.gs` — web app (`doGet`/`doPost`), save/submit/load/regenerate, admin prefill, MVR/PSP send, signed PDFs, and the proprietary **MVR Release Consent Form** with ESIGN/UETA audit trail.
- `Ingest.gs` — reverse flow: watches the `Applicants` folder, OCR-parses dragged-in CDL / medical-card / Lanefinder PDFs, prefills the application (manual drag-drop wins priority), standardizes filenames + folder names, and writes clickable "open form" links into Drive.
- `appsscript.json` — scopes, Advanced Drive service (v2), and web-app deployment settings.

## First deploy (clasp)

Prereqs: Node + `clasp` (`npm i -g @google/clasp`), and the **Apps Script API** turned on for `admin@sstransco.com` at <https://script.google.com/home/usersettings>.

```bash
clasp login                       # authenticate in the browser AS admin@sstransco.com
cd google-apps-script
clasp create --type standalone --title "Sigma Driver Application Service"
clasp push -f                     # uploads Code.gs, Ingest.gs, appsscript.json
clasp deploy --description "v1"   # creates the web-app /exec URL
```

Then, in the Apps Script editor for the new project:

1. **Project Settings → Script properties** — add `ADMIN_PREFILL_KEY` (a long random string). Run `initializeScriptProperties()` once to set `ALLOWED_APPLICATION_ORIGINS` and `SITE_APPLICATION_URL` defaults and confirm the key.
2. Run `createIngestTrigger()` once — approve the OAuth consent, then it installs the every-5-minute drag-drop watcher. (First run also enables the Drive API for the project if prompted.)
3. Copy the `clasp deploy` `/exec` URL into `../application-config.js` as `appsScriptUrl`.

Re-deploy after code changes: `clasp push -f && clasp deploy --description "vN"`.

## What it creates in Drive

Under the Shared Drive `Applicants` folder (`18HXcfD2LWVVcw4HL0n2i3vmtNVLfwfjZ`):

- `LASTNAME,FIRSTNAME/`
  - `application_data` Sheet (`fields`, `metadata`, `audit_log`, `uploads` tabs)
  - `Uploads/` — normalized PDFs, e.g. `DESHAZER,MARVIN_cdlfront_ISS_2024_01_02_EXP_2029_05_06.pdf`, `..._medicalcard_EXP_2027_08_22.pdf`
  - `Signed Forms/` — individual signed PDFs incl. `..._mvr_release_consent_SIGNED.pdf`
  - `▶ OPEN — First Last` Google Doc — clickable open / send-MVR / send-PSP links (no URL copy-paste)
- `⚡ Applicants — Open Links` Sheet at the folder root — one-click index of every applicant

## Reverse drag-drop flow

Drop a driver's CDL / medical card / Lanefinder PDFs into their folder under `Applicants` (create the folder if new). Within ~5 minutes (or run `ingestDriveDropIns()` manually) the service OCR-parses them, prefills the application, standardizes the filenames + folder name to `LASTNAME,FIRSTNAME`, and refreshes the open-links. Dragged data overrides any prior form data. Files already inside `Uploads/` are never re-processed.

## Admin delivery

Open the `▶ OPEN` link in an applicant's folder (or `apply.html?mode=admin`), enter `ADMIN_PREFILL_KEY`, confirm the driver's email, and choose:

- **Send incomplete application** — driver completes and signs personally.
- **Send MVR/CDLIS consent only** — emails a private link to the proprietary MVR Release Consent Form for the driver's own signature (produces the audit-trail PDF).
- **Send PSP consent only** — same, for the stand-alone PSP disclosure and authorization.

## Notes / controls

- Every save/submit/ingest notification is hard-coded to `dispatch@sstransco.com` and excludes SSN, CDL number, birth date, and medical details.
- Signer IP for the audit trail is captured best-effort client-side (ipify) only on submit/send; it shows "Not captured" if unavailable.
- Restrict Shared Drive edit access to Compliance admins; rotate `ADMIN_PREFILL_KEY` when an admin leaves.
- Have transportation/employment counsel approve the final notices, signature ceremony, and retention before production use.
