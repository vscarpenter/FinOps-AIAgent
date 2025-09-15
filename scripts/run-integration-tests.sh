#!/bin/bash

# AWS Spend Monitor Agent - Integration Test Runner
# This script sets up and runs integration tests with proper environment configuration

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check environment variables
check_env_var() {
    if [ -z "${!1}" ]; then
        print_error "Environment variable $1 is not set"
        return 1
    else
        print_success "Environment variable $1 is set"
        return 0
    fi
}

# Function to validate AWS credentials
validate_aws_credentials() {
    print_status "Validating AWS credentials..."
    
    if ! command_exists aws; then
        print_warning "AWS CLI not found, skipping credential validation"
        return 0
    fi
    
    if aws sts get-caller-identity >/dev/null 2>&1; then
        print_success "AWS credentials are valid"
        aws sts get-caller-identity --output table
        return 0
    else
        print_error "AWS credentials are invalid or not configured"
        return 1
    fi
}

# Function to check required dependencies
check_dependencies() {
    print_status "Checking dependencies..."
    
    if ! command_exists node; then
        print_error "Node.js is not installed"
        exit 1
    fi
    
    if ! command_exists npm; then
        print_error "npm is not installed"
        exit 1
    fi
    
    print_success "Node.js $(node --version) and npm $(npm --version) are available"
}

# Function to build the project
build_project() {
    print_status "Building project..."
    
    if npm run build; then
        print_success "Project built successfully"
    else
        print_error "Project build failed"
        exit 1
    fi
}

# Function to run integration tests
run_integration_tests() {
    local test_type="$1"
    
    print_status "Running integration tests (type: $test_type)..."
    
    # Set integration test environment variable
    export RUN_INTEGRATION_TESTS=true
    
    case "$test_type" in
        "all")
            npm run test:integration:run
            ;;
        "performance")
            npm run test:performance
            ;;
        "ios")
            export TEST_IOS_INTEGRATION=true
            npm run test:integration:ios
            ;;
        "e2e")
            npm run test:integration -- tests/integration/e2e.test.ts
            ;;
        *)
            print_error "Unknown test type: $test_type"
            print_status "Available types: all, performance, ios, e2e"
            exit 1
            ;;
    esac
}

# Function to display usage
show_usage() {
    echo "Usage: $0 [OPTIONS] [TEST_TYPE]"
    echo ""
    echo "TEST_TYPE:"
    echo "  all         Run all integration tests (default)"
    echo "  performance Run performance tests only"
    echo "  ios         Run iOS integration tests"
    echo "  e2e         Run end-to-end tests only"
    echo ""
    echo "OPTIONS:"
    echo "  -h, --help     Show this help message"
    echo "  -v, --verbose  Enable verbose output"
    echo "  --skip-build   Skip project build step"
    echo "  --skip-deps    Skip dependency check"
    echo "  --dry-run      Show what would be executed without running tests"
    echo ""
    echo "ENVIRONMENT VARIABLES:"
    echo "  AWS_REGION              AWS region (default: us-east-1)"
    echo "  AWS_ACCESS_KEY_ID       AWS access key"
    echo "  AWS_SECRET_ACCESS_KEY   AWS secret key"
    echo "  AWS_SESSION_TOKEN       AWS session token (optional)"
    echo "  TEST_IOS_INTEGRATION    Enable iOS tests (true/false)"
    echo "  TEST_IOS_PLATFORM_ARN   SNS platform application ARN for iOS"
    echo "  TEST_IOS_BUNDLE_ID      iOS bundle ID"
    echo ""
    echo "EXAMPLES:"
    echo "  $0                      # Run all integration tests"
    echo "  $0 performance          # Run performance tests only"
    echo "  $0 --verbose ios        # Run iOS tests with verbose output"
    echo "  $0 --dry-run all        # Show what would be executed"
}

# Parse command line arguments
VERBOSE=false
SKIP_BUILD=false
SKIP_DEPS=false
DRY_RUN=false
TEST_TYPE="all"

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_usage
            exit 0
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --skip-deps)
            SKIP_DEPS=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        all|performance|ios|e2e)
            TEST_TYPE="$1"
            shift
            ;;
        *)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Enable verbose output if requested
if [ "$VERBOSE" = true ]; then
    set -x
    export SUPPRESS_TEST_LOGS=false
fi

# Main execution
main() {
    print_status "AWS Spend Monitor Agent - Integration Test Runner"
    print_status "================================================"
    
    # Check dependencies
    if [ "$SKIP_DEPS" = false ]; then
        check_dependencies
    fi
    
    # Check required environment variables
    print_status "Checking environment variables..."
    
    # Set default AWS region if not set
    export AWS_REGION=${AWS_REGION:-us-east-1}
    print_status "AWS Region: $AWS_REGION"
    
    # Check required AWS credentials
    ENV_CHECK_FAILED=false
    
    if ! check_env_var "AWS_ACCESS_KEY_ID"; then
        ENV_CHECK_FAILED=true
    fi
    
    if ! check_env_var "AWS_SECRET_ACCESS_KEY"; then
        ENV_CHECK_FAILED=true
    fi
    
    if [ "$ENV_CHECK_FAILED" = true ]; then
        print_error "Required environment variables are missing"
        print_status "Please set AWS credentials before running integration tests"
        print_status "You can use 'aws configure' or set environment variables directly"
        exit 1
    fi
    
    # Validate AWS credentials
    validate_aws_credentials
    
    # Check iOS-specific environment variables if iOS tests are requested
    if [ "$TEST_TYPE" = "ios" ] || [ "$TEST_IOS_INTEGRATION" = "true" ]; then
        print_status "Checking iOS test environment variables..."
        
        if [ -z "$TEST_IOS_PLATFORM_ARN" ]; then
            print_warning "TEST_IOS_PLATFORM_ARN not set - iOS tests may fail"
        fi
        
        if [ -z "$TEST_IOS_BUNDLE_ID" ]; then
            print_warning "TEST_IOS_BUNDLE_ID not set - using default"
        fi
    fi
    
    # Build project
    if [ "$SKIP_BUILD" = false ]; then
        build_project
    fi
    
    # Show what would be executed in dry-run mode
    if [ "$DRY_RUN" = true ]; then
        print_status "DRY RUN - Would execute:"
        print_status "  Test type: $TEST_TYPE"
        print_status "  AWS Region: $AWS_REGION"
        print_status "  Verbose: $VERBOSE"
        print_status "  Skip build: $SKIP_BUILD"
        print_status "  Skip deps: $SKIP_DEPS"
        
        if [ "$TEST_TYPE" = "ios" ] || [ "$TEST_IOS_INTEGRATION" = "true" ]; then
            print_status "  iOS tests enabled: true"
        fi
        
        exit 0
    fi
    
    # Run integration tests
    if run_integration_tests "$TEST_TYPE"; then
        print_success "Integration tests completed successfully!"
    else
        print_error "Integration tests failed!"
        exit 1
    fi
    
    print_status "================================================"
    print_success "Integration test execution completed"
}

# Run main function
main "$@"