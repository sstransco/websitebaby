#!/bin/sh
set -eu

SOURCE_DIR="/Users/john/Documents/Codex/2026-07-25/dot-application/outputs/Sigma_Squared_DOT_Packet"
TARGET_DIR="/Users/john/Documents/GitHub/websitebaby/documents"

cp "$SOURCE_DIR/02_FCRA_Consumer_Report_Disclosure.pdf" "$TARGET_DIR/FCRA_Consumer_Report_Disclosure.pdf"
cp "$SOURCE_DIR/05_Background_Check_Authorization.pdf" "$TARGET_DIR/FCRA_Background_Check_Authorization.pdf"
cp "$SOURCE_DIR/06_PSP_Driving_Record_Disclosure_and_Authorization.pdf" "$TARGET_DIR/PSP_Authorization.pdf"
cp "$SOURCE_DIR/07_CDLIS_and_MVR_Consent.pdf" "$TARGET_DIR/MVR_CDLIS_Consent.pdf"
cp "$SOURCE_DIR/08_Electronic_Signature_Consent.pdf" "$TARGET_DIR/Electronic_Signature_Consent.pdf"
cp "$SOURCE_DIR/09_Driver_Rights_Safety_Performance_History.pdf" "$TARGET_DIR/Driver_Rights_Safety_Performance_History.pdf"
