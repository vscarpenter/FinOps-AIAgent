#!/bin/bash

# AWS Spend Monitor - Pre-deployment Validation Script
# This script performs comprehensive checks before deployment

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

# Validation counters
VALIDATION_ERRORS=0
VALIDATION_WARNINGS=0
VALIDATION_CHECKS=0

# Functions
print_header() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE} Pre-deployment Validation${NC}"
    echo -e "${BLUE}================================${NC}"
    echo
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
    ((VALIDATION_CHECKS++))
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
    ((VALIDATION_ERRORS++))
    ((VALIDATION_CHECKS++))
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
    ((VALIDATION_WARNINGS++))
    ((VALIDATION_CHECKS++))
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

check_prerequisites() {
    print_info "Checking prerequisites..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
    else
        NODE_VERSION=$(node --version)
        NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1 | sed 's/v//')
        if [[ $NODE_MAJOR -ge 18 ]]; then
            print_success "Node.js version is adequate: $NODE_VERSION"
        else
            print_error "Node.js version is too old: $NODE_VERSION (required: 18+)"
        fi
    fi
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed"
    else
        NPM_VERSION=$(npm --version)
        print_success "npm is available: $NPM_VERSION"
    fi
    
    # Check TypeScript
    if ! command -v npx &> /dev/null; then
        print_warning "npx is not available"
    elif ! npx tsc --version &> /dev/null; then
        print_warning "TypeScript is not available via npx"
    else
        TS_VERSION=$(npx tsc --version)
        print_success "TypeScript is available: $TS_VERSION"
    fi
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed"
    else
        AWS_VERSION=$(aws --version 2>&1 | head -1)
        print_success "AWS CLI is available: $AWS_VERSION"
    fi
    
    # Check CDK
    if ! command -v cdk &> /dev/null; then
        print_error "AWS CDK is not installed"
    else
        CDK_VERSION=$(cdk --version)
        print_success "AWS CDK is available: $CDK_VERSION"
    fi
    
    # Check jq (optional but helpful)
    if ! command -v jq &> /dev/null; then
        print_warning "jq is not installed - some validations will be limited"
    else
        JQ_VERSION=$(jq --version)
        print_success "jq is available: $JQ_VERSION"
    fi
}

check_aws_credentials() {
    print_info "Checking AWS credentials..."
    
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "AWS credentials not configured or invalid"
        return 1
    fi
    
    if command -v jq &> /dev/null; then
        IDENTITY=$(aws sts get-caller-identity --output json)
        USER_ARN=$(echo "$IDENTITY" | jq -r '.Arn')
        ACCOUNT_ID=$(echo "$IDENTITY" | jq -r '.Account')
        print_success "AWS credentials are valid"
        print_info "Identity: $USER_ARN"
        print_info "Account ID: $ACCOUNT_ID"
    else
        print_success "AWS credentials are valid"
    fi
}

check_project_structure() {
    print_info "Checking project structure..."
    
    # Check required files
    local required_files=(
        "package.json"
        "tsconfig.json"
        "src/agent.ts"
        "src/infrastructure.ts"
        "src/index.ts"
    )
    
    for file in "${required_files[@]}"; do
        if [[ -f "$PROJECT_ROOT/$file" ]]; then
            print_success "Required file exists: $file"
        else
            print_error "Required file missing: $file"
        fi
    done
    
    # Check required directories
    local required_dirs=(
        "src"
        "src/tools"
        "src/utils"
        "tests"
        "scripts"
    )
    
    for dir in "${required_dirs[@]}"; do
        if [[ -d "$PROJECT_ROOT/$dir" ]]; then
            print_success "Required directory exists: $dir"
        else
            print_error "Required directory missing: $dir"
        fi
    done
}

