#!/bin/bash

# FinOps AI Agent - Deployment Script
# This script builds and deploys the FinOps AI Agent with AWS Bedrock integration using CDK

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default configuration values
SPEND_THRESHOLD=${SPEND_THRESHOLD:-10}
SCHEDULE_HOUR=${SCHEDULE_HOUR:-9}
CHECK_PERIOD_DAYS=${CHECK_PERIOD_DAYS:-1}
RETRY_ATTEMPTS=${RETRY_ATTEMPTS:-3}
MIN_SERVICE_COST=${MIN_SERVICE_COST:-1}
IOS_BUNDLE_ID=${IOS_BUNDLE_ID:-"com.vinny.aws.spendmonitor"}
APNS_SANDBOX=${APNS_SANDBOX:-"true"}

# Bedrock configuration defaults
BEDROCK_ENABLED=${BEDROCK_ENABLED:-"true"}
BEDROCK_MODEL_ID=${BEDROCK_MODEL_ID:-"amazon.titan-text-express-v1"}
BEDROCK_REGION=${BEDROCK_REGION:-"us-east-1"}
BEDROCK_COST_THRESHOLD=${BEDROCK_COST_THRESHOLD:-"100"}
BEDROCK_RATE_LIMIT=${BEDROCK_RATE_LIMIT:-"10"}
BEDROCK_MAX_TOKENS=${BEDROCK_MAX_TOKENS:-"1000"}
BEDROCK_TEMPERATURE=${BEDROCK_TEMPERATURE:-"0.3"}
BEDROCK_CACHE_TTL=${BEDROCK_CACHE_TTL:-"60"}
BEDROCK_LOG_LEVEL=${BEDROCK_LOG_LEVEL:-"INFO"}
BEDROCK_FALLBACK_ON_ERROR=${BEDROCK_FALLBACK_ON_ERROR:-"true"}

# Deployment configuration
DEPLOYMENT_TIMEOUT=${DEPLOYMENT_TIMEOUT:-"20"}
VALIDATION_TIMEOUT=${VALIDATION_TIMEOUT:-"300"}
ROLLBACK_ON_FAILURE=${ROLLBACK_ON_FAILURE:-"true"}

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

print_bedrock() {
    echo -e "${PURPLE}[BEDROCK]${NC} $1"
}

print_validation() {
    echo -e "${CYAN}[VALIDATION]${NC} $1"
}

print_step() {
    echo -e "${BLUE}==>${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to validate Bedrock configuration
validate_bedrock_config() {
    print_bedrock "Validating Bedrock configuration..."
    
    local validation_errors=0
    
    # Validate model ID
    case "$BEDROCK_MODEL_ID" in
        "amazon.titan-text-express-v1"|"amazon.titan-text-lite-v1"|"amazon.titan-embed-text-v1"|"anthropic.claude-v2"|"anthropic.claude-instant-v1")
            print_success "Valid Bedrock model ID: $BEDROCK_MODEL_ID"
            ;;
        *)
            print_error "Invalid Bedrock model ID: $BEDROCK_MODEL_ID"
            ((validation_errors++))
            ;;
    esac
    
    # Validate region
    case "$BEDROCK_REGION" in
        "us-east-1"|"us-west-2"|"eu-west-1"|"ap-southeast-1"|"ap-northeast-1")
            print_success "Valid Bedrock region: $BEDROCK_REGION"
            ;;
        *)
            print_warning "Bedrock may not be available in region: $BEDROCK_REGION"
            ;;
    esac
    
    # Validate numeric parameters
    if [[ ! "$BEDROCK_COST_THRESHOLD" =~ ^[0-9]+(\.[0-9]+)?$ ]] || (( $(echo "$BEDROCK_COST_THRESHOLD <= 0" | bc -l) )); then
        print_error "Invalid Bedrock cost threshold: $BEDROCK_COST_THRESHOLD (must be positive number)"
        ((validation_errors++))
    fi
    
    if [[ ! "$BEDROCK_RATE_LIMIT" =~ ^[0-9]+$ ]] || [[ "$BEDROCK_RATE_LIMIT" -le 0 ]]; then
        print_error "Invalid Bedrock rate limit: $BEDROCK_RATE_LIMIT (must be positive integer)"
        ((validation_errors++))
    fi
    
    if [[ ! "$BEDROCK_MAX_TOKENS" =~ ^[0-9]+$ ]] || [[ "$BEDROCK_MAX_TOKENS" -le 0 ]] || [[ "$BEDROCK_MAX_TOKENS" -gt 8000 ]]; then
        print_error "Invalid Bedrock max tokens: $BEDROCK_MAX_TOKENS (must be 1-8000)"
        ((validation_errors++))
    fi
    
    if [[ ! "$BEDROCK_TEMPERATURE" =~ ^[0-9]*\.?[0-9]+$ ]] || (( $(echo "$BEDROCK_TEMPERATURE < 0 || $BEDROCK_TEMPERATURE > 1" | bc -l) )); then
        print_error "Invalid Bedrock temperature: $BEDROCK_TEMPERATURE (must be 0.0-1.0)"
        ((validation_errors++))
    fi
    
    if [[ ! "$BEDROCK_CACHE_TTL" =~ ^[0-9]+$ ]] || [[ "$BEDROCK_CACHE_TTL" -le 0 ]]; then
        print_error "Invalid Bedrock cache TTL: $BEDROCK_CACHE_TTL (must be positive integer)"
        ((validation_errors++))
    fi
    
    # Validate log level
    case "$BEDROCK_LOG_LEVEL" in
        "DEBUG"|"INFO"|"WARN"|"ERROR")
            print_success "Valid Bedrock log level: $BEDROCK_LOG_LEVEL"
            ;;
        *)
            print_error "Invalid Bedrock log level: $BEDROCK_LOG_LEVEL (must be DEBUG|INFO|WARN|ERROR)"
            ((validation_errors++))
            ;;
    esac
    
    return $validation_errors
}

