from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


OUT = Path("test-artifacts/tibbs-test-2026-07-27/human-readable-drive-pdfs")
OUT.mkdir(parents=True, exist_ok=True)

COMPANY = "Sigma Squared Transport Corporation"
CARRIER_ADDRESS = "1101 N Cleveland Ave Apt 14, Sioux Falls, SD 57103"
USDOT = "4473629"
APP_ID = "SIG-20260727-2D030E33"
AUDIT = {
    "client_timestamp": "2026-07-27T08:55:00.000Z",
    "recorded_timestamp": "2026-07-27T09:45:55.957Z",
    "timezone": "America/Chicago",
    "user_agent": "Codex automated browser test; mobile viewport 390x844",
}
AUDIT_ID = "regen-" + hashlib.sha256((APP_ID + AUDIT["recorded_timestamp"]).encode()).hexdigest()[:24]

FIELDS = {
    "application_date": "2026-07-01",
    "application_id": APP_ID,
    "certification": "TRUE",
    "clearinghouse_limited_query_consent": "TRUE",
    "cmv_disqualified": "no",
    "current_address_city": "Evansville",
    "current_address_postal": "82636",
    "current_address_start": "2023-06",
    "current_address_state": "WY",
    "current_address_street": "4901 Lathrop Rd #7",
    "date_of_birth": "1980-01-15",
    "esign_consent": "TRUE",
    "fcra_authorization": "TRUE",
    "fcra_disclosure_receipt": "TRUE",
    "form_submission_date": "2026-07-27",
    "form_submitted_at_utc": "2026-07-27T09:45:53.949Z",
    "legal_first_name": "TEST",
    "legal_last_name": "USER",
    "legal_middle_name": "M",
    "license_action_attestation": "no",
    "license_action_details": "",
    "license_class": "AM",
    "license_endorsements": "T, X",
    "license_expiration_date": "2029-05-06",
    "license_issue_date": "2024-05-16",
    "license_number": "TEST-CDL-112148135",
    "license_restrictions": "B",
    "license_state": "WY",
    "medical_card_expiration": "2028-03-02",
    "mvr_authorization": "TRUE",
    "older_cmv_employers_complete": "TRUE",
    "other_unexpired_license": "no",
    "psp_authorization": "TRUE",
    "qualification_details": "",
    "recent_cmv_driving1": "yes",
    "recent_current1": "yes",
    "recent_dot_sensitive1": "yes",
    "recent_employer_address[]": ["1101 N Cleveland Ave Apt 14, Sioux Falls, SD 57103"],
    "recent_employer_name[]": ["Sigma Test Carrier"],
    "recent_employment_end[]": [""],
    "recent_employment_start[]": ["2023-06"],
    "recent_entry_type[]": ["employer"],
    "recent_experience_equipment[]": ["Truck tractor and semitrailer"],
    "recent_experience_miles_week[]": ["2500"],
    "recent_experience_nature[]": ["Interstate non-excepted"],
    "recent_fmcsr1": "yes",
    "recent_reason_leaving[]": [""],
    "rights_acknowledgment": "TRUE",
    "sap_rtd_notes": "",
    "signature_date": "2026-07-01",
    "signature_name": "TEST USER",
    "ssn": "555-01-2626",
    "violation_attestation": "none",
    "accident_attestation": "none",
}

