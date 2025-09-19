# AWS Bedrock Setup and Configuration Guide

This guide provides comprehensive instructions for setting up and configuring AWS Bedrock integration with the FinOps AI Agent system.

## Overview

The FinOps AI Agent uses AWS Bedrock with Titan models to provide AI-enhanced cost analysis, including:
- Intelligent spending pattern analysis
- Anomaly detection with confidence scoring
- Cost optimization recommendations
- Enhanced alert content with actionable insights

## Prerequisites

### AWS Account Requirements

1. **AWS Account with Bedrock Access**
   - AWS account with appropriate permissions
   - Bedrock service available in your target region
   - Cost Explorer API access enabled

2. **Model Access Permissions**
   - Request access to Titan models in AWS Bedrock console
   - Ensure models are enabled in your target region
   - Verify quota limits for your use case

3. **IAM Permissions**
   - `bedrock:InvokeModel` permission for specific models
   - CloudWatch metrics and logs permissions
   - Cost Explorer read permissions

### Supported Regions

Bedrock is available in the following regions (verify current availability):
- `us-east-1` (N. Virginia) - Recommended for most use cases
- `us-west-2` (Oregon)
- `eu-west-1` (Ireland)
- `ap-southeast-1` (Singapore)

## Step-by-Step Setup

### 1. Enable Bedrock Model Access

1. **Navigate to AWS Bedrock Console**
   ```
   https://console.aws.amazon.com/bedrock/
   ```

2. **Request Model Access**
   - Go to "Model access" in the left navigation
   - Click "Request model access"
   - Select the following models:
     - `amazon.titan-text-express-v1` (Recommended)
     - `amazon.titan-text-lite-v1` (Cost-optimized)
     - `amazon.titan-embed-text-v1` (Optional)

3. **Wait for Approval**
   - Model access is typically approved within minutes
   - Check status in the Bedrock console
   - Verify access by testing model invocation

### 2. Configure IAM Permissions

Create an IAM policy for Bedrock access:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BedrockModelAccess",
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
    },
    {
      "Sid": "CloudWatchMetrics",
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricData"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "cloudwatch:namespace": "SpendMonitor/Bedrock"
        }
      }
    }
  ]
}
```

### 3. Configure Environment Variables

Set the following environment variables for your Lambda function:

```bash
# Core Bedrock Configuration
BEDROCK_ENABLED=true
BEDROCK_MODEL_ID=amazon.titan-text-express-v1
BEDROCK_REGION=us-east-1

# Cost Controls
BEDROCK_COST_THRESHOLD=100
BEDROCK_RATE_LIMIT_PER_MINUTE=10

# Performance Tuning
BEDROCK_MAX_TOKENS=1000
BEDROCK_TEMPERATURE=0.3
BEDROCK_CACHE_RESULTS=true
BEDROCK_CACHE_TTL_MINUTES=60
BEDROCK_FALLBACK_ON_ERROR=true

# Logging
BEDROCK_LOG_LEVEL=INFO
BEDROCK_ENABLE_DETAILED_LOGGING=false
```

### 4. Update CDK Configuration

Add Bedrock configuration to your CDK context:

```json
{
  "bedrockEnabled": "true",
  "bedrockModelId": "amazon.titan-text-express-v1",
  "bedrockRegion": "us-east-1",
  "bedrockCostThreshold": "100",
  "bedrockRateLimit": "10",
  "bedrockMaxTokens": "1000",
  "bedrockTemperature": "0.3",
  "bedrockCacheTTL": "60",
  "bedrockLogLevel": "INFO"
}
```

### 5. Deploy Infrastructure Updates

Deploy the updated infrastructure with Bedrock support:

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Deploy with Bedrock configuration
cdk deploy --context bedrockEnabled=true
```

## Configuration Options

### Model Selection Guide

#### Titan Text Express (Recommended)
- **Model ID**: `amazon.titan-text-express-v1`
- **Use Case**: Balanced performance and cost
- **Max Tokens**: Up to 8,000
- **Best For**: Regular cost analysis and optimization recommendations

#### Titan Text Lite (Cost-Optimized)
- **Model ID**: `amazon.titan-text-lite-v1`
- **Use Case**: Cost-sensitive deployments
- **Max Tokens**: Up to 4,000
- **Best For**: Basic anomaly detection and simple insights

#### Titan Embeddings (Optional)
- **Model ID**: `amazon.titan-embed-text-v1`
- **Use Case**: Advanced pattern matching
- **Best For**: Complex cost pattern analysis

### Configuration Parameters

#### Core Settings

| Parameter | Description | Default | Range |
|-----------|-------------|---------|-------|
| `enabled` | Enable/disable Bedrock integration | `true` | `true/false` |
| `modelId` | Bedrock model identifier | `amazon.titan-text-express-v1` | Valid model ID |
| `region` | AWS region for Bedrock | `us-east-1` | Valid AWS region |

#### Performance Settings

| Parameter | Description | Default | Range |
|-----------|-------------|---------|-------|
| `maxTokens` | Maximum tokens per request | `1000` | `1-8000` |
| `temperature` | Model creativity (0=deterministic, 1=creative) | `0.3` | `0.0-1.0` |
| `rateLimitPerMinute` | API calls per minute limit | `10` | `1-100` |