# Function to check Bedrock model access
check_bedrock_model_access() {
    print_bedrock "Checking Bedrock model access..."
    
    # Create a temporary test script
    local test_script=$(mktemp)
    cat > "$test_script" << 'EOF'
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

async function testModelAccess() {
    try {
        const client = new BedrockRuntimeClient({ 
            region: process.env.BEDROCK_REGION || 'us-east-1'
        });
        
        const modelId = process.env.BEDROCK_MODEL_ID || 'amazon.titan-text-express-v1';
        
        let requestBody;
        if (modelId.startsWith('amazon.titan')) {
            requestBody = {
                inputText: 'Test',
                textGenerationConfig: {
                    maxTokenCount: 10,
                    temperature: 0.1
                }
            };
        } else if (modelId.startsWith('anthropic.claude')) {
            requestBody = {
                prompt: '\n\nHuman: Test\n\nAssistant:',
                max_tokens_to_sample: 10,
                temperature: 0.1
            };
        }
        
        const command = new InvokeModelCommand({
            modelId: modelId,
            body: JSON.stringify(requestBody),
            contentType: 'application/json',
            accept: 'application/json'
        });
        
        await client.send(command);
        console.log('SUCCESS: Model access validated');
        process.exit(0);
    } catch (error) {
        console.error('ERROR: Model access failed:', error.message);
        process.exit(1);
    }
}

testModelAccess();
EOF
    
    # Run the test with timeout
    if timeout 30s node "$test_script" 2>/dev/null; then
        print_success "Bedrock model access validated successfully"
        rm -f "$test_script"
        return 0
    else
        print_error "Bedrock model access validation failed"
        print_warning "This could be due to:"
        print_warning "1. Model not enabled in AWS Bedrock console"
        print_warning "2. Insufficient IAM permissions"
        print_warning "3. Model not available in region $BEDROCK_REGION"
        print_warning "4. Network connectivity issues"
        rm -f "$test_script"
        return 1
    fi
}

# Function to validate AWS permissions for Bedrock
validate_bedrock_permissions() {
    print_bedrock "Validating Bedrock IAM permissions..."
    
    local permissions_ok=true
    
    # Check if user can list foundation models
    if aws bedrock list-foundation-models --region "$BEDROCK_REGION" >/dev/null 2>&1; then
        print_success "Bedrock list-foundation-models permission verified"
    else
        print_warning "Cannot list Bedrock foundation models (may not be required)"
    fi
    
    # Check Cost Explorer permissions (required for cost monitoring)
    if [[ "$SKIP_COST_EXPLORER_CHECK" != "true" ]]; then
        local yesterday=$(date -d "yesterday" +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d 2>/dev/null || echo "2025-01-01")
        local today=$(date +%Y-%m-%d)
        
        if aws ce get-cost-and-usage \
            --time-period Start="$yesterday",End="$today" \
            --granularity DAILY \
            --metrics BlendedCost \
            --output json >/dev/null 2>&1; then
            print_success "Cost Explorer permissions verified"
        else
            print_warning "Cost Explorer permissions may be limited"
            print_info "This could affect cost analysis features but deployment will continue"
            print_info "To fix: Run './scripts/setup-iam-permissions.sh setup' to automatically add permissions"
            print_info "Or manually add these IAM permissions:"
            print_info "  - ce:GetCostAndUsage"
            print_info "  - ce:GetUsageReport" 
            print_info "  - ce:GetDimensionValues"
            print_info "Or use --skip-cost-explorer to skip this check"
            # Don't fail deployment for Cost Explorer permissions - make it a warning
        fi
    else
        print_info "Cost Explorer permissions check skipped"
    fi
    
    # Check CloudWatch permissions for metrics
    if aws cloudwatch put-metric-data \
        --namespace "SpendMonitor/Test" \
        --metric-data MetricName=TestMetric,Value=1 \
        --region "$BEDROCK_REGION" >/dev/null 2>&1; then
        print_success "CloudWatch metrics permissions verified"
    else
        print_warning "CloudWatch metrics permissions may be limited"
    fi
    
    if [[ "$permissions_ok" == "true" ]]; then
        return 0
    else
        return 1
    fi
}

