/**
 * Bedrock Monitoring Utilities
 * 
 * This module provides comprehensive monitoring capabilities for AWS Bedrock
 * including cost tracking, health checks, and CloudWatch alarm management.
 */

import { CloudWatchClient, PutMetricAlarmCommand, DescribeAlarmsCommand, DeleteAlarmsCommand } from '@aws-sdk/client-cloudwatch';
import { BedrockConfig } from '../types';
import { createLogger } from './logger';
import { MetricsCollector } from './metrics';

export interface BedrockMonitoringConfig {
  bedrockConfig: BedrockConfig;
  region: string;
  alarmTopicArn?: string;
}

export interface BedrockHealthStatus {
  overall: 'healthy' | 'warning' | 'critical';
  modelAccess: boolean;
  costUtilization: number;
  rateLimitStatus: 'normal' | 'approaching' | 'exceeded';
  cachePerformance?: {
    hitRate: number;
    costSavings: number;
  };
  lastHealthCheck: string;
  errors: string[];
  warnings: string[];
}

export interface BedrockCostMetrics {
  monthlySpend: number;
  costThreshold: number;
  utilizationPercentage: number;
  callCount: number;
  averageCostPerCall: number;
  projectedMonthlySpend: number;
  lastUpdated: string;
}

/**
 * Bedrock monitoring service for health checks and cost tracking
 */
export class BedrockMonitoringService {
  private cloudWatch: CloudWatchClient;
  private config: BedrockMonitoringConfig;
  private logger = createLogger('BedrockMonitoringService');
  private metrics: MetricsCollector;

  constructor(config: BedrockMonitoringConfig) {
    this.config = config;
    this.cloudWatch = new CloudWatchClient({ region: config.region });
    this.metrics = new MetricsCollector(config.region, 'SpendMonitor/Bedrock');
  }

  /**
   * Creates CloudWatch alarms for Bedrock cost monitoring
   */
  async createBedrockCostAlarms(): Promise<void> {
    const { bedrockConfig, alarmTopicArn } = this.config;
    
    if (!bedrockConfig.enabled) {
      this.logger.info('Bedrock is disabled, skipping alarm creation');
      return;
    }

    try {
      // Create alarm for monthly spend threshold (80% warning)
      const warningThreshold = bedrockConfig.costThreshold * 0.8;
      await this.createCostAlarm(
        'BedrockCostWarning',
        'Bedrock monthly spend approaching threshold',
        'BedrockMonthlySpend',
        warningThreshold,
        'GreaterThanThreshold',
        alarmTopicArn
      );

      // Create alarm for monthly spend threshold (100% critical)
      await this.createCostAlarm(
        'BedrockCostCritical',
        'Bedrock monthly spend exceeded threshold',
        'BedrockMonthlySpend',
        bedrockConfig.costThreshold,
        'GreaterThanThreshold',
        alarmTopicArn
      );

      // Create alarm for rate limit hits
      await this.createCostAlarm(
        'BedrockRateLimitExceeded',
        'Bedrock API rate limit exceeded',
        'BedrockRateLimitHits',
        5, // Alert after 5 rate limit hits
        'GreaterThanThreshold',
        alarmTopicArn
      );

      // Create alarm for health check failures
      await this.createCostAlarm(
        'BedrockHealthCheckFailure',
        'Bedrock health check failures detected',
        'BedrockHealthCheck',
        0, // Alert when health check value is 0 (unhealthy)
        'LessThanThreshold',
        alarmTopicArn
      );

      this.logger.info('Bedrock CloudWatch alarms created successfully', {
        warningThreshold,
        criticalThreshold: bedrockConfig.costThreshold,
        modelId: bedrockConfig.modelId
      });

    } catch (error) {
      this.logger.error('Failed to create Bedrock CloudWatch alarms', error as Error, {
        modelId: bedrockConfig.modelId,
        costThreshold: bedrockConfig.costThreshold
      });
      throw error;
    }
  }

  /**
   * Creates a CloudWatch alarm for Bedrock metrics
   */
  private async createCostAlarm(
    alarmName: string,
    alarmDescription: string,
    metricName: string,
    threshold: number,
    comparisonOperator: string,
    alarmTopicArn?: string
  ): Promise<void> {
    const command = new PutMetricAlarmCommand({
      AlarmName: `SpendMonitor-${alarmName}-${this.config.bedrockConfig.modelId}`,
      AlarmDescription: alarmDescription,
      MetricName: metricName,
      Namespace: 'SpendMonitor/Bedrock',
      Statistic: 'Sum',
      Period: 300, // 5 minutes
      EvaluationPeriods: 1,
      Threshold: threshold,
      ComparisonOperator: comparisonOperator as any,
      AlarmActions: alarmTopicArn ? [alarmTopicArn] : undefined,
      Dimensions: [
        {
          Name: 'ModelId',
          Value: this.config.bedrockConfig.modelId
        }
      ],
      TreatMissingData: 'notBreaching'
    });

    await this.cloudWatch.send(command);
    
    this.logger.debug('CloudWatch alarm created', {
      alarmName,
      metricName,
      threshold,
      comparisonOperator
    });
  }

  /**
   * Performs comprehensive Bedrock health check
   */
  async performHealthCheck(): Promise<BedrockHealthStatus> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let modelAccess = false;
    let costUtilization = 0;
    let rateLimitStatus: 'normal' | 'approaching' | 'exceeded' = 'normal';

