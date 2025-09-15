#!/bin/bash

# AWS Spend Monitor - Deployment Validation Script
# This script validates the complete deployment including iOS configuration

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

# Validation counters
VALIDATION_ERRORS=0
VALIDATION_WARNINGS=0
VALIDATION_CHECKS=0

# Functions
print_header() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE} Deployment Validation${NC}"
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
    
    # Check jq for JSON parsing
    if ! command -v jq &> /dev/null; then
        print_warning "jq is not installed - some validations will be limited"
    fi
    
    print_success "Prerequisites check passed"
}

load_configuration() {
    print_info "Loading configuration..."
    
    # Load from config file
    if [[ -f "$CONFIG_FILE" ]]; then
        source "$CONFIG_FILE"
        print_success "Loaded iOS configuration"
    else
        print_warning "iOS configuration file not found: $CONFIG_FILE"
    fi
    
    # Load from environment file
    if [[ -f "$ENV_FILE" ]]; then
        source "$ENV_FILE"
        print_success "Loaded environment variables"
    else
        print_warning "Environment file not found: $ENV_FILE"
    fi
    
    # Set defaults
    AWS_REGION=${AWS_REGION:-"us-east-1"}
}

validate_cloudformation_stack() {
    print_info "Validating CloudFormation stack..."
    
    # Try to find the stack
    local stack_names=("SpendMonitorStack" "spend-monitor-stack" "aws-spend-monitor")
    local stack_found=""
    
    for stack_name in "${stack_names[@]}"; do
        if aws cloudformation describe-stacks \
            --region "$AWS_REGION" \
            --stack-name "$stack_name" \
            --output json &>/dev/null; then
            stack_found="$stack_name"
            break
        fi
    done
    
    if [[ -n "$stack_found" ]]; then
        print_success "CloudFormation stack found: $stack_found"
        
        # Check stack status
        STACK_STATUS=$(aws cloudformation describe-stacks \
            --region "$AWS_REGION" \
            --stack-name "$stack_found" \
            --query 'Stacks[0].StackStatus' \
            --output text)
        
        if [[ "$STACK_STATUS" == "CREATE_COMPLETE" || "$STACK_STATUS" == "UPDATE_COMPLETE" ]]; then
            print_success "Stack status is healthy: $STACK_STATUS"
        else
            print_error "Stack status is not healthy: $STACK_STATUS"
        fi
        
        # Get stack outputs
        if command -v jq &> /dev/null; then
            STACK_OUTPUTS=$(aws cloudformation describe-stacks \
                --region "$AWS_REGION" \
                --stack-name "$stack_found" \
                --query 'Stacks[0].Outputs' \
                --output json 2>/dev/null)
            
            if [[ -n "$STACK_OUTPUTS" && "$STACK_OUTPUTS" != "null" ]]; then
                print_success "Stack outputs available"
                
                # Check for specific outputs
                SNS_TOPIC_ARN=$(echo "$STACK_OUTPUTS" | jq -r '.[] | select(.OutputKey=="SnsTopicArn") | .OutputValue // empty')
                LAMBDA_FUNCTION_ARN=$(echo "$STACK_OUTPUTS" | jq -r '.[] | select(.OutputKey=="LambdaFunctionArn") | .OutputValue // empty')
                API_URL=$(echo "$STACK_OUTPUTS" | jq -r '.[] | select(.OutputKey=="ApiUrl") | .OutputValue // empty')
                
                if [[ -n "$SNS_TOPIC_ARN" ]]; then
                    print_success "SNS Topic ARN output found"
                else
                    print_warning "SNS Topic ARN output not found"
                fi
                
                if [[ -n "$LAMBDA_FUNCTION_ARN" ]]; then
                    print_success "Lambda Function ARN output found"
                else
                    print_warning "Lambda Function ARN output not found"
                fi
                
                if [[ -n "$API_URL" ]]; then
                    print_success "API URL output found"
                else
                    print_warning "API URL output not found (may be optional)"
                fi
            else
                print_warning "No stack outputs found"
            fi
        fi
    else
        print_error "CloudFormation stack not found"
        print_info "Expected stack names: ${stack_names[*]}"
    fi
}