# Function to run comprehensive pre-deployment validation
run_pre_deployment_validation() {
    print_step "Running pre-deployment validation..."
    
    local validation_script="./scripts/pre-deployment-check.sh"
    local validation_args=""
    
    # Add skip flags based on user preferences
    if [[ "$SKIP_TESTS" == "true" ]]; then
        validation_args="$validation_args --skip-tests"
    fi
    
    if [[ "$SKIP_BEDROCK_VALIDATION" == "true" ]]; then
        validation_args="$validation_args --skip-bedrock"
    fi
    
    if [[ -f "$validation_script" ]]; then
        print_validation "Running comprehensive validation checks..."
        if bash "$validation_script" $validation_args; then
            print_success "Pre-deployment validation passed"
            return 0
        else
            print_error "Pre-deployment validation failed"
            if [[ "$FORCE_DEPLOY" != "true" ]]; then
                print_error "Use --force to deploy anyway (not recommended)"
                return 1
            else
                print_warning "Continuing deployment due to --force flag"
                return 0
            fi
        fi
    else
        print_warning "Pre-deployment validation script not found, running basic checks..."
        return 0
    fi
}

# Function to estimate deployment costs
estimate_deployment_costs() {
    print_step "Estimating deployment costs..."
    
    local monthly_cost=0
    
    # Lambda costs (very minimal for scheduled execution)
    local lambda_cost=1
    monthly_cost=$((monthly_cost + lambda_cost))
    
    # CloudWatch costs
    local cloudwatch_cost=2
    monthly_cost=$((monthly_cost + cloudwatch_cost))
    
    # SNS costs (minimal)
    local sns_cost=1
    monthly_cost=$((monthly_cost + sns_cost))
    
    # Bedrock costs (if enabled)
    if [[ "$BEDROCK_ENABLED" == "true" ]]; then
        print_bedrock "Bedrock AI features enabled - additional costs apply"
        print_bedrock "Monthly cost limit set to: \$${BEDROCK_COST_THRESHOLD}"
        monthly_cost=$((monthly_cost + BEDROCK_COST_THRESHOLD))
    fi
    
    print_status "Estimated monthly cost: \$${monthly_cost} (excluding Bedrock usage)"
    
    if [[ "$BEDROCK_ENABLED" == "true" ]]; then
        print_bedrock "Bedrock costs depend on usage:"
        print_bedrock "- Model: $BEDROCK_MODEL_ID"
        print_bedrock "- Rate limit: $BEDROCK_RATE_LIMIT calls/minute"
        print_bedrock "- Max tokens: $BEDROCK_MAX_TOKENS per request"
        print_bedrock "- Cost limit: \$${BEDROCK_COST_THRESHOLD}/month"
    fi
}

