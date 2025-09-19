# Bedrock Troubleshooting Guide

This guide provides solutions for common issues encountered when using AWS Bedrock integration with the FinOps AI Agent.

## Quick Diagnostic Checklist

Before diving into specific issues, run through this quick checklist:

- [ ] Bedrock service is available in your region
- [ ] Model access has been granted for your account
- [ ] IAM permissions are correctly configured
- [ ] Environment variables are set properly
- [ ] Cost thresholds haven't been exceeded
- [ ] Rate limits aren't being hit

## Common Issues and Solutions

### 1. Model Access Denied

#### Symptoms
```
AccessDeniedException: User is not authorized to perform: bedrock:InvokeModel
```

#### Diagnosis
```bash
# Check IAM permissions
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::ACCOUNT:role/lambda-execution-role \
  --action-names bedrock:InvokeModel \
  --resource-arns arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-text-express-v1

# Verify model access in Bedrock console
aws bedrock list-foundation-models --region us-east-1
```

#### Solutions

1. **Request Model Access**
   ```bash
   # Navigate to Bedrock console and request access
   # https://console.aws.amazon.com/bedrock/home#/modelaccess
   ```

2. **Update IAM Policy**
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": "bedrock:InvokeModel",
         "Resource": "arn:aws:bedrock:*::foundation-model/amazon.titan-text-express-v1"
       }
     ]
   }
   ```

3. **Verify Region Availability**
   ```bash
   # Check if Bedrock is available in your region
   aws bedrock list-foundation-models --region us-east-1
   ```

### 2. Model Not Found

#### Symptoms
```
ValidationException: The model ID 'amazon.titan-text-express-v1' is not supported
```

#### Diagnosis
```bash
# List available models in your region
aws bedrock list-foundation-models \
  --region us-east-1 \
  --query 'modelSummaries[?contains(modelId, `titan`)]'

# Check model status
aws bedrock get-foundation-model \
  --model-identifier amazon.titan-text-express-v1 \
  --region us-east-1
```

#### Solutions

1. **Use Correct Model ID**
   ```typescript
   // Correct model IDs
   const validModelIds = [
     'amazon.titan-text-express-v1',
     'amazon.titan-text-lite-v1',
     'amazon.titan-embed-text-v1'
   ];
   ```

2. **Check Regional Availability**
   ```bash
   # Models may not be available in all regions
   aws bedrock list-foundation-models --region us-west-2
   ```

3. **Update Configuration**
   ```typescript
   const config: BedrockConfig = {
     modelId: 'amazon.titan-text-express-v1', // Verify this is correct
     region: 'us-east-1' // Ensure model is available in this region
   };
   ```

### 3. Rate Limiting Issues

#### Symptoms
```
ThrottlingException: Rate exceeded
TooManyRequestsException: Request was denied due to request throttling
```

#### Diagnosis
```bash
# Check CloudWatch metrics for rate limiting
aws cloudwatch get-metric-statistics \
  --namespace "SpendMonitor/Bedrock" \
  --metric-name "BedrockRateLimited" \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

#### Solutions

1. **Implement Exponential Backoff**
   ```typescript
   const retryConfig = {
     maxRetries: 3,
     baseDelay: 1000,
     maxDelay: 10000,
     backoffMultiplier: 2
   };
   ```

2. **Reduce Rate Limits**
   ```typescript
   const config: BedrockConfig = {
     rateLimitPerMinute: 5, // Reduce from default 10
     // Add delays between requests
   };
   ```

3. **Request Quota Increase**
   ```bash
   # Submit AWS Support case for quota increase
   # Include usage patterns and business justification
   ```

### 4. High Costs / Budget Exceeded

#### Symptoms
```
Cost threshold exceeded: $150.00 > $100.00
AI analysis disabled due to cost limits
```

#### Diagnosis
```bash
# Check current month costs
aws cloudwatch get-metric-statistics \
  --namespace "SpendMonitor/Bedrock" \
  --metric-name "BedrockCostUSD" \
  --start-time $(date -u -d 'first day of this month' +%Y-%m-%dT00:00:00) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 86400 \
  --statistics Sum

# Check token usage patterns
aws cloudwatch get-metric-statistics \
  --namespace "SpendMonitor/Bedrock" \
  --metric-name "BedrockTokensUsed" \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum
```

#### Solutions

1. **Immediate Cost Control**
   ```bash
   # Temporarily disable Bedrock
   aws lambda update-function-configuration \
     --function-name spend-monitor-agent \
     --environment Variables='{"BEDROCK_ENABLED":"false"}'
   ```

2. **Optimize Token Usage**
   ```typescript
   const optimizedConfig: BedrockConfig = {
     maxTokens: 500, // Reduce from 1000
     temperature: 0.1, // More deterministic = fewer tokens
     cacheResults: true,
     cacheTTLMinutes: 120 // Longer cache
   };
   ```

