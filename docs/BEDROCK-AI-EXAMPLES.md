# AWS Bedrock AI Analysis Examples and API Documentation

This document provides comprehensive examples of AI-enhanced cost analysis outputs, confidence score interpretation, code examples for Bedrock integration, and operational runbooks for AI feature management.

## Overview

The FinOps AI Agent uses AWS Bedrock with Titan models to provide intelligent cost analysis, including:
- Spending pattern analysis with natural language insights
- Anomaly detection with confidence scoring
- Cost optimization recommendations with priority ranking
- Enhanced alert content with actionable AI-generated recommendations

## AI Analysis Examples

### 1. Spending Pattern Analysis Example

#### Input Cost Data
```json
{
  "totalCost": 2847.32,
  "projectedMonthly": 8541.96,
  "period": {
    "start": "2024-01-01",
    "end": "2024-01-10"
  },
  "serviceBreakdown": {
    "Amazon Elastic Compute Cloud - Compute": 1245.67,
    "Amazon Simple Storage Service": 523.45,
    "Amazon Relational Database Service": 387.22,
    "Amazon CloudFront": 234.56,
    "AWS Lambda": 156.78,
    "Amazon DynamoDB": 89.34,
    "Amazon ElastiCache": 67.89,
    "Amazon API Gateway": 45.23,
    "AWS CloudTrail": 23.45,
    "Amazon Route 53": 12.34
  }
}
```

#### AI Analysis Output
```json
{
  "summary": "Current AWS spending shows a compute-heavy workload with EC2 representing 44% of total costs. The projected monthly spend of $8,542 indicates significant scale with storage and database services as secondary cost drivers.",
  "keyInsights": [
    "EC2 compute costs ($1,246) dominate spending, suggesting potential rightsizing opportunities",
    "S3 storage costs ($523) are substantial, indicating possible lifecycle policy optimization",
    "RDS costs ($387) suggest database workloads that could benefit from Reserved Instance pricing",
    "CloudFront usage ($235) shows content delivery optimization is already in place",
    "Lambda costs ($157) are moderate, indicating efficient serverless adoption"
  ],
  "confidenceScore": 0.87,
  "analysisTimestamp": "2024-01-10T14:30:00Z",
  "modelUsed": "amazon.titan-text-express-v1",
  "processingCost": 0.0024
}
```

### 2. Anomaly Detection Example

#### Input with Historical Context
```json
{
  "currentCostData": {
    "totalCost": 3456.78,
    "serviceBreakdown": {
      "Amazon Elastic Compute Cloud - Compute": 2100.45,
      "Amazon Simple Storage Service": 567.89,
      "Amazon Relational Database Service": 345.67,
      "AWS Lambda": 234.56,
      "Amazon DynamoDB": 123.45,
      "Amazon CloudFront": 84.76
    }
  },
  "historicalData": [
    {
      "totalCost": 1234.56,
      "serviceBreakdown": {
        "Amazon Elastic Compute Cloud - Compute": 678.90,
        "Amazon Simple Storage Service": 234.56,
        "Amazon Relational Database Service": 156.78,
        "AWS Lambda": 89.34,
        "Amazon DynamoDB": 45.67,
        "Amazon CloudFront": 29.31
      }
    }
  ]
}
```

#### Anomaly Detection Output
```json
{
  "anomaliesDetected": true,
  "anomalies": [
    {
      "service": "Amazon Elastic Compute Cloud - Compute",
      "severity": "HIGH",
      "description": "EC2 costs ($2,100) are 209% higher than historical average ($679), indicating significant infrastructure scaling or inefficient resource usage",
      "confidenceScore": 0.92,
      "suggestedAction": "Review recent EC2 instance launches, check for oversized instances, and validate auto-scaling configurations"
    },
    {
      "service": "Amazon Simple Storage Service",
      "severity": "MEDIUM",
      "description": "S3 costs ($568) are 142% higher than historical average ($235), suggesting increased data storage or inefficient storage classes",
      "confidenceScore": 0.78,
      "suggestedAction": "Analyze S3 storage classes, implement lifecycle policies, and review data retention policies"
    },
    {
      "service": "AWS Lambda",
      "severity": "MEDIUM",
      "description": "Lambda costs ($235) are 163% higher than historical average ($89), indicating increased function executions or inefficient code",
      "confidenceScore": 0.71,
      "suggestedAction": "Review Lambda function performance, optimize memory allocation, and check for infinite loops or excessive invocations"
    }
  ]
}
```

