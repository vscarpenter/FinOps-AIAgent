# Deployment Guide

This guide walks through deploying the AWS Spend Monitor Agent using AWS CDK.

## Prerequisites

1. **AWS CLI configured** with appropriate permissions
2. **Node.js 18+** installed
3. **AWS CDK** installed globally: `npm install -g aws-cdk`
4. **Cost Explorer API access** enabled in your AWS account

## Required AWS Permissions

Your deployment user/role needs these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ce:GetCostAndUsage",
        "ce:GetUsageReport",
        "ce:GetDimensionValues"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sns:CreateTopic",
        "sns:Subscribe",
        "sns:Publish"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "events:PutRule",
        "events:PutTargets"
      ],
      "Resource": "*"
    }
  ]
}
```

## Step-by-Step Deployment

### 1. Install Dependencies

```bash
npm install
```

### 2. Build the Project

```bash
npm run build
```

### 3. Bootstrap CDK (First Time Only)

```bash
cdk bootstrap
```

### 4. Deploy the Stack

```bash
cdk deploy
```

The deployment will create:
- Lambda function with the Strands agent
- SNS topic for alerts
- EventBridge rule for daily scheduling
- IAM roles and policies

### 5. Configure SNS Subscriptions

After deployment, subscribe to the SNS topic:

```bash
# Get the topic ARN from CDK output
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:ACCOUNT:aws-spend-alerts \
  --protocol email \
  --notification-endpoint your-email@example.com
```

### 6. Confirm Subscription

Check your email and confirm the SNS subscription.

## Configuration Options

### Environment Variables

You can customize the agent by setting these environment variables:

- `SPEND_THRESHOLD`: Monthly spend threshold in USD (default: 10)
- `CHECK_PERIOD_DAYS`: How often to check (default: 1)
- `SNS_TOPIC_ARN`: SNS topic for alerts (set automatically)

### Updating Configuration

To change the spend threshold after deployment:

```bash
aws lambda update-function-configuration \
  --function-name SpendMonitorStack-SpendMonitorAgent \
  --environment Variables='{SPEND_THRESHOLD=25}'
```

## Testing the Deployment

### Manual Trigger

Test the agent manually:

```bash
aws lambda invoke \
  --function-name SpendMonitorStack-SpendMonitorAgent \
  --payload '{}' \
  response.json
```

### Check Logs

View execution logs:

```bash
aws logs tail /aws/lambda/SpendMonitorStack-SpendMonitorAgent --follow
```

## Monitoring and Troubleshooting

### Common Issues

1. **Cost Explorer API not enabled**
   - Enable in AWS Billing console
   - May take 24 hours to activate

2. **Insufficient permissions**
   - Check IAM policies
   - Ensure Cost Explorer permissions

3. **SNS delivery failures**
   - Verify email subscription
   - Check SNS topic permissions

### Monitoring

- CloudWatch metrics for Lambda execution
- SNS delivery status
- Cost Explorer API usage

## Cleanup

To remove all resources:

```bash
cdk destroy
```

This will delete:
- Lambda function
- SNS topic
- EventBridge rule
- IAM roles

Note: SNS subscriptions may need manual cleanup.