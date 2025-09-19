#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Configuration
BEDROCK_ENABLED=${BEDROCK_ENABLED:-"true"}
BEDROCK_MODEL_ID=${BEDROCK_MODEL_ID:-"amazon.titan-text-express-v1"}
BEDROCK_REGION=${BEDROCK_REGION:-"us-east-1"}
BEDROCK_COST_THRESHOLD=${BEDROCK_COST_THRESHOLD:-"100"}
BEDROCK_RATE_LIMIT=${BEDROCK_RATE_LIMIT:-"10"}
BEDROCK_MAX_TOKENS=${BEDROCK_MAX_TOKENS:-"1000"}
BEDROCK_TEMPERATURE=${BEDROCK_TEMPERATURE:-"0.3"}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

echo "Testing Bedrock validation components..."

# Test model validation
echo "1. Testing model validation..."
case "$BEDROCK_MODEL_ID" in
    "amazon.titan-text-express-v1")
        print_success "Valid Bedrock model: $BEDROCK_MODEL_ID (Recommended)"
        ;;
    *)
        print_error "Invalid model: $BEDROCK_MODEL_ID"
        ;;
esac

# Test region validation
echo "2. Testing region validation..."
case "$BEDROCK_REGION" in
    "us-east-1")
        print_success "Bedrock region: $BEDROCK_REGION (Primary)"
        ;;
    *)
        print_error "Invalid region: $BEDROCK_REGION"
        ;;
esac

# Test numeric validations
echo "3. Testing numeric validations..."
if command -v bc >/dev/null 2>&1; then
    print_info "bc command found"
    
    # Cost threshold validation
    echo "Testing cost threshold: $BEDROCK_COST_THRESHOLD"
    if [[ ! "$BEDROCK_COST_THRESHOLD" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
        print_error "Cost threshold format invalid"
    elif (( $(echo "$BEDROCK_COST_THRESHOLD <= 0" | bc -l) )); then
        print_error "Cost threshold too low"
    else
        print_success "Cost threshold valid: $BEDROCK_COST_THRESHOLD"
    fi
    
    # Temperature validation
    echo "Testing temperature: $BEDROCK_TEMPERATURE"
    if [[ ! "$BEDROCK_TEMPERATURE" =~ ^[0-9]*\.?[0-9]+$ ]]; then
        print_error "Temperature format invalid"
    elif (( $(echo "$BEDROCK_TEMPERATURE < 0 || $BEDROCK_TEMPERATURE > 1" | bc -l) )); then
        print_error "Temperature out of range"
    else
        print_success "Temperature valid: $BEDROCK_TEMPERATURE"
    fi
else
    print_error "bc command not found"
fi

# Test rate limit validation
echo "4. Testing rate limit validation..."
if [[ ! "$BEDROCK_RATE_LIMIT" =~ ^[0-9]+$ ]] || [[ "$BEDROCK_RATE_LIMIT" -le 0 ]]; then
    print_error "Invalid rate limit: $BEDROCK_RATE_LIMIT"
else
    print_success "Rate limit valid: $BEDROCK_RATE_LIMIT"
fi

# Test max tokens validation
echo "5. Testing max tokens validation..."
if [[ ! "$BEDROCK_MAX_TOKENS" =~ ^[0-9]+$ ]] || [[ "$BEDROCK_MAX_TOKENS" -le 0 ]]; then
    print_error "Invalid max tokens: $BEDROCK_MAX_TOKENS"
elif [[ "$BEDROCK_MAX_TOKENS" -gt 8000 ]]; then
    print_error "Max tokens too high: $BEDROCK_MAX_TOKENS"
else
    print_success "Max tokens valid: $BEDROCK_MAX_TOKENS"
fi

echo "Test completed successfully!"