### 3. Optimization Recommendations Example

#### Input Cost Data
```json
{
  "totalCost": 4567.89,
  "serviceBreakdown": {
    "Amazon Elastic Compute Cloud - Compute": 2345.67,
    "Amazon Simple Storage Service": 789.12,
    "Amazon Relational Database Service": 567.89,
    "Amazon ElastiCache": 234.56,
    "AWS Lambda": 156.78,
    "Amazon DynamoDB": 123.45,
    "Amazon CloudFront": 89.34,
    "Amazon API Gateway": 67.89,
    "AWS Data Transfer": 45.67,
    "Amazon Route 53": 23.45
  }
}
```

#### Optimization Recommendations Output
```json
{
  "recommendations": [
    {
      "category": "RESERVED_INSTANCES",
      "service": "Amazon Elastic Compute Cloud - Compute",
      "description": "Purchase EC2 Reserved Instances for consistent workloads. Analysis shows steady usage patterns suitable for 1-year term commitments.",
      "estimatedSavings": 821.98,
      "priority": "HIGH",
      "implementationComplexity": "EASY"
    },
    {
      "category": "STORAGE_OPTIMIZATION",
      "service": "Amazon Simple Storage Service",
      "description": "Implement S3 Intelligent Tiering and lifecycle policies to automatically move infrequently accessed data to cheaper storage classes.",
      "estimatedSavings": 236.74,
      "priority": "HIGH",
      "implementationComplexity": "EASY"
    },
    {
      "category": "RIGHTSIZING",
      "service": "Amazon Elastic Compute Cloud - Compute",
      "description": "Rightsize EC2 instances based on utilization metrics. Several instances show consistently low CPU and memory usage.",
      "estimatedSavings": 469.13,
      "priority": "HIGH",
      "implementationComplexity": "MEDIUM"
    },
    {
      "category": "RESERVED_INSTANCES",
      "service": "Amazon Relational Database Service",
      "description": "Consider RDS Reserved Instances for database workloads with predictable usage patterns.",
      "estimatedSavings": 198.76,
      "priority": "MEDIUM",
      "implementationComplexity": "EASY"
    },
    {
      "category": "RIGHTSIZING",
      "service": "Amazon ElastiCache",
      "description": "Review ElastiCache node types and cluster configurations for potential downsizing opportunities.",
      "estimatedSavings": 70.37,
      "priority": "MEDIUM",
      "implementationComplexity": "MEDIUM"
    }
  ]
}
```

## Confidence Score Interpretation

### Understanding Confidence Scores

Confidence scores range from 0.0 to 1.0 and indicate the AI model's certainty in its analysis:

#### Score Ranges and Interpretation

| Score Range | Interpretation | Recommended Action |
|-------------|----------------|-------------------|
| 0.9 - 1.0 | Very High Confidence | Act on recommendations immediately |
| 0.8 - 0.89 | High Confidence | Validate and implement recommendations |
| 0.7 - 0.79 | Good Confidence | Review recommendations with domain expertise |
| 0.6 - 0.69 | Moderate Confidence | Investigate further before acting |
| 0.5 - 0.59 | Low Confidence | Use as starting point for investigation |
| 0.0 - 0.49 | Very Low Confidence | Consider fallback analysis or manual review |

#### Factors Affecting Confidence Scores

1. **Data Quality and Completeness**
   - Complete service breakdown increases confidence
   - Historical data availability boosts anomaly detection confidence
   - Missing or sparse data reduces confidence

2. **Pattern Clarity**
   - Clear spending patterns result in higher confidence
   - Irregular or noisy data reduces confidence
   - Consistent trends across time periods increase confidence