validate_lambda_function() {
    print_info "Validating Lambda function..."
    
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
        print_success "Lambda function found: $function_found"
        
        if command -v jq &> /dev/null; then
            FUNCTION_CONFIG=$(aws lambda get-function-configuration \
                --region "$AWS_REGION" \
                --function-name "$function_found" \
                --output json)
            
            # Check runtime
            RUNTIME=$(echo "$FUNCTION_CONFIG" | jq -r '.Runtime')
            if [[ "$RUNTIME" =~ ^nodejs ]]; then
                print_success "Runtime is Node.js: $RUNTIME"
            else
                print_warning "Unexpected runtime: $RUNTIME"
            fi
            
            # Check memory
            MEMORY=$(echo "$FUNCTION_CONFIG" | jq -r '.MemorySize')
            if [[ $MEMORY -ge 512 ]]; then
                print_success "Memory allocation is adequate: ${MEMORY}MB"
            else
                print_warning "Memory allocation may be low: ${MEMORY}MB (recommended: 512MB+)"
            fi
            
            # Check timeout
            TIMEOUT=$(echo "$FUNCTION_CONFIG" | jq -r '.Timeout')
            if [[ $TIMEOUT -ge 60 ]]; then
                print_success "Timeout is adequate: ${TIMEOUT}s"
            else
                print_warning "Timeout may be low: ${TIMEOUT}s (recommended: 60s+)"
            fi
            
            # Check environment variables
            ENV_VARS=$(echo "$FUNCTION_CONFIG" | jq -r '.Environment.Variables // {}')
            
            # Check required environment variables
            local required_vars=("SPEND_THRESHOLD" "SNS_TOPIC_ARN")
            for var in "${required_vars[@]}"; do
                if echo "$ENV_VARS" | jq -e ".$var" &>/dev/null; then
                    print_success "Environment variable $var is set"
                else
                    print_error "Required environment variable $var is missing"
                fi
            done
            
            # Check iOS-specific environment variables
            local ios_vars=("IOS_PLATFORM_APP_ARN" "IOS_BUNDLE_ID")
            for var in "${ios_vars[@]}"; do
                if echo "$ENV_VARS" | jq -e ".$var" &>/dev/null; then
                    print_success "iOS environment variable $var is set"
                else
                    print_warning "iOS environment variable $var is not set"
                fi
            done
        fi
        
        # Test function invocation
        print_info "Testing Lambda function invocation..."
        TEST_EVENT='{"source":"aws.events","detail-type":"Scheduled Event","detail":{}}'
        
        INVOCATION_RESULT=$(aws lambda invoke \
            --region "$AWS_REGION" \
            --function-name "$function_found" \
            --payload "$TEST_EVENT" \
            --output json \
            /tmp/lambda-test-$$ 2>/dev/null)
        
        if [[ $? -eq 0 ]]; then
            STATUS_CODE=$(echo "$INVOCATION_RESULT" | jq -r '.StatusCode')
            if [[ "$STATUS_CODE" == "200" ]]; then
                print_success "Lambda function invocation successful"
                
                # Check for errors in response
                if [[ -f "/tmp/lambda-test-$$" ]]; then
                    if grep -q "errorMessage" "/tmp/lambda-test-$$"; then
                        ERROR_MSG=$(cat "/tmp/lambda-test-$$" | jq -r '.errorMessage // "Unknown error"')
                        print_error "Lambda function error: $ERROR_MSG"
                    else
                        print_success "Lambda function executed without errors"
                    fi
                    rm -f "/tmp/lambda-test-$$"
                fi
            else
                print_error "Lambda function invocation failed (Status: $STATUS_CODE)"
            fi
        else
            print_error "Failed to invoke Lambda function"
        fi
    else
        print_error "Lambda function not found"
        print_info "Expected function names: ${function_names[*]}"
    fi
}

