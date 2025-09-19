/**
 * Bedrock Monitoring Configuration Examples
 * 
 * This file provides configuration examples for Bedrock monitoring and alerting
 * infrastructure in the FinOps AI Agent system.
 */

export interface BedrockMonitoringConfig {
  // Cost monitoring settings
  costThreshold: number; // Monthly cost threshold in USD
  costAlertThreshold: number; // Percentage of threshold to trigger alerts (0.8 = 80%)
  
  // Performance monitoring settings
  responseTimeThreshold: number; // Maximum acceptable response time in milliseconds
  rateLimitThreshold: number; // API calls per minute before rate limiting
  
  // Quality monitoring settings
  minimumConfidenceScore: number; // Minimum acceptable confidence score (0.0 - 1.0)
  anomalyDetectionSensitivity: 'LOW' | 'MEDIUM' | 'HIGH';
  
  // Operational settings
  enableDetailedLogging: boolean;
  logLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  enableCostOptimization: boolean;
  
  // Alert settings
  operationalAlertTopicArn: string;
  alertOnModelAccessFailure: boolean;
  alertOnCostThresholdBreach: boolean;
  alertOnHighResponseTime: boolean;
}

/**
 * Development Environment Configuration
 * Suitable for development and testing with lower thresholds
 */
export const developmentConfig: BedrockMonitoringConfig = {
  costThreshold: 10, // $10 USD per month
  costAlertThreshold: 0.8, // Alert at 80% of threshold ($8)
  responseTimeThreshold: 15000, // 15 seconds
  rateLimitThreshold: 5, // 5 calls per minute
  minimumConfidenceScore: 0.6,
  anomalyDetectionSensitivity: 'MEDIUM',
  enableDetailedLogging: true,
  logLevel: 'DEBUG',
  enableCostOptimization: true,
  operationalAlertTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-monitor-ops-alerts-dev',
  alertOnModelAccessFailure: true,
  alertOnCostThresholdBreach: true,
  alertOnHighResponseTime: true
};

/**
 * Production Environment Configuration
 * Suitable for production with higher thresholds and optimized settings
 */
export const productionConfig: BedrockMonitoringConfig = {
  costThreshold: 100, // $100 USD per month
  costAlertThreshold: 0.9, // Alert at 90% of threshold ($90)
  responseTimeThreshold: 10000, // 10 seconds
  rateLimitThreshold: 20, // 20 calls per minute
  minimumConfidenceScore: 0.7,
  anomalyDetectionSensitivity: 'HIGH',
  enableDetailedLogging: false,
  logLevel: 'INFO',
  enableCostOptimization: true,
  operationalAlertTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-monitor-ops-alerts-prod',
  alertOnModelAccessFailure: true,
  alertOnCostThresholdBreach: true,
  alertOnHighResponseTime: true
};

/**
 * Enterprise Environment Configuration
 * Suitable for enterprise deployments with high volume and strict monitoring
 */
export const enterpriseConfig: BedrockMonitoringConfig = {
  costThreshold: 500, // $500 USD per month
  costAlertThreshold: 0.85, // Alert at 85% of threshold ($425)
  responseTimeThreshold: 8000, // 8 seconds
  rateLimitThreshold: 50, // 50 calls per minute
  minimumConfidenceScore: 0.8,
  anomalyDetectionSensitivity: 'HIGH',
  enableDetailedLogging: false,
  logLevel: 'WARN',
  enableCostOptimization: true,
  operationalAlertTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-monitor-ops-alerts-enterprise',
  alertOnModelAccessFailure: true,
  alertOnCostThresholdBreach: true,
  alertOnHighResponseTime: true
};

/**
 * CloudWatch Alarm Configuration for Bedrock Monitoring
 */
export interface BedrockAlarmConfig {
  alarmName: string;
  description: string;
  metricName: string;
  namespace: string;
  threshold: number;
  comparisonOperator: string;
  evaluationPeriods: number;
  period: number; // in seconds
  statistic: string;
  treatMissingData: string;
  dimensions?: { [key: string]: string };
}

/**
 * Standard Bedrock CloudWatch Alarms Configuration
 */