# Function to display help
show_help() {
    cat << EOF
FinOps AI Agent - Deployment Script

Usage: ./deploy.sh [OPTIONS]

Core Options:
    -t, --threshold AMOUNT      Set spend threshold in USD (default: $SPEND_THRESHOLD)
    -s, --schedule HOUR         Set daily check hour in UTC (default: $SCHEDULE_HOUR)
    -p, --period DAYS           Set check period in days (default: $CHECK_PERIOD_DAYS)
    -r, --retry ATTEMPTS        Set retry attempts (default: $RETRY_ATTEMPTS)
    -m, --min-cost AMOUNT       Set minimum service cost to report (default: $MIN_SERVICE_COST)

iOS Options:
    -b, --bundle-id ID          Set iOS bundle ID (default: $IOS_BUNDLE_ID)
    --sandbox                   Use APNS sandbox (default: $APNS_SANDBOX)

Bedrock AI Options:
    --bedrock-enabled BOOL      Enable/disable Bedrock AI (default: $BEDROCK_ENABLED)
    --bedrock-model MODEL       Bedrock model ID (default: $BEDROCK_MODEL_ID)
    --bedrock-region REGION     Bedrock region (default: $BEDROCK_REGION)
    --bedrock-cost-limit AMOUNT Bedrock monthly cost limit (default: $BEDROCK_COST_THRESHOLD)
    --bedrock-rate-limit NUM    API calls per minute (default: $BEDROCK_RATE_LIMIT)
    --bedrock-max-tokens NUM    Max tokens per request (default: $BEDROCK_MAX_TOKENS)
    --bedrock-temperature NUM   Model temperature 0.0-1.0 (default: $BEDROCK_TEMPERATURE)
    --bedrock-cache-ttl MIN     Cache TTL in minutes (default: $BEDROCK_CACHE_TTL)
    --bedrock-log-level LEVEL   Log level: DEBUG|INFO|WARN|ERROR (default: $BEDROCK_LOG_LEVEL)

Deployment Options:
    --skip-tests               Skip running tests
    --skip-lint                Skip linting
    --skip-validation          Skip pre-deployment validation
    --skip-bedrock-validation  Skip Bedrock-specific validation
    --skip-cost-explorer       Skip Cost Explorer permissions check
    --clean                    Clean build artifacts before deployment
    --dry-run                  Show what would be deployed without deploying
    --force                    Force deployment even with validation warnings
    --timeout MINUTES          Deployment timeout in minutes (default: $DEPLOYMENT_TIMEOUT)
    --no-rollback              Disable automatic rollback on failure

Validation Options:
    --validate-only            Run validation checks only, don't deploy
    --validate-bedrock         Validate Bedrock configuration and access
    --validate-ios             Validate iOS configuration
    --validate-permissions     Validate AWS permissions

    -h, --help                 Show this help message

Environment Variables:
    AWS_PROFILE                AWS profile to use for deployment
    AWS_REGION                 AWS region for deployment (default: us-east-1)
    CDK_DEFAULT_ACCOUNT        AWS account ID
    CDK_DEFAULT_REGION         AWS region

Bedrock Environment Variables:
    BEDROCK_ENABLED            Enable Bedrock AI integration
    BEDROCK_MODEL_ID           Bedrock model identifier
    BEDROCK_REGION             AWS region for Bedrock service
    BEDROCK_COST_THRESHOLD     Monthly cost limit for Bedrock usage
    BEDROCK_RATE_LIMIT_PER_MINUTE  API rate limit
    BEDROCK_MAX_TOKENS         Maximum tokens per request
    BEDROCK_TEMPERATURE        Model temperature setting
    BEDROCK_CACHE_TTL_MINUTES  Cache time-to-live
    BEDROCK_LOG_LEVEL          Logging level for Bedrock operations

Examples:
    ./deploy.sh                                    # Deploy with defaults (Bedrock enabled)
    ./deploy.sh -t 50 -s 8 --bedrock-enabled true # $50 threshold, 8 AM UTC, Bedrock enabled
    ./deploy.sh --bedrock-model amazon.titan-text-lite-v1 --bedrock-cost-limit 25  # Cost-optimized Bedrock
    ./deploy.sh --validate-only                    # Run validation checks only
    ./deploy.sh --clean --skip-tests --bedrock-enabled false  # Deploy without AI features
    AWS_PROFILE=prod ./deploy.sh -t 100 --bedrock-region us-west-2  # Production deployment

Bedrock Model Options:
    amazon.titan-text-express-v1    # Balanced performance (recommended)
    amazon.titan-text-lite-v1       # Cost-optimized
    anthropic.claude-v2             # Premium analysis (higher cost)

EOF
}

# Parse command line arguments
SKIP_TESTS=false
SKIP_LINT=false
SKIP_VALIDATION=false
SKIP_BEDROCK_VALIDATION=false
SKIP_COST_EXPLORER_CHECK=false
CLEAN_BUILD=false
DRY_RUN=false
FORCE_DEPLOY=false
VALIDATE_ONLY=false
VALIDATE_BEDROCK=false
VALIDATE_IOS=false
VALIDATE_PERMISSIONS=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--threshold)
            SPEND_THRESHOLD="$2"
            shift 2
            ;;
        -s|--schedule)
            SCHEDULE_HOUR="$2"
            shift 2
            ;;
        -p|--period)
            CHECK_PERIOD_DAYS="$2"
            shift 2
            ;;
        -r|--retry)
            RETRY_ATTEMPTS="$2"
            shift 2
            ;;
        -m|--min-cost)
            MIN_SERVICE_COST="$2"
            shift 2
            ;;
        -b|--bundle-id)
            IOS_BUNDLE_ID="$2"
            shift 2
            ;;
        --sandbox)
            APNS_SANDBOX="true"
            shift
            ;;
        --bedrock-enabled)
            BEDROCK_ENABLED="$2"
            shift 2
            ;;
        --bedrock-model)
            BEDROCK_MODEL_ID="$2"
            shift 2
            ;;
        --bedrock-region)
            BEDROCK_REGION="$2"
            shift 2
            ;;
        --bedrock-cost-limit)
            BEDROCK_COST_THRESHOLD="$2"
            shift 2
            ;;
        --bedrock-rate-limit)
            BEDROCK_RATE_LIMIT="$2"
            shift 2
            ;;
        --bedrock-max-tokens)
            BEDROCK_MAX_TOKENS="$2"
            shift 2
            ;;
        --bedrock-temperature)
            BEDROCK_TEMPERATURE="$2"
            shift 2
            ;;
        --bedrock-cache-ttl)
            BEDROCK_CACHE_TTL="$2"
            shift 2
            ;;
        --bedrock-log-level)
            BEDROCK_LOG_LEVEL="$2"
            shift 2
            ;;
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        --skip-lint)
            SKIP_LINT=true
            shift
            ;;
        --skip-validation)
            SKIP_VALIDATION=true
            shift
            ;;
        --skip-bedrock-validation)
            SKIP_BEDROCK_VALIDATION=true
            shift
            ;;
        --clean)
            CLEAN_BUILD=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --force)
            FORCE_DEPLOY=true
            shift
            ;;
        --timeout)
            DEPLOYMENT_TIMEOUT="$2"
            shift 2
            ;;
        --no-rollback)
            ROLLBACK_ON_FAILURE=false
            shift
            ;;
        --validate-only)
            VALIDATE_ONLY=true
            shift
            ;;
        --validate-bedrock)
            VALIDATE_BEDROCK=true
            shift
            ;;
        --validate-ios)
            VALIDATE_IOS=true
            shift
            ;;
        --validate-permissions)
            VALIDATE_PERMISSIONS=true
            shift
            ;;
        --skip-cost-explorer)
            SKIP_COST_EXPLORER_CHECK=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Print deployment configuration