validate_sns_configuration() {
    print_info "Validating SNS configuration..."
    
    # Check SNS topic
    if [[ -n "$SNS_TOPIC_ARN" ]]; then
        TOPIC_ARN="$SNS_TOPIC_ARN"
    else
        # Try to find topic by name
        local topic_names=("spend-monitor-alerts" "aws-spend-monitor" "SpendMonitorAlerts")
        for topic_name in "${topic_names[@]}"; do
            TOPIC_ARN=$(aws sns list-topics \
                --region "$AWS_REGION" \
                --query "Topics[?contains(TopicArn, '$topic_name')].TopicArn" \
                --output text 2>/dev/null | head -1)
            
            if [[ -n "$TOPIC_ARN" ]]; then
                break
            fi
        done
    fi
    
    if [[ -n "$TOPIC_ARN" ]]; then
        print_success "SNS topic found: $TOPIC_ARN"
        
        # Check topic attributes
        TOPIC_ATTRS=$(aws sns get-topic-attributes \
            --region "$AWS_REGION" \
            --topic-arn "$TOPIC_ARN" \
            --output json 2>/dev/null)
        
        if [[ $? -eq 0 ]]; then
            print_success "SNS topic is accessible"
            
            if command -v jq &> /dev/null; then
                # Check subscriptions
                SUBSCRIPTIONS=$(aws sns list-subscriptions-by-topic \
                    --region "$AWS_REGION" \
                    --topic-arn "$TOPIC_ARN" \
                    --output json 2>/dev/null)
                
                if [[ -n "$SUBSCRIPTIONS" ]]; then
                    SUB_COUNT=$(echo "$SUBSCRIPTIONS" | jq '.Subscriptions | length')
                    if [[ $SUB_COUNT -gt 0 ]]; then
                        print_success "SNS topic has $SUB_COUNT subscription(s)"
                    else
                        print_warning "SNS topic has no subscriptions"
                    fi
                fi
            fi
        else
            print_error "Cannot access SNS topic"
        fi
    else
        print_error "SNS topic not found"
    fi
    
    # Check iOS platform application
    if [[ -n "$PLATFORM_APP_ARN" ]]; then
        print_info "Validating iOS platform application..."
        
        PLATFORM_ATTRS=$(aws sns get-platform-application-attributes \
            --region "$AWS_REGION" \
            --platform-application-arn "$PLATFORM_APP_ARN" \
            --output json 2>/dev/null)
        
        if [[ $? -eq 0 ]]; then
            print_success "iOS platform application is accessible"
            
            if command -v jq &> /dev/null; then
                ENABLED=$(echo "$PLATFORM_ATTRS" | jq -r '.Attributes.Enabled // "true"')
                if [[ "$ENABLED" == "true" ]]; then
                    print_success "iOS platform application is enabled"
                else
                    print_error "iOS platform application is disabled"
                fi
                
                PLATFORM_TYPE=$(echo "$PLATFORM_ATTRS" | jq -r '.Attributes.Platform')
                print_success "Platform type: $PLATFORM_TYPE"
            fi
        else
            print_error "Cannot access iOS platform application: $PLATFORM_APP_ARN"
        fi
    else
        print_warning "iOS platform application ARN not configured"
    fi
}

validate_eventbridge_rule() {
    print_info "Validating EventBridge rule..."
    
    # Try to find the EventBridge rule
    local rule_names=("spend-monitor-schedule" "SpendMonitorSchedule" "aws-spend-monitor-schedule")
    local rule_found=""
    
    for rule_name in "${rule_names[@]}"; do
        if aws events describe-rule \
            --region "$AWS_REGION" \
            --name "$rule_name" \
            --output json &>/dev/null; then
            rule_found="$rule_name"
            break
        fi
    done
    
    if [[ -n "$rule_found" ]]; then
        print_success "EventBridge rule found: $rule_found"
        
        if command -v jq &> /dev/null; then
            RULE_CONFIG=$(aws events describe-rule \
                --region "$AWS_REGION" \
                --name "$rule_found" \
                --output json)
            
            # Check rule state
            STATE=$(echo "$RULE_CONFIG" | jq -r '.State')
            if [[ "$STATE" == "ENABLED" ]]; then
                print_success "EventBridge rule is enabled"
            else
                print_error "EventBridge rule is disabled: $STATE"
            fi
            
            # Check schedule expression
            SCHEDULE=$(echo "$RULE_CONFIG" | jq -r '.ScheduleExpression // "none"')
            if [[ "$SCHEDULE" != "none" ]]; then
                print_success "Schedule expression: $SCHEDULE"
            else
                print_warning "No schedule expression found"
            fi
            
            # Check targets
            TARGETS=$(aws events list-targets-by-rule \
                --region "$AWS_REGION" \
                --rule "$rule_found" \
                --output json 2>/dev/null)
            
            if [[ -n "$TARGETS" ]]; then
                TARGET_COUNT=$(echo "$TARGETS" | jq '.Targets | length')
                if [[ $TARGET_COUNT -gt 0 ]]; then
                    print_success "EventBridge rule has $TARGET_COUNT target(s)"
                else
                    print_error "EventBridge rule has no targets"
                fi
            fi
        fi
    else
        print_error "EventBridge rule not found"
        print_info "Expected rule names: ${rule_names[*]}"
    fi
}

