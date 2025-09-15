#!/bin/bash

# iOS Integration Test Runner
# 
# This script runs iOS-specific integration tests for the AWS Spend Monitor Agent.
# It validates the environment, runs the tests, and provides detailed reporting.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
RUN_UNIT_TESTS=true
RUN_INTEGRATION_TESTS=false
RUN_PERFORMANCE_TESTS=false
VERBOSE=false
COVERAGE=false

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

# Function to show usage
show_usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Run iOS notification tests for the AWS Spend Monitor Agent.

OPTIONS:
    -u, --unit              Run unit tests only (default: true)
    -i, --integration       Run integration tests (requires AWS credentials and iOS platform)
    -p, --performance       Run performance tests (requires integration setup)
    -a, --all               Run all test types
    -c, --coverage          Generate test coverage report
    -v, --verbose           Enable verbose output
    -h, --help              Show this help message

ENVIRONMENT VARIABLES:
    Required for integration tests:
        AWS_REGION                  AWS region (default: us-east-1)
        AWS_ACCESS_KEY_ID           AWS access key
        AWS_SECRET_ACCESS_KEY       AWS secret key
        TEST_IOS_PLATFORM_ARN       SNS Platform Application ARN for APNS
    
    Optional:
        TEST_IOS_BUNDLE_ID          iOS app bundle ID (default: com.example.spendmonitor.test)
        RUN_INTEGRATION_TESTS       Set to 'true' to enable integration tests
        TEST_IOS_INTEGRATION        Set to 'true' to enable iOS-specific tests

EXAMPLES:
    # Run unit tests only
    $0 --unit

    # Run integration tests (requires AWS setup)
    $0 --integration

    # Run all tests with coverage
    $0 --all --coverage

    # Run performance tests with verbose output
    $0 --performance --verbose

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -u|--unit)
            RUN_UNIT_TESTS=true
            RUN_INTEGRATION_TESTS=false
            RUN_PERFORMANCE_TESTS=false
            shift
            ;;
        -i|--integration)
            RUN_INTEGRATION_TESTS=true
            shift
            ;;
        -p|--performance)
            RUN_PERFORMANCE_TESTS=true
            RUN_INTEGRATION_TESTS=true
            shift
            ;;
        -a|--all)
            RUN_UNIT_TESTS=true
            RUN_INTEGRATION_TESTS=true
            RUN_PERFORMANCE_TESTS=true
            shift
            ;;
        -c|--coverage)
            COVERAGE=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to validate environment
validate_environment() {
    print_status "Validating test environment..."

    # Check Node.js
    if ! command_exists node; then
        print_error "Node.js is not installed"
        exit 1
    fi

    # Check npm
    if ! command_exists npm; then
        print_error "npm is not installed"
        exit 1
    fi

    # Check if dependencies are installed
    if [ ! -d "node_modules" ]; then
        print_warning "Dependencies not installed. Running npm install..."
        npm install
    fi

    # Check Jest
    if ! command_exists npx || ! npx jest --version >/dev/null 2>&1; then
        print_error "Jest is not available. Please install dependencies."
        exit 1
    fi

    print_success "Basic environment validation passed"
}

