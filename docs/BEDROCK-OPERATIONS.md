# Bedrock Operations Guide

This guide provides operational procedures for managing AWS Bedrock integration in the FinOps AI Agent system.

## Overview

The FinOps AI Agent uses AWS Bedrock with Titan models to provide AI-enhanced cost analysis, anomaly detection, and optimization recommendations. This document covers monitoring, troubleshooting, and operational procedures for the Bedrock integration.

## Monitoring and Alerting

### CloudWatch Metrics

The system publishes the following Bedrock-specific metrics to CloudWatch:

#### Core Metrics
- `SpendMonitor/Bedrock/ExecutionCount` - Success/failure counts for Bedrock operations
- `SpendMonitor/Bedrock/BedrockResponseTimeMs` - API response times
- `SpendMonitor/Bedrock/BedrockCostUSD` - Cumulative Bedrock costs
- `SpendMonitor/Bedrock/BedrockApiCalls` - Number of API calls made
- `SpendMonitor/Bedrock/BedrockTokensUsed` - Total tokens consumed

#### Quality Metrics
- `SpendMonitor/Bedrock/BedrockConfidenceScore` - AI analysis confidence scores
- `SpendMonitor/Bedrock/BedrockAnomaliesDetected` - Number of anomalies found
- `SpendMonitor/Bedrock/BedrockRecommendationsGenerated` - Optimization recommendations count

#### Operational Metrics
- `SpendMonitor/Bedrock/BedrockRateLimited` - Rate limiting events
- `SpendMonitor/Bedrock/BedrockDisabled` - AI analysis disabled due to cost limits
- `SpendMonitor/Bedrock/BedrockFallbackUsed` - Fallback to traditional analysis
- `SpendMonitor/Bedrock/BedrockCacheHitRate` - Cache efficiency

### CloudWatch Alarms

#### Critical Alarms
1. **BedrockApiFailures** - Triggers on 2+ consecutive API failures
2. **BedrockModelAccess** - Triggers on model access validation failures
3. **BedrockDisabled** - Triggers when AI analysis is disabled due to cost limits

#### Warning Alarms
1. **BedrockCostThreshold** - Triggers at 80% of monthly cost threshold
2. **BedrockResponseTime** - Triggers on high response times (>10 seconds)
3. **BedrockRateLimit** - Triggers on rate limiting events

### Dashboard Widgets

Access the Bedrock monitoring dashboard at:
```
https://{region}.console.aws.amazon.com/cloudwatch/home?region={region}#dashboards:name=SpendMonitorAgent
```

Key widgets include:
- AI Analysis Success Rate
- Cost and Usage Monitoring
- Response Time Trends
- Confidence Score Gauge
- Model Access Health

## Operational Procedures

### 1. Bedrock Service Health Check

To verify Bedrock service health:

```bash
# Check CloudWatch metrics for recent activity
aws cloudwatch get-metric-statistics \
  --namespace "SpendMonitor/Bedrock" \
  --metric-name "ExecutionCount" \
  --dimensions Name=Operation,Value=BedrockAnalysis Name=Status,Value=Success \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum

# Check for recent failures
aws cloudwatch get-metric-statistics \
  --namespace "SpendMonitor/Bedrock" \
  --metric-name "ExecutionCount" \
  --dimensions Name=Operation,Value=BedrockAnalysis Name=Status,Value=Failure \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

### 2. Cost Monitoring

Monitor Bedrock costs to prevent unexpected charges:

```bash
# Check current month Bedrock costs
aws cloudwatch get-metric-statistics \
  --namespace "SpendMonitor/Bedrock" \
  --metric-name "BedrockCostUSD" \
  --start-time $(date -u -d 'first day of this month' +%Y-%m-%dT00:00:00) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum

# Check API call volume
aws cloudwatch get-metric-statistics \
  --namespace "SpendMonitor/Bedrock" \
  --metric-name "BedrockApiCalls" \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum
```

### 3. Performance Monitoring

Monitor Bedrock API performance:

```bash
# Check average response times
aws cloudwatch get-metric-statistics \
  --namespace "SpendMonitor/Bedrock" \
  --metric-name "BedrockResponseTimeMs" \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average,Maximum