print_step "FinOps AI Agent Deployment Configuration"
echo "=========================================="
echo "Core Configuration:"
echo "  Spend Threshold: \$${SPEND_THRESHOLD}"
echo "  Schedule Hour: ${SCHEDULE_HOUR}:00 UTC"
echo "  Check Period: ${CHECK_PERIOD_DAYS} days"
echo "  Retry Attempts: ${RETRY_ATTEMPTS}"
echo "  Min Service Cost: \$${MIN_SERVICE_COST}"
echo ""
echo "iOS Configuration:"
echo "  Bundle ID: ${IOS_BUNDLE_ID}"
echo "  APNS Sandbox: ${APNS_SANDBOX}"
echo ""
echo "Bedrock AI Configuration:"
echo "  Enabled: ${BEDROCK_ENABLED}"
if [[ "$BEDROCK_ENABLED" == "true" ]]; then
    echo "  Model: ${BEDROCK_MODEL_ID}"
    echo "  Region: ${BEDROCK_REGION}"
    echo "  Cost Limit: \$${BEDROCK_COST_THRESHOLD}/month"
    echo "  Rate Limit: ${BEDROCK_RATE_LIMIT} calls/minute"
    echo "  Max Tokens: ${BEDROCK_MAX_TOKENS}"
    echo "  Temperature: ${BEDROCK_TEMPERATURE}"
    echo "  Cache TTL: ${BEDROCK_CACHE_TTL} minutes"
    echo "  Log Level: ${BEDROCK_LOG_LEVEL}"
    echo "  Fallback on Error: ${BEDROCK_FALLBACK_ON_ERROR}"
fi
echo ""
echo "AWS Configuration:"
echo "  Profile: ${AWS_PROFILE:-default}"
echo "  Region: ${AWS_REGION:-us-east-1}"
echo "  Deployment Timeout: ${DEPLOYMENT_TIMEOUT} minutes"
echo "  Rollback on Failure: ${ROLLBACK_ON_FAILURE}"
echo ""

# Handle validation-only mode
if [[ "$VALIDATE_ONLY" == "true" ]] || [[ "$VALIDATE_BEDROCK" == "true" ]] || [[ "$VALIDATE_IOS" == "true" ]] || [[ "$VALIDATE_PERMISSIONS" == "true" ]]; then
    print_step "Running validation checks only..."
    
    if [[ "$VALIDATE_BEDROCK" == "true" ]] || [[ "$VALIDATE_ONLY" == "true" ]]; then
        if [[ "$BEDROCK_ENABLED" == "true" ]]; then
            validate_bedrock_config || exit 1
            validate_bedrock_permissions || exit 1
            check_bedrock_model_access || exit 1
        else
            print_bedrock "Bedrock is disabled, skipping Bedrock validation"
        fi
    fi
    
    if [[ "$VALIDATE_IOS" == "true" ]] || [[ "$VALIDATE_ONLY" == "true" ]]; then
        if [[ -f "./scripts/validate-ios-config.sh" ]]; then
            print_status "Running iOS validation..."
            bash "./scripts/validate-ios-config.sh" || exit 1
        else
            print_warning "iOS validation script not found"
        fi
    fi
    
    if [[ "$VALIDATE_PERMISSIONS" == "true" ]] || [[ "$VALIDATE_ONLY" == "true" ]]; then
        validate_bedrock_permissions || exit 1
    fi
    
    if [[ "$VALIDATE_ONLY" == "true" ]]; then
        run_pre_deployment_validation || exit 1
    fi
    
    print_success "Validation completed successfully!"
    exit 0
fi

# Check prerequisites
print_step "Checking prerequisites..."

if ! command_exists node; then
    print_error "Node.js is not installed. Please install Node.js 18+ and try again."
    exit 1
fi

NODE_VERSION=$(node --version)
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1 | sed 's/v//')
if [[ $NODE_MAJOR -lt 18 ]]; then
    print_error "Node.js version is too old: $NODE_VERSION (required: 18+)"
    exit 1
fi

if ! command_exists npm; then
    print_error "npm is not installed. Please install npm and try again."
    exit 1
fi

if ! command_exists aws; then
    print_error "AWS CLI is not installed. Please install AWS CLI and try again."
    exit 1
fi

# Check for bc command (needed for numeric validation)
if ! command_exists bc; then
    print_warning "bc command not found - some validations will be limited"
fi

# Check AWS credentials
print_step "Verifying AWS credentials..."
if ! aws sts get-caller-identity >/dev/null 2>&1; then
    print_error "AWS credentials not configured or invalid. Please run 'aws configure' or set up your credentials."
    exit 1