# Function to validate AWS environment for integration tests
validate_aws_environment() {
    print_status "Validating AWS environment for integration tests..."

    local required_vars=("AWS_REGION" "AWS_ACCESS_KEY_ID" "AWS_SECRET_ACCESS_KEY")
    local missing_vars=()

    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            missing_vars+=("$var")
        fi
    done

    if [ ${#missing_vars[@]} -ne 0 ]; then
        print_error "Missing required AWS environment variables: ${missing_vars[*]}"
        print_error "Please configure AWS credentials before running integration tests."
        exit 1
    fi

    print_success "AWS environment validation passed"
}

# Function to validate iOS environment for integration tests
validate_ios_environment() {
    print_status "Validating iOS environment for integration tests..."

    if [ -z "$TEST_IOS_PLATFORM_ARN" ]; then
        print_error "TEST_IOS_PLATFORM_ARN is required for iOS integration tests"
        print_error "Please set up an SNS Platform Application for APNS and provide its ARN"
        exit 1
    fi

    # Validate ARN format
    if [[ ! "$TEST_IOS_PLATFORM_ARN" =~ ^arn:aws:sns:[^:]+:[^:]+:app/APNS/.+ ]]; then
        print_error "Invalid TEST_IOS_PLATFORM_ARN format: $TEST_IOS_PLATFORM_ARN"
        print_error "Expected format: arn:aws:sns:region:account:app/APNS/application-name"
        exit 1
    fi

    # Set default bundle ID if not provided
    if [ -z "$TEST_IOS_BUNDLE_ID" ]; then
        export TEST_IOS_BUNDLE_ID="com.example.spendmonitor.test"
        print_warning "TEST_IOS_BUNDLE_ID not set, using default: $TEST_IOS_BUNDLE_ID"
    fi

    print_success "iOS environment validation passed"
    print_status "iOS Platform ARN: $TEST_IOS_PLATFORM_ARN"
    print_status "iOS Bundle ID: $TEST_IOS_BUNDLE_ID"
}

# Function to run unit tests
run_unit_tests() {
    print_status "Running iOS notification unit tests..."

    local jest_args=()
    
    if [ "$COVERAGE" = true ]; then
        jest_args+=("--coverage")
    fi
    
    if [ "$VERBOSE" = true ]; then
        jest_args+=("--verbose")
    fi

    # Run iOS-specific unit tests
    jest_args+=("--testPathPattern=ios.*test\\.ts$")
    jest_args+=("--testPathIgnorePatterns=integration")

    if npx jest "${jest_args[@]}"; then
        print_success "iOS unit tests passed"
        return 0
    else
        print_error "iOS unit tests failed"
        return 1
    fi
}

# Function to run integration tests
run_integration_tests() {
    print_status "Running iOS integration tests..."

    # Set environment variables for integration tests
    export RUN_INTEGRATION_TESTS=true
    export TEST_IOS_INTEGRATION=true

    local jest_args=()
    jest_args+=("--config" "jest.integration.config.js")
    jest_args+=("--testPathPattern=ios.*test\\.ts$")
    
    if [ "$COVERAGE" = true ]; then
        jest_args+=("--coverage")
    fi
    
    if [ "$VERBOSE" = true ]; then
        jest_args+=("--verbose")
    fi

    if npx jest "${jest_args[@]}"; then
        print_success "iOS integration tests passed"
        return 0
    else
        print_error "iOS integration tests failed"
        return 1
    fi
}

# Function to run performance tests
run_performance_tests() {
    print_status "Running iOS performance tests..."

    # Set environment variables for performance tests
    export RUN_INTEGRATION_TESTS=true
    export TEST_IOS_INTEGRATION=true

    local jest_args=()
    jest_args+=("--config" "jest.integration.config.js")
    jest_args+=("--testPathPattern=ios-performance\\.test\\.ts$")
    jest_args+=("--testTimeout=120000") # 2 minutes for performance tests
    
    if [ "$VERBOSE" = true ]; then
        jest_args+=("--verbose")
    fi

    if npx jest "${jest_args[@]}"; then
        print_success "iOS performance tests passed"
        return 0
    else
        print_error "iOS performance tests failed"
        return 1
    fi
}

# Function to generate test report
generate_report() {
    print_status "Generating test report..."

    if [ "$COVERAGE" = true ] && [ -d "coverage" ]; then
        print_status "Coverage report generated in coverage/ directory"
        
        if command_exists open && [[ "$OSTYPE" == "darwin"* ]]; then
            print_status "Opening coverage report in browser..."
            open coverage/lcov-report/index.html
        elif command_exists xdg-open; then
            print_status "Opening coverage report in browser..."
            xdg-open coverage/lcov-report/index.html
        fi
    fi

    print_success "Test execution completed"
}

# Main execution
main() {
    print_status "Starting iOS notification tests for AWS Spend Monitor Agent"
    print_status "=========================================================="

    # Always validate basic environment
    validate_environment

    local test_results=()

    # Run unit tests if requested
    if [ "$RUN_UNIT_TESTS" = true ]; then
        if run_unit_tests; then
            test_results+=("Unit tests: PASSED")
        else
            test_results+=("Unit tests: FAILED")
        fi
    fi

    # Run integration tests if requested
    if [ "$RUN_INTEGRATION_TESTS" = true ]; then
        validate_aws_environment
        validate_ios_environment
        
        if run_integration_tests; then
            test_results+=("Integration tests: PASSED")
        else
            test_results+=("Integration tests: FAILED")
        fi
    fi

    # Run performance tests if requested
    if [ "$RUN_PERFORMANCE_TESTS" = true ]; then
        if run_performance_tests; then
            test_results+=("Performance tests: PASSED")
        else
            test_results+=("Performance tests: FAILED")
        fi
    fi

    # Generate report
    generate_report

    # Print summary
    print_status "Test Results Summary:"
    print_status "===================="
    
    local failed_tests=0
    for result in "${test_results[@]}"; do
        if [[ $result == *"PASSED"* ]]; then
            print_success "$result"
        else
            print_error "$result"
            ((failed_tests++))
        fi
    done

    if [ $failed_tests -eq 0 ]; then
        print_success "All tests passed!"
        exit 0
    else
        print_error "$failed_tests test suite(s) failed"
        exit 1
    fi
}

# Run main function
main "$@"