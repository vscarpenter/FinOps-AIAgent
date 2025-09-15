#!/bin/bash

# AWS Spend Monitor - iOS Platform Application Setup Script
# This script creates and configures SNS platform applications for APNS

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

# Default values
DEFAULT_APP_NAME="SpendMonitorAPNS"
DEFAULT_BUNDLE_ID="com.example.aws-spend-monitor"
DEFAULT_REGION="us-east-1"

# Functions
print_header() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE} AWS Spend Monitor iOS Setup${NC}"
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
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed. Please install it first."
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "AWS credentials not configured. Run 'aws configure' first."
        exit 1
    fi
    
    # Check OpenSSL
    if ! command -v openssl &> /dev/null; then
        print_error "OpenSSL is not installed. Please install it first."
        exit 1
    fi
    
    print_success "Prerequisites check passed"
}

load_config() {
    if [[ -f "$CONFIG_FILE" ]]; then
        print_info "Loading existing configuration from $CONFIG_FILE"
        source "$CONFIG_FILE"
    else
        print_info "No existing configuration found. Using defaults."
    fi
}

save_config() {
    cat > "$CONFIG_FILE" << EOF
# iOS Configuration for AWS Spend Monitor
APP_NAME="$APP_NAME"
BUNDLE_ID="$BUNDLE_ID"
AWS_REGION="$AWS_REGION"
CERT_PATH="$CERT_PATH"
KEY_PATH="$KEY_PATH"
ENVIRONMENT="$ENVIRONMENT"
PLATFORM_APP_ARN="$PLATFORM_APP_ARN"
EOF
    print_success "Configuration saved to $CONFIG_FILE"
}

prompt_configuration() {
    echo
    print_info "Configuration Setup"
    echo "Please provide the following information:"
    echo
    
    # App Name
    read -p "App Name [$DEFAULT_APP_NAME]: " APP_NAME
    APP_NAME=${APP_NAME:-$DEFAULT_APP_NAME}
    
    # Bundle ID
    read -p "Bundle ID [$DEFAULT_BUNDLE_ID]: " BUNDLE_ID
    BUNDLE_ID=${BUNDLE_ID:-$DEFAULT_BUNDLE_ID}
    
    # AWS Region
    read -p "AWS Region [$DEFAULT_REGION]: " AWS_REGION
    AWS_REGION=${AWS_REGION:-$DEFAULT_REGION}
    
    # Environment
    echo
    echo "Select environment:"
    echo "1) Development (APNS Sandbox)"
    echo "2) Production (APNS)"
    read -p "Choice [1]: " ENV_CHOICE
    ENV_CHOICE=${ENV_CHOICE:-1}
    
    if [[ "$ENV_CHOICE" == "2" ]]; then
        ENVIRONMENT="production"
        PLATFORM_TYPE="APNS"
    else
        ENVIRONMENT="development"
        PLATFORM_TYPE="APNS_SANDBOX"
    fi
    
    # Certificate paths
    echo
    print_info "Certificate Configuration"
    echo "Please provide paths to your APNS certificate and key files:"
    
    while true; do
        read -p "Certificate file path (.pem): " CERT_PATH
        if [[ -f "$CERT_PATH" ]]; then
            break
        else
            print_error "Certificate file not found: $CERT_PATH"
        fi
    done
    
    while true; do
        read -p "Private key file path (.pem): " KEY_PATH
        if [[ -f "$KEY_PATH" ]]; then
            break
        else
            print_error "Private key file not found: $KEY_PATH"
        fi
    done
}