#### Cost Control Settings

| Parameter | Description | Default | Range |
|-----------|-------------|---------|-------|
| `costThreshold` | Monthly cost limit (USD) | `100` | `1-10000` |
| `fallbackOnError` | Use traditional analysis on AI failure | `true` | `true/false` |

#### Caching Settings

| Parameter | Description | Default | Range |
|-----------|-------------|---------|-------|
| `cacheResults` | Enable response caching | `true` | `true/false` |
| `cacheTTLMinutes` | Cache time-to-live in minutes | `60` | `1-1440` |

## Environment-Specific Configurations

### Production Environment

```typescript
const productionConfig: BedrockConfig = {
  enabled: true,
  modelId: 'amazon.titan-text-express-v1',
  region: 'us-east-1',
  maxTokens: 1000,
  temperature: 0.3,
  costThreshold: 100,
  rateLimitPerMinute: 10,
  cacheResults: true,
  cacheTTLMinutes: 60,
  fallbackOnError: true
};
```

### Development Environment

```typescript
const developmentConfig: BedrockConfig = {
  enabled: true,
  modelId: 'amazon.titan-text-express-v1',
  region: 'us-east-1',
  maxTokens: 500,
  temperature: 0.1,
  costThreshold: 10,
  rateLimitPerMinute: 5,
  cacheResults: true,
  cacheTTLMinutes: 15,
  fallbackOnError: true
};
```

### Cost-Optimized Environment

```typescript
const costOptimizedConfig: BedrockConfig = {
  enabled: true,
  modelId: 'amazon.titan-text-lite-v1',
  region: 'us-east-1',
  maxTokens: 800,
  temperature: 0.2,
  costThreshold: 25,
  rateLimitPerMinute: 15,
  cacheResults: true,
  cacheTTLMinutes: 30,
  fallbackOnError: true
};
```

## Validation and Testing

### 1. Configuration Validation

Test your configuration with the validation script:

```bash
# Run configuration validation
npm run validate-config

# Test Bedrock connectivity
node scripts/test-bedrock-connection.js
```

### 2. Model Access Verification

Verify model access programmatically:

```typescript
import { BedrockAnalysisTool } from './src/tools/bedrock-analysis-tool';

const tool = new BedrockAnalysisTool(config);
const hasAccess = await tool.validateModelAccess();
console.log('Model access:', hasAccess);
```

### 3. End-to-End Testing

Run integration tests to verify complete functionality:

```bash
# Run Bedrock integration tests
npm run test:integration -- --testNamePattern="bedrock"

# Run AI performance tests
npm run test:integration -- tests/integration/ai-performance.test.ts
```

## Cost Optimization Best Practices

### 1. Implement Aggressive Caching

```typescript
const cacheOptimizedConfig: BedrockConfig = {
  // ... other settings
  cacheResults: true,
  cacheTTLMinutes: 120, // 2-hour cache for stable cost patterns
};
```

### 2. Use Appropriate Token Limits

```typescript
// For basic analysis
const basicConfig = {
  maxTokens: 500, // Sufficient for simple insights
};

// For detailed analysis
const detailedConfig = {
  maxTokens: 1500, // More comprehensive recommendations
};
```

### 3. Implement Cost Monitoring

```typescript
const costControlConfig: BedrockConfig = {
  costThreshold: 50, // Conservative monthly limit
  rateLimitPerMinute: 5, // Prevent runaway costs
  fallbackOnError: true, // Always have fallback
};
```

### 4. Optimize Prompt Engineering

- Use structured prompts for consistent responses
- Minimize unnecessary context in prompts
- Request specific output formats to reduce tokens
- Implement prompt templates for reusability

### 5. Monitor Usage Patterns

Set up CloudWatch alarms for:
- Daily cost thresholds
- API call volume limits
- Response time monitoring
- Error rate tracking

## Security Considerations

### 1. Least Privilege Access

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-text-express-v1",
      "Condition": {
        "StringEquals": {
          "bedrock:ModelId": "amazon.titan-text-express-v1"
        },
        "IpAddress": {
          "aws:SourceIp": ["10.0.0.0/16"]
        }
      }
    }
  ]
}
```

### 2. Data Privacy

- Cost data is processed in memory only
- No persistent storage of sensitive information
- Audit trails for all AI analysis requests
- Compliance with data residency requirements

### 3. Cost Controls

- Implement spending limits via IAM policies
- Monitor usage with CloudWatch alarms
- Automatic disabling when thresholds exceeded
- Regular cost reviews and optimization

## Next Steps

After completing the setup:

1. **Monitor Initial Performance**
   - Review CloudWatch metrics for first 24 hours
   - Validate AI analysis quality
   - Check cost accumulation patterns

2. **Optimize Configuration**
   - Adjust token limits based on usage
   - Fine-tune caching parameters
   - Optimize cost thresholds

3. **Implement Monitoring**
   - Set up CloudWatch dashboards
   - Configure operational alarms
   - Establish cost monitoring procedures

4. **Train Your Team**
   - Review AI analysis outputs
   - Understand confidence scoring
   - Learn optimization recommendations

For troubleshooting and operational procedures, see [BEDROCK-OPERATIONS.md](./BEDROCK-OPERATIONS.md).