export const bedrockAlarms: BedrockAlarmConfig[] = [
  {
    alarmName: 'SpendMonitor-BedrockApiFailures',
    description: 'Alarm for Bedrock API call failures',
    metricName: 'ExecutionCount',
    namespace: 'SpendMonitor/Bedrock',
    threshold: 2,
    comparisonOperator: 'GreaterThanOrEqualToThreshold',
    evaluationPeriods: 1,
    period: 300, // 5 minutes
    statistic: 'Sum',
    treatMissingData: 'notBreaching',
    dimensions: {
      Operation: 'BedrockAnalysis',
      Status: 'Failure'
    }
  },
  {
    alarmName: 'SpendMonitor-BedrockCostThreshold',
    description: 'Alarm for Bedrock API usage costs exceeding threshold',
    metricName: 'BedrockCostUSD',
    namespace: 'SpendMonitor/Bedrock',
    threshold: 80, // Will be calculated as percentage of configured threshold
    comparisonOperator: 'GreaterThanThreshold',
    evaluationPeriods: 1,
    period: 3600, // 1 hour
    statistic: 'Sum',
    treatMissingData: 'notBreaching'
  },
  {
    alarmName: 'SpendMonitor-BedrockRateLimit',
    description: 'Alarm for Bedrock API rate limiting events',
    metricName: 'BedrockRateLimited',
    namespace: 'SpendMonitor/Bedrock',
    threshold: 1,
    comparisonOperator: 'GreaterThanOrEqualToThreshold',
    evaluationPeriods: 1,
    period: 300, // 5 minutes
    statistic: 'Sum',
    treatMissingData: 'notBreaching'
  },
  {
    alarmName: 'SpendMonitor-BedrockResponseTime',
    description: 'Alarm for high Bedrock API response times',
    metricName: 'BedrockResponseTimeMs',
    namespace: 'SpendMonitor/Bedrock',
    threshold: 10000, // 10 seconds
    comparisonOperator: 'GreaterThanThreshold',
    evaluationPeriods: 2,
    period: 300, // 5 minutes
    statistic: 'Average',
    treatMissingData: 'notBreaching'
  },
  {
    alarmName: 'SpendMonitor-BedrockModelAccess',
    description: 'Alarm for Bedrock model access validation failures',
    metricName: 'ExecutionCount',
    namespace: 'SpendMonitor/Bedrock',
    threshold: 1,
    comparisonOperator: 'GreaterThanOrEqualToThreshold',
    evaluationPeriods: 1,
    period: 900, // 15 minutes
    statistic: 'Sum',
    treatMissingData: 'notBreaching',
    dimensions: {
      Operation: 'ModelAccessValidation',
      Status: 'Failure'
    }
  },
  {
    alarmName: 'SpendMonitor-BedrockDisabled',
    description: 'Alarm when Bedrock AI analysis is disabled due to cost limits',
    metricName: 'BedrockDisabled',
    namespace: 'SpendMonitor/Bedrock',
    threshold: 1,
    comparisonOperator: 'GreaterThanOrEqualToThreshold',
    evaluationPeriods: 1,
    period: 300, // 5 minutes
    statistic: 'Maximum',
    treatMissingData: 'notBreaching'
  }
];

/**
 * Bedrock Dashboard Widget Configuration
 */
export interface BedrockDashboardWidget {
  title: string;
  type: 'line' | 'number' | 'gauge';
  metrics: Array<{
    namespace: string;
    metricName: string;
    dimensions?: { [key: string]: string };
    statistic: string;
    period: number;
  }>;
  width: number;
  height: number;
}

/**
 * Standard Bedrock Dashboard Widgets
 */
export const bedrockDashboardWidgets: BedrockDashboardWidget[] = [
  {
    title: 'Bedrock AI Analysis Success Rate',
    type: 'line',
    metrics: [
      {
        namespace: 'SpendMonitor/Bedrock',
        metricName: 'ExecutionCount',
        dimensions: { Operation: 'BedrockAnalysis', Status: 'Success' },
        statistic: 'Sum',
        period: 900 // 15 minutes
      },
      {
        namespace: 'SpendMonitor/Bedrock',
        metricName: 'ExecutionCount',
        dimensions: { Operation: 'BedrockAnalysis', Status: 'Failure' },
        statistic: 'Sum',
        period: 900 // 15 minutes
      }
    ],
    width: 12,
    height: 6
  },
  {
    title: 'Bedrock Cost Monitoring',
    type: 'line',
    metrics: [
      {
        namespace: 'SpendMonitor/Bedrock',
        metricName: 'BedrockCostUSD',
        statistic: 'Sum',
        period: 3600 // 1 hour
      },
      {
        namespace: 'SpendMonitor/Bedrock',
        metricName: 'BedrockApiCalls',
        statistic: 'Sum',
        period: 3600 // 1 hour
      }
    ],
    width: 12,
    height: 6
  },
  {
    title: 'Bedrock Response Time',
    type: 'line',
    metrics: [
      {
        namespace: 'SpendMonitor/Bedrock',
        metricName: 'BedrockResponseTimeMs',
        statistic: 'Average',
        period: 900 // 15 minutes
      }
    ],
    width: 6,
    height: 6
  },
  {
    title: 'Bedrock Confidence Score',
    type: 'gauge',
    metrics: [
      {
        namespace: 'SpendMonitor/Bedrock',
        metricName: 'BedrockConfidenceScore',
        statistic: 'Average',
        period: 3600 // 1 hour
      }
    ],
    width: 6,
    height: 6
  }
];

/**
 * Bedrock Logging Configuration
 */
export interface BedrockLoggingConfig {
  logLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  enableDetailedLogging: boolean;
  logRetentionDays: number;
  enableStructuredLogging: boolean;
  enableCorrelationIds: boolean;
  logSensitiveData: boolean; // Should be false in production
  customLogFields: string[];
}

/**
 * Production Bedrock Logging Configuration
 */
export const productionLoggingConfig: BedrockLoggingConfig = {
  logLevel: 'INFO',
  enableDetailedLogging: false,
  logRetentionDays: 30,
  enableStructuredLogging: true,
  enableCorrelationIds: true,
  logSensitiveData: false,
  customLogFields: [
    'bedrockModelId',
    'bedrockRegion',
    'responseTimeMs',
    'tokenCount',
    'confidenceScore',
    'costUSD'
  ]
};

/**
 * Development Bedrock Logging Configuration
 */
export const developmentLoggingConfig: BedrockLoggingConfig = {
  logLevel: 'DEBUG',
  enableDetailedLogging: true,
  logRetentionDays: 7,
  enableStructuredLogging: true,
  enableCorrelationIds: true,
  logSensitiveData: true, // Allowed in development for debugging
  customLogFields: [
    'bedrockModelId',
    'bedrockRegion',
    'responseTimeMs',
    'tokenCount',
    'confidenceScore',
    'costUSD',
    'requestPayload',
    'responsePayload',
    'errorDetails'
  ]
};