3. **Service Significance**
   - Major cost drivers (>10% of total) get higher confidence
   - Minor services (<1% of total) get lower confidence
   - Well-known AWS services get higher confidence than obscure ones

4. **Historical Context**
   - More historical data points increase confidence
   - Consistent patterns across periods boost confidence
   - Lack of historical data reduces confidence by 0.2 points

### Confidence Score Enhancement Logic

The system automatically adjusts confidence scores based on:

```typescript
// Example confidence adjustment logic
function adjustConfidenceScore(baseScore: number, factors: ConfidenceFactors): number {
  let adjustedScore = baseScore;
  
  // Historical data availability
  if (factors.hasHistoricalData) {
    adjustedScore += 0.2;
    if (factors.historicalDataPoints > 5) {
      adjustedScore += 0.1; // Bonus for rich historical context
    }
  } else {
    adjustedScore -= 0.2;
  }
  
  // Service cost significance
  if (factors.costPercentage > 0.3) {
    adjustedScore += 0.2; // Major cost driver
  } else if (factors.costPercentage > 0.1) {
    adjustedScore += 0.1; // Significant service
  } else if (factors.costPercentage < 0.01) {
    adjustedScore -= 0.3; // Minor service
  }
  
  // Pattern consistency
  if (factors.patternConsistency > 0.8) {
    adjustedScore += 0.1;
  } else if (factors.patternConsistency < 0.3) {
    adjustedScore -= 0.2;
  }
  
  // Clamp to valid range
  return Math.max(0.0, Math.min(1.0, adjustedScore));
}
```

## Code Examples for Bedrock Integration

### 1. Basic Bedrock Analysis Tool Usage

```typescript
import { BedrockAnalysisTool } from '../src/tools/bedrock-analysis-tool';
import { BedrockConfig, CostAnalysis } from '../src/types';

// Configure Bedrock
const bedrockConfig: BedrockConfig = {
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

// Initialize the tool
const bedrockTool = new BedrockAnalysisTool(bedrockConfig);

// Perform spending pattern analysis
async function analyzeSpending(costData: CostAnalysis) {
  try {
    // Validate model access first
    const hasAccess = await bedrockTool.validateModelAccess();
    if (!hasAccess) {
      throw new Error('Bedrock model access validation failed');
    }
    
    // Perform AI analysis
    const aiAnalysis = await bedrockTool.analyzeSpendingPatterns(costData);
    
    console.log('AI Analysis Results:');
    console.log(`Summary: ${aiAnalysis.summary}`);
    console.log(`Confidence: ${aiAnalysis.confidenceScore}`);
    console.log('Key Insights:');
    aiAnalysis.keyInsights.forEach((insight, index) => {
      console.log(`  ${index + 1}. ${insight}`);
    });
    
    return aiAnalysis;
  } catch (error) {
    console.error('AI analysis failed:', error);
    throw error;
  }
}
```

### 2. Anomaly Detection with Historical Context

```typescript
async function detectAnomalies(
  currentCostData: CostAnalysis, 
  historicalData: CostAnalysis[]
) {
  try {
    const anomalyResult = await bedrockTool.detectAnomalies(
      currentCostData, 
      historicalData
    );
    
    if (anomalyResult.anomaliesDetected) {
      console.log(`Found ${anomalyResult.anomalies.length} anomalies:`);
      
      anomalyResult.anomalies.forEach((anomaly, index) => {
        console.log(`\nAnomaly ${index + 1}:`);
        console.log(`  Service: ${anomaly.service}`);
        console.log(`  Severity: ${anomaly.severity}`);
        console.log(`  Confidence: ${anomaly.confidenceScore}`);
        console.log(`  Description: ${anomaly.description}`);
        console.log(`  Suggested Action: ${anomaly.suggestedAction}`);
      });
    } else {
      console.log('No anomalies detected in current spending patterns');
    }
    
    return anomalyResult;
  } catch (error) {
    console.error('Anomaly detection failed:', error);
    throw error;
  }
}
```

### 3. Optimization Recommendations Generation