fi

AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_CURRENT_REGION=$(aws configure get region || echo "us-east-1")
print_success "AWS credentials verified (Account: ${AWS_ACCOUNT}, Region: ${AWS_CURRENT_REGION})"

# Validate Bedrock configuration if enabled
if [[ "$BEDROCK_ENABLED" == "true" ]] && [[ "$SKIP_BEDROCK_VALIDATION" != "true" ]]; then
    print_step "Validating Bedrock configuration..."
    
    if ! validate_bedrock_config; then
        print_error "Bedrock configuration validation failed"
        if [[ "$FORCE_DEPLOY" != "true" ]]; then
            exit 1
        else
            print_warning "Continuing with invalid Bedrock configuration due to --force flag"
        fi
    fi
    
    if ! validate_bedrock_permissions; then
        print_error "Bedrock permissions validation failed"
        if [[ "$FORCE_DEPLOY" != "true" ]]; then
            exit 1
        else
            print_warning "Continuing with insufficient Bedrock permissions due to --force flag"
        fi
    fi
    
    # Run comprehensive Bedrock validation
    if [[ -f "./scripts/validate-bedrock.sh" ]]; then
        print_bedrock "Running comprehensive Bedrock validation..."
        if bash "./scripts/validate-bedrock.sh"; then
            print_success "Comprehensive Bedrock validation passed"
        else
            print_error "Comprehensive Bedrock validation failed"
            if [[ "$FORCE_DEPLOY" != "true" ]]; then
                print_error "Fix Bedrock issues above or use --bedrock-enabled false"
                exit 1
            else
                print_warning "Continuing with failed Bedrock validation due to --force flag"
            fi
        fi
    else
        # Fallback to basic model access check
        if command_exists node && [[ -d "node_modules" ]]; then
            if ! check_bedrock_model_access; then
                print_error "Bedrock model access validation failed"
                if [[ "$FORCE_DEPLOY" != "true" ]]; then
                    print_error "Please ensure:"
                    print_error "1. Model access is enabled in AWS Bedrock console"
                    print_error "2. IAM permissions include bedrock:InvokeModel"
                    print_error "3. Model is available in region $BEDROCK_REGION"
                    exit 1
                else
                    print_warning "Continuing with failed model access due to --force flag"
                fi
            fi
        else
            print_warning "Skipping Bedrock model access test (dependencies not available)"
        fi
    fi
fi

# Run pre-deployment validation
if [[ "$SKIP_VALIDATION" != "true" ]]; then
    if ! run_pre_deployment_validation; then
        print_error "Pre-deployment validation failed"
        exit 1
    fi
fi

# Estimate costs
estimate_deployment_costs

# Clean build artifacts if requested
if [ "$CLEAN_BUILD" = true ]; then
    print_status "Cleaning build artifacts..."
    rm -rf dist/ coverage/ node_modules/.cache/
    print_success "Build artifacts cleaned"
fi

# Install dependencies
print_status "Installing dependencies..."
if ! npm install; then
    print_error "Failed to install dependencies"
    exit 1
fi
print_success "Dependencies installed"

# Run linting
if [ "$SKIP_LINT" = false ]; then
    print_status "Running linter..."
    if ! npm run lint; then
        print_error "Linting failed"
        exit 1
    fi
    print_success "Linting passed"
fi

# Run tests
if [ "$SKIP_TESTS" = false ]; then
    print_status "Running tests..."
    if ! npm run test; then
        print_error "Tests failed"
        exit 1
    fi
    print_success "Tests passed"
fi

# Build the application
print_status "Building application..."
if ! npm run build; then
    print_error "Build failed"
    exit 1
fi
print_success "Application built successfully"

# Check if CDK is installed
if ! command_exists cdk; then
    print_warning "CDK CLI not found globally. Installing locally..."
    if ! npx cdk --version >/dev/null 2>&1; then
        print_error "CDK not available. Please install with: npm install -g aws-cdk"
        exit 1
    fi
    CDK_CMD="npx cdk"
else
    CDK_CMD="cdk"
fi

# Bootstrap CDK if needed
print_status "Checking CDK bootstrap status..."
if ! $CDK_CMD ls >/dev/null 2>&1; then
    print_status "Bootstrapping CDK..."
    if ! $CDK_CMD bootstrap; then
        print_error "CDK bootstrap failed"
        exit 1
    fi
    print_success "CDK bootstrapped"
fi

