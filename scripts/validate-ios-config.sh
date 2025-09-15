#!/bin/bash

# AWS Spend Monitor - iOS Configuration Validation Script
# This script validates the iOS push notification configuration

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_ROOT/.ios-config"
ENV_FILE="$PROJECT_ROOT/.env.ios"

# Validation results
VALIDATION_ERRORS=0
VALIDATION_WARNINGS=0

# Functions
print_header() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE} iOS Configuration Validation${NC}"
    echo -e "${BLUE}================================${NC}"
    echo
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
    ((VALIDATION_ERRORS++))
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
    ((VALIDATION_WARNINGS++))
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

check_prerequisites() {
    print_info "Checking prerequisites..."
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed"
        return 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "AWS credentials not configured"
        return 1
    fi
    
    # Check jq for JSON parsing
    if ! command -v jq &> /dev/null; then
        print_warning "jq is not installed - some validations will be skipped"
    fi
    
    print_success "Prerequisites check passed"
}

load_configuration() {
    print_info "Loading configuration..."
    
    # Load from config file
    if [[ -f "$CONFIG_FILE" ]]; then
        source "$CONFIG_FILE"
        print_success "Loaded configuration from $CONFIG_FILE"
    else
        print_warning "Configuration file not found: $CONFIG_FILE"
    fi
    
    # Load from environment file
    if [[ -f "$ENV_FILE" ]]; then
        source "$ENV_FILE"
        print_success "Loaded environment variables from $ENV_FILE"
    else
        print_warning "Environment file not found: $ENV_FILE"
    fi
    
    # Check for environment variables
    if [[ -n "$IOS_PLATFORM_APP_ARN" ]]; then
        PLATFORM_APP_ARN="$IOS_PLATFORM_APP_ARN"
    fi
    
    if [[ -n "$IOS_BUNDLE_ID" ]]; then
        BUNDLE_ID="$IOS_BUNDLE_ID"
    fi
}

validate_configuration_variables() {
    print_info "Validating configuration variables..."
    
    # Check required variables
    if [[ -z "$PLATFORM_APP_ARN" ]]; then
        print_error "Platform Application ARN not configured"
    else
        print_success "Platform Application ARN: $PLATFORM_APP_ARN"
    fi
    
    if [[ -z "$BUNDLE_ID" ]]; then
        print_error "Bundle ID not configured"
    else
        print_success "Bundle ID: $BUNDLE_ID"
        
        # Validate bundle ID format
        if [[ ! "$BUNDLE_ID" =~ ^[a-zA-Z0-9.-]+\.[a-zA-Z0-9.-]+$ ]]; then
            print_warning "Bundle ID format may be invalid: $BUNDLE_ID"
        fi
    fi
    
    if [[ -z "$AWS_REGION" ]]; then
        print_warning "AWS Region not configured, using default"
        AWS_REGION="us-east-1"
    else
        print_success "AWS Region: $AWS_REGION"
    fi
    
    # Check optional variables
    if [[ -n "$APNS_SANDBOX" ]]; then
        print_success "APNS Sandbox mode: $APNS_SANDBOX"
    else
        print_warning "APNS Sandbox mode not specified"
    fi
}

validate_platform_application() {
    print_info "Validating SNS Platform Application..."
    
    if [[ -z "$PLATFORM_APP_ARN" ]]; then
        print_error "Cannot validate platform application - ARN not provided"
        return 1
    fi
    
    # Check if platform application exists
    PLATFORM_ATTRS=$(aws sns get-platform-application-attributes \
        --region "$AWS_REGION" \
        --platform-application-arn "$PLATFORM_APP_ARN" \
        --output json 2>/dev/null)
    
    if [[ $? -eq 0 ]]; then
        print_success "Platform application exists and is accessible"
        
        if command -v jq &> /dev/null; then
            # Check if enabled
            ENABLED=$(echo "$PLATFORM_ATTRS" | jq -r '.Attributes.Enabled // "true"')
            if [[ "$ENABLED" == "true" ]]; then
                print_success "Platform application is enabled"
            else
                print_error "Platform application is disabled"
            fi
            
            # Check platform type
            PLATFORM=$(echo "$PLATFORM_ATTRS" | jq -r '.Attributes.Platform // "unknown"')
            print_success "Platform type: $PLATFORM"
            
            # Check success feedback role (optional)
            SUCCESS_ROLE=$(echo "$PLATFORM_ATTRS" | jq -r '.Attributes.SuccessFeedbackRoleArn // "not configured"')
            if [[ "$SUCCESS_ROLE" != "not configured" ]]; then
                print_success "Success feedback role configured"
            else
                print_warning "Success feedback role not configured"
            fi
            
            # Check failure feedback role (optional)
            FAILURE_ROLE=$(echo "$PLATFORM_ATTRS" | jq -r '.Attributes.FailureFeedbackRoleArn // "not configured"')
            if [[ "$FAILURE_ROLE" != "not configured" ]]; then
                print_success "Failure feedback role configured"
            else
                print_warning "Failure feedback role not configured"
            fi
        fi
    else
        print_error "Platform application not found or not accessible: $PLATFORM_APP_ARN"
    fi
}