# Check for rate limiting
aws cloudwatch get-metric-statistics \
  --namespace "SpendMonitor/Bedrock" \
  --metric-name "BedrockRateLimited" \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

## Troubleshooting

### Common Issues and Solutions

#### 1. Bedrock API Failures

**Symptoms:**
- `BedrockApiFailures` alarm triggered
- High failure rate in ExecutionCount metrics
- Error logs showing Bedrock API errors

**Diagnosis:**
```bash
# Check Lambda function logs
aws logs filter-log-events \
  --log-group-name "/aws/lambda/spend-monitor-agent" \
  --start-time $(date -d '1 hour ago' +%s)000 \
  --filter-pattern "ERROR Bedrock"

# Check for specific error patterns
aws logs filter-log-events \
  --log-group-name "/aws/lambda/spend-monitor-agent" \
  --start-time $(date -d '1 hour ago' +%s)000 \
  --filter-pattern "{ $.level = \"ERROR\" && $.operation = \"BedrockAnalysis\" }"
```

**Solutions:**
1. **Model Access Issues:**
   - Verify IAM permissions for `bedrock:InvokeModel`
   - Check if model ID is correct and available in the region
   - Ensure model is not disabled or deprecated

2. **Rate Limiting:**
   - Reduce API call frequency
   - Implement exponential backoff
   - Consider upgrading service limits

3. **Authentication Errors:**
   - Verify Lambda execution role has correct permissions
   - Check if Bedrock service is available in the region

#### 2. High Costs

**Symptoms:**
- `BedrockCostThreshold` alarm triggered
- Rapid increase in `BedrockCostUSD` metric
- AI analysis automatically disabled

**Diagnosis:**
```bash
# Check cost trends
aws cloudwatch get-metric-statistics \
  --namespace "SpendMonitor/Bedrock" \
  --metric-name "BedrockCostUSD" \
  --start-time $(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 86400 \
  --statistics Sum

# Check token usage
aws cloudwatch get-metric-statistics \
  --namespace "SpendMonitor/Bedrock" \
  --metric-name "BedrockTokensUsed" \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum
```

**Solutions:**
1. **Immediate Actions:**
   - Temporarily disable Bedrock analysis: Set `BEDROCK_ENABLED=false`
   - Reduce analysis frequency
   - Lower token limits

2. **Long-term Optimization:**
   - Implement more aggressive caching
   - Optimize prompts to use fewer tokens
   - Use smaller/cheaper models for simple analysis
   - Implement cost-based throttling

#### 3. Poor AI Quality

**Symptoms:**
- Low confidence scores in `BedrockConfidenceScore` metric
- Few anomalies detected despite obvious cost spikes
- Poor quality recommendations

**Diagnosis:**
```bash
# Check confidence score trends
aws cloudwatch get-metric-statistics \
  --namespace "SpendMonitor/Bedrock" \
  --metric-name "BedrockConfidenceScore" \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Average,Minimum

# Check anomaly detection rate
aws cloudwatch get-metric-statistics \
  --namespace "SpendMonitor/Bedrock" \
  --metric-name "BedrockAnomaliesDetected" \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum
```

**Solutions:**
1. **Prompt Optimization:**
   - Review and improve prompt templates
   - Add more context to prompts
   - Use structured output formats

2. **Model Configuration:**
   - Adjust temperature settings
   - Increase max tokens for more detailed responses
   - Consider using different Titan model variants

3. **Data Quality:**
   - Ensure cost data is complete and accurate
   - Provide historical context for better analysis
   - Filter out noise in cost data

#### 4. High Response Times

**Symptoms:**
- `BedrockResponseTime` alarm triggered
- High values in `BedrockResponseTimeMs` metric
- Timeout errors in Lambda logs

**Diagnosis:**
```bash
# Check response time patterns
aws cloudwatch get-metric-statistics \
  --namespace "SpendMonitor/Bedrock" \
  --metric-name "BedrockResponseTimeMs" \
  --start-time $(date -u -d '2 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average,Maximum,Minimum
```

**Solutions:**
1. **Immediate Actions:**
   - Reduce max tokens to speed up responses
   - Implement request timeouts
   - Use caching more aggressively