3. **Switch to Cheaper Model**
   ```typescript
   const costOptimizedConfig: BedrockConfig = {
     modelId: 'amazon.titan-text-lite-v1', // Cheaper than express
     maxTokens: 400,
     costThreshold: 25
   };
   ```

### 5. Poor AI Analysis Quality

#### Symptoms
- Low confidence scores (< 0.5)
- Generic or unhelpful recommendations
- Missing anomaly detection

#### Diagnosis
```bash
# Check confidence score trends
aws cloudwatch get-metric-statistics \
  --namespace "SpendMonitor/Bedrock" \
  --metric-name "BedrockConfidenceScore" \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Average,Minimum

# Review recent AI responses in logs
aws logs filter-log-events \
  --log-group-name "/aws/lambda/spend-monitor-agent" \
  --start-time $(date -d '1 hour ago' +%s)000 \
  --filter-pattern "{ $.aiAnalysis.confidenceScore < 0.5 }"
```

#### Solutions

1. **Improve Prompt Engineering**
   ```typescript
   // Add more context to prompts
   const enhancedPrompt = `
   Analyze the following AWS cost data with focus on:
   - Unusual spending patterns compared to typical usage
   - Services with significant cost increases
   - Specific optimization opportunities
   
   Cost Data: ${JSON.stringify(costData)}
   Historical Context: ${JSON.stringify(historicalData)}
   `;
   ```

2. **Adjust Model Parameters**
   ```typescript
   const qualityConfig: BedrockConfig = {
     maxTokens: 1500, // Allow more detailed responses
     temperature: 0.4, // Balance creativity and consistency
   };
   ```

3. **Provide Better Context**
   ```typescript
   // Include historical data for better analysis
   const analysisContext = {
     currentCosts: costData,
     previousMonth: historicalData,
     businessContext: organizationInfo
   };
   ```

### 6. Timeout Issues

#### Symptoms
```
TimeoutError: Request timed out after 30000ms
Lambda function timeout
```

#### Diagnosis
```bash
# Check response time patterns
aws cloudwatch get-metric-statistics \
  --namespace "SpendMonitor/Bedrock" \
  --metric-name "BedrockResponseTimeMs" \
  --start-time $(date -u -d '2 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average,Maximum
```

#### Solutions

1. **Optimize Request Size**
   ```typescript
   const optimizedConfig: BedrockConfig = {
     maxTokens: 800, // Reduce response size
     // Simplify prompts to reduce processing time
   };
   ```

2. **Implement Timeout Handling**
   ```typescript
   const timeoutConfig = {
     requestTimeout: 25000, // 25 seconds
     retryOnTimeout: true,
     fallbackOnTimeout: true
   };
   ```

3. **Increase Lambda Timeout**
   ```bash
   aws lambda update-function-configuration \
     --function-name spend-monitor-agent \
     --timeout 300 # 5 minutes
   ```

### 7. Cache Issues

#### Symptoms
- Stale AI analysis results
- Cache misses despite recent requests
- Inconsistent analysis results

#### Diagnosis
```bash
# Check cache hit rates
aws cloudwatch get-metric-statistics \
  --namespace "SpendMonitor/Bedrock" \
  --metric-name "BedrockCacheHitRate" \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Average
```

#### Solutions

1. **Adjust Cache TTL**
   ```typescript
   const cacheConfig: BedrockConfig = {
     cacheResults: true,
     cacheTTLMinutes: 30, // Shorter TTL for fresher results
   };
   ```

2. **Implement Cache Invalidation**
   ```typescript
   // Clear cache when significant cost changes detected
   if (costChangePercentage > 20) {
     await clearBedrockCache();
   }
   ```

3. **Optimize Cache Keys**
   ```typescript
   // Use more specific cache keys
   const cacheKey = `bedrock-analysis-${date}-${serviceHash}-${costThreshold}`;
   ```

### 8. Network Connectivity Issues

#### Symptoms
```
NetworkingError: getaddrinfo ENOTFOUND bedrock.us-east-1.amazonaws.com
ECONNRESET: Connection reset by peer
```

#### Diagnosis
```bash
# Test network connectivity
curl -I https://bedrock.us-east-1.amazonaws.com

# Check VPC configuration if using VPC Lambda
aws ec2 describe-vpc-endpoints --filters Name=service-name,Values=com.amazonaws.us-east-1.bedrock
```

#### Solutions

1. **Configure VPC Endpoints** (if using VPC Lambda)
   ```bash
   aws ec2 create-vpc-endpoint \
     --vpc-id vpc-12345678 \
     --service-name com.amazonaws.us-east-1.bedrock \
     --route-table-ids rtb-12345678
   ```

2. **Update Security Groups**
   ```bash
   # Allow HTTPS outbound traffic
   aws ec2 authorize-security-group-egress \
     --group-id sg-12345678 \
     --protocol tcp \
     --port 443 \
     --cidr 0.0.0.0/0
   ```