```typescript
async function generateOptimizationRecommendations(costData: CostAnalysis) {
  try {
    const recommendations = await bedrockTool.generateOptimizationRecommendations(costData);
    
    if (recommendations.length > 0) {
      console.log(`Generated ${recommendations.length} optimization recommendations:`);
      
      // Group by priority
      const highPriority = recommendations.filter(r => r.priority === 'HIGH');
      const mediumPriority = recommendations.filter(r => r.priority === 'MEDIUM');
      const lowPriority = recommendations.filter(r => r.priority === 'LOW');
      
      console.log('\n=== HIGH PRIORITY RECOMMENDATIONS ===');
      highPriority.forEach((rec, index) => {
        console.log(`\n${index + 1}. ${rec.service} - ${rec.category}`);
        console.log(`   Description: ${rec.description}`);
        console.log(`   Estimated Savings: $${rec.estimatedSavings?.toFixed(2) || 'N/A'}`);
        console.log(`   Complexity: ${rec.implementationComplexity}`);
      });
      
      console.log('\n=== MEDIUM PRIORITY RECOMMENDATIONS ===');
      mediumPriority.forEach((rec, index) => {
        console.log(`\n${index + 1}. ${rec.service} - ${rec.category}`);
        console.log(`   Description: ${rec.description}`);
        console.log(`   Estimated Savings: $${rec.estimatedSavings?.toFixed(2) || 'N/A'}`);
        console.log(`   Complexity: ${rec.implementationComplexity}`);
      });
      
      const totalSavings = recommendations.reduce(
        (sum, rec) => sum + (rec.estimatedSavings || 0), 
        0
      );
      console.log(`\nTotal Estimated Savings: $${totalSavings.toFixed(2)}`);
    } else {
      console.log('No optimization recommendations generated');
    }
    
    return recommendations;
  } catch (error) {
    console.error('Optimization recommendation generation failed:', error);
    throw error;
  }
}
```

### 4. Enhanced Cost Analysis Integration

```typescript
import { CostAnalysisTool } from '../src/tools/cost-analysis-tool';

async function performEnhancedCostAnalysis(config: SpendMonitorConfig) {
  const costTool = new CostAnalysisTool(config);
  const bedrockTool = new BedrockAnalysisTool(config.bedrockConfig!);
  
  try {
    // Get basic cost analysis
    const costAnalysis = await costTool.getCurrentMonthCosts();
    
    // Enhance with AI analysis if enabled
    if (config.bedrockConfig?.enabled) {
      const enhancedAnalysis = await costTool.enhanceWithAIAnalysis(costAnalysis);
      
      console.log('Enhanced Cost Analysis Results:');
      console.log(`Total Cost: $${enhancedAnalysis.totalCost.toFixed(2)}`);
      console.log(`Projected Monthly: $${enhancedAnalysis.projectedMonthly.toFixed(2)}`);
      
      if (enhancedAnalysis.aiAnalysis) {
        console.log('\nAI Insights:');
        console.log(`Summary: ${enhancedAnalysis.aiAnalysis.summary}`);
        console.log(`Confidence: ${enhancedAnalysis.aiAnalysis.confidenceScore}`);
        
        enhancedAnalysis.aiAnalysis.keyInsights.forEach((insight, index) => {
          console.log(`  ${index + 1}. ${insight}`);
        });
      }
      
      if (enhancedAnalysis.anomalies?.anomaliesDetected) {
        console.log('\nAnomalies Detected:');
        enhancedAnalysis.anomalies.anomalies.forEach((anomaly, index) => {
          console.log(`  ${index + 1}. ${anomaly.service}: ${anomaly.description}`);
        });
      }
      
      if (enhancedAnalysis.recommendations && enhancedAnalysis.recommendations.length > 0) {
        console.log('\nTop Optimization Recommendations:');
        enhancedAnalysis.recommendations.slice(0, 3).forEach((rec, index) => {
          console.log(`  ${index + 1}. ${rec.service}: ${rec.description}`);
          console.log(`     Estimated Savings: $${rec.estimatedSavings?.toFixed(2) || 'N/A'}`);
        });
      }
      
      return enhancedAnalysis;
    } else {
      console.log('Bedrock analysis disabled, returning basic cost analysis');
      return costAnalysis;
    }
  } catch (error) {
    console.error('Enhanced cost analysis failed:', error);
    throw error;
  }
}
```