# Handle dry-run mode
if [[ "$DRY_RUN" == "true" ]]; then
    print_step "Dry-run mode: Showing deployment command without executing..."
    
    DEPLOY_CMD="$CDK_CMD deploy --require-approval never"
    DEPLOY_CMD="$DEPLOY_CMD -c spendThreshold=$SPEND_THRESHOLD"
    DEPLOY_CMD="$DEPLOY_CMD -c scheduleHour=$SCHEDULE_HOUR"
    DEPLOY_CMD="$DEPLOY_CMD -c checkPeriodDays=$CHECK_PERIOD_DAYS"
    DEPLOY_CMD="$DEPLOY_CMD -c retryAttempts=$RETRY_ATTEMPTS"
    DEPLOY_CMD="$DEPLOY_CMD -c minServiceCost=$MIN_SERVICE_COST"
    DEPLOY_CMD="$DEPLOY_CMD -c iosBundleId=$IOS_BUNDLE_ID"
    DEPLOY_CMD="$DEPLOY_CMD -c apnsSandbox=$APNS_SANDBOX"
    
    # Add Bedrock parameters
    DEPLOY_CMD="$DEPLOY_CMD -c bedrockEnabled=$BEDROCK_ENABLED"
    if [[ "$BEDROCK_ENABLED" == "true" ]]; then
        DEPLOY_CMD="$DEPLOY_CMD -c bedrockModelId=$BEDROCK_MODEL_ID"
        DEPLOY_CMD="$DEPLOY_CMD -c bedrockRegion=$BEDROCK_REGION"
        DEPLOY_CMD="$DEPLOY_CMD -c bedrockCostThreshold=$BEDROCK_COST_THRESHOLD"
        DEPLOY_CMD="$DEPLOY_CMD -c bedrockRateLimit=$BEDROCK_RATE_LIMIT"
        DEPLOY_CMD="$DEPLOY_CMD -c bedrockMaxTokens=$BEDROCK_MAX_TOKENS"
        DEPLOY_CMD="$DEPLOY_CMD -c bedrockTemperature=$BEDROCK_TEMPERATURE"
        DEPLOY_CMD="$DEPLOY_CMD -c bedrockCacheTTL=$BEDROCK_CACHE_TTL"
        DEPLOY_CMD="$DEPLOY_CMD -c bedrockLogLevel=$BEDROCK_LOG_LEVEL"
        DEPLOY_CMD="$DEPLOY_CMD -c bedrockDetailedLogging=true"
    fi
    
    print_status "Would execute: $DEPLOY_CMD"
    print_success "Dry-run completed. Use without --dry-run to deploy."
    exit 0
fi

# Deploy the stack
print_step "Deploying AWS infrastructure..."

# Build deployment command with timeout
DEPLOY_CMD="timeout ${DEPLOYMENT_TIMEOUT}m $CDK_CMD deploy"

# Add rollback configuration
if [[ "$ROLLBACK_ON_FAILURE" == "true" ]]; then
    DEPLOY_CMD="$DEPLOY_CMD --rollback true"
else
    DEPLOY_CMD="$DEPLOY_CMD --rollback false"
fi

DEPLOY_CMD="$DEPLOY_CMD --require-approval never"
DEPLOY_CMD="$DEPLOY_CMD -c spendThreshold=$SPEND_THRESHOLD"
DEPLOY_CMD="$DEPLOY_CMD -c scheduleHour=$SCHEDULE_HOUR"
DEPLOY_CMD="$DEPLOY_CMD -c checkPeriodDays=$CHECK_PERIOD_DAYS"
DEPLOY_CMD="$DEPLOY_CMD -c retryAttempts=$RETRY_ATTEMPTS"
DEPLOY_CMD="$DEPLOY_CMD -c minServiceCost=$MIN_SERVICE_COST"
DEPLOY_CMD="$DEPLOY_CMD -c iosBundleId=$IOS_BUNDLE_ID"
DEPLOY_CMD="$DEPLOY_CMD -c apnsSandbox=$APNS_SANDBOX"

# Add Bedrock parameters
DEPLOY_CMD="$DEPLOY_CMD -c bedrockEnabled=$BEDROCK_ENABLED"
if [[ "$BEDROCK_ENABLED" == "true" ]]; then
    DEPLOY_CMD="$DEPLOY_CMD -c bedrockModelId=$BEDROCK_MODEL_ID"
    DEPLOY_CMD="$DEPLOY_CMD -c bedrockRegion=$BEDROCK_REGION"
    DEPLOY_CMD="$DEPLOY_CMD -c bedrockCostThreshold=$BEDROCK_COST_THRESHOLD"
    DEPLOY_CMD="$DEPLOY_CMD -c bedrockRateLimit=$BEDROCK_RATE_LIMIT"
    DEPLOY_CMD="$DEPLOY_CMD -c bedrockMaxTokens=$BEDROCK_MAX_TOKENS"
    DEPLOY_CMD="$DEPLOY_CMD -c bedrockTemperature=$BEDROCK_TEMPERATURE"
    DEPLOY_CMD="$DEPLOY_CMD -c bedrockCacheTTL=$BEDROCK_CACHE_TTL"
    DEPLOY_CMD="$DEPLOY_CMD -c bedrockLogLevel=$BEDROCK_LOG_LEVEL"
    DEPLOY_CMD="$DEPLOY_CMD -c bedrockDetailedLogging=true"
fi

print_status "Executing: $DEPLOY_CMD"