check_dependencies() {
    print_info "Checking dependencies..."
    
    cd "$PROJECT_ROOT"
    
    # Check if node_modules exists
    if [[ ! -d "node_modules" ]]; then
        print_warning "node_modules directory not found - running npm install..."
        if npm install; then
            print_success "Dependencies installed successfully"
        else
            print_error "Failed to install dependencies"
            return 1
        fi
    else
        print_success "node_modules directory exists"
    fi
    
    # Check package.json for required dependencies
    if [[ -f "package.json" ]]; then
        if command -v jq &> /dev/null; then
            local required_deps=(
                "@aws-sdk/client-cost-explorer"
                "@aws-sdk/client-sns"
                "@aws-sdk/client-lambda"
            )
            
            PACKAGE_JSON=$(cat package.json)
            
            for dep in "${required_deps[@]}"; do
                if echo "$PACKAGE_JSON" | jq -e ".dependencies.\"$dep\" // .devDependencies.\"$dep\"" &>/dev/null; then
                    print_success "Required dependency found: $dep"
                else
                    print_error "Required dependency missing: $dep"
                fi
            done
        else
            print_warning "Cannot validate dependencies without jq"
        fi
    else
        print_error "package.json not found"
    fi
}

# Guard against stray 'strands-agents' requires in artifacts
check_for_strands_agents() {
    print_info "Scanning build artifacts for unexpected 'strands-agents' references..."
    local found=0
    if rg -n "strands-agents" dist/ >/dev/null 2>&1; then
        print_error "Found 'strands-agents' reference in dist/"
        rg -n "strands-agents" dist/ || true
        found=1
    fi
    if rg -n "strands-agents" fresh-deployment/ >/dev/null 2>&1; then
        print_error "Found 'strands-agents' reference in fresh-deployment/"
        rg -n "strands-agents" fresh-deployment/ || true
        found=1
    fi
    if [[ $found -eq 1 ]]; then
        return 1
    fi
    print_success "No unexpected 'strands-agents' references detected"
}

check_typescript_compilation() {
    print_info "Checking TypeScript compilation..."
    
    cd "$PROJECT_ROOT"
    
    # Try to compile TypeScript
    if npm run build &> /dev/null; then
        print_success "TypeScript compilation successful"
        
        # Check if dist directory was created
        if [[ -d "dist" ]]; then
            print_success "Build output directory created"
            
            # Check for key output files
            local expected_files=(
                "dist/index.js"
                "dist/agent.js"
                "dist/infrastructure.js"
            )
            
            for file in "${expected_files[@]}"; do
                if [[ -f "$file" ]]; then
                    print_success "Build output file exists: $file"
                else
                    print_warning "Build output file missing: $file"
                fi
            done
        else
            print_warning "Build output directory not created"
        fi
    else
        print_error "TypeScript compilation failed"
        print_info "Run 'npm run build' to see detailed errors"
    fi
}

check_tests() {
    print_info "Checking tests..."
    
    cd "$PROJECT_ROOT"
    
    # Check if test files exist
    if [[ -d "tests" ]]; then
        TEST_COUNT=$(find tests -name "*.test.ts" -o -name "*.spec.ts" | wc -l)
        if [[ $TEST_COUNT -gt 0 ]]; then
            print_success "Found $TEST_COUNT test file(s)"
        else
            print_warning "No test files found in tests directory"
        fi
    else
        print_warning "Tests directory not found"
    fi
    
    # Try to run tests
    if npm test &> /dev/null; then
        print_success "Tests pass successfully"
    else
        print_warning "Tests are failing - check before deployment"
        print_info "Run 'npm test' to see detailed test results"
    fi
}