3. **Implement Retry Logic**
   ```typescript
   const networkRetryConfig = {
     maxRetries: 5,
     retryDelayOptions: {
       base: 300
     }
   };
   ```

## Diagnostic Commands

### Health Check Script

```bash
#!/bin/bash
# bedrock-health-check.sh

echo "=== Bedrock Health Check ==="

# 1. Check model access
echo "Checking model access..."
aws bedrock list-foundation-models --region us-east-1 --query 'modelSummaries[?contains(modelId, `titan`)]'

# 2. Check recent metrics
echo "Checking recent metrics..."
aws cloudwatch get-metric-statistics \
  --namespace "SpendMonitor/Bedrock" \
  --metric-name "ExecutionCount" \
  --dimensions Name=Status,Value=Success \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum

# 3. Check for errors
echo "Checking for recent errors..."
aws logs filter-log-events \
  --log-group-name "/aws/lambda/spend-monitor-agent" \
  --start-time $(date -d '1 hour ago' +%s)000 \
  --filter-pattern "ERROR Bedrock"

# 4. Check cost status
echo "Checking cost status..."
aws cloudwatch get-metric-statistics \
  --namespace "SpendMonitor/Bedrock" \
  --metric-name "BedrockCostUSD" \
  --start-time $(date -u -d 'first day of this month' +%Y-%m-%dT00:00:00) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 86400 \
  --statistics Sum

echo "=== Health Check Complete ==="
```

### Configuration Validation Script

```bash
#!/bin/bash
# validate-bedrock-config.sh

echo "=== Bedrock Configuration Validation ==="

# Check environment variables
echo "Environment Variables:"
echo "BEDROCK_ENABLED: ${BEDROCK_ENABLED:-not set}"
echo "BEDROCK_MODEL_ID: ${BEDROCK_MODEL_ID:-not set}"
echo "BEDROCK_REGION: ${BEDROCK_REGION:-not set}"
echo "BEDROCK_COST_THRESHOLD: ${BEDROCK_COST_THRESHOLD:-not set}"

# Validate model ID
if [ -n "$BEDROCK_MODEL_ID" ]; then
  echo "Validating model ID: $BEDROCK_MODEL_ID"
  aws bedrock get-foundation-model \
    --model-identifier "$BEDROCK_MODEL_ID" \
    --region "${BEDROCK_REGION:-us-east-1}"
fi

# Check IAM permissions
echo "Checking IAM permissions..."
aws sts get-caller-identity

echo "=== Validation Complete ==="
```

## Emergency Procedures

### Immediate Disable

```bash
# Emergency disable Bedrock integration
aws lambda update-function-configuration \
  --function-name spend-monitor-agent \
  --environment Variables='{
    "BEDROCK_ENABLED": "false",
    "SNS_TOPIC_ARN": "arn:aws:sns:us-east-1:123456789012:spend-alerts",
    "SPEND_THRESHOLD": "100"
  }'
```

### Cost Limit Override

```bash
# Temporarily increase cost threshold
aws lambda update-function-configuration \
  --function-name spend-monitor-agent \
  --environment Variables='{
    "BEDROCK_ENABLED": "true",
    "BEDROCK_COST_THRESHOLD": "200",
    "BEDROCK_RATE_LIMIT_PER_MINUTE": "5"
  }'
```

### Fallback Mode

```bash
# Enable fallback mode only
aws lambda update-function-configuration \
  --function-name spend-monitor-agent \
  --environment Variables='{
    "BEDROCK_ENABLED": "true",
    "BEDROCK_FALLBACK_ON_ERROR": "true",
    "BEDROCK_RATE_LIMIT_PER_MINUTE": "1"
  }'
```

## Getting Help

### AWS Support

When opening AWS Support cases for Bedrock issues:

1. **Include System Information**
   - AWS account ID
   - Region and model ID
   - Lambda function name and version
   - Error messages with timestamps

2. **Provide Diagnostic Data**
   - CloudWatch metrics screenshots
   - Lambda function logs (sanitized)
   - IAM policy configurations
   - Recent configuration changes

3. **Specify Business Impact**
   - Cost monitoring disruption
   - Alert delivery failures
   - Timeline for resolution needed

### Internal Escalation

1. **Level 1**: Check CloudWatch metrics and basic configuration
2. **Level 2**: Review Lambda logs and IAM permissions
3. **Level 3**: Engage AWS Support for service-level issues

### Community Resources

- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [AWS Bedrock User Guide](https://docs.aws.amazon.com/bedrock/latest/userguide/)
- [AWS Bedrock API Reference](https://docs.aws.amazon.com/bedrock/latest/APIReference/)
- [AWS re:Post Bedrock Community](https://repost.aws/tags/TA4IvCeRbdS_2YlL0jl5nKog/amazon-bedrock)

For operational procedures and monitoring, see [BEDROCK-OPERATIONS.md](./BEDROCK-OPERATIONS.md).