validate_iam_permissions() {
    print_info "Validating IAM permissions..."
    
    # Get current identity
    IDENTITY=$(aws sts get-caller-identity --output json 2>/dev/null)
    if [[ $? -eq 0 ]]; then
        if command -v jq &> /dev/null; then
            USER_ARN=$(echo "$IDENTITY" | jq -r '.Arn')
            print_success "Current identity: $USER_ARN"
        fi
    else
        print_error "Cannot get current AWS identity"
        return 1
    fi
    
    # Test SNS permissions
    print_info "Testing SNS permissions..."
    
    # Test list platform applications
    if aws sns list-platform-applications --region "$AWS_REGION" --output json &>/dev/null; then
        print_success "Can list platform applications"
    else
        print_error "Cannot list platform applications - check SNS permissions"
    fi
    
    # Test get platform application attributes (if ARN provided)
    if [[ -n "$PLATFORM_APP_ARN" ]]; then
        if aws sns get-platform-application-attributes \
            --region "$AWS_REGION" \
            --platform-application-arn "$PLATFORM_APP_ARN" \
            --output json &>/dev/null; then
            print_success "Can get platform application attributes"
        else
            print_error "Cannot get platform application attributes"
        fi
    fi
    
    # Test create endpoint (dry run - we'll use a fake token)
    if [[ -n "$PLATFORM_APP_ARN" ]]; then
        FAKE_TOKEN="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        TEST_ENDPOINT=$(aws sns create-platform-endpoint \
            --region "$AWS_REGION" \
            --platform-application-arn "$PLATFORM_APP_ARN" \
            --token "$FAKE_TOKEN" \
            --custom-user-data "validation-test" \
            --output text --query 'EndpointArn' 2>/dev/null)
        
        if [[ $? -eq 0 && -n "$TEST_ENDPOINT" ]]; then
            print_success "Can create platform endpoints"
            
            # Clean up test endpoint
            aws sns delete-endpoint \
                --region "$AWS_REGION" \
                --endpoint-arn "$TEST_ENDPOINT" &>/dev/null
        else
            print_warning "Cannot create platform endpoints - may need additional permissions"
        fi
    fi
}

validate_certificate_expiration() {
    print_info "Checking certificate expiration..."
    
    if [[ -z "$PLATFORM_APP_ARN" ]]; then
        print_warning "Cannot check certificate expiration - platform ARN not provided"
        return 0
    fi
    
    # This is a basic check - AWS doesn't expose certificate details directly
    # We can only check if the platform application is working
    if aws sns get-platform-application-attributes \
        --region "$AWS_REGION" \
        --platform-application-arn "$PLATFORM_APP_ARN" \
        --output json &>/dev/null; then
        print_success "Platform application is responding (certificate likely valid)"
    else
        print_error "Platform application not responding (certificate may be expired)"
    fi
    
    print_warning "Note: Certificate expiration date cannot be checked directly through AWS API"
    print_info "Check your Apple Developer account for certificate expiration dates"
}

validate_network_connectivity() {
    print_info "Validating network connectivity..."
    
    # Test AWS SNS endpoint connectivity
    if curl -s --connect-timeout 5 "https://sns.$AWS_REGION.amazonaws.com" > /dev/null; then
        print_success "Can connect to AWS SNS endpoint"
    else
        print_error "Cannot connect to AWS SNS endpoint"
    fi
    
    # Test Apple APNS connectivity (sandbox)
    if curl -s --connect-timeout 5 "https://api.sandbox.push.apple.com" > /dev/null; then
        print_success "Can connect to APNS sandbox"
    else
        print_warning "Cannot connect to APNS sandbox"
    fi
    
    # Test Apple APNS connectivity (production)
    if curl -s --connect-timeout 5 "https://api.push.apple.com" > /dev/null; then
        print_success "Can connect to APNS production"
    else
        print_warning "Cannot connect to APNS production"
    fi
}

