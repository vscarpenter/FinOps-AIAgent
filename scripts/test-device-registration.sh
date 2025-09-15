#!/bin/bash

# AWS Spend Monitor - Device Registration Testing Script
# This script tests iOS device registration functionality

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

# Test configuration
TEST_DEVICE_TOKEN="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
TEST_USER_ID="test-user-$(date +%s)"
API_TIMEOUT=30

# Functions
print_header() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE} Device Registration Testing${NC}"
    echo -e "${BLUE}================================${NC}"
    echo
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

check_prerequisites() {
    print_info "Checking prerequisites..."
    
    # Check curl
    if ! command -v curl &> /dev/null; then
        print_error "curl is not installed"
        exit 1
    fi
    
    # Check jq for JSON parsing
    if ! command -v jq &> /dev/null; then
        print_error "jq is not installed (required for JSON parsing)"
        exit 1
    fi
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed"
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "AWS credentials not configured"
        exit 1
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
    
    # Override with environment variables if set
    if [[ -n "$IOS_PLATFORM_APP_ARN" ]]; then
        PLATFORM_APP_ARN="$IOS_PLATFORM_APP_ARN"
    fi
    
    if [[ -n "$IOS_BUNDLE_ID" ]]; then
        BUNDLE_ID="$IOS_BUNDLE_ID"
    fi
    
    # Set defaults if not configured
    AWS_REGION=${AWS_REGION:-"us-east-1"}
    BUNDLE_ID=${BUNDLE_ID:-"com.example.aws-spend-monitor"}
}

validate_configuration() {
    print_info "Validating configuration..."
    
    if [[ -z "$PLATFORM_APP_ARN" ]]; then
        print_error "Platform Application ARN not configured"
        print_info "Run ./scripts/setup-ios-platform.sh first"
        exit 1
    fi
    
    if [[ -z "$BUNDLE_ID" ]]; then
        print_error "Bundle ID not configured"
        exit 1
    fi
    
    print_success "Configuration validation passed"
    print_info "Platform ARN: $PLATFORM_APP_ARN"
    print_info "Bundle ID: $BUNDLE_ID"
    print_info "AWS Region: $AWS_REGION"
}

generate_test_device_token() {
    # Generate a valid 64-character hex string for testing
    TEST_DEVICE_TOKEN=$(openssl rand -hex 32)
    print_info "Generated test device token: ${TEST_DEVICE_TOKEN:0:16}..."
}