### 5. Error Handling and Fallback Patterns

```typescript
async function robustAIAnalysis(costData: CostAnalysis) {
  const bedrockTool = new BedrockAnalysisTool(bedrockConfig);
  
  try {
    // Attempt AI analysis with comprehensive error handling
    const aiAnalysis = await bedrockTool.analyzeSpendingPatterns(costData);
    
    // Validate confidence score
    if (aiAnalysis.confidenceScore < 0.5) {
      console.warn('Low confidence AI analysis, consider manual review');
    }
    
    return aiAnalysis;
  } catch (error) {
    console.error('AI analysis failed, using fallback:', error);
    
    // Implement fallback analysis
    return createFallbackAnalysis(costData);
  }
}

function createFallbackAnalysis(costData: CostAnalysis): AIAnalysisResult {
  const topService = Object.entries(costData.serviceBreakdown)
    .sort(([, a], [, b]) => b - a)[0];
  
  return {
    summary: `Current AWS spending is $${costData.totalCost.toFixed(2)} with projected monthly cost of $${costData.projectedMonthly.toFixed(2)}.`,
    keyInsights: [
      `Top cost driver: ${topService ? topService[0] : 'Unknown'} ($${topService ? topService[1].toFixed(2) : '0.00'})`,
      'AI analysis unavailable - using basic cost breakdown',
      'Consider reviewing high-cost services for optimization opportunities'
    ],
    confidenceScore: 0.3,
    analysisTimestamp: new Date().toISOString(),
    modelUsed: 'fallback'
  };
}
```

## Operational Runbooks for AI Feature Management

### 1. AI Analysis Health Check Runbook

#### Purpose
Verify that Bedrock AI analysis is functioning correctly and producing quality insights.

#### Frequency
- **Automated**: Every 4 hours via CloudWatch alarms
- **Manual**: Daily during business hours
- **On-demand**: After configuration changes or incidents

#### Procedure

```bash
#!/bin/bash
# AI Analysis Health Check Script

echo "=== Bedrock AI Analysis Health Check ==="
echo "Timestamp: $(date)"

# 1. Check Bedrock service availability
echo "1. Checking Bedrock service availability..."
aws bedrock list-foundation-models --region us-east-1 > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "   ✓ Bedrock service is accessible"
else
    echo "   ✗ Bedrock service is not accessible"
    exit 1
fi

# 2. Verify model access
echo "2. Verifying Titan model access..."
aws bedrock get-foundation-model --model-identifier amazon.titan-text-express-v1 --region us-east-1 > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "   ✓ Titan model access confirmed"
else
    echo "   ✗ Titan model access denied"
    exit 1
fi

# 3. Check recent AI analysis metrics
echo "3. Checking recent AI analysis metrics..."
SUCCESS_COUNT=$(aws cloudwatch get-metric-statistics \
    --namespace "SpendMonitor/Bedrock" \
    --metric-name "ExecutionCount" \
    --dimensions Name=Operation,Value=BedrockAnalysis Name=Status,Value=Success \
    --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
    --period 3600 \
    --statistics Sum \
    --query 'Datapoints[0].Sum' \
    --output text)

FAILURE_COUNT=$(aws cloudwatch get-metric-statistics \
    --namespace "SpendMonitor/Bedrock" \
    --metric-name "ExecutionCount" \
    --dimensions Name=Operation,Value=BedrockAnalysis Name=Status,Value=Failure \
    --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
    --period 3600 \
    --statistics Sum \
    --query 'Datapoints[0].Sum' \
    --output text)

if [ "$SUCCESS_COUNT" != "None" ] && [ "$SUCCESS_COUNT" -gt 0 ]; then
    echo "   ✓ Recent successful AI analyses: $SUCCESS_COUNT"
else
    echo "   ⚠ No successful AI analyses in the last hour"
fi

if [ "$FAILURE_COUNT" != "None" ] && [ "$FAILURE_COUNT" -gt 0 ]; then
    echo "   ⚠ Recent failed AI analyses: $FAILURE_COUNT"
fi

# 4. Check confidence score trends
echo "4. Checking AI confidence score trends..."
AVG_CONFIDENCE=$(aws cloudwatch get-metric-statistics \
    --namespace "SpendMonitor/Bedrock" \
    --metric-name "BedrockConfidenceScore" \
    --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S) \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
    --period 86400 \
    --statistics Average \
    --query 'Datapoints[0].Average' \
    --output text)

if [ "$AVG_CONFIDENCE" != "None" ]; then
    echo "   ✓ Average confidence score (24h): $AVG_CONFIDENCE"
    if (( $(echo "$AVG_CONFIDENCE < 0.6" | bc -l) )); then
        echo "   ⚠ Low average confidence score - consider reviewing AI prompts"
    fi
else
    echo "   ⚠ No confidence score data available"
fi

# 5. Check cost accumulation
echo "5. Checking Bedrock cost accumulation..."
MONTHLY_COST=$(aws cloudwatch get-metric-statistics \
    --namespace "SpendMonitor/Bedrock" \
    --metric-name "BedrockCostUSD" \
    --start-time $(date -u -d 'first day of this month' +%Y-%m-%dT00:00:00) \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
    --period 86400 \
    --statistics Sum \
    --query 'Datapoints[-1].Sum' \
    --output text)

if [ "$MONTHLY_COST" != "None" ]; then
    echo "   ✓ Current month Bedrock cost: \$${MONTHLY_COST}"
    COST_THRESHOLD=100
    if (( $(echo "$MONTHLY_COST > $COST_THRESHOLD" | bc -l) )); then
        echo "   ⚠ Bedrock costs approaching threshold (\$${COST_THRESHOLD})"
    fi
else
    echo "   ⚠ No cost data available"
fi

echo "=== Health Check Complete ==="
```

