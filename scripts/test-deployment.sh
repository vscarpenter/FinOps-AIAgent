#!/usr/bin/env bash

set -euo pipefail

# Test the deployed Spend Monitor Lambda by temporarily lowering SPEND_THRESHOLD,
# invoking the function, checking logs for alert markers, and restoring env vars.

usage() {
  cat << EOF
Usage: $0 [options]

Options:
  -f, --function-name NAME   Lambda function name (overrides stack lookup)
  -s, --stack-name NAME      CloudFormation stack name (default: SpendMonitorStack)
  -r, --region REGION        AWS region (default: env or us-east-1)
  --since MINUTES            Minutes back for log scan (default: 10)
  --keep-threshold           Do not restore original SPEND_THRESHOLD
  -h, --help                 Show this help

Examples:
  $0 --stack-name SpendMonitorStack
  $0 --function-name SpendMonitorStack-SpendMonitorAgentV2-ABC123 --since 15
EOF
}

STACK_NAME=${STACK_NAME:-SpendMonitorStack}
REGION=${AWS_REGION:-${CDK_DEFAULT_REGION:-us-east-1}}
SINCE_MIN=10
KEEP_THRESHOLD=false
FN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--function-name)
      FN="$2"; shift 2;;
    -s|--stack-name)
      STACK_NAME="$2"; shift 2;;
    -r|--region)
      REGION="$2"; shift 2;;
    --since)
      SINCE_MIN="$2"; shift 2;;
    --keep-threshold)
      KEEP_THRESHOLD=true; shift;;
    -h|--help)
      usage; exit 0;;
    *)
      echo "Unknown option: $1" >&2; usage; exit 1;;
  esac
done

require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "[ERROR] Missing dependency: $1" >&2; exit 1; }; }

require_cmd aws
require_cmd jq

echo "[INFO] Region: $REGION"

# Resolve function name from stack output if not provided
if [[ -z "$FN" ]]; then
  echo "[INFO] Resolving Lambda function name from stack: $STACK_NAME"
  FN=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='AgentFunctionName'].OutputValue" \
    --output text)
fi

if [[ -z "$FN" || "$FN" == "None" ]]; then
  echo "[ERROR] Could not resolve Lambda function name. Use --function-name." >&2
  exit 1
fi

echo "[INFO] Testing Lambda: $FN"

TMP_DIR=$(mktemp -d)
ORIG_ENV_JSON="$TMP_DIR/orig-env.json"
MOD_ENV_JSON="$TMP_DIR/mod-env.json"
RESP_JSON="$TMP_DIR/response.json"

cleanup() {
  [[ -d "$TMP_DIR" ]] && rm -rf "$TMP_DIR" || true
}
trap cleanup EXIT

echo "[INFO] Fetching current environment variables..."
aws lambda get-function-configuration \
  --function-name "$FN" \
  --region "$REGION" \
  --query 'Environment.Variables' \
  --output json > "$ORIG_ENV_JSON"

CURRENT_THRESHOLD=$(jq -r '.SPEND_THRESHOLD // ""' "$ORIG_ENV_JSON")
echo "[INFO] Current SPEND_THRESHOLD: ${CURRENT_THRESHOLD:-<unset>}"

echo "[INFO] Setting SPEND_THRESHOLD to 0.01 for test..."
jq '.SPEND_THRESHOLD = "0.01"' "$ORIG_ENV_JSON" | jq '{Variables: .}' > "$MOD_ENV_JSON"
aws lambda update-function-configuration \
  --function-name "$FN" \
  --region "$REGION" \
  --environment file://"$MOD_ENV_JSON" >/dev/null

echo "[INFO] Invoking Lambda..."
aws lambda invoke \
  --function-name "$FN" \
  --region "$REGION" \
  --payload '{}' "$RESP_JSON" >/dev/null

echo "[INFO] Invocation result:"
cat "$RESP_JSON" || true
echo

echo "[INFO] Scanning logs for alert/threshold messages (last ${SINCE_MIN}m)..."
if aws logs tail /aws/lambda/spend-monitor-agent \
  --region "$REGION" \
  --since "${SINCE_MIN}m" \
  --filter-pattern 'Spending threshold exceeded|Alert sent successfully|Simplified alert sent successfully' \
  --format short >/dev/null 2>&1; then
  aws logs tail /aws/lambda/spend-monitor-agent \
    --region "$REGION" \
    --since "${SINCE_MIN}m" \
    --filter-pattern 'Spending threshold exceeded|Alert sent successfully|Simplified alert sent successfully' \
    --format short
else
  echo "[WARN] Could not tail logs (aws logs tail not supported); falling back to filter-log-events"
  START_MS=$(( ( $(date +%s) - (SINCE_MIN*60) ) * 1000 ))
  aws logs filter-log-events \
    --region "$REGION" \
    --log-group-name /aws/lambda/spend-monitor-agent \
    --start-time "$START_MS" \
    --query 'events[].message' \
    --output text | grep -E 'Spending threshold exceeded|Alert sent successfully|Simplified alert sent successfully' || true
fi

if [[ "$KEEP_THRESHOLD" != true ]]; then
  echo "[INFO] Restoring original SPEND_THRESHOLD (${CURRENT_THRESHOLD:-<unset>})..."
  jq '{Variables: .}' "$ORIG_ENV_JSON" > "$MOD_ENV_JSON"
  aws lambda update-function-configuration \
    --function-name "$FN" \
    --region "$REGION" \
    --environment file://"$MOD_ENV_JSON" >/dev/null
  echo "[INFO] Restoration complete."
else
  echo "[INFO] Keeping modified SPEND_THRESHOLD as requested."
fi

echo "[DONE] Deployment test completed."