test_device_token_validation() {
    print_info "Testing device token validation..."
    
    # Test valid token format
    if [[ ${#TEST_DEVICE_TOKEN} -eq 64 && "$TEST_DEVICE_TOKEN" =~ ^[0-9a-fA-F]+$ ]]; then
        print_success "Test device token format is valid"
    else
        print_error "Test device token format is invalid"
        exit 1
    fi
    
    # Test invalid token formats
    local invalid_tokens=(
        "short"
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefg"  # invalid char
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde"   # too short
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0" # too long
    )
    
    for token in "${invalid_tokens[@]}"; do
        if [[ ${#token} -eq 64 && "$token" =~ ^[0-9a-fA-F]+$ ]]; then
            print_error "Token validation failed to reject: ${token:0:20}..."
        else
            print_success "Token validation correctly rejected: ${token:0:20}..."
        fi
    done
}

test_sns_platform_endpoint_creation() {
    print_info "Testing SNS platform endpoint creation..."
    
    # Create platform endpoint
    ENDPOINT_ARN=$(aws sns create-platform-endpoint \
        --region "$AWS_REGION" \
        --platform-application-arn "$PLATFORM_APP_ARN" \
        --token "$TEST_DEVICE_TOKEN" \
        --custom-user-data "test-registration-$(date +%s)" \
        --output text --query 'EndpointArn' 2>/dev/null)
    
    if [[ $? -eq 0 && -n "$ENDPOINT_ARN" ]]; then
        print_success "Platform endpoint created: $ENDPOINT_ARN"
        
        # Store for cleanup
        echo "$ENDPOINT_ARN" >> "/tmp/test-endpoints-$$"
    else
        print_error "Failed to create platform endpoint"
        return 1
    fi
    
    # Test getting endpoint attributes
    ENDPOINT_ATTRS=$(aws sns get-endpoint-attributes \
        --region "$AWS_REGION" \
        --endpoint-arn "$ENDPOINT_ARN" \
        --output json 2>/dev/null)
    
    if [[ $? -eq 0 ]]; then
        print_success "Can retrieve endpoint attributes"
        
        # Check if endpoint is enabled
        ENABLED=$(echo "$ENDPOINT_ATTRS" | jq -r '.Attributes.Enabled // "true"')
        if [[ "$ENABLED" == "true" ]]; then
            print_success "Endpoint is enabled"
        else
            print_warning "Endpoint is disabled"
        fi
        
        # Check token
        STORED_TOKEN=$(echo "$ENDPOINT_ATTRS" | jq -r '.Attributes.Token')
        if [[ "$STORED_TOKEN" == "$TEST_DEVICE_TOKEN" ]]; then
            print_success "Device token stored correctly"
        else
            print_error "Device token mismatch"
        fi
    else
        print_error "Cannot retrieve endpoint attributes"
    fi
}

test_duplicate_registration() {
    print_info "Testing duplicate device registration..."
    
    # Try to register the same token again
    ENDPOINT_ARN2=$(aws sns create-platform-endpoint \
        --region "$AWS_REGION" \
        --platform-application-arn "$PLATFORM_APP_ARN" \
        --token "$TEST_DEVICE_TOKEN" \
        --custom-user-data "duplicate-test-$(date +%s)" \
        --output text --query 'EndpointArn' 2>/dev/null)
    
    if [[ $? -eq 0 && -n "$ENDPOINT_ARN2" ]]; then
        if [[ "$ENDPOINT_ARN" == "$ENDPOINT_ARN2" ]]; then
            print_success "Duplicate registration returns same endpoint"
        else
            print_warning "Duplicate registration created new endpoint: $ENDPOINT_ARN2"
            echo "$ENDPOINT_ARN2" >> "/tmp/test-endpoints-$$"
        fi
    else
        print_error "Duplicate registration failed"
    fi
}

test_endpoint_update() {
    print_info "Testing endpoint updates..."
    
    # Update endpoint attributes
    aws sns set-endpoint-attributes \
        --region "$AWS_REGION" \
        --endpoint-arn "$ENDPOINT_ARN" \
        --attributes "CustomUserData=updated-$(date +%s)" \
        2>/dev/null
    
    if [[ $? -eq 0 ]]; then
        print_success "Endpoint attributes updated successfully"
    else
        print_error "Failed to update endpoint attributes"
    fi
    
    # Verify update
    UPDATED_ATTRS=$(aws sns get-endpoint-attributes \
        --region "$AWS_REGION" \
        --endpoint-arn "$ENDPOINT_ARN" \
        --output json 2>/dev/null)
    
    if [[ $? -eq 0 ]]; then
        CUSTOM_DATA=$(echo "$UPDATED_ATTRS" | jq -r '.Attributes.CustomUserData')
        if [[ "$CUSTOM_DATA" =~ ^updated- ]]; then
            print_success "Endpoint update verified"
        else
            print_warning "Endpoint update not reflected"
        fi
    fi
}

test_notification_delivery() {
    print_info "Testing notification delivery..."
    
    # Create test notification payload
    local test_payload='{
        "APNS": "{\"aps\":{\"alert\":{\"title\":\"Test Notification\",\"body\":\"This is a test from the spend monitor\"},\"badge\":1,\"sound\":\"default\"}}"
    }'
    
    # Send test notification
    MESSAGE_ID=$(aws sns publish \
        --region "$AWS_REGION" \
        --target-arn "$ENDPOINT_ARN" \
        --message "$test_payload" \
        --message-structure json \
        --output text --query 'MessageId' 2>/dev/null)
    
    if [[ $? -eq 0 && -n "$MESSAGE_ID" ]]; then
        print_success "Test notification sent (Message ID: $MESSAGE_ID)"
        print_info "Note: Notification may not be delivered due to invalid device token"
    else
        print_error "Failed to send test notification"
    fi
}

test_api_gateway_endpoints() {
    print_info "Testing API Gateway endpoints (if available)..."
    
    # Try to find API Gateway URL from CloudFormation or CDK outputs
    local api_urls=(
        "https://api.example.com/devices"  # Replace with actual URL
        "http://localhost:3000/devices"    # Local development
    )
    
    # Check if we can find the actual API URL
    if command -v aws &> /dev/null; then
        # Try to get from CloudFormation outputs
        CF_OUTPUTS=$(aws cloudformation describe-stacks \
            --region "$AWS_REGION" \
            --query 'Stacks[?contains(StackName, `SpendMonitor`) || contains(StackName, `spend-monitor`)].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
            --output text 2>/dev/null)
        
        if [[ -n "$CF_OUTPUTS" ]]; then
            api_urls=("$CF_OUTPUTS/devices")
        fi
    fi
    
    local api_found=false
    
    for api_url in "${api_urls[@]}"; do
        print_info "Testing API endpoint: $api_url"
        
        # Test health endpoint
        HEALTH_RESPONSE=$(curl -s --connect-timeout 5 "${api_url%/devices}/health" -w "%{http_code}" -o /dev/null 2>/dev/null || echo "000")
        
        if [[ "$HEALTH_RESPONSE" == "200" ]]; then
            print_success "API health endpoint accessible"
            api_found=true
            
            # Test device registration endpoint
            REGISTRATION_PAYLOAD=$(cat << EOF
{
    "deviceToken": "$TEST_DEVICE_TOKEN",
    "bundleId": "$BUNDLE_ID",
    "userId": "$TEST_USER_ID"
}
EOF
)
            
            REGISTRATION_RESPONSE=$(curl -s \
                --connect-timeout "$API_TIMEOUT" \
                -X POST \
                -H "Content-Type: application/json" \
                -d "$REGISTRATION_PAYLOAD" \
                "$api_url" \
                -w "%{http_code}" 2>/dev/null)
            
            HTTP_CODE="${REGISTRATION_RESPONSE: -3}"
            RESPONSE_BODY="${REGISTRATION_RESPONSE%???}"
            
            if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]]; then
                print_success "Device registration API working (HTTP $HTTP_CODE)"
                
                if command -v jq &> /dev/null && echo "$RESPONSE_BODY" | jq . &>/dev/null; then
                    ENDPOINT_ARN_API=$(echo "$RESPONSE_BODY" | jq -r '.endpointArn // empty')
                    if [[ -n "$ENDPOINT_ARN_API" ]]; then
                        print_success "API returned endpoint ARN: $ENDPOINT_ARN_API"
                        echo "$ENDPOINT_ARN_API" >> "/tmp/test-endpoints-$$"
                    fi
                fi
            else
                print_warning "Device registration API returned HTTP $HTTP_CODE"
                if [[ -n "$RESPONSE_BODY" ]]; then
                    print_info "Response: $RESPONSE_BODY"
                fi
            fi
            
            break
        elif [[ "$HEALTH_RESPONSE" != "000" ]]; then
            print_warning "API endpoint returned HTTP $HEALTH_RESPONSE"
        fi
    done
    
    if [[ "$api_found" != "true" ]]; then
        print_warning "No accessible API Gateway endpoints found"
        print_info "This is normal if the API hasn't been deployed yet"
    fi
}

test_lambda_function() {
    print_info "Testing Lambda function (if available)..."
    
    # Try to find the Lambda function
    local function_names=("spend-monitor-agent" "aws-spend-monitor" "SpendMonitorAgent")
    local function_found=""
    
    for func_name in "${function_names[@]}"; do
        if aws lambda get-function-configuration \
            --region "$AWS_REGION" \
            --function-name "$func_name" \
            --output json &>/dev/null; then
            function_found="$func_name"
            break
        fi
    done
    
    if [[ -n "$function_found" ]]; then
        print_success "Found Lambda function: $function_found"
        
        # Test function invocation with test event
        local test_event='{
            "source": "aws.events",
            "detail-type": "Scheduled Event",
            "detail": {}
        }'
        
        INVOCATION_RESULT=$(aws lambda invoke \
            --region "$AWS_REGION" \
            --function-name "$function_found" \
            --payload "$test_event" \
            --output json \
            /tmp/lambda-response-$$ 2>/dev/null)
        
        if [[ $? -eq 0 ]]; then
            STATUS_CODE=$(echo "$INVOCATION_RESULT" | jq -r '.StatusCode')
            if [[ "$STATUS_CODE" == "200" ]]; then
                print_success "Lambda function invocation successful"
                
                # Check for errors in response
                if [[ -f "/tmp/lambda-response-$$" ]]; then
                    if grep -q "errorMessage" "/tmp/lambda-response-$$"; then
                        print_warning "Lambda function returned an error"
                        cat "/tmp/lambda-response-$$"
                    else
                        print_success "Lambda function executed without errors"
                    fi
                    rm -f "/tmp/lambda-response-$$"
                fi
            else
                print_error "Lambda function invocation failed (Status: $STATUS_CODE)"
            fi
        else
            print_error "Failed to invoke Lambda function"
        fi
    else
        print_warning "Lambda function not found - may not be deployed yet"
    fi
}

cleanup_test_resources() {
    print_info "Cleaning up test resources..."
    
    if [[ -f "/tmp/test-endpoints-$$" ]]; then
        while IFS= read -r endpoint_arn; do
            if [[ -n "$endpoint_arn" ]]; then
                print_info "Deleting test endpoint: ${endpoint_arn##*/}"
                aws sns delete-endpoint \
                    --region "$AWS_REGION" \
                    --endpoint-arn "$endpoint_arn" &>/dev/null
                
                if [[ $? -eq 0 ]]; then
                    print_success "Deleted endpoint: ${endpoint_arn##*/}"
                else
                    print_warning "Failed to delete endpoint: ${endpoint_arn##*/}"
                fi
            fi
        done < "/tmp/test-endpoints-$$"
        
        rm -f "/tmp/test-endpoints-$$"
    fi
    
    # Clean up any temporary files
    rm -f "/tmp/lambda-response-$$"
}

generate_test_report() {
    echo
    print_info "Device Registration Test Summary"
    echo "================================"
    
    print_info "Test Configuration:"
    echo "  Platform ARN: $PLATFORM_APP_ARN"
    echo "  Bundle ID: $BUNDLE_ID"
    echo "  AWS Region: $AWS_REGION"
    echo "  Test Device Token: ${TEST_DEVICE_TOKEN:0:16}..."
    echo "  Test User ID: $TEST_USER_ID"
    
    echo
    print_info "Next Steps:"
    echo "1. If tests passed, your iOS configuration is working correctly"
    echo "2. Deploy your iOS app with the device registration code"
    echo "3. Test with real device tokens from your iOS app"
    echo "4. Monitor CloudWatch logs for any issues"
    echo "5. Set up monitoring for certificate expiration"
    
    echo
    print_info "Troubleshooting:"
    echo "- Check docs/IOS-SETUP.md for detailed setup instructions"
    echo "- Run ./scripts/validate-ios-config.sh for configuration validation"
    echo "- Check CloudWatch logs for detailed error messages"
    echo "- Verify APNS certificates are valid and not expired"
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
    echo "  --device-token TOKEN    Use specific device token for testing"
    echo "  --user-id ID            Use specific user ID for testing"
    echo "  --skip-cleanup          Don't clean up test resources"
    echo "  --skip-api              Skip API Gateway tests"
    echo "  --skip-lambda           Skip Lambda function tests"
    echo "  --verbose               Show detailed output"
    echo
    echo "Examples:"
    echo "  $0                                    # Full registration test"
    echo "  $0 --skip-api --skip-lambda          # Test only SNS functionality"
    echo "  $0 --device-token abc123...          # Test with specific token"
}

# Parse command line arguments
SKIP_CLEANUP=false
SKIP_API=false
SKIP_LAMBDA=false
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
        --device-token)
            TEST_DEVICE_TOKEN="$2"
            shift 2
            ;;
        --user-id)
            TEST_USER_ID="$2"
            shift 2
            ;;
        --skip-cleanup)
            SKIP_CLEANUP=true
            shift
            ;;
        --skip-api)
            SKIP_API=true
            shift
            ;;
        --skip-lambda)
            SKIP_LAMBDA=true
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

# Trap to ensure cleanup on exit
trap 'cleanup_test_resources' EXIT

# Main execution
main() {
    print_header
    
    check_prerequisites
    load_configuration
    validate_configuration
    
    # Generate test token if not provided
    if [[ "$TEST_DEVICE_TOKEN" == "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" ]]; then
        generate_test_device_token
    fi
    
    test_device_token_validation
    test_sns_platform_endpoint_creation
    test_duplicate_registration
    test_endpoint_update
    test_notification_delivery
    
    if [[ "$SKIP_API" != "true" ]]; then
        test_api_gateway_endpoints
    fi
    
    if [[ "$SKIP_LAMBDA" != "true" ]]; then
        test_lambda_function
    fi
    
    generate_test_report
    
    echo
    print_success "Device registration testing completed!"
}

# Run main function
main "$@"