CONSENTS = [
    (
        "application_certification",
        "Application Certification",
        "applicationCertification",
        "certification",
        [
            "This certifies that this application was completed by me, and that all entries on it and information in it are true and complete to the best of my knowledge.",
        ],
    ),
    (
        "driver_rights",
        "Driver Safety-Performance History Rights",
        "driverRights",
        "rights_acknowledgment",
        [
            "If you had Department of Transportation-regulated employment during the preceding three years, Sigma Squared Transport Corporation will investigate information provided by prior employers.",
            "You have the right to review information provided by prior employers, have errors corrected by the prior employer and re-sent to Sigma Squared, and have a rebuttal statement attached if you and the prior employer cannot agree on accuracy.",
            "You may submit a written review request while applying, or as late as 30 days after you are employed or notified that employment was denied. Send requests to dispatch@sstransco.com.",
        ],
    ),
    (
        "fcra_disclosure",
        "FCRA Consumer-Report Disclosure",
        "fcraDisclosure",
        "fcra_disclosure_receipt",
        [
            "Sigma Squared Transport Corporation may obtain a consumer report about you for employment purposes, including to evaluate you for employment, reassignment, promotion, or retention.",
            "A consumer report may include information about your driving record, criminal history, employment history, education or license verification, public records, identity and Social Security number validation, and other lawful background information.",
            "This document is the disclosure. It is not an authorization, release of claims, or waiver of rights.",
        ],
    ),
    (
        "background_check_authorization",
        "Background-Check Authorization",
        "fcraAuthorization",
        "fcra_authorization",
        [
            "I authorize Sigma Squared Transport Corporation and its authorized consumer reporting agencies or screening providers to obtain consumer reports and investigative consumer reports about me for employment purposes.",
            "I authorize lawful sources to provide information needed to prepare those reports, including identity and Social Security number verification, employment and education verification, motor-vehicle and licensing records, criminal and public records, and other information described in the separate disclosure I received.",
        ],
    ),
    (
        "mvr_cdlis_authorization",
        "MVR and CDLIS Authorization",
        "mvrCdlisAuthorization",
        "mvr_authorization",
        [
            "I authorize Sigma Squared Transport Corporation and its authorized agents to request, obtain, and review my motor-vehicle records and commercial-driver licensing information from each State driver licensing agency where I held or hold a license or permit during the preceding three years, and from CDLIS, as permitted by law.",
            "This authorization is for commercial-driver employment verification, driver qualification, and safety-compliance purposes, including the initial inquiry required by 49 CFR 391.23 and lawful periodic inquiries during employment.",
        ],
    ),
    (
        "psp_authorization",
        "PSP Disclosure and Authorization",
        "pspDisclosureAuthorization",
        "psp_authorization",
        [
            "In connection with your application for employment with Sigma Squared Transport Corporation, the Prospective Employer, its employees, agents or contractors may obtain one or more reports regarding your driving and safety inspection history from the Federal Motor Carrier Safety Administration.",
            "The Prospective Employer cannot obtain background reports from FMCSA without your authorization.",
            "I authorize Sigma Squared Transport Corporation to access the FMCSA Pre-Employment Screening Program system to seek information regarding my commercial driving safety record and safety inspection history, including crash data from the previous five years and inspection history from the previous three years.",
            "I understand I may challenge the accuracy of data by submitting a request to https://dataqs.fmcsa.dot.gov.",
        ],
    ),
    (
        "electronic_signature_consent",
        "Electronic Records and Signature Consent",
        "electronicSignatureConsent",
        "esign_consent",
        [
            "You may receive, review, sign, and retain application records and disclosures electronically. Your electronic signature has the same intended effect as a handwritten signature.",
            "This consent applies to the driver application, disclosures, authorizations, acknowledgments, and related hiring records delivered in this process.",
            "You may request paper copies at no charge by contacting dispatch@sstransco.com or (605) 650-3870.",
        ],
    ),
    (
        "clearinghouse_limited_query_consent",
        "Clearinghouse Limited-Query Consent",
        "clearinghouseLimitedQueryConsent",
        "clearinghouse_limited_query_consent",
        [
            "I authorize Sigma Squared Transport Corporation to conduct limited queries of the FMCSA Drug and Alcohol Clearinghouse as required or permitted by 49 CFR part 382.",
            "A limited query tells the employer whether information exists in my Clearinghouse record, but does not release the detailed record.",
            "I understand Sigma Squared must send a separate pre-employment full-query request through the Clearinghouse after this application is submitted, and that I must provide specific electronic consent in the Clearinghouse before detailed information can be released for that full query.",
        ],
    ),
]


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="Fine", parent=styles["Normal"], fontName="Helvetica", fontSize=6.8, leading=8, textColor=colors.HexColor("#555555")))
styles.add(ParagraphStyle(name="Small", parent=styles["Normal"], fontName="Helvetica", fontSize=8, leading=9.3))
styles.add(ParagraphStyle(name="Legal", parent=styles["Normal"], fontName="Times-Roman", fontSize=8.4, leading=9.8, spaceAfter=4))
styles.add(ParagraphStyle(name="TitleOfficial", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=13, leading=15, alignment=TA_CENTER, spaceAfter=1))
styles.add(ParagraphStyle(name="Company", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9.4, leading=11, alignment=TA_CENTER, spaceAfter=0))
styles.add(ParagraphStyle(name="SubtleCenter", parent=styles["Fine"], alignment=TA_CENTER, spaceAfter=6))
styles.add(ParagraphStyle(name="Section", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9, leading=10, spaceBefore=8, spaceAfter=2))
styles.add(ParagraphStyle(name="BlueSig", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9, leading=11, textColor=colors.HexColor("#1F4E79")))


