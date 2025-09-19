#!/bin/bash

# AI Integration Test Runner
# This script runs the Bedrock AI integration tests with proper environment setup

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🤖 AWS Bedrock AI Integration Test Runner${NC}"
echo "=================================================="

# Check if integration tests are enabled
if [ "$RUN_INTEGRATION_TESTS" != "true" ]; then
    echo -e "${YELLOW}⚠️  Integration tests are disabled${NC}"
    echo "Set RUN_INTEGRATION_TESTS=true to enable integration tests"
    exit 0
fi

# Check if Bedrock integration is enabled
if [ "$TEST_BEDROCK_INTEGRATION" != "true" ]; then
    echo -e "${YELLOW}⚠️  Bedrock AI integration tests are disabled${NC}"
    echo "Set TEST_BEDROCK_INTEGRATION=true to enable AI integration tests"
    exit 0
fi

# Validate required environment variables
echo -e "${BLUE}🔍 Validating environment...${NC}"

required_vars=("AWS_REGION" "AWS_ACCESS_KEY_ID" "AWS_SECRET_ACCESS_KEY")
missing_vars=()

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=("$var")
    fi
done

if [ ${#missing_vars[@]} -ne 0 ]; then
    echo -e "${RED}❌ Missing required environment variables:${NC}"
    printf '%s\n' "${missing_vars[@]}"
    echo ""
    echo "Please ensure AWS credentials are configured:"
    echo "  export AWS_REGION=us-east-1"
    echo "  export AWS_ACCESS_KEY_ID=your-access-key"
    echo "  export AWS_SECRET_ACCESS_KEY=your-secret-key"
    exit 1
fi

# Set default values for optional variables
export TEST_BEDROCK_MODEL_ID=${TEST_BEDROCK_MODEL_ID:-"amazon.titan-text-express-v1"}
export AWS_REGION=${AWS_REGION:-"us-east-1"}

echo -e "${GREEN}✅ Environment validation passed${NC}"
echo "  Region: $AWS_REGION"
echo "  Model: $TEST_BEDROCK_MODEL_ID"

# Check AWS credentials and Bedrock access
echo -e "${BLUE}🔐 Validating AWS credentials and Bedrock access...${NC}"

# Test basic AWS access
if ! aws sts get-caller-identity --region "$AWS_REGION" >/dev/null 2>&1; then
    echo -e "${RED}❌ AWS credentials validation failed${NC}"
    echo "Please check your AWS credentials and permissions"
    exit 1
fi

echo -e "${GREEN}✅ AWS credentials validated${NC}"

# Check Bedrock model access (this will be done in the tests, but we can check basic permissions)
echo -e "${BLUE}🧠 Checking Bedrock permissions...${NC}"

# Note: We can't easily test Bedrock access without making an actual API call,
# so we'll let the tests handle this validation

echo -e "${GREEN}✅ Basic setup validation completed${NC}"

# Build the project
echo -e "${BLUE}🔨 Building project...${NC}"
if ! npm run build; then
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Build completed${NC}"

# Run AI integration tests
echo -e "${BLUE}🧪 Running AI integration tests...${NC}"

test_files=(
    "tests/integration/bedrock-ai-integration.test.ts"
)

# Add performance tests if enabled
if [ "$RUN_PERFORMANCE_TESTS" = "true" ]; then
    echo -e "${YELLOW}📊 Performance tests enabled${NC}"
    test_files+=("tests/integration/ai-performance.test.ts")
fi

# Run the tests
test_command="npm test"
for file in "${test_files[@]}"; do
    test_command="$test_command $file"
done

echo "Running: $test_command"
echo ""

if $test_command; then
    echo ""
    echo -e "${GREEN}🎉 All AI integration tests passed!${NC}"
    
    # Display cost warning
    echo ""
    echo -e "${YELLOW}💰 Cost Information:${NC}"
    echo "These tests make real API calls to AWS Bedrock which incur costs:"
    echo "  • Titan Text model: ~\$0.0008 per 1K input tokens, ~\$0.0016 per 1K output tokens"
    echo "  • Typical test run: ~\$0.01 - \$0.05 total cost"
    echo "  • Monitor your AWS billing dashboard for actual costs"
    
else
    echo ""
    echo -e "${RED}❌ AI integration tests failed${NC}"
    echo ""
    echo -e "${YELLOW}🔧 Troubleshooting tips:${NC}"
    echo "1. Verify Bedrock model access in your AWS region"
    echo "2. Check that your AWS account has Bedrock permissions"
    echo "3. Ensure the model ID is correct and available"
    echo "4. Check AWS service status for any outages"
    echo "5. Review test logs for specific error messages"
    
    exit 1
fi

echo ""
echo -e "${BLUE}📋 Test Summary:${NC}"
echo "  • Integration tests: ✅ Enabled"
echo "  • Bedrock AI tests: ✅ Enabled"
echo "  • Performance tests: $([ "$RUN_PERFORMANCE_TESTS" = "true" ] && echo "✅ Enabled" || echo "❌ Disabled")"
echo "  • Model: $TEST_BEDROCK_MODEL_ID"
echo "  • Region: $AWS_REGION"

echo ""
echo -e "${GREEN}🚀 AI integration testing completed successfully!${NC}"