validate_iam_permissions() {
    print_info "Validating IAM permissions..."
    
    # Get current identity
    CURRENT_IDENTITY=$(aws sts get-caller-identity --output json 2>/dev/null)
    if [[ $? -eq 0 ]]; then
        if command -v jq &> /dev/null; then
            USER_ARN=$(echo "$CURRENT_IDENTITY" | jq -r '.Arn')
            print_success "Current identity: $USER_ARN"
        fi
    else
        print_error "Cannot get current AWS identity"
        return 1
    fi
    
    # Test Cost Explorer permissions
    print_info "Testing Cost Explorer permissions..."
    if aws ce get-cost-and-usage \
        --region "$AWS_REGION" \
        --time-period Start=2024-01-01,End=2024-01-02 \
        --granularity DAILY \
        --metrics BlendedCost \
        --output json &>/dev/null; then
        print_success "Cost Explorer permissions are working"
    else
        print_error "Cost Explorer permissions are missing or insufficient"
    fi
    
    # Test SNS permissions
    print_info "Testing SNS permissions..."
    if aws sns list-topics --region "$AWS_REGION" --output json &>/dev/null; then
        print_success "SNS list permissions are working"
    else
        print_error "SNS list permissions are missing"
    fi
    
    if [[ -n "$TOPIC_ARN" ]]; then
        if aws sns get-topic-attributes \
            --region "$AWS_REGION" \
            --topic-arn "$TOPIC_ARN" \
            --output json &>/dev/null; then
            print_success "SNS topic access permissions are working"
        else
            print_error "SNS topic access permissions are missing"
        fi
    fi
    
    # Test Lambda permissions (if we found a function)
    if [[ -n "$function_found" ]]; then
        print_info "Testing Lambda permissions..."
        if aws lambda get-function-configuration \
            --region "$AWS_REGION" \
            --function-name "$function_found" \
            --output json &>/dev/null; then
            print_success "Lambda function access permissions are working"
        else
            print_error "Lambda function access permissions are missing"
        fi
    fi
}

validate_api_gateway() {
    print_info "Validating API Gateway (if deployed)..."
    
    # Try to find API Gateway
    local api_found=false
    
    if command -v jq &> /dev/null; then
        APIS=$(aws apigateway get-rest-apis \
            --region "$AWS_REGION" \
            --output json 2>/dev/null)
        
        if [[ $? -eq 0 ]]; then
            API_COUNT=$(echo "$APIS" | jq '.items | length')
            if [[ $API_COUNT -gt 0 ]]; then
                # Look for spend monitor API
                SPEND_API=$(echo "$APIS" | jq -r '.items[] | select(.name | contains("spend") or contains("Spend") or contains("monitor") or contains("Monitor")) | .id' | head -1)
                
                if [[ -n "$SPEND_API" ]]; then
                    print_success "API Gateway found: $SPEND_API"
                    api_found=true
                    
                    # Check API deployment
                    DEPLOYMENTS=$(aws apigateway get-deployments \
                        --region "$AWS_REGION" \
                        --rest-api-id "$SPEND_API" \
                        --output json 2>/dev/null)
                    
                    if [[ $? -eq 0 ]]; then
                        DEPLOYMENT_COUNT=$(echo "$DEPLOYMENTS" | jq '.items | length')
                        if [[ $DEPLOYMENT_COUNT -gt 0 ]]; then
                            print_success "API Gateway has $DEPLOYMENT_COUNT deployment(s)"
                        else
                            print_warning "API Gateway has no deployments"
                        fi
                    fi
                    
                    # Test API endpoint
                    API_URL="https://$SPEND_API.execute-api.$AWS_REGION.amazonaws.com/prod"
                    HEALTH_RESPONSE=$(curl -s --connect-timeout 5 "$API_URL/health" -w "%{http_code}" -o /dev/null 2>/dev/null || echo "000")
                    
                    if [[ "$HEALTH_RESPONSE" == "200" ]]; then
                        print_success "API Gateway health endpoint is accessible"
                    elif [[ "$HEALTH_RESPONSE" != "000" ]]; then
                        print_warning "API Gateway returned HTTP $HEALTH_RESPONSE"
                    else
                        print_warning "API Gateway endpoint not accessible"
                    fi
                fi
            fi
        fi
    fi
    
    if [[ "$api_found" != "true" ]]; then
        print_warning "API Gateway not found (may be optional)"
    fi
}