2. **Optimization:**
   - Optimize prompt length and complexity
   - Consider parallel processing for multiple analyses
   - Implement async processing for non-critical analysis

## Configuration Management

### Environment Variables

Key Bedrock configuration environment variables:

```bash
# Core configuration
BEDROCK_ENABLED=true
BEDROCK_MODEL_ID=amazon.titan-text-express-v1
BEDROCK_REGION=us-east-1

# Cost controls
BEDROCK_COST_THRESHOLD=100
BEDROCK_RATE_LIMIT_PER_MINUTE=10

# Performance tuning
BEDROCK_MAX_TOKENS=1000
BEDROCK_TEMPERATURE=0.1
BEDROCK_CACHE_TTL_MINUTES=60

# Logging
BEDROCK_LOG_LEVEL=INFO
BEDROCK_ENABLE_DETAILED_LOGGING=false
```

### CDK Context Variables

Configure Bedrock settings via CDK context:

```json
{
  "bedrockEnabled": "true",
  "bedrockModelId": "amazon.titan-text-express-v1",
  "bedrockRegion": "us-east-1",
  "bedrockCostThreshold": "100",
  "bedrockRateLimit": "10",
  "bedrockMaxTokens": "1000",
  "bedrockTemperature": "0.1",
  "bedrockCacheTTL": "60",
  "bedrockLogLevel": "INFO",
  "bedrockDetailedLogging": "false"
}
```

## Security Considerations

### IAM Permissions

The system uses least-privilege IAM permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel"
      ],
      "Resource": [
        "arn:aws:bedrock:*::foundation-model/amazon.titan-text-express-v1",
        "arn:aws:bedrock:*::foundation-model/amazon.titan-text-lite-v1",
        "arn:aws:bedrock:*::foundation-model/amazon.titan-embed-text-v1"
      ],
      "Condition": {
        "StringEquals": {
          "bedrock:ModelId": [
            "amazon.titan-text-express-v1",
            "amazon.titan-text-lite-v1",
            "amazon.titan-embed-text-v1"
          ]
        }
      }
    }
  ]
}
```

### Cost Control Policies

Implement cost control through IAM policies:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Action": [
        "bedrock:InvokeModel"
      ],
      "Resource": "*",
      "Condition": {
        "NumericGreaterThan": {
          "aws:RequestedRegion": "100"
        }
      }
    }
  ]
}
```

## Maintenance Procedures

### Regular Maintenance Tasks

1. **Weekly:**
   - Review cost trends and adjust thresholds if needed
   - Check alarm status and resolve any issues
   - Review AI analysis quality metrics

2. **Monthly:**
   - Analyze cost optimization opportunities
   - Review and update prompt templates
   - Update model configurations based on performance

3. **Quarterly:**
   - Review security permissions and policies
   - Evaluate new Bedrock models and features
   - Update operational procedures and documentation

### Backup and Recovery

1. **Configuration Backup:**
   - Export CloudWatch dashboard configurations
   - Backup CDK context and environment variables
   - Document custom prompt templates

2. **Recovery Procedures:**
   - Disable Bedrock integration if critical issues occur
   - Fallback to traditional cost analysis
   - Restore from known good configurations

## Support and Escalation

### Internal Escalation

1. **Level 1:** Check CloudWatch metrics and alarms
2. **Level 2:** Review Lambda logs and error patterns
3. **Level 3:** Engage AWS Support for Bedrock service issues

### AWS Support Cases

When opening AWS Support cases for Bedrock issues:

1. Include relevant CloudWatch metrics
2. Provide Lambda function logs with correlation IDs
3. Specify model ID and region
4. Include IAM policy configurations
5. Describe cost impact and business urgency

### Emergency Procedures

In case of critical issues:

1. **Immediate:** Disable Bedrock integration
2. **Short-term:** Switch to fallback analysis mode
3. **Long-term:** Investigate and resolve root cause

```bash
# Emergency disable command
aws lambda update-function-configuration \
  --function-name spend-monitor-agent \
  --environment Variables='{
    "BEDROCK_ENABLED": "false",
    "SNS_TOPIC_ARN": "arn:aws:sns:...",
    "SPEND_THRESHOLD": "10"
  }'
```

This operations guide should be reviewed and updated regularly as the system evolves and new Bedrock features become available.