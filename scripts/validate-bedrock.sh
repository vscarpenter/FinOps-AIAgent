#!/bin/bash

# Bedrock Validation Script
# Comprehensive validation for AWS Bedrock integration

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

# Validation counters
VALIDATION_ERRORS=0
VALIDATION_WARNINGS=0
VALIDATION_CHECKS=0

# Functions
print_bedrock() {
    echo -e "${PURPLE}[BEDROCK]${NC} $1"
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

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Validate Bedrock configuration
validate_bedrock_config() {
    print_bedrock "Validating Bedrock configuration..."
    
    # Check if Bedrock is enabled
    if [[ "$BEDROCK_ENABLED" != "true" ]]; then
        print_info "Bedrock is disabled, skipping validation"
        return 0
    fi
    
    # Validate model ID
    case "$BEDROCK_MODEL_ID" in
        "amazon.titan-text-express-v1")
            print_success "Valid Bedrock model: $BEDROCK_MODEL_ID (Recommended)"
            ;;
        "amazon.titan-text-lite-v1")
            print_success "Valid Bedrock model: $BEDROCK_MODEL_ID (Cost-optimized)"
            ;;
        "amazon.titan-embed-text-v1")
            print_success "Valid Bedrock model: $BEDROCK_MODEL_ID (Embeddings)"
            ;;
        "anthropic.claude-v2")
            print_success "Valid Bedrock model: $BEDROCK_MODEL_ID (Premium)"
            print_warning "Claude models have higher costs - monitor usage carefully"
            ;;
        "anthropic.claude-instant-v1")
            print_success "Valid Bedrock model: $BEDROCK_MODEL_ID (Fast)"
            ;;
        *)
            print_error "Invalid or unsupported Bedrock model ID: $BEDROCK_MODEL_ID"
            print_info "Supported models: amazon.titan-text-express-v1, amazon.titan-text-lite-v1, anthropic.claude-v2"
            ;;
    esac
    
    # Validate region
    case "$BEDROCK_REGION" in
        "us-east-1")
            print_success "Bedrock region: $BEDROCK_REGION (Primary)"
            ;;
        "us-west-2"|"eu-west-1"|"ap-southeast-1"|"ap-northeast-1")
            print_success "Bedrock region: $BEDROCK_REGION (Supported)"
            ;;
        *)
            print_warning "Bedrock may not be available in region: $BEDROCK_REGION"
            print_info "Recommended regions: us-east-1, us-west-2, eu-west-1"
            ;;
    esac
    
    # Validate numeric parameters
    if ! command_exists bc; then
        print_warning "bc command not found - skipping numeric validations"
    else
        # Cost threshold validation
        if [[ ! "$BEDROCK_COST_THRESHOLD" =~ ^[0-9]+(\.[0-9]+)?$ ]] || (( $(echo "$BEDROCK_COST_THRESHOLD <= 0" | bc -l) )); then
            print_error "Invalid Bedrock cost threshold: $BEDROCK_COST_THRESHOLD (must be positive number)"
        elif (( $(echo "$BEDROCK_COST_THRESHOLD < 10" | bc -l) )); then
            print_warning "Low Bedrock cost threshold: \$${BEDROCK_COST_THRESHOLD} (may limit functionality)"
        elif (( $(echo "$BEDROCK_COST_THRESHOLD > 500" | bc -l) )); then
            print_warning "High Bedrock cost threshold: \$${BEDROCK_COST_THRESHOLD} (monitor costs carefully)"
        else
            print_success "Bedrock cost threshold: \$${BEDROCK_COST_THRESHOLD}"
        fi
        
        # Temperature validation
        if [[ ! "$BEDROCK_TEMPERATURE" =~ ^[0-9]*\.?[0-9]+$ ]] || (( $(echo "$BEDROCK_TEMPERATURE < 0 || $BEDROCK_TEMPERATURE > 1" | bc -l) )); then
            print_error "Invalid Bedrock temperature: $BEDROCK_TEMPERATURE (must be 0.0-1.0)"
        elif (( $(echo "$BEDROCK_TEMPERATURE < 0.1" | bc -l) )); then
            print_info "Low temperature setting: $BEDROCK_TEMPERATURE (very deterministic responses)"
        elif (( $(echo "$BEDROCK_TEMPERATURE > 0.7" | bc -l) )); then
            print_warning "High temperature setting: $BEDROCK_TEMPERATURE (may produce inconsistent results)"
        else
            print_success "Bedrock temperature: $BEDROCK_TEMPERATURE"
        fi
    fi
    
    # Rate limit validation
    if [[ ! "$BEDROCK_RATE_LIMIT" =~ ^[0-9]+$ ]] || [[ "$BEDROCK_RATE_LIMIT" -le 0 ]]; then
        print_error "Invalid Bedrock rate limit: $BEDROCK_RATE_LIMIT (must be positive integer)"
    elif [[ "$BEDROCK_RATE_LIMIT" -lt 5 ]]; then
        print_warning "Low rate limit: $BEDROCK_RATE_LIMIT calls/minute (may impact performance)"
    elif [[ "$BEDROCK_RATE_LIMIT" -gt 50 ]]; then
        print_warning "High rate limit: $BEDROCK_RATE_LIMIT calls/minute (monitor costs carefully)"
    else
        print_success "Bedrock rate limit: $BEDROCK_RATE_LIMIT calls/minute"
    fi
    
    # Max tokens validation
    if [[ ! "$BEDROCK_MAX_TOKENS" =~ ^[0-9]+$ ]] || [[ "$BEDROCK_MAX_TOKENS" -le 0 ]]; then
        print_error "Invalid Bedrock max tokens: $BEDROCK_MAX_TOKENS (must be positive integer)"
    elif [[ "$BEDROCK_MAX_TOKENS" -gt 8000 ]]; then
        print_error "Bedrock max tokens too high: $BEDROCK_MAX_TOKENS (maximum: 8000)"
    elif [[ "$BEDROCK_MAX_TOKENS" -lt 100 ]]; then
        print_warning "Low max tokens: $BEDROCK_MAX_TOKENS (may limit response quality)"
    else
        print_success "Bedrock max tokens: $BEDROCK_MAX_TOKENS"
    fi
}