validate_certificates() {
    print_info "Validating APNS certificates..."
    
    # Check certificate format
    if ! openssl x509 -in "$CERT_PATH" -noout -text &> /dev/null; then
        print_error "Invalid certificate format: $CERT_PATH"
        exit 1
    fi
    
    # Check private key format
    if ! openssl rsa -in "$KEY_PATH" -check -noout &> /dev/null; then
        print_error "Invalid private key format: $KEY_PATH"
        exit 1
    fi
    
    # Check certificate expiration
    EXPIRY_DATE=$(openssl x509 -in "$CERT_PATH" -noout -enddate | cut -d= -f2)
    EXPIRY_TIMESTAMP=$(date -d "$EXPIRY_DATE" +%s 2>/dev/null || date -j -f "%b %d %H:%M:%S %Y %Z" "$EXPIRY_DATE" +%s 2>/dev/null)
    CURRENT_TIMESTAMP=$(date +%s)
    
    if [[ $EXPIRY_TIMESTAMP -lt $CURRENT_TIMESTAMP ]]; then
        print_error "Certificate has expired: $EXPIRY_DATE"
        exit 1
    fi
    
    # Check if certificate expires within 30 days
    THIRTY_DAYS=$((30 * 24 * 60 * 60))
    if [[ $((EXPIRY_TIMESTAMP - CURRENT_TIMESTAMP)) -lt $THIRTY_DAYS ]]; then
        print_warning "Certificate expires soon: $EXPIRY_DATE"
    fi
    
    print_success "Certificate validation passed"
}

create_platform_application() {
    print_info "Creating SNS platform application..."
    
    # Read certificate and key content
    CERT_CONTENT=$(cat "$CERT_PATH")
    KEY_CONTENT=$(cat "$KEY_PATH")
    
    # Create platform application
    PLATFORM_APP_ARN=$(aws sns create-platform-application \
        --region "$AWS_REGION" \
        --name "${APP_NAME}-${ENVIRONMENT}" \
        --platform "$PLATFORM_TYPE" \
        --attributes "PlatformCredential=$CERT_CONTENT,PlatformPrincipal=$KEY_CONTENT" \
        --query 'PlatformApplicationArn' \
        --output text)
    
    if [[ $? -eq 0 && -n "$PLATFORM_APP_ARN" ]]; then
        print_success "Platform application created: $PLATFORM_APP_ARN"
    else
        print_error "Failed to create platform application"
        exit 1
    fi
}

update_platform_application() {
    print_info "Updating existing platform application..."
    
    # Read certificate and key content
    CERT_CONTENT=$(cat "$CERT_PATH")
    KEY_CONTENT=$(cat "$KEY_PATH")
    
    # Update platform application
    aws sns set-platform-application-attributes \
        --region "$AWS_REGION" \
        --platform-application-arn "$PLATFORM_APP_ARN" \
        --attributes "PlatformCredential=$CERT_CONTENT,PlatformPrincipal=$KEY_CONTENT"
    
    if [[ $? -eq 0 ]]; then
        print_success "Platform application updated: $PLATFORM_APP_ARN"
    else
        print_error "Failed to update platform application"
        exit 1
    fi
}

check_existing_platform_app() {
    print_info "Checking for existing platform application..."
    
    # List platform applications and check if one exists with our name
    EXISTING_ARN=$(aws sns list-platform-applications \
        --region "$AWS_REGION" \
        --query "PlatformApplications[?contains(PlatformApplicationArn, '${APP_NAME}-${ENVIRONMENT}')].PlatformApplicationArn" \
        --output text)
    
    if [[ -n "$EXISTING_ARN" ]]; then
        print_warning "Platform application already exists: $EXISTING_ARN"
        echo
        read -p "Do you want to update it with new certificates? (y/N): " UPDATE_CHOICE
        
        if [[ "$UPDATE_CHOICE" =~ ^[Yy]$ ]]; then
            PLATFORM_APP_ARN="$EXISTING_ARN"
            update_platform_application
        else
            PLATFORM_APP_ARN="$EXISTING_ARN"
            print_info "Using existing platform application"
        fi
    else
        create_platform_application
    fi
}

test_platform_application() {
    print_info "Testing platform application..."
    
    # Get platform application attributes
    ATTRIBUTES=$(aws sns get-platform-application-attributes \
        --region "$AWS_REGION" \
        --platform-application-arn "$PLATFORM_APP_ARN" \
        --query 'Attributes' \
        --output json)
    
    if [[ $? -eq 0 ]]; then
        print_success "Platform application is accessible"
        
        # Check if enabled
        ENABLED=$(echo "$ATTRIBUTES" | jq -r '.Enabled // "true"')
        if [[ "$ENABLED" == "true" ]]; then
            print_success "Platform application is enabled"
        else
            print_warning "Platform application is disabled"
        fi
    else
        print_error "Failed to access platform application"
        exit 1
    fi
}