### 2. AI Quality Monitoring Runbook

#### Purpose
Monitor and maintain the quality of AI-generated insights and recommendations.

#### Triggers
- Low confidence scores (< 0.6 average over 24 hours)
- High anomaly false positive rates
- Poor recommendation quality feedback

#### Procedure

1. **Analyze Confidence Score Trends**
   ```bash
   # Get confidence score distribution
   aws cloudwatch get-metric-statistics \
     --namespace "SpendMonitor/Bedrock" \
     --metric-name "BedrockConfidenceScore" \
     --start-time $(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%S) \
     --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
     --period 3600 \
     --statistics Average,Minimum,Maximum
   ```

2. **Review Recent AI Outputs**
   ```bash
   # Check Lambda logs for AI analysis results
   aws logs filter-log-events \
     --log-group-name "/aws/lambda/spend-monitor-agent" \
     --start-time $(date -d '24 hours ago' +%s)000 \
     --filter-pattern "{ $.operation = \"BedrockAnalysis\" && $.confidenceScore < 0.6 }"
   ```

3. **Validate Prompt Templates**
   - Review current prompt templates for clarity and specificity
   - Test prompts with sample data to ensure consistent outputs
   - Update prompts based on observed quality issues

4. **Adjust Model Parameters**
   ```typescript
   // Example parameter adjustments for quality improvement
   const qualityOptimizedConfig: BedrockConfig = {
     // ... other settings
     temperature: 0.1, // Lower temperature for more deterministic outputs
     maxTokens: 1500,  // More tokens for detailed analysis
   };
   ```

### 3. Cost Control and Optimization Runbook

#### Purpose
Monitor and control Bedrock usage costs while maintaining analysis quality.

#### Triggers
- Monthly cost approaching 80% of threshold
- Unusual spike in API call volume
- Rate limiting events

#### Procedure