# Check AWS credentials and permissions
check_aws_permissions() {
    print_bedrock "Checking AWS permissions..."
    
    # Check basic AWS access
    if ! aws sts get-caller-identity >/dev/null 2>&1; then
        print_error "Cannot access AWS - check credentials"
        return 1
    fi
    
    local account_id=$(aws sts get-caller-identity --query Account --output text)
    local current_region=$(aws configure get region || echo "us-east-1")
    print_success "AWS access verified (Account: $account_id, Region: $current_region)"
    
    # Check Bedrock permissions
    if aws bedrock list-foundation-models --region "$BEDROCK_REGION" >/dev/null 2>&1; then
        print_success "Bedrock list-foundation-models permission verified"
    else
        print_warning "Cannot list Bedrock foundation models (may not be required for runtime)"
    fi
    
    # Check Cost Explorer permissions
    if aws ce get-cost-and-usage \
        --time-period Start=2024-01-01,End=2024-01-02 \
        --granularity DAILY \
        --metrics BlendedCost \
        --output json >/dev/null 2>&1; then
        print_success "Cost Explorer permissions verified"
    else
        print_error "Cost Explorer permissions missing - required for cost analysis"
    fi
    
    # Check CloudWatch permissions
    if aws cloudwatch put-metric-data \
        --namespace "SpendMonitor/Test" \
        --metric-data MetricName=TestMetric,Value=1 \
        --region "$BEDROCK_REGION" >/dev/null 2>&1; then
        print_success "CloudWatch metrics permissions verified"
    else
        print_warning "CloudWatch metrics permissions may be limited"
    fi
}

