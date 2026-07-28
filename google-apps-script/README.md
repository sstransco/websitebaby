# Sigma driver-application save service

This Apps Script is the credential boundary between the public application page and the restricted Shared Drive. It runs as the deploying Google Workspace owner; no Google credential is placed in the website.

## Deploy

1. Create a standalone Apps Script project while signed in to the Sigma Google Workspace account that can write to the Shared Drive.
2. Copy `Code.gs` and `appsscript.json` into the project. In Project Settings, enable **Show `appsscript.json` manifest file in editor** if needed.
3. In **Project Settings → Script properties**, add:
   - `ADMIN_PREFILL_KEY`: a long, unique administrator prefill key.
   - `ALLOWED_APPLICATION_ORIGINS`: comma-separated exact origins; defaults to `https://sstransco.com,https://www.sstransco.com`.
4. Deploy as a **Web app**:
   - Execute as: **Me**
   - Who has access: the audience required for the public application (normally **Anyone**).
5. Copy the `/exec` deployment URL into `application-config.js` as `appsScriptUrl`.
6. Redeploy a new version after changing `Code.gs`.

## What the service creates

Under Shared Drive folder `04 Driver Qualification Files – Active and Pending` (`1wlZm1bQTmLEGYlwkjTUEnCAj4KjfpKvy`):

- `LASTNAME,FIRSTNAME/`
  - `application_data` Google Sheet with `fields`, `metadata`, `audit_log`, and `uploads` tabs
  - `Uploads/` with normalized, unambiguous year-first PDF filenames such as `DESHAVER,MARVIN_cdlfront_ISS_2024_01_02_EXP_2029_05_06.pdf`, `DESHAVER,MARVIN_cdlback_ISS_2024_01_02_EXP_2029_05_06.pdf`, `DESHAVER,MARVIN_medicalcard_EXP_2027_08_22.pdf`, and numbered prior-CDL files
  - `Signed_Application_and_Authorizations` Google Doc on submit
  - `Signed_Application_and_Authorizations.pdf` on submit
  - `Signed Forms/` with individual signed PDFs for application certification, notices, authorizations, PSP, electronic signature consent, and Clearinghouse limited-query consent. Each PDF includes the typed e-signature and audit trail.

Uploading a new file for the same document slot moves the prior Drive file to Trash and replaces its row in the `uploads` tab.

Every save/submit notification is hard-coded to `dispatch@sstransco.com` and excludes SSN, CDL number, birth date, and medical details.

## Production controls

- Restrict edit access on the target Shared Drive folder to Compliance administrators.
- Rotate `ADMIN_PREFILL_KEY` when an administrator leaves.
- Keep the Apps Script deployment owned by a managed service or continuity account.
- Add a bot-control token (for example Cloudflare Turnstile) before public advertising.
- Have transportation/employment counsel approve the final notices, signature ceremony, retention policy, and adverse-action workflow before production use.