def clean(v):
    if isinstance(v, list):
        return ", ".join(clean(x) for x in v if clean(x))
    if v is True or str(v).upper() == "TRUE":
        return "Yes"
    if v is False or str(v).upper() == "FALSE":
        return "No"
    text = "" if v is None else str(v).strip()
    return text or "Not provided"


def yn(v):
    text = str(v or "").strip().lower()
    if text in {"yes", "true"}:
        return "Yes"
    if text in {"no", "none", "false"}:
        return "No"
    return clean(v)


def hdate(v):
    text = str(v or "")
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return f"{text[5:7]}/{text[8:10]}/{text[0:4]}"
    return clean(v)


def hmonth(v):
    text = str(v or "")
    if len(text) == 7 and text[4] == "-":
        return f"{text[5:7]}/{text[0:4]}"
    return clean(v)


def applicant_name():
    return " ".join(x for x in [FIELDS["legal_first_name"], FIELDS["legal_middle_name"], FIELDS["legal_last_name"]] if x)


def consent_digest(consent):
    payload = json.dumps({"title": consent[1], "version": "sigma-dqf-2.0.0", "paragraphs": consent[4]}, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()


PACKET_DIGEST = hashlib.sha256(json.dumps({"fields": FIELDS, "consents": [(c[0], consent_digest(c)) for c in CONSENTS]}, sort_keys=True).encode()).hexdigest()


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 6.5)
    canvas.setFillColor(colors.HexColor("#555555"))
    canvas.drawString(0.55 * inch, 0.33 * inch, f"{COMPANY} | Application {APP_ID} | Packet SHA-256 {PACKET_DIGEST[:32]}...")
    canvas.drawRightString(7.95 * inch, 0.33 * inch, f"Page {doc.page}")
    canvas.restoreState()


def doc_template(path):
    doc = SimpleDocTemplate(str(path), pagesize=letter, rightMargin=0.52 * inch, leftMargin=0.52 * inch, topMargin=0.48 * inch, bottomMargin=0.52 * inch)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
    doc.addPageTemplates([PageTemplate(id="official", frames=[frame], onPage=footer)])
    return doc


def p(text, style="Small"):
    return Paragraph(str(text), styles[style])


def header(title, subtitle):
    return [
        p(COMPANY.upper(), "Company"),
        p(title.upper(), "TitleOfficial"),
        p(f"{subtitle} | {CARRIER_ADDRESS} | USDOT {USDOT}", "SubtleCenter"),
        line(),
    ]


def line():
    return Table([[""]], colWidths=[7.45 * inch], rowHeights=[0.01 * inch], style=TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.7, colors.black), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))