# Check Bedrock model access
check_model_access() {
    print_bedrock "Checking Bedrock model access..."
    
    if [[ "$BEDROCK_ENABLED" != "true" ]]; then
        print_info "Bedrock disabled, skipping model access check"
        return 0
    fi
    
    # Check if we have Node.js and required dependencies
    if ! command_exists node; then
        print_warning "Node.js not found - cannot test model access"
        return 0
    fi
    
    if [[ ! -d "node_modules" ]]; then
        print_warning "Node modules not installed - cannot test model access"
        return 0
    fi
    
    # Create temporary test script
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
        if (modelId.startsWith('amazon.titan-text')) {
            requestBody = {
                inputText: 'Test access validation',
                textGenerationConfig: {
                    maxTokenCount: 10,
                    temperature: 0.1,
                    stopSequences: [],
                    topP: 1
                }
            };
        } else if (modelId.startsWith('amazon.titan-embed')) {
            requestBody = {
                inputText: 'Test access validation'
            };
        } else if (modelId.startsWith('anthropic.claude')) {
            requestBody = {
                prompt: '\n\nHuman: Test access validation\n\nAssistant:',
                max_tokens_to_sample: 10,
                temperature: 0.1
            };
        } else {
            throw new Error(`Unsupported model: ${modelId}`);
        }
        
        const command = new InvokeModelCommand({
            modelId: modelId,
            body: JSON.stringify(requestBody),
            contentType: 'application/json',
            accept: 'application/json'
        });
        
        const response = await client.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        
        console.log('SUCCESS: Model access validated');
        console.log(`Model: ${modelId}`);
        console.log(`Response received: ${JSON.stringify(responseBody).length} bytes`);
        process.exit(0);
    } catch (error) {
        console.error('ERROR: Model access failed');
        console.error(`Model: ${process.env.BEDROCK_MODEL_ID || 'amazon.titan-text-express-v1'}`);
        console.error(`Error: ${error.message}`);
        
        if (error.name === 'AccessDeniedException') {
            console.error('CAUSE: Model access not enabled in Bedrock console');
        } else if (error.name === 'ValidationException') {
            console.error('CAUSE: Invalid request parameters');
        } else if (error.name === 'ThrottlingException') {
            console.error('CAUSE: Rate limiting - try again later');
        } else if (error.name === 'ServiceUnavailableException') {
            console.error('CAUSE: Bedrock service unavailable in region');
        }
        
        process.exit(1);
    }
}

testModelAccess();
EOF
    
    # Set environment variables for the test
    export BEDROCK_REGION="$BEDROCK_REGION"
    export BEDROCK_MODEL_ID="$BEDROCK_MODEL_ID"
    
    # Run the test with timeout
    if timeout 30s node "$test_script" 2>/dev/null; then
        print_success "Bedrock model access validated successfully"
        rm -f "$test_script"
        return 0
    else
        print_error "Bedrock model access validation failed"
        print_info "Common causes:"
        print_info "1. Model not enabled in AWS Bedrock console"
        print_info "2. Insufficient IAM permissions (bedrock:InvokeModel)"
        print_info "3. Model not available in region $BEDROCK_REGION"
        print_info "4. Network connectivity issues"
        print_info "5. Invalid model configuration"
        
        print_info "To fix:"
        print_info "1. Go to AWS Bedrock console → Model access"
        print_info "2. Request access to model: $BEDROCK_MODEL_ID"
        print_info "3. Wait for approval (usually instant)"
        print_info "4. Verify IAM permissions include bedrock:InvokeModel"
        
        rm -f "$test_script"
        return 1
    fi
}

# Check Bedrock service availability
check_service_availability() {
    print_bedrock "Checking Bedrock service availability..."
    
    # Check if Bedrock is available in the region
    if aws bedrock list-foundation-models --region "$BEDROCK_REGION" --output json >/dev/null 2>&1; then
        print_success "Bedrock service is available in $BEDROCK_REGION"
        
        # Check if our specific model is available
        local available_models=$(aws bedrock list-foundation-models --region "$BEDROCK_REGION" --query 'modelSummaries[].modelId' --output text 2>/dev/null || echo "")
        
        if echo "$available_models" | grep -q "$BEDROCK_MODEL_ID"; then
            print_success "Model $BEDROCK_MODEL_ID is available in $BEDROCK_REGION"
        else
            print_warning "Model $BEDROCK_MODEL_ID may not be available in $BEDROCK_REGION"
            print_info "Available models in $BEDROCK_REGION:"
            echo "$available_models" | tr ' ' '\n' | grep -E "(titan|claude)" | head -5 | sed 's/^/  - /'
        fi
    else
        print_error "Bedrock service is not available in $BEDROCK_REGION"
        print_info "Bedrock is available in: us-east-1, us-west-2, eu-west-1, ap-southeast-1"
    fi
}

