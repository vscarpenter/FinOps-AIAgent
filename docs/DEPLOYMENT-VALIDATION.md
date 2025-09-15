# Deployment Validation Guide

This guide covers the comprehensive validation process for the AWS Spend Monitor, including configuration validation, pre-deployment checks, and post-deployment verification.

## Overview

The AWS Spend Monitor includes several validation tools to ensure proper configuration and deployment:

1. **Configuration Validation** - Validates settings before deployment
2. **Pre-deployment Checks** - Verifies prerequisites and environment
3. **Post-deployment Validation** - Confirms successful deployment
4. **iOS Configuration Validation** - Specific checks for iOS push notifications

## Configuration Validation

### Basic Configuration

The spend monitor requires several configuration parameters:

```bash
# Required Environment Variables
export SPEND_THRESHOLD=10                    # Alert threshold in USD
export SNS_TOPIC_ARN=arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts
export AWS_REGION=us-east-1

# Optional Environment Variables
export CHECK_PERIOD_DAYS=1                  # How often to check (days)
export RETRY_ATTEMPTS=3                     # Max retry attempts
export MIN_SERVICE_COST_THRESHOLD=1         # Min cost to show in breakdown
```

### iOS Configuration (Optional)

For iOS push notifications, additional configuration is required:

```bash
# iOS Environment Variables
export IOS_PLATFORM_APP_ARN=arn:aws:sns:us-east-1:123456789012:app/APNS/SpendMonitorApp
export IOS_BUNDLE_ID=com.example.spendmonitor
export APNS_SANDBOX=true                    # Use sandbox for development
```

### Configuration File Format

Alternatively, you can use a JSON configuration file:

```json
{
  "spendThreshold": 10,
  "snsTopicArn": "arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts",
  "region": "us-east-1",
  "checkPeriodDays": 1,
  "retryAttempts": 3,
  "minServiceCostThreshold": 1,
  "iosConfig": {
    "platformApplicationArn": "arn:aws:sns:us-east-1:123456789012:app/APNS/SpendMonitorApp",
    "bundleId": "com.example.spendmonitor",
    "sandbox": true
  }
}
```

## Validation Commands

### 1. Configuration Validation

Validate your configuration before deployment:

```bash
# Validate current environment variables
npm run validate:config

# Validate with specific configuration file
npm run validate:config -- --config config.json

# Skip AWS service validation (for offline validation)
npm run validate:config -- --skip-aws

# Show sample configuration
npm run validate:config -- --sample

# Verbose output with detailed information
npm run validate:config -- --verbose
```

### 2. Pre-deployment Validation

Run comprehensive pre-deployment checks:

```bash
# Full pre-deployment validation
./scripts/pre-deployment-check.sh

# Skip specific checks
./scripts/pre-deployment-check.sh --skip-tests --skip-iam

# Available skip options:
# --skip-tests     Skip test execution
# --skip-build     Skip TypeScript compilation
# --skip-iam       Skip IAM permission tests
# --skip-cdk       Skip CDK bootstrap check
# --skip-ios       Skip iOS configuration check
```

### 3. iOS Configuration Validation

Validate iOS-specific configuration:

```bash
# Full iOS validation
./scripts/validate-ios-config.sh

# Skip network connectivity tests
./scripts/validate-ios-config.sh --skip-network

# Override configuration
./scripts/validate-ios-config.sh --platform-arn arn:aws:sns:... --bundle-id com.example.app
```

### 4. Post-deployment Validation

After deployment, validate the complete system:

```bash
# Full deployment validation
./scripts/validate-deployment.sh

# Skip specific validations
./scripts/validate-deployment.sh --skip-iam --skip-api
```

## Validation Checklist

### Prerequisites

- [ ] Node.js 18+ installed
- [ ] AWS CLI installed and configured
- [ ] AWS CDK installed
- [ ] TypeScript compiler available
- [ ] Required dependencies installed (`npm install`)

### AWS Permissions

The deployment requires the following AWS permissions:

