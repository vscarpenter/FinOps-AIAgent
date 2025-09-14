#!/bin/bash

# AWS Spend Monitor Agent - Deployment Script
# This script builds and deploys the AWS Spend Monitor Agent using CDK

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default configuration values
SPEND_THRESHOLD=${SPEND_THRESHOLD:-10}
SCHEDULE_HOUR=${SCHEDULE_HOUR:-9}
CHECK_PERIOD_DAYS=${CHECK_PERIOD_DAYS:-1}
RETRY_ATTEMPTS=${RETRY_ATTEMPTS:-3}
MIN_SERVICE_COST=${MIN_SERVICE_COST:-1}
IOS_BUNDLE_ID=${IOS_BUNDLE_ID:-"com.vinny.aws.spendmonitor"}
APNS_SANDBOX=${APNS_SANDBOX:-"true"}

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

# Function to display help
show_help() {
    cat << EOF
AWS Spend Monitor Agent - Deployment Script

Usage: ./deploy.sh [OPTIONS]

Options:
    -t, --threshold AMOUNT      Set spend threshold in USD (default: $SPEND_THRESHOLD)
    -s, --schedule HOUR         Set daily check hour in UTC (default: $SCHEDULE_HOUR)
    -p, --period DAYS           Set check period in days (default: $CHECK_PERIOD_DAYS)
    -r, --retry ATTEMPTS        Set retry attempts (default: $RETRY_ATTEMPTS)
    -m, --min-cost AMOUNT       Set minimum service cost to report (default: $MIN_SERVICE_COST)
    -b, --bundle-id ID          Set iOS bundle ID (default: $IOS_BUNDLE_ID)
    --sandbox                   Use APNS sandbox (default: $APNS_SANDBOX)
    --skip-tests               Skip running tests
    --skip-lint                Skip linting
    --clean                    Clean build artifacts before deployment
    -h, --help                 Show this help message

Environment Variables:
    AWS_PROFILE                AWS profile to use for deployment
    AWS_REGION                 AWS region for deployment (default: us-east-1)
    CDK_DEFAULT_ACCOUNT        AWS account ID
    CDK_DEFAULT_REGION         AWS region

Examples:
    ./deploy.sh                                    # Deploy with defaults
    ./deploy.sh -t 50 -s 8                        # $50 threshold, 8 AM UTC
    ./deploy.sh --clean --skip-tests               # Clean build, skip tests
    AWS_PROFILE=prod ./deploy.sh -t 100            # Use 'prod' AWS profile

EOF
}

# Parse command line arguments
SKIP_TESTS=false
SKIP_LINT=false
CLEAN_BUILD=false

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
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        --skip-lint)
            SKIP_LINT=true
            shift
            ;;
        --clean)
            CLEAN_BUILD=true
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
print_status "AWS Spend Monitor Agent Deployment"
echo "=================================="
echo "Configuration:"
echo "  Spend Threshold: \$${SPEND_THRESHOLD}"
echo "  Schedule Hour: ${SCHEDULE_HOUR}:00 UTC"
echo "  Check Period: ${CHECK_PERIOD_DAYS} days"
echo "  Retry Attempts: ${RETRY_ATTEMPTS}"
echo "  Min Service Cost: \$${MIN_SERVICE_COST}"
echo "  iOS Bundle ID: ${IOS_BUNDLE_ID}"
echo "  APNS Sandbox: ${APNS_SANDBOX}"
echo "  AWS Profile: ${AWS_PROFILE:-default}"
echo "  AWS Region: ${AWS_REGION:-us-east-1}"
echo ""

# Check prerequisites
print_status "Checking prerequisites..."

if ! command_exists node; then
    print_error "Node.js is not installed. Please install Node.js 18+ and try again."
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

# Check AWS credentials
print_status "Verifying AWS credentials..."
if ! aws sts get-caller-identity >/dev/null 2>&1; then
    print_error "AWS credentials not configured or invalid. Please run 'aws configure' or set up your credentials."
    exit 1
fi

AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_CURRENT_REGION=$(aws configure get region || echo "us-east-1")
print_success "AWS credentials verified (Account: ${AWS_ACCOUNT}, Region: ${AWS_CURRENT_REGION})"

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

# Deploy the stack
print_status "Deploying AWS infrastructure..."
DEPLOY_CMD="$CDK_CMD deploy --require-approval never"
DEPLOY_CMD="$DEPLOY_CMD -c spendThreshold=$SPEND_THRESHOLD"
DEPLOY_CMD="$DEPLOY_CMD -c scheduleHour=$SCHEDULE_HOUR"
DEPLOY_CMD="$DEPLOY_CMD -c checkPeriodDays=$CHECK_PERIOD_DAYS"
DEPLOY_CMD="$DEPLOY_CMD -c retryAttempts=$RETRY_ATTEMPTS"
DEPLOY_CMD="$DEPLOY_CMD -c minServiceCost=$MIN_SERVICE_COST"
DEPLOY_CMD="$DEPLOY_CMD -c iosBundleId=$IOS_BUNDLE_ID"
DEPLOY_CMD="$DEPLOY_CMD -c apnsSandbox=$APNS_SANDBOX"

print_status "Executing: $DEPLOY_CMD"
if ! eval $DEPLOY_CMD; then
    print_error "Deployment failed"
    exit 1
fi

print_success "Deployment completed successfully!"
echo ""
print_status "Next steps:"
echo "1. Configure SNS topic subscriptions for alerts:"
echo "   aws sns subscribe --topic-arn \$(aws sns list-topics --query 'Topics[?contains(TopicArn, \`aws-spend-alerts\`)].TopicArn' --output text) --protocol email --notification-endpoint vscarpenter@gmail.com"
echo ""
echo "2. Test the deployment:"
echo "   aws lambda invoke --function-name \$(aws lambda list-functions --query 'Functions[?contains(FunctionName, \`SpendMonitorAgent\`)].FunctionName' --output text) --payload '{}' response.json"
echo ""
echo "3. Monitor logs:"
echo "   aws logs tail /aws/lambda/spend-monitor-agent --follow"
echo ""
print_success "AWS Spend Monitor Agent is now deployed and will run daily at ${SCHEDULE_HOUR}:00 UTC"