# Estimate Bedrock costs
estimate_costs() {
    print_bedrock "Estimating Bedrock costs..."
    
    if [[ "$BEDROCK_ENABLED" != "true" ]]; then
        print_info "Bedrock disabled, no additional costs"
        return 0
    fi
    
    local daily_calls=1  # Assuming daily cost analysis
    local monthly_calls=$((daily_calls * 30))
    local tokens_per_call="$BEDROCK_MAX_TOKENS"
    
    # Rough cost estimates (as of 2024)
    case "$BEDROCK_MODEL_ID" in
        "amazon.titan-text-express-v1")
            local cost_per_1k_tokens=0.0008
            ;;
        "amazon.titan-text-lite-v1")
            local cost_per_1k_tokens=0.0003
            ;;
        "anthropic.claude-v2")
            local cost_per_1k_tokens=0.008
            ;;
        "anthropic.claude-instant-v1")
            local cost_per_1k_tokens=0.0008
            ;;
        *)
            local cost_per_1k_tokens=0.001
            ;;
    esac
    
    if command_exists bc; then
        local monthly_cost=$(echo "scale=2; $monthly_calls * $tokens_per_call * $cost_per_1k_tokens / 1000" | bc)
        print_info "Estimated monthly cost: \$${monthly_cost} (based on daily usage)"
        print_info "Cost limit set to: \$${BEDROCK_COST_THRESHOLD}"
        
        if (( $(echo "$monthly_cost > $BEDROCK_COST_THRESHOLD" | bc -l) )); then
            print_warning "Estimated cost exceeds limit - consider reducing max tokens or rate limit"
        else
            print_success "Estimated cost within limit"
        fi
    else
        print_info "Cannot calculate costs without bc command"
    fi
    
    print_info "Cost factors:"
    print_info "- Model: $BEDROCK_MODEL_ID"
    print_info "- Max tokens per call: $BEDROCK_MAX_TOKENS"
    print_info "- Rate limit: $BEDROCK_RATE_LIMIT calls/minute"
    print_info "- Estimated daily calls: $daily_calls"
}

# Generate validation report
generate_report() {
    echo
    print_bedrock "Bedrock Validation Report"
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
        print_success "Bedrock validation passed!"
        
        if [[ $VALIDATION_WARNINGS -gt 0 ]]; then
            print_warning "Review $VALIDATION_WARNINGS warning(s) above"
        fi
        
        echo
        print_bedrock "Bedrock is ready for deployment!"
        print_info "Model: $BEDROCK_MODEL_ID"
        print_info "Region: $BEDROCK_REGION"
        print_info "Cost limit: \$${BEDROCK_COST_THRESHOLD}/month"
        
    else
        print_error "Bedrock validation failed with $VALIDATION_ERRORS error(s)"
        echo
        print_info "Fix the errors above before deploying with Bedrock enabled"
        print_info "Or deploy with --bedrock-enabled false to disable AI features"
    fi
}

# Main execution
main() {
    print_bedrock "AWS Bedrock Validation"
    echo "======================"
    echo
    
    if [[ "$BEDROCK_ENABLED" != "true" ]]; then
        print_info "Bedrock is disabled - validation skipped"
        print_info "To enable Bedrock: export BEDROCK_ENABLED=true"
        exit 0
    fi
    
    print_info "Configuration:"
    print_info "- Enabled: $BEDROCK_ENABLED"
    print_info "- Model: $BEDROCK_MODEL_ID"
    print_info "- Region: $BEDROCK_REGION"
    print_info "- Cost Limit: \$${BEDROCK_COST_THRESHOLD}"
    print_info "- Rate Limit: $BEDROCK_RATE_LIMIT calls/minute"
    print_info "- Max Tokens: $BEDROCK_MAX_TOKENS"
    print_info "- Temperature: $BEDROCK_TEMPERATURE"
    echo
    
    validate_bedrock_config
    check_aws_permissions
    check_service_availability
    check_model_access
    estimate_costs
    
    generate_report
    
    # Exit with error code if there are critical errors
    exit $VALIDATION_ERRORS
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --help, -h    Show this help message"
            echo
            echo "Environment Variables:"
            echo "  BEDROCK_ENABLED           Enable/disable Bedrock (default: true)"
            echo "  BEDROCK_MODEL_ID          Model identifier (default: amazon.titan-text-express-v1)"
            echo "  BEDROCK_REGION            AWS region (default: us-east-1)"
            echo "  BEDROCK_COST_THRESHOLD    Monthly cost limit (default: 100)"
            echo "  BEDROCK_RATE_LIMIT        Rate limit per minute (default: 10)"
            echo "  BEDROCK_MAX_TOKENS        Max tokens per request (default: 1000)"
            echo "  BEDROCK_TEMPERATURE       Model temperature (default: 0.3)"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Run main function
main "$@"