check_configuration() {
    print_info "Checking configuration..."
    
    cd "$PROJECT_ROOT"
    
    # Run the TypeScript configuration validator
    if [[ -f "scripts/validate-config.ts" ]]; then
        print_info "Running configuration validation..."
        
        if npx ts-node scripts/validate-config.ts --skip-aws 2>/dev/null; then
            print_success "Configuration validation passed"
        else
            print_warning "Configuration validation has issues"
            print_info "Run 'npm run validate:config' for detailed results"
        fi
    else
        print_warning "Configuration validator not found"
    fi
    
    # Check environment variables
    local required_env_vars=(
        "SPEND_THRESHOLD"
        "SNS_TOPIC_ARN"
    )
    
    for var in "${required_env_vars[@]}"; do
        if [[ -n "${!var}" ]]; then
            print_success "Environment variable set: $var"
        else
            print_warning "Environment variable not set: $var"
        fi
    done
    
    # Check optional iOS environment variables
    local ios_env_vars=(
        "IOS_PLATFORM_APP_ARN"
        "IOS_BUNDLE_ID"
    )
    
    local ios_configured=false
    for var in "${ios_env_vars[@]}"; do
        if [[ -n "${!var}" ]]; then
            print_success "iOS environment variable set: $var"
            ios_configured=true
        fi
    done
    
    if [[ "$ios_configured" != "true" ]]; then
        print_warning "iOS environment variables not configured - iOS notifications will be disabled"
    fi
}

check_iam_permissions() {
    print_info "Checking IAM permissions..."
    
    # Test basic AWS access
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "Cannot access AWS - check credentials"
        return 1
    fi
    
    # Test Cost Explorer permissions
    if aws ce get-cost-and-usage \
        --time-period Start=2024-01-01,End=2024-01-02 \
        --granularity DAILY \
        --metrics BlendedCost \
        --output json &>/dev/null; then
        print_success "Cost Explorer permissions are working"
    else
        print_error "Cost Explorer permissions are missing"
    fi
    
    # Test SNS permissions
    if aws sns list-topics --output json &>/dev/null; then
        print_success "SNS list permissions are working"
    else
        print_error "SNS permissions are missing"
    fi
    
    # Test Lambda permissions
    if aws lambda list-functions --output json &>/dev/null; then
        print_success "Lambda list permissions are working"
    else
        print_error "Lambda permissions are missing"
    fi
    
    # Test CloudFormation permissions
    if aws cloudformation list-stacks --output json &>/dev/null; then
        print_success "CloudFormation permissions are working"
    else
        print_error "CloudFormation permissions are missing"
    fi
    
    # Test EventBridge permissions
    if aws events list-rules --output json &>/dev/null; then
        print_success "EventBridge permissions are working"
    else
        print_error "EventBridge permissions are missing"
    fi
}

check_cdk_bootstrap() {
    print_info "Checking CDK bootstrap..."
    
    # Get current AWS account and region
    if command -v jq &> /dev/null; then
        ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
        REGION=${AWS_REGION:-$(aws configure get region 2>/dev/null || echo "us-east-1")}
        
        # Check if CDK is bootstrapped
        BOOTSTRAP_STACK="CDKToolkit"
        if aws cloudformation describe-stacks \
            --region "$REGION" \
            --stack-name "$BOOTSTRAP_STACK" \
            --output json &>/dev/null; then
            print_success "CDK is bootstrapped in $REGION"
        else
            print_error "CDK is not bootstrapped in $REGION"
            print_info "Run: cdk bootstrap aws://$ACCOUNT_ID/$REGION"
        fi
    else
        print_warning "Cannot check CDK bootstrap status without jq"
    fi
}

check_ios_certificates() {
    print_info "Checking iOS certificates (if configured)..."
    
    # Check if iOS is configured
    if [[ -n "$IOS_PLATFORM_APP_ARN" ]]; then
        print_info "iOS platform application configured: $IOS_PLATFORM_APP_ARN"
        
        # Run iOS-specific validation
        if [[ -f "$SCRIPT_DIR/validate-ios-config.sh" ]]; then
            if bash "$SCRIPT_DIR/validate-ios-config.sh" --skip-network &>/dev/null; then
                print_success "iOS configuration validation passed"
            else
                print_warning "iOS configuration has issues"
                print_info "Run './scripts/validate-ios-config.sh' for details"
            fi
        else
            print_warning "iOS validation script not found"
        fi
    else
        print_info "iOS not configured - skipping certificate checks"
    fi
}

generate_deployment_checklist() {
    echo
    print_info "Pre-deployment Checklist"
    echo "========================="
    
    local success_rate=0
    if [[ $VALIDATION_CHECKS -gt 0 ]]; then
        success_rate=$(( (VALIDATION_CHECKS - VALIDATION_ERRORS - VALIDATION_WARNINGS) * 100 / VALIDATION_CHECKS ))
    fi
    
    echo "Total Checks: $VALIDATION_CHECKS"
    echo "Passed: $((VALIDATION_CHECKS - VALIDATION_ERRORS - VALIDATION_WARNINGS))"
    echo "Warnings: $VALIDATION_WARNINGS"
    echo "Errors: $VALIDATION_ERRORS"
    echo "Success Rate: $success_rate%"
    
    echo
    if [[ $VALIDATION_ERRORS -eq 0 ]]; then
        print_success "Pre-deployment validation passed!"
        
        if [[ $VALIDATION_WARNINGS -gt 0 ]]; then
            print_warning "There are $VALIDATION_WARNINGS warning(s) to review"
        fi
        
        echo
        print_info "Ready to deploy! Next steps:"
        echo "1. Review any warnings above"
        echo "2. Run: npm run deploy"
        echo "3. After deployment, run: ./scripts/validate-deployment.sh"
        
    else
        print_error "Pre-deployment validation failed with $VALIDATION_ERRORS error(s)"
        echo
        print_info "Please fix the errors above before deploying"
        echo
        print_info "Common fixes:"
        echo "1. Install missing dependencies: npm install"
        echo "2. Fix TypeScript compilation errors: npm run build"
        echo "3. Configure AWS credentials: aws configure"
        echo "4. Bootstrap CDK: cdk bootstrap"
        echo "5. Set required environment variables"
    fi
}

show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo
    echo "Options:"
    echo "  -h, --help              Show this help message"
    echo "  --skip-tests            Skip test execution"
    echo "  --skip-build            Skip TypeScript compilation"
    echo "  --skip-iam              Skip IAM permission tests"
    echo "  --skip-cdk              Skip CDK bootstrap check"
    echo "  --skip-ios              Skip iOS configuration check"
    echo "  --verbose               Show detailed output"
    echo
    echo "Examples:"
    echo "  $0                      # Full pre-deployment check"
    echo "  $0 --skip-tests         # Skip test execution"
    echo "  $0 --skip-iam           # Skip IAM permission tests"
}

# Parse command line arguments
SKIP_TESTS=false
SKIP_BUILD=false
SKIP_IAM=false
SKIP_CDK=false
SKIP_IOS=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --skip-iam)
            SKIP_IAM=true
            shift
            ;;
        --skip-cdk)
            SKIP_CDK=true
            shift
            ;;
        --skip-ios)
            SKIP_IOS=true
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
    
    check_prerequisites
    check_aws_credentials
    check_project_structure
    check_dependencies
    
    if [[ "$SKIP_BUILD" != "true" ]]; then
        check_typescript_compilation
    fi
    
    if [[ "$SKIP_TESTS" != "true" ]]; then
        check_tests
    fi
    
    check_configuration

    # Scan artifacts for unexpected 'strands-agents' references
    check_for_strands_agents || VALIDATION_ERRORS=$((VALIDATION_ERRORS+1))
    
    if [[ "$SKIP_IAM" != "true" ]]; then
        check_iam_permissions
    fi
    
    if [[ "$SKIP_CDK" != "true" ]]; then
        check_cdk_bootstrap
    fi
    
    if [[ "$SKIP_IOS" != "true" ]]; then
        check_ios_certificates
    fi
    
    generate_deployment_checklist
    
    # Exit with error code if there are critical errors
    exit $VALIDATION_ERRORS
}

# Run main function
main "$@"