def qa_table(rows, col_widths=(2.8 * inch, 4.65 * inch)):
    filtered = [(q, clean(a)) for q, a in rows if clean(a) != "Not provided"]
    if not filtered:
        filtered = [("No entries", "Not provided")]
    data = [[p(q, "Small"), p(a, "Small")] for q, a in filtered]
    return Table(data, colWidths=list(col_widths), style=TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#777777")),
        ("FONT", (0, 0), (-1, -1), "Helvetica", 8),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F2F2F2")),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))


def section(title, rows):
    return [p(title.upper(), "Section"), qa_table(rows), Spacer(1, 5)]


def verification_block(note=""):
    return [
        p("VERIFIED ELECTRONIC SIGNATURE", "Section"),
        qa_table([
            ("LOCK ID", AUDIT_ID),
            ("Signed as", f"<b><font color='#1F4E79'>{FIELDS['signature_name']}</font></b>"),
            ("Signature date", hdate(FIELDS["signature_date"])),
            ("Packet SHA-256", PACKET_DIGEST),
            ("Verification note", note),
        ]),
        Spacer(1, 5),
    ]


def application_story():
    story = []
    story += section("Applicant Information", [
        ("Application date", hdate(FIELDS["application_date"])),
        ("Full legal name", applicant_name()),
        ("Date of birth", hdate(FIELDS["date_of_birth"])),
        ("Social Security number", FIELDS["ssn"]),
        ("Form submission date", hdate(FIELDS["form_submission_date"])),
    ])
    story += section("Current Residence", [
        ("What is your current street address?", FIELDS["current_address_street"]),
        ("City", FIELDS["current_address_city"]),
        ("State", FIELDS["current_address_state"]),
        ("ZIP / postal code", FIELDS["current_address_postal"]),
        ("When did you begin living at this address?", hmonth(FIELDS["current_address_start"])),
    ])
    story += section("Current Commercial Driver License", [
        ("What state or licensing authority issued the current CDL?", FIELDS["license_state"]),
        ("What is the current CDL number?", FIELDS["license_number"]),
        ("What is the CDL class?", FIELDS["license_class"]),
        ("What endorsements are listed?", FIELDS["license_endorsements"]),
        ("What restrictions are listed?", FIELDS["license_restrictions"]),
        ("What is the CDL issue date?", hdate(FIELDS["license_issue_date"])),
        ("What is the CDL expiration date?", hdate(FIELDS["license_expiration_date"])),
        ("Do you hold any other unexpired license or permit?", yn(FIELDS["other_unexpired_license"])),
    ])
    story += section("Medical Examiner Certificate", [
        ("What is the medical-card expiration date?", hdate(FIELDS["medical_card_expiration"])),
    ])
    story += section("Driving Record", [
        ("Have you had any DOT-reportable accidents during the preceding three years?", "No accidents reported" if FIELDS["accident_attestation"] == "none" else FIELDS["accident_attestation"]),
        ("Have you had any non-parking traffic convictions or forfeitures during the preceding three years?", "No convictions or forfeitures reported" if FIELDS["violation_attestation"] == "none" else FIELDS["violation_attestation"]),
        ("Has any license, permit, or privilege to operate a motor vehicle ever been denied, revoked, or suspended?", yn(FIELDS["license_action_attestation"])),
        ("Have you ever been disqualified from operating a CMV, including a DOT drug/alcohol violation or SAP/return-to-duty issue?", yn(FIELDS["cmv_disqualified"])),
    ])
    story += section("Work History - Preceding Three Years", [
        ("Choose one", "Employed"),
        ("Employer / organization", FIELDS["recent_employer_name[]"][0]),
        ("Address", FIELDS["recent_employer_address[]"][0]),
        ("Start month", hmonth(FIELDS["recent_employment_start[]"][0])),
        ("Currently employed here?", yn(FIELDS["recent_current1"])),
        ("Subject to FMCSR while employed?", yn(FIELDS["recent_fmcsr1"])),
        ("DOT drug/alcohol safety-sensitive position?", yn(FIELDS["recent_dot_sensitive1"])),
        ("Commercial motor vehicle driving?", yn(FIELDS["recent_cmv_driving1"])),
        ("Equipment operated", FIELDS["recent_experience_equipment[]"][0]),
        ("Nature of operation", FIELDS["recent_experience_nature[]"][0]),
        ("Approximate miles per week", FIELDS["recent_experience_miles_week[]"][0]),
    ])
    story += section("Earlier Work History - CMV Only", [
        ("Earlier CMV employers", "Applicant indicated no additional earlier CMV employers were required."),
    ])
    return story


def consent_story(consent, full=True):
    file_key, title, _version_key, _field, paragraphs = consent
    digest = consent_digest(consent)
    story = []
    story += header(title, "Signed notice / authorization")
    story.append(p(f"Version sigma-dqf-2.0.0 | Document SHA-256 {digest}", "Fine"))
    story.append(Spacer(1, 5))
    story += section("Applicant and Application", [
        ("Applicant", applicant_name()),
        ("Application ID", APP_ID),
        ("Application date", hdate(FIELDS["application_date"])),
        ("Carrier", f"{COMPANY} | USDOT {USDOT}"),
    ])
    for paragraph in paragraphs:
        story.append(p(paragraph, "Legal"))
    story.append(Spacer(1, 3))
    story += verification_block("The applicant checked this authorization in the Review and Sign step.")
    story.append(p(f"Verification footer: {file_key} | Version sigma-dqf-2.0.0 | SHA-256 {digest}", "Fine"))
    return story


def combined_story(include_application=True):
    story = header("Driver Application and Consent Packet" if include_application else "Electronic Driver Application and Authorizations", "Driver qualification file copy")
    story += section("Packet Metadata", [
        ("Application ID", APP_ID),
        ("Applicant", applicant_name()),
        ("Application date", hdate(FIELDS["application_date"])),
        ("Submitted", AUDIT["recorded_timestamp"].replace("T", " ").replace("Z", " UTC")),
        ("Carrier", f"{COMPANY} | USDOT {USDOT}"),
    ])
    story += verification_block("This packet was generated from the driver application answers and electronically acknowledged consent text.")
    story += application_story()
    story.append(PageBreak())
    story.append(p("SIGNED CONSENTS AND NOTICES", "Section"))
    story.append(p("Applicant acknowledgments are shown in-line for printing. Individual signed PDFs are also saved in the Signed Forms folder.", "Fine"))
    for consent in CONSENTS:
        story.append(KeepTogether([
            p(consent[1].upper(), "Section"),
            p(f"Version sigma-dqf-2.0.0 | SHA-256 {consent_digest(consent)}", "Fine"),
            *[p(text, "Legal") for text in consent[4]],
            p(f"Checked and electronically signed by <b><font color='#1F4E79'>{FIELDS['signature_name']}</font></b> on {hdate(FIELDS['signature_date'])}.", "Small"),
            Spacer(1, 5),
        ]))
    story.append(PageBreak())
    story += section("Electronic Signature Audit Trail", [
        ("Signed by", f"<b><font color='#1F4E79'>{FIELDS['signature_name']}</font></b>"),
        ("Signature date", hdate(FIELDS["signature_date"])),
        ("Audit ID", AUDIT_ID),
        ("Content digest (SHA-256)", PACKET_DIGEST),
        ("Client timestamp", AUDIT["client_timestamp"]),
        ("Recorded timestamp", AUDIT["recorded_timestamp"]),
        ("Client timezone", AUDIT["timezone"]),
        ("User agent", AUDIT["user_agent"]),
    ])
    story += section("Carrier Review / Signature / Stamp", [
        ("Reviewed by", "____________________________________________"),
        ("Title", "____________________________________________"),
        ("Date", "____________________________________________"),
        ("Carrier signature or stamp", "\n\n\n"),
    ])
    return story


def build_pdf(path, story):
    doc_template(path).build(story)


def main():
    outputs = {}
    build_pdf(OUT / "USER,TEST_driver_application_consent_packet_SIGNED.pdf", combined_story(True))
    outputs["printable_packet"] = str(OUT / "USER,TEST_driver_application_consent_packet_SIGNED.pdf")
    build_pdf(OUT / "Signed_Application_and_Authorizations.pdf", combined_story(False))
    outputs["signed_packet"] = str(OUT / "Signed_Application_and_Authorizations.pdf")
    for consent in CONSENTS:
        file_key = consent[0]
        file_name = f"USER,TEST_{file_key}_SIGNED.pdf"
        build_pdf(OUT / file_name, consent_story(consent))
        outputs[file_key] = str(OUT / file_name)
    print(json.dumps(outputs, indent=2))


if __name__ == "__main__":
    main()