generate_env_config() {
    print_info "Generating environment configuration..."
    
    ENV_FILE="$PROJECT_ROOT/.env.ios"
    cat > "$ENV_FILE" << EOF
# iOS Configuration for AWS Spend Monitor
# Generated by setup-ios-platform.sh on $(date)

IOS_PLATFORM_APP_ARN=$PLATFORM_APP_ARN
IOS_BUNDLE_ID=$BUNDLE_ID
APNS_SANDBOX=$([[ "$ENVIRONMENT" == "development" ]] && echo "true" || echo "false")
AWS_REGION=$AWS_REGION
EOF
    
    print_success "Environment configuration saved to $ENV_FILE"
    
    echo
    print_info "Add these environment variables to your deployment:"
    echo "IOS_PLATFORM_APP_ARN=$PLATFORM_APP_ARN"
    echo "IOS_BUNDLE_ID=$BUNDLE_ID"
    echo "APNS_SANDBOX=$([[ "$ENVIRONMENT" == "development" ]] && echo "true" || echo "false")"
}

print_next_steps() {
    echo
    print_info "Setup completed successfully!"
    echo
    echo "Next steps:"
    echo "1. Update your CDK deployment with the platform application ARN"
    echo "2. Deploy your infrastructure: npm run deploy"
    echo "3. Test device registration: ./scripts/test-device-registration.sh"
    echo "4. Validate the deployment: ./scripts/validate-deployment.sh"
    echo
    echo "Platform Application ARN: $PLATFORM_APP_ARN"
    echo "Bundle ID: $BUNDLE_ID"
    echo "Environment: $ENVIRONMENT"
    echo
    print_info "Configuration saved to: $CONFIG_FILE"
    print_info "Environment variables saved to: $PROJECT_ROOT/.env.ios"
}

show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo
    echo "Options:"
    echo "  -h, --help              Show this help message"
    echo "  -c, --config FILE       Use specific config file"
    echo "  --app-name NAME         Set application name"
    echo "  --bundle-id ID          Set bundle ID"
    echo "  --region REGION         Set AWS region"
    echo "  --cert-path PATH        Path to certificate file"
    echo "  --key-path PATH         Path to private key file"
    echo "  --environment ENV       Set environment (development|production)"
    echo "  --update-existing       Update existing platform application"
    echo
    echo "Examples:"
    echo "  $0                                          # Interactive setup"
    echo "  $0 --app-name MyApp --bundle-id com.my.app # Quick setup"
    echo "  $0 --update-existing                       # Update certificates"
}

# Parse command line arguments
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
        --app-name)
            APP_NAME="$2"
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
        --cert-path)
            CERT_PATH="$2"
            shift 2
            ;;
        --key-path)
            KEY_PATH="$2"
            shift 2
            ;;
        --environment)
            ENVIRONMENT="$2"
            if [[ "$ENVIRONMENT" == "production" ]]; then
                PLATFORM_TYPE="APNS"
            else
                PLATFORM_TYPE="APNS_SANDBOX"
            fi
            shift 2
            ;;
        --update-existing)
            UPDATE_EXISTING=true
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
    
    check_prerequisites
    load_config
    
    # If not all required parameters are provided, prompt for them
    if [[ -z "$APP_NAME" || -z "$BUNDLE_ID" || -z "$AWS_REGION" || -z "$CERT_PATH" || -z "$KEY_PATH" || -z "$ENVIRONMENT" ]]; then
        prompt_configuration
    fi
    
    validate_certificates
    
    if [[ "$UPDATE_EXISTING" == "true" ]]; then
        update_platform_application
    else
        check_existing_platform_app
    fi
    
    test_platform_application
    save_config
    generate_env_config
    print_next_steps
}

# Run main function
main "$@"