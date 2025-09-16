#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <lambda-function-name> [region]" >&2
  exit 1
fi

FUNCTION_NAME="$1"
REGION="${2:-${AWS_REGION:-${CDK_DEFAULT_REGION:-us-east-1}}}"

TMP_DIR="$(mktemp -d)"
ZIP_PATH="$TMP_DIR/code.zip"

echo "[INFO] Inspecting deployed Lambda bundle for: $FUNCTION_NAME (region: $REGION)"

if ! command -v aws >/dev/null 2>&1; then
  echo "[ERROR] AWS CLI not found. Please install and configure AWS CLI." >&2
  exit 1
fi

echo "[INFO] Fetching code location..."
CODE_URL=$(aws lambda get-function \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --query 'Code.Location' \
  --output text)

echo "[INFO] Downloading bundle to $ZIP_PATH ..."
curl -sSL "$CODE_URL" -o "$ZIP_PATH"

echo "[INFO] Unzipping..."
unzip -q "$ZIP_PATH" -d "$TMP_DIR/unzipped"

echo "[INFO] Searching for 'strands-agents' in deployed code..."
if rg -n "strands-agents" "$TMP_DIR/unzipped" >/dev/null 2>&1; then
  echo "[ERROR] Found unexpected 'strands-agents' reference in deployed bundle:"
  rg -n "strands-agents" "$TMP_DIR/unzipped" || true
  echo "[HINT] This indicates a stale artifact. Rebuild, resync dist -> fresh-deployment, and redeploy."
  exit 2
else
  echo "[OK] No references to 'strands-agents' found in deployed bundle."
fi

echo "[INFO] Sample top-level files:"
ls -la "$TMP_DIR/unzipped" | head -n 40

echo "[DONE] Inspection complete. Temp dir: $TMP_DIR"
echo "       Remove it with: rm -rf $TMP_DIR"