# Execute deployment with error handling
DEPLOYMENT_START_TIME=$(date +%s)
if eval $DEPLOY_CMD; then
    DEPLOYMENT_END_TIME=$(date +%s)
    DEPLOYMENT_DURATION=$((DEPLOYMENT_END_TIME - DEPLOYMENT_START_TIME))
    print_success "Deployment completed successfully in ${DEPLOYMENT_DURATION} seconds!"
else
    DEPLOYMENT_END_TIME=$(date +%s)
    DEPLOYMENT_DURATION=$((DEPLOYMENT_END_TIME - DEPLOYMENT_START_TIME))
    print_error "Deployment failed after ${DEPLOYMENT_DURATION} seconds"
    
    if [[ "$ROLLBACK_ON_FAILURE" == "true" ]]; then
        print_status "Automatic rollback should have been triggered..."
    fi
    
    print_error "Deployment troubleshooting:"
    print_error "1. Check CloudFormation console for detailed error messages"
    print_error "2. Verify all IAM permissions are correctly configured"
    print_error "3. Check if Bedrock models are enabled in the target region"
    print_error "4. Ensure CDK is properly bootstrapped"
    print_error "5. Review CloudWatch logs for Lambda deployment issues"
    
    exit 1
fi

# Run post-deployment validation
print_step "Running post-deployment validation..."
if [[ -f "./scripts/validate-deployment.sh" ]]; then
    if bash "./scripts/validate-deployment.sh" --timeout 60; then
        print_success "Post-deployment validation passed"
    else
        print_warning "Post-deployment validation failed - check the deployment"
    fi
else
    print_warning "Post-deployment validation script not found"
fi

print_success "FinOps AI Agent deployment completed successfully!"
echo ""
print_step "Next Steps:"
echo ""
echo "1. Configure SNS topic subscriptions for alerts:"
echo "   aws sns subscribe --topic-arn \$(aws sns list-topics --query 'Topics[?contains(TopicArn, \`aws-spend-alerts\`)].TopicArn' --output text) --protocol email --notification-endpoint your-email@example.com"
echo ""
echo "2. Test the deployment:"
echo "   aws lambda invoke --function-name \$(aws lambda list-functions --query 'Functions[?contains(FunctionName, \`SpendMonitorAgent\`)].FunctionName' --output text) --payload '{}' response.json"
echo ""
echo "3. Monitor logs:"
echo "   aws logs tail /aws/lambda/spend-monitor-agent --follow"
echo ""

if [[ "$BEDROCK_ENABLED" == "true" ]]; then
    print_bedrock "Bedrock AI Features Enabled:"
    echo "   - Model: $BEDROCK_MODEL_ID"
    echo "   - Region: $BEDROCK_REGION"
    echo "   - Monthly cost limit: \$${BEDROCK_COST_THRESHOLD}"
    echo "   - Rate limit: ${BEDROCK_RATE_LIMIT} calls/minute"
    echo ""
    print_bedrock "Monitor Bedrock usage:"
    echo "   aws logs filter-log-events --log-group-name /aws/lambda/spend-monitor-agent --filter-pattern '[timestamp, requestId, level=\"BEDROCK\"]'"
    echo ""
    print_bedrock "Check Bedrock costs:"
    echo "   aws ce get-cost-and-usage --time-period Start=\$(date -d '1 month ago' +%Y-%m-%d),End=\$(date +%Y-%m-%d) --granularity MONTHLY --metrics BlendedCost --group-by Type=DIMENSION,Key=SERVICE --query 'ResultsByTime[0].Groups[?Keys[0]==\`Amazon Bedrock\`]'"
    echo ""
fi

echo "4. iOS Device Registration (if configured):"
echo "   API Endpoint: \$(aws apigateway get-rest-apis --query 'items[?name==\`iOS Device Registration API\`].id' --output text)"
echo "   Register device: POST /devices with {\"deviceToken\": \"your-device-token\"}"
echo ""
echo "5. Validate configuration:"
echo "   ./scripts/validate-deployment.sh"
echo ""
echo "6. Run integration tests:"
echo "   npm run test:integration"
echo ""

print_success "FinOps AI Agent is now deployed and will run daily at ${SCHEDULE_HOUR}:00 UTC"

if [[ "$BEDROCK_ENABLED" == "true" ]]; then
    print_bedrock "AI-enhanced cost analysis is enabled with fallback to traditional analysis"
else
    print_status "Traditional cost analysis is enabled (Bedrock AI disabled)"
fi

echo ""
print_status "Deployment Summary:"
echo "   Duration: ${DEPLOYMENT_DURATION} seconds"
echo "   AWS Account: ${AWS_ACCOUNT}"
echo "   Region: ${AWS_CURRENT_REGION}"
echo "   Bedrock Enabled: ${BEDROCK_ENABLED}"
if [[ "$BEDROCK_ENABLED" == "true" ]]; then
    echo "   Bedrock Model: ${BEDROCK_MODEL_ID}"
    echo "   Bedrock Region: ${BEDROCK_REGION}"
fi
echo "   Schedule: Daily at ${SCHEDULE_HOUR}:00 UTC"
echo "   Spend Threshold: \$${SPEND_THRESHOLD}"