test_device_token_validation() {
    print_info "Testing device token validation..."
    
    # Test valid token format
    VALID_TOKEN="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    if [[ ${#VALID_TOKEN} -eq 64 && "$VALID_TOKEN" =~ ^[0-9a-fA-F]+$ ]]; then
        print_success "Device token validation logic works for valid tokens"
    else
        print_error "Device token validation logic failed"
    fi
    
    # Test invalid token formats
    INVALID_TOKENS=(
        "short"
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefg"  # invalid char
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde"   # too short
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0" # too long
    )
    
    for token in "${INVALID_TOKENS[@]}"; do
        if [[ ${#token} -eq 64 && "$token" =~ ^[0-9a-fA-F]+$ ]]; then
            print_error "Device token validation failed to reject invalid token: $token"
        else
            print_success "Device token validation correctly rejected: ${token:0:20}..."
        fi
    done
}

validate_lambda_configuration() {
    print_info "Validating Lambda function configuration..."
    
    # Try to find the Lambda function
    FUNCTION_NAMES=("spend-monitor-agent" "aws-spend-monitor" "SpendMonitorAgent")
    FUNCTION_FOUND=""
    
    for func_name in "${FUNCTION_NAMES[@]}"; do
        if aws lambda get-function-configuration \
            --region "$AWS_REGION" \
            --function-name "$func_name" \
            --output json &>/dev/null; then
            FUNCTION_FOUND="$func_name"
            break
        fi
    done
    
    if [[ -n "$FUNCTION_FOUND" ]]; then
        print_success "Found Lambda function: $FUNCTION_FOUND"
        
        # Check environment variables
        if command -v jq &> /dev/null; then
            ENV_VARS=$(aws lambda get-function-configuration \
                --region "$AWS_REGION" \
                --function-name "$FUNCTION_FOUND" \
                --query 'Environment.Variables' \
                --output json)
            
            # Check for iOS-related environment variables
            if echo "$ENV_VARS" | jq -e '.IOS_PLATFORM_APP_ARN' &>/dev/null; then
                print_success "IOS_PLATFORM_APP_ARN environment variable configured"
            else
                print_warning "IOS_PLATFORM_APP_ARN environment variable not found"
            fi
            
            if echo "$ENV_VARS" | jq -e '.IOS_BUNDLE_ID' &>/dev/null; then
                print_success "IOS_BUNDLE_ID environment variable configured"
            else
                print_warning "IOS_BUNDLE_ID environment variable not found"
            fi
        fi
    else
        print_warning "Lambda function not found - may not be deployed yet"
    fi
}

generate_validation_report() {
    echo
    print_info "Validation Summary"
    echo "=================="
    
    if [[ $VALIDATION_ERRORS -eq 0 ]]; then
        print_success "No critical errors found"
    else
        print_error "Found $VALIDATION_ERRORS critical error(s)"
    fi
    
    if [[ $VALIDATION_WARNINGS -eq 0 ]]; then
        print_success "No warnings"
    else
        print_warning "Found $VALIDATION_WARNINGS warning(s)"
    fi
    
    echo
    if [[ $VALIDATION_ERRORS -eq 0 ]]; then
        print_success "iOS configuration appears to be valid!"
        echo
        print_info "Next steps:"
        echo "1. Deploy your infrastructure if not already done"
        echo "2. Test device registration: ./scripts/test-device-registration.sh"
        echo "3. Test push notifications: npm run test:ios-integration"
    else
        print_error "Please fix the critical errors before proceeding"
        echo
        print_info "Common fixes:"
        echo "1. Run the setup script: ./scripts/setup-ios-platform.sh"
        echo "2. Check your AWS credentials and permissions"
        echo "3. Verify your APNS certificates are valid and not expired"
    fi
}

show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo
    echo "Options:"
    echo "  -h, --help              Show this help message"
    echo "  -c, --config FILE       Use specific config file"
    echo "  --platform-arn ARN      Override platform application ARN"
    echo "  --bundle-id ID          Override bundle ID"
    echo "  --region REGION         Override AWS region"
    echo "  --skip-network          Skip network connectivity tests"
    echo "  --skip-iam              Skip IAM permission tests"
    echo "  --verbose               Show detailed output"
    echo
    echo "Examples:"
    echo "  $0                                    # Full validation"
    echo "  $0 --skip-network                    # Skip network tests"
    echo "  $0 --platform-arn arn:aws:sns:...   # Override platform ARN"
}

# Parse command line arguments
SKIP_NETWORK=false
SKIP_IAM=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -c|--config)
            CONFIG_FILE="$2"
            shift 2
            ;;
        --platform-arn)
            PLATFORM_APP_ARN="$2"
            shift 2
            ;;
        --bundle-id)
            BUNDLE_ID="$2"
            shift 2
            ;;
        --region)
            AWS_REGION="$2"
            shift 2
            ;;
        --skip-network)
            SKIP_NETWORK=true
            shift
            ;;
        --skip-iam)
            SKIP_IAM=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        *)
            print_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Main execution
main() {
    print_header
    
    check_prerequisites || exit 1
    load_configuration
    validate_configuration_variables
    validate_platform_application
    
    if [[ "$SKIP_IAM" != "true" ]]; then
        validate_iam_permissions
    fi
    
    validate_certificate_expiration
    
    if [[ "$SKIP_NETWORK" != "true" ]]; then
        validate_network_connectivity
    fi
    
    test_device_token_validation
    validate_lambda_configuration
    generate_validation_report
    
    # Exit with error code if there are critical errors
    exit $VALIDATION_ERRORS
}

# Run main function
main "$@"