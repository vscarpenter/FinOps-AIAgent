#!/bin/bash

# IAM Permissions Setup Script for FinOps AI Agent
# This script helps set up the required IAM permissions

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_info() {
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

# Function to create IAM policy JSON
create_policy_json() {
    local policy_file="finops-ai-agent-policy.json"
    
    cat > "$policy_file" << 'EOF'
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "CostExplorerAccess",
            "Effect": "Allow",
            "Action": [
                "ce:GetCostAndUsage",
                "ce:GetUsageReport",
                "ce:GetDimensionValues",
                "ce:GetReservationCoverage",
                "ce:GetReservationPurchaseRecommendation",
                "ce:GetReservationUtilization"
            ],
            "Resource": "*"
        },
        {
            "Sid": "BedrockAccess",
            "Effect": "Allow",
            "Action": [
                "bedrock:InvokeModel",
                "bedrock:ListFoundationModels"
            ],
            "Resource": [
                "arn:aws:bedrock:*::foundation-model/amazon.titan-text-express-v1",
                "arn:aws:bedrock:*::foundation-model/amazon.titan-text-lite-v1",
                "arn:aws:bedrock:*::foundation-model/amazon.titan-embed-text-v1",
                "arn:aws:bedrock:*::foundation-model/anthropic.claude-v2",
                "arn:aws:bedrock:*::foundation-model/anthropic.claude-instant-v1"
            ]
        },
        {
            "Sid": "CloudWatchAccess",
            "Effect": "Allow",
            "Action": [
                "cloudwatch:PutMetricData",
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            ],
            "Resource": "*"
        },
        {
            "Sid": "SNSAccess",
            "Effect": "Allow",
            "Action": [
                "sns:Publish",
                "sns:CreateTopic",
                "sns:Subscribe",
                "sns:ListTopics",
                "sns:CreatePlatformEndpoint",
                "sns:DeleteEndpoint",
                "sns:GetEndpointAttributes",
                "sns:SetEndpointAttributes"
            ],
            "Resource": "*"
        },
        {
            "Sid": "LambdaAccess",
            "Effect": "Allow",
            "Action": [
                "lambda:InvokeFunction",
                "lambda:CreateFunction",
                "lambda:UpdateFunctionCode",
                "lambda:UpdateFunctionConfiguration",
                "lambda:DeleteFunction",
                "lambda:GetFunction",
                "lambda:ListFunctions"
            ],
            "Resource": "*"
        },
        {
            "Sid": "EventBridgeAccess",
            "Effect": "Allow",
            "Action": [
                "events:PutRule",
                "events:DeleteRule",
                "events:PutTargets",
                "events:RemoveTargets",
                "events:ListRules"
            ],
            "Resource": "*"
        },
        {
            "Sid": "DynamoDBAccess",
            "Effect": "Allow",
            "Action": [
                "dynamodb:CreateTable",
                "dynamodb:DeleteTable",
                "dynamodb:DescribeTable",
                "dynamodb:GetItem",
                "dynamodb:PutItem",
                "dynamodb:UpdateItem",
                "dynamodb:DeleteItem",
                "dynamodb:Query",
                "dynamodb:Scan"
            ],
            "Resource": "*"
        },
        {
            "Sid": "APIGatewayAccess",
            "Effect": "Allow",
            "Action": [
                "apigateway:*"
            ],
            "Resource": "*"
        },
        {
            "Sid": "CloudFormationAccess",
            "Effect": "Allow",
            "Action": [
                "cloudformation:*"
            ],
            "Resource": "*"
        },
        {
            "Sid": "IAMAccess",
            "Effect": "Allow",
            "Action": [
                "iam:CreateRole",
                "iam:DeleteRole",
                "iam:GetRole",
                "iam:PassRole",
                "iam:AttachRolePolicy",
                "iam:DetachRolePolicy",
                "iam:PutRolePolicy",
                "iam:DeleteRolePolicy",
                "iam:GetRolePolicy"
            ],
            "Resource": "*"
        }
    ]
}
EOF
    
    echo "$policy_file"
}

# Function to show manual setup instructions
show_manual_instructions() {
    print_info "Manual IAM Setup Instructions:"
    echo ""
    echo "1. Go to AWS IAM Console: https://console.aws.amazon.com/iam/"
    echo "2. Create a new policy or attach to existing user/role:"
    echo "   - Click 'Policies' → 'Create Policy'"
    echo "   - Choose 'JSON' tab"
    echo "   - Copy and paste the policy from: $(create_policy_json)"
    echo "   - Name it: 'FinOpsAIAgentPolicy'"
    echo "   - Click 'Create Policy'"
    echo ""
    echo "3. Attach the policy to your user or role:"
    echo "   - Go to 'Users' or 'Roles'"
    echo "   - Select your user/role"
    echo "   - Click 'Add permissions' → 'Attach policies directly'"
    echo "   - Search for 'FinOpsAIAgentPolicy'"
    echo "   - Select and attach the policy"
    echo ""
    echo "4. For Bedrock specifically:"
    echo "   - Go to AWS Bedrock Console: https://console.aws.amazon.com/bedrock/"
    echo "   - Click 'Model access' in the left navigation"
    echo "   - Click 'Request model access'"
    echo "   - Enable the following models:"
    echo "     • amazon.titan-text-express-v1 (Recommended)"
    echo "     • amazon.titan-text-lite-v1 (Cost-optimized)"
    echo "     • anthropic.claude-v2 (Premium, optional)"
    echo "   - Submit the request (usually approved instantly)"
}

# Function to create and attach policy via CLI
setup_via_cli() {
    local policy_name="FinOpsAIAgentPolicy"
    local policy_file=$(create_policy_json)
    
    print_info "Creating IAM policy via AWS CLI..."
    
    # Check if policy already exists
    if aws iam get-policy --policy-arn "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):policy/$policy_name" >/dev/null 2>&1; then
        print_warning "Policy $policy_name already exists"
        
        # Update the existing policy
        print_info "Updating existing policy..."
        local policy_arn="arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):policy/$policy_name"
        
        if aws iam create-policy-version \
            --policy-arn "$policy_arn" \
            --policy-document "file://$policy_file" \
            --set-as-default >/dev/null 2>&1; then
            print_success "Policy updated successfully"
        else
            print_error "Failed to update policy"
            return 1
        fi
    else
        # Create new policy
        print_info "Creating new policy..."
        if aws iam create-policy \
            --policy-name "$policy_name" \
            --policy-document "file://$policy_file" \
            --description "IAM policy for FinOps AI Agent deployment and operation" >/dev/null 2>&1; then
            print_success "Policy created successfully"
        else
            print_error "Failed to create policy"
            return 1
        fi
    fi
    
    # Get current user
    local current_user=$(aws sts get-caller-identity --query Arn --output text | cut -d'/' -f2)
    local account_id=$(aws sts get-caller-identity --query Account --output text)
    local policy_arn="arn:aws:iam::$account_id:policy/$policy_name"
    
    if [[ -n "$current_user" ]]; then
        print_info "Attaching policy to user: $current_user"
        
        if aws iam attach-user-policy \
            --user-name "$current_user" \
            --policy-arn "$policy_arn" >/dev/null 2>&1; then
            print_success "Policy attached to user successfully"
        else
            print_warning "Could not attach policy to user (may already be attached)"
        fi
    else
        print_warning "Could not determine current user - you may need to attach the policy manually"
    fi
    
    # Clean up policy file
    rm -f "$policy_file"
    
    print_success "IAM setup completed!"
    print_info "Policy ARN: $policy_arn"
}

# Function to check current permissions
check_permissions() {
    print_info "Checking current permissions..."
    
    local permissions_ok=true
    
    # Check Cost Explorer
    if aws ce get-cost-and-usage \
        --time-period Start=2025-01-01,End=2025-01-02 \
        --granularity DAILY \
        --metrics BlendedCost \
        --output json >/dev/null 2>&1; then
        print_success "Cost Explorer permissions: OK"
    else
        print_error "Cost Explorer permissions: MISSING"
        permissions_ok=false
    fi
    
    # Check Bedrock
    if aws bedrock list-foundation-models --region us-east-1 >/dev/null 2>&1; then
        print_success "Bedrock permissions: OK"
    else
        print_error "Bedrock permissions: MISSING"
        permissions_ok=false
    fi
    
    # Check CloudWatch
    if aws cloudwatch put-metric-data \
        --namespace "Test" \
        --metric-data MetricName=Test,Value=1 >/dev/null 2>&1; then
        print_success "CloudWatch permissions: OK"
    else
        print_error "CloudWatch permissions: MISSING"
        permissions_ok=false
    fi
    
    # Check SNS
    if aws sns list-topics >/dev/null 2>&1; then
        print_success "SNS permissions: OK"
    else
        print_error "SNS permissions: MISSING"
        permissions_ok=false
    fi
    
    # Check Lambda
    if aws lambda list-functions >/dev/null 2>&1; then
        print_success "Lambda permissions: OK"
    else
        print_error "Lambda permissions: MISSING"
        permissions_ok=false
    fi
    
    # Check CloudFormation
    if aws cloudformation list-stacks >/dev/null 2>&1; then
        print_success "CloudFormation permissions: OK"
    else
        print_error "CloudFormation permissions: MISSING"
        permissions_ok=false
    fi
    
    if [[ "$permissions_ok" == "true" ]]; then
        print_success "All required permissions are available!"
        return 0
    else
        print_error "Some permissions are missing"
        return 1
    fi
}

# Main function
main() {
    echo "FinOps AI Agent - IAM Permissions Setup"
    echo "======================================"
    echo
    
    case "${1:-check}" in
        "check")
            check_permissions
            ;;
        "setup")
            if ! command -v aws >/dev/null 2>&1; then
                print_error "AWS CLI not found. Please install AWS CLI first."
                exit 1
            fi
            
            if ! aws sts get-caller-identity >/dev/null 2>&1; then
                print_error "AWS credentials not configured. Please run 'aws configure' first."
                exit 1
            fi
            
            setup_via_cli
            echo
            print_info "Testing permissions after setup..."
            check_permissions
            ;;
        "manual")
            show_manual_instructions
            ;;
        "help"|"-h"|"--help")
            echo "Usage: $0 [COMMAND]"
            echo
            echo "Commands:"
            echo "  check     Check current IAM permissions (default)"
            echo "  setup     Automatically create and attach IAM policy"
            echo "  manual    Show manual setup instructions"
            echo "  help      Show this help message"
            echo
            echo "Examples:"
            echo "  $0                # Check current permissions"
            echo "  $0 setup          # Automatically setup permissions"
            echo "  $0 manual         # Show manual setup instructions"
            ;;
        *)
            print_error "Unknown command: $1"
            echo "Use '$0 help' for usage information"
            exit 1
            ;;
    esac
}

main "$@"