validate_cloudwatch_logs() {
    print_info "Validating CloudWatch logs..."
    
    # Check for Lambda log groups
    local log_groups=("/aws/lambda/spend-monitor-agent" "/aws/lambda/aws-spend-monitor" "/aws/lambda/SpendMonitorAgent")
    local log_group_found=""
    
    for log_group in "${log_groups[@]}"; do
        if aws logs describe-log-groups \
            --region "$AWS_REGION" \
            --log-group-name-prefix "$log_group" \
            --output json &>/dev/null; then
            log_group_found="$log_group"
            break
        fi
    done
    
    if [[ -n "$log_group_found" ]]; then
        print_success "CloudWatch log group found: $log_group_found"
        
        # Check recent log streams
        LOG_STREAMS=$(aws logs describe-log-streams \
            --region "$AWS_REGION" \
            --log-group-name "$log_group_found" \
            --order-by LastEventTime \
            --descending \
            --max-items 5 \
            --output json 2>/dev/null)
        
        if [[ $? -eq 0 ]] && command -v jq &> /dev/null; then
            STREAM_COUNT=$(echo "$LOG_STREAMS" | jq '.logStreams | length')
            if [[ $STREAM_COUNT -gt 0 ]]; then
                print_success "Found $STREAM_COUNT recent log stream(s)"
                
                # Check for recent activity
                LATEST_STREAM=$(echo "$LOG_STREAMS" | jq -r '.logStreams[0].logStreamName')
                LAST_EVENT=$(echo "$LOG_STREAMS" | jq -r '.logStreams[0].lastEventTime // 0')
                
                if [[ $LAST_EVENT -gt 0 ]]; then
                    LAST_EVENT_DATE=$(date -d "@$((LAST_EVENT / 1000))" 2>/dev/null || date -r $((LAST_EVENT / 1000)) 2>/dev/null)
                    print_success "Latest log activity: $LAST_EVENT_DATE"
                else
                    print_warning "No recent log activity found"
                fi
            else
                print_warning "No log streams found"
            fi
        fi
    else
        print_warning "CloudWatch log group not found"
    fi
}

generate_deployment_report() {
    echo
    print_info "Deployment Validation Summary"
    echo "============================="
    
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
        print_success "Deployment validation passed!"
        
        if [[ $VALIDATION_WARNINGS -gt 0 ]]; then
            print_warning "There are $VALIDATION_WARNINGS warning(s) to review"
        fi
        
        echo
        print_info "Your AWS Spend Monitor is ready to use!"
        echo
        print_info "Next steps:"
        echo "1. Test the monitoring: Wait for the next scheduled run or trigger manually"
        echo "2. Set up notifications: Subscribe to the SNS topic for alerts"
        echo "3. Configure iOS: Use the device registration API to add iOS devices"
        echo "4. Monitor logs: Check CloudWatch logs for any issues"
        
    else
        print_error "Deployment validation failed with $VALIDATION_ERRORS error(s)"
        echo
        print_info "Common fixes:"
        echo "1. Check IAM permissions for all required services"
        echo "2. Verify all resources were deployed successfully"
        echo "3. Ensure environment variables are configured correctly"
        echo "4. Check CloudFormation stack status for any issues"
    fi
    
    echo
    print_info "Configuration Summary:"
    echo "  AWS Region: $AWS_REGION"
    echo "  SNS Topic: ${TOPIC_ARN:-"Not found"}"
    echo "  iOS Platform App: ${PLATFORM_APP_ARN:-"Not configured"}"
    echo "  Bundle ID: ${BUNDLE_ID:-"Not configured"}"
}

show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo
    echo "Options:"
    echo "  -h, --help              Show this help message"
    echo "  -c, --config FILE       Use specific config file"
    echo "  --region REGION         Override AWS region"
    echo "  --skip-iam              Skip IAM permission tests"
    echo "  --skip-api              Skip API Gateway validation"
    echo "  --skip-logs             Skip CloudWatch logs validation"
    echo "  --verbose               Show detailed output"
    echo
    echo "Examples:"
    echo "  $0                      # Full deployment validation"
    echo "  $0 --skip-iam           # Skip IAM permission tests"
    echo "  $0 --region us-west-2   # Validate in specific region"
}

# Parse command line arguments
SKIP_IAM=false
SKIP_API=false
SKIP_LOGS=false
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
        --region)
            AWS_REGION="$2"
            shift 2
            ;;
        --skip-iam)
            SKIP_IAM=true
            shift
            ;;
        --skip-api)
            SKIP_API=true
            shift
            ;;
        --skip-logs)
            SKIP_LOGS=true
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
    load_configuration
    
    validate_cloudformation_stack
    validate_lambda_function
    validate_sns_configuration
    validate_eventbridge_rule
    
    if [[ "$SKIP_IAM" != "true" ]]; then
        validate_iam_permissions
    fi
    
    if [[ "$SKIP_API" != "true" ]]; then
        validate_api_gateway
    fi
    
    if [[ "$SKIP_LOGS" != "true" ]]; then
        validate_cloudwatch_logs
    fi
    
    generate_deployment_report
    
    # Exit with error code if there are critical errors
    exit $VALIDATION_ERRORS
}

# Run main function
main "$@"