    try {
      // Check model access (this would need to be implemented in BedrockAnalysisTool)
      // For now, we'll simulate this check
      modelAccess = true; // This should call bedrockTool.validateModelAccess()
      
      // Check cost utilization
      const costMetrics = await this.getCostMetrics();
      costUtilization = costMetrics.utilizationPercentage;
      
      if (costUtilization >= 100) {
        errors.push('Bedrock cost threshold exceeded');
      } else if (costUtilization >= 80) {
        warnings.push('Bedrock cost utilization approaching threshold');
      }

      // Check rate limit status (simulated)
      const currentCallRate = 5; // This should be calculated from actual metrics
      const maxCallRate = this.config.bedrockConfig.rateLimitPerMinute;
      
      if (currentCallRate >= maxCallRate) {
        rateLimitStatus = 'exceeded';
        errors.push('Bedrock rate limit exceeded');
      } else if (currentCallRate >= maxCallRate * 0.8) {
        rateLimitStatus = 'approaching';
        warnings.push('Bedrock rate limit approaching');
      }

      // Record health check metrics
      await this.metrics.recordBedrockHealthCheck(
        this.config.bedrockConfig.modelId,
        errors.length === 0,
        undefined,
        errors.length > 0 ? errors[0] : undefined
      );

    } catch (error) {
      errors.push(`Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      await this.metrics.recordBedrockHealthCheck(
        this.config.bedrockConfig.modelId,
        false,
        undefined,
        'HealthCheckException'
      );
    }

    // Determine overall health
    const overall = errors.length > 0 ? 'critical' : 
                   warnings.length > 0 ? 'warning' : 'healthy';

    const healthStatus: BedrockHealthStatus = {
      overall,
      modelAccess,
      costUtilization,
      rateLimitStatus,
      lastHealthCheck: new Date().toISOString(),
      errors,
      warnings
    };

    this.logger.info('Bedrock health check completed', {
      overall,
      modelAccess,
      costUtilization,
      rateLimitStatus,
      errorCount: errors.length,
      warningCount: warnings.length
    });

    return healthStatus;
  }

  /**
   * Gets current Bedrock cost metrics
   */
  async getCostMetrics(): Promise<BedrockCostMetrics> {
    // This is a simplified implementation
    // In a real implementation, this would query CloudWatch metrics
    const monthlySpend = 0; // This should be calculated from actual usage
    const costThreshold = this.config.bedrockConfig.costThreshold;
    const utilizationPercentage = (monthlySpend / costThreshold) * 100;
    const callCount = 0; // This should be retrieved from metrics
    const averageCostPerCall = callCount > 0 ? monthlySpend / callCount : 0;
    
    // Simple projection based on current daily spend
    const daysInMonth = new Date().getDate();
    const dailySpend = monthlySpend / daysInMonth;
    const projectedMonthlySpend = dailySpend * 30;

    const costMetrics: BedrockCostMetrics = {
      monthlySpend,
      costThreshold,
      utilizationPercentage,
      callCount,
      averageCostPerCall,
      projectedMonthlySpend,
      lastUpdated: new Date().toISOString()
    };

    // Record cost tracking metrics
    await this.metrics.recordBedrockCostTracking(
      monthlySpend,
      costThreshold,
      callCount
    );

    return costMetrics;
  }

  /**
   * Removes Bedrock CloudWatch alarms
   */
  async removeBedrockCostAlarms(): Promise<void> {
    try {
      const alarmNames = [
        `SpendMonitor-BedrockCostWarning-${this.config.bedrockConfig.modelId}`,
        `SpendMonitor-BedrockCostCritical-${this.config.bedrockConfig.modelId}`,
        `SpendMonitor-BedrockRateLimitExceeded-${this.config.bedrockConfig.modelId}`,
        `SpendMonitor-BedrockHealthCheckFailure-${this.config.bedrockConfig.modelId}`
      ];

      const command = new DeleteAlarmsCommand({
        AlarmNames: alarmNames
      });

      await this.cloudWatch.send(command);
      
      this.logger.info('Bedrock CloudWatch alarms removed successfully', {
        alarmNames,
        modelId: this.config.bedrockConfig.modelId
      });

    } catch (error) {
      this.logger.error('Failed to remove Bedrock CloudWatch alarms', error as Error, {
        modelId: this.config.bedrockConfig.modelId
      });
      throw error;
    }
  }

  /**
   * Lists existing Bedrock CloudWatch alarms
   */
  async listBedrockAlarms(): Promise<string[]> {
    try {
      const command = new DescribeAlarmsCommand({
        AlarmNamePrefix: `SpendMonitor-Bedrock`,
        MaxRecords: 100
      });

      const response = await this.cloudWatch.send(command);
      const alarmNames = response.MetricAlarms?.map(alarm => alarm.AlarmName || '') || [];
      
      this.logger.debug('Listed Bedrock CloudWatch alarms', {
        alarmCount: alarmNames.length,
        alarmNames
      });

      return alarmNames.filter(name => name.length > 0);

    } catch (error) {
      this.logger.error('Failed to list Bedrock CloudWatch alarms', error as Error);
      throw error;
    }
  }

  /**
   * Updates Bedrock cost threshold alarms
   */
  async updateCostThresholds(newThreshold: number): Promise<void> {
    try {
      // Remove existing alarms
      await this.removeBedrockCostAlarms();
      
      // Update config
      this.config.bedrockConfig.costThreshold = newThreshold;
      
      // Create new alarms with updated thresholds
      await this.createBedrockCostAlarms();
      
      this.logger.info('Bedrock cost threshold alarms updated', {
        newThreshold,
        modelId: this.config.bedrockConfig.modelId
      });

    } catch (error) {
      this.logger.error('Failed to update Bedrock cost threshold alarms', error as Error, {
        newThreshold,
        modelId: this.config.bedrockConfig.modelId
      });
      throw error;
    }
  }
}

/**
 * Creates a Bedrock monitoring service instance
 */
export function createBedrockMonitoringService(config: BedrockMonitoringConfig): BedrockMonitoringService {
  return new BedrockMonitoringService(config);
}