1. **Immediate Cost Assessment**
   ```bash
   # Check current month costs
   aws cloudwatch get-metric-statistics \
     --namespace "SpendMonitor/Bedrock" \
     --metric-name "BedrockCostUSD" \
     --start-time $(date -u -d 'first day of this month' +%Y-%m-%dT00:00:00) \
     --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
     --period 86400 \
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

2. **Cost Optimization Actions**
   
   **Immediate (if costs > 90% of threshold):**
   ```bash
   # Temporarily disable Bedrock analysis
   aws lambda update-function-configuration \
     --function-name spend-monitor-agent \
     --environment Variables='{"BEDROCK_ENABLED":"false"}'
   ```
   
   **Short-term (if costs > 80% of threshold):**
   - Reduce analysis frequency
   - Implement more aggressive caching
   - Lower token limits for non-critical analysis
   
   **Long-term optimization:**
   - Optimize prompt engineering to use fewer tokens
   - Implement cost-based throttling
   - Consider using cheaper model variants for simple analysis

3. **Cache Optimization**
   ```typescript
   // Implement aggressive caching for cost control
   const costOptimizedConfig: BedrockConfig = {
     // ... other settings
     cacheResults: true,
     cacheTTLMinutes: 240, // 4-hour cache for stable patterns
     rateLimitPerMinute: 5, // Reduce API call frequency
   };
   ```

### 4. Incident Response Runbook

#### Purpose
Respond to AI analysis failures and service disruptions.

#### Severity Levels

**Critical (P1)**: AI analysis completely unavailable
**High (P2)**: High failure rate (>50%) or very low confidence scores (<0.3)
**Medium (P3)**: Moderate issues affecting analysis quality
**Low (P4)**: Minor issues or optimization opportunities

#### Response Procedures

**P1 - Critical Incident**
1. **Immediate Actions (0-15 minutes)**
   ```bash
   # Enable fallback mode immediately
   aws lambda update-function-configuration \
     --function-name spend-monitor-agent \
     --environment Variables='{"BEDROCK_FALLBACK_ON_ERROR":"true"}'
   
   # Check service status
   aws bedrock list-foundation-models --region us-east-1
   ```

2. **Investigation (15-60 minutes)**
   - Check AWS Service Health Dashboard
   - Review Lambda function logs for error patterns
   - Verify IAM permissions and model access
   - Test model invocation manually

3. **Resolution (1-4 hours)**
   - Apply fixes based on root cause analysis
   - Gradually re-enable AI analysis
   - Monitor recovery metrics

**P2 - High Severity**
1. **Assessment (0-30 minutes)**
   - Analyze failure patterns and error rates
   - Check confidence score trends
   - Review recent configuration changes

2. **Mitigation (30 minutes - 2 hours)**
   - Adjust model parameters if needed
   - Implement temporary rate limiting
   - Update prompt templates if quality issues identified

**P3/P4 - Medium/Low Severity**
1. **Scheduled Investigation**
   - Review during next business day
   - Analyze trends and patterns
   - Plan optimization improvements

### 5. Performance Optimization Runbook

#### Purpose
Optimize AI analysis performance and response times.

#### Monitoring Metrics
- Average response time
- 95th percentile response time
- Token usage efficiency
- Cache hit rates

#### Optimization Actions

1. **Response Time Optimization**
   ```typescript
   // Optimize for faster responses
   const performanceConfig: BedrockConfig = {
     // ... other settings
     maxTokens: 800,      // Reduce tokens for faster processing
     temperature: 0.1,    // Lower temperature for faster generation
     rateLimitPerMinute: 15, // Increase rate limit if costs allow
   };
   ```

2. **Prompt Optimization**
   - Reduce prompt length while maintaining clarity
   - Use structured output formats
   - Implement prompt templates for consistency

3. **Caching Strategy**
   ```typescript
   // Implement intelligent caching
   const cacheStrategy = {
     // Cache stable cost patterns longer
     stableCostCacheTTL: 120, // 2 hours
     // Cache volatile patterns shorter
     volatileCostCacheTTL: 30, // 30 minutes
     // Cache based on cost change percentage
     getCacheTTL: (costChangePercentage: number) => {
       if (costChangePercentage < 5) return 120; // Stable
       if (costChangePercentage < 20) return 60;  // Moderate
       return 15; // Volatile - short cache
     }
   };
   ```

This comprehensive documentation provides teams with the knowledge and tools needed to effectively use, monitor, and maintain the AI-enhanced cost analysis features of the FinOps AI Agent system.