#### Cost Explorer
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ce:GetCostAndUsage",
        "ce:GetUsageReport"
      ],
      "Resource": "*"
    }
  ]
}
```

#### SNS
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sns:CreateTopic",
        "sns:GetTopicAttributes",
        "sns:SetTopicAttributes",
        "sns:Subscribe",
        "sns:Unsubscribe",
        "sns:Publish",
        "sns:ListTopics",
        "sns:ListSubscriptionsByTopic"
      ],
      "Resource": "*"
    }
  ]
}
```

#### SNS Mobile Push (for iOS)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sns:CreatePlatformApplication",
        "sns:GetPlatformApplicationAttributes",
        "sns:SetPlatformApplicationAttributes",
        "sns:CreatePlatformEndpoint",
        "sns:GetEndpointAttributes",
        "sns:SetEndpointAttributes",
        "sns:DeleteEndpoint",
        "sns:ListPlatformApplications",
        "sns:ListEndpointsByPlatformApplication"
      ],
      "Resource": "*"
    }
  ]
}
```

#### Lambda
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration",
        "lambda:InvokeFunction",
        "lambda:ListFunctions"
      ],
      "Resource": "*"
    }
  ]
}
```

#### EventBridge
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "events:PutRule",
        "events:DeleteRule",
        "events:DescribeRule",
        "events:PutTargets",
        "events:RemoveTargets",
        "events:ListTargetsByRule",
        "events:ListRules"
      ],
      "Resource": "*"
    }
  ]
}
```

#### CloudFormation
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateStack",
        "cloudformation:UpdateStack",
        "cloudformation:DeleteStack",
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackEvents",
        "cloudformation:DescribeStackResources",
        "cloudformation:ListStacks"
      ],
      "Resource": "*"
    }
  ]
}
```

### Configuration Validation

- [ ] Spend threshold is a positive number
- [ ] SNS topic ARN is valid format
- [ ] AWS region is valid
- [ ] iOS platform application ARN is valid (if using iOS)
- [ ] iOS bundle ID is valid format (if using iOS)
- [ ] All required environment variables are set

### Pre-deployment Checks

- [ ] TypeScript compilation succeeds
- [ ] All tests pass
- [ ] AWS credentials are configured
- [ ] Required IAM permissions are available
- [ ] CDK is bootstrapped in target region
- [ ] iOS certificates are valid (if using iOS)

### Post-deployment Validation

- [ ] CloudFormation stack deployed successfully
- [ ] Lambda function is created and configured
- [ ] SNS topic is accessible
- [ ] EventBridge rule is enabled
- [ ] iOS platform application is accessible (if configured)
- [ ] Test invocation succeeds

## Common Issues and Solutions

### Configuration Issues

**Issue**: `SNS topic ARN format is invalid`
```bash
# Solution: Ensure ARN follows correct format
export SNS_TOPIC_ARN=arn:aws:sns:REGION:ACCOUNT_ID:TOPIC_NAME
```

**Issue**: `iOS bundle ID format is invalid`
```bash
# Solution: Use reverse domain notation
export IOS_BUNDLE_ID=com.company.appname
```

### Permission Issues

**Issue**: `Cost Explorer permissions are missing`
```bash
# Solution: Add Cost Explorer permissions to your IAM user/role
aws iam attach-user-policy --user-name YOUR_USER --policy-arn arn:aws:iam::aws:policy/AWSBillingReadOnlyAccess
```

**Issue**: `Cannot access SNS topic`
```bash
# Solution: Verify topic exists and you have permissions
aws sns get-topic-attributes --topic-arn YOUR_TOPIC_ARN
```

### Deployment Issues

**Issue**: `CDK is not bootstrapped`
```bash
# Solution: Bootstrap CDK in your region
cdk bootstrap aws://ACCOUNT_ID/REGION
```

**Issue**: `TypeScript compilation failed`
```bash
# Solution: Fix compilation errors
npm run build
# Check for syntax errors and missing dependencies
```

### iOS Issues

**Issue**: `iOS platform application not found`
```bash
# Solution: Create platform application first
./scripts/setup-ios-platform.sh
```

**Issue**: `APNS certificate expired`
```bash
# Solution: Update certificate in Apple Developer account and recreate platform application
```

## Validation Scripts Reference

### validate-config.ts

TypeScript-based configuration validator with AWS service checks.

**Usage:**
```bash
npx ts-node scripts/validate-config.ts [options]
```

**Options:**
- `--config FILE` - Load configuration from JSON file
- `--region REGION` - Override AWS region
- `--skip-aws` - Skip AWS service validation
- `--sample` - Show sample configuration
- `--verbose` - Show detailed information

### pre-deployment-check.sh

Comprehensive pre-deployment validation script.

**Usage:**
```bash
./scripts/pre-deployment-check.sh [options]
```

**Options:**
- `--skip-tests` - Skip test execution
- `--skip-build` - Skip TypeScript compilation
- `--skip-iam` - Skip IAM permission tests
- `--skip-cdk` - Skip CDK bootstrap check
- `--skip-ios` - Skip iOS configuration check

### validate-ios-config.sh

iOS-specific configuration validation.

**Usage:**
```bash
./scripts/validate-ios-config.sh [options]
```

**Options:**
- `--platform-arn ARN` - Override platform application ARN
- `--bundle-id ID` - Override bundle ID
- `--region REGION` - Override AWS region
- `--skip-network` - Skip network connectivity tests
- `--skip-iam` - Skip IAM permission tests

### validate-deployment.sh

Post-deployment validation script.

**Usage:**
```bash
./scripts/validate-deployment.sh [options]
```

**Options:**
- `--region REGION` - Override AWS region
- `--skip-iam` - Skip IAM permission tests
- `--skip-api` - Skip API Gateway validation
- `--skip-logs` - Skip CloudWatch logs validation

## Integration with CI/CD

### GitHub Actions Example

```yaml
name: Deploy AWS Spend Monitor

on:
  push:
    branches: [main]

jobs:
  validate-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm install
        
      - name: Pre-deployment validation
        run: ./scripts/pre-deployment-check.sh --skip-iam
        env:
          SPEND_THRESHOLD: ${{ secrets.SPEND_THRESHOLD }}
          SNS_TOPIC_ARN: ${{ secrets.SNS_TOPIC_ARN }}
          AWS_REGION: ${{ secrets.AWS_REGION }}
          
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}
          
      - name: Deploy with CDK
        run: npm run deploy
        
      - name: Post-deployment validation
        run: ./scripts/validate-deployment.sh
```

### AWS CodePipeline Example

```yaml
version: 0.2
phases:
  install:
    runtime-versions:
      nodejs: 18
    commands:
      - npm install
      
  pre_build:
    commands:
      - echo "Running pre-deployment validation..."
      - ./scripts/pre-deployment-check.sh
      
  build:
    commands:
      - echo "Deploying infrastructure..."
      - npm run deploy
      
  post_build:
    commands:
      - echo "Running post-deployment validation..."
      - ./scripts/validate-deployment.sh
```

## Monitoring and Alerting

After successful deployment, monitor the validation status:

### CloudWatch Alarms

The deployment creates CloudWatch alarms for:
- Lambda function errors
- Lambda function duration
- SNS delivery failures
- Cost Explorer API errors

### Log Analysis

Check CloudWatch logs for validation results:

```bash
# View recent Lambda logs
aws logs describe-log-streams \
  --log-group-name /aws/lambda/spend-monitor-agent \
  --order-by LastEventTime \
  --descending

# Get recent log events
aws logs get-log-events \
  --log-group-name /aws/lambda/spend-monitor-agent \
  --log-stream-name LATEST_STREAM_NAME
```

### Health Checks

Set up regular health checks:

```bash
# Test Lambda function
aws lambda invoke \
  --function-name spend-monitor-agent \
  --payload '{"source":"aws.events","detail-type":"Scheduled Event"}' \
  response.json

# Check SNS topic
aws sns get-topic-attributes \
  --topic-arn YOUR_TOPIC_ARN

# Validate iOS platform application
aws sns get-platform-application-attributes \
  --platform-application-arn YOUR_PLATFORM_ARN
```

This comprehensive validation approach ensures reliable deployment and operation of the AWS Spend Monitor with iOS support.