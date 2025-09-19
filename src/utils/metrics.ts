import { CloudWatchClient, PutMetricDataCommand, MetricDatum } from '@aws-sdk/client-cloudwatch';
import { createLogger } from './logger';

/**
 * CloudWatch metrics utility for monitoring agent performance
 */
export class MetricsCollector {
  private cloudWatch: CloudWatchClient;
  private namespace: string;
  private logger = createLogger('MetricsCollector');

  constructor(region: string, namespace: string = 'SpendMonitor/Agent') {
    this.cloudWatch = new CloudWatchClient({ region });
    this.namespace = namespace;
  }

  /**
   * Records execution duration metric
   */
  async recordExecutionDuration(operation: string, durationMs: number, success: boolean): Promise<void> {
    const metrics: MetricDatum[] = [
      {
        MetricName: 'ExecutionDuration',
        Value: durationMs,
        Unit: 'Milliseconds',
        Dimensions: [
          { Name: 'Operation', Value: operation },
          { Name: 'Status', Value: success ? 'Success' : 'Failure' }
        ],
        Timestamp: new Date()
      }
    ];

    await this.putMetrics(metrics);
  }

  /**
   * Records success/failure rate metrics
   */
  async recordExecutionResult(operation: string, success: boolean): Promise<void> {
    const metrics: MetricDatum[] = [
      {
        MetricName: 'ExecutionCount',
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          { Name: 'Operation', Value: operation },
          { Name: 'Status', Value: success ? 'Success' : 'Failure' }
        ],
        Timestamp: new Date()
      }
    ];

    if (success) {
      metrics.push({
        MetricName: 'SuccessRate',
        Value: 1,
        Unit: 'Count',
        Dimensions: [{ Name: 'Operation', Value: operation }],
        Timestamp: new Date()
      });
    } else {
      metrics.push({
        MetricName: 'ErrorRate',
        Value: 1,
        Unit: 'Count',
        Dimensions: [{ Name: 'Operation', Value: operation }],
        Timestamp: new Date()
      });
    }

    await this.putMetrics(metrics);
  }

  /**
   * Records cost analysis metrics
   */
  async recordCostAnalysis(totalCost: number, projectedCost: number, serviceCount: number): Promise<void> {
    const metrics: MetricDatum[] = [
      {
        MetricName: 'CurrentSpend',
        Value: totalCost,
        Unit: 'None',
        Timestamp: new Date()
      },
      {
        MetricName: 'ProjectedMonthlySpend',
        Value: projectedCost,
        Unit: 'None',
        Timestamp: new Date()
      },
      {
        MetricName: 'ServiceCount',
        Value: serviceCount,
        Unit: 'Count',
        Timestamp: new Date()
      }
    ];

    await this.putMetrics(metrics);
  }

  /**
   * Records alert delivery metrics
   */
  async recordAlertDelivery(channels: string[], success: boolean, retryCount: number = 0): Promise<void> {
    const metrics: MetricDatum[] = [
      {
        MetricName: 'AlertDeliveryCount',
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          { Name: 'Status', Value: success ? 'Success' : 'Failure' }
        ],
        Timestamp: new Date()
      },
      {
        MetricName: 'AlertChannelCount',
        Value: channels.length,
        Unit: 'Count',
        Timestamp: new Date()
      }
    ];

    if (retryCount > 0) {
      metrics.push({
        MetricName: 'AlertRetryCount',
        Value: retryCount,
        Unit: 'Count',
        Timestamp: new Date()
      });
    }

    // Record metrics per channel
    for (const channel of channels) {
      metrics.push({
        MetricName: 'ChannelDelivery',
        Value: success ? 1 : 0,
        Unit: 'Count',
        Dimensions: [
          { Name: 'Channel', Value: channel },
          { Name: 'Status', Value: success ? 'Success' : 'Failure' }
        ],
        Timestamp: new Date()
      });
    }

    await this.putMetrics(metrics);
  }

  /**
   * Records threshold breach metrics
   */
  async recordThresholdBreach(currentSpend: number, threshold: number, exceedAmount: number): Promise<void> {
    const metrics: MetricDatum[] = [
      {
        MetricName: 'ThresholdBreach',
        Value: 1,
        Unit: 'Count',
        Timestamp: new Date()
      },
      {
        MetricName: 'ThresholdExceedAmount',
        Value: exceedAmount,
        Unit: 'None',
        Timestamp: new Date()
      },
      {
        MetricName: 'ThresholdExceedPercentage',
        Value: (exceedAmount / threshold) * 100,
        Unit: 'Percent',
        Timestamp: new Date()
      }
    ];

    await this.putMetrics(metrics);
  }

  /**
   * Records iOS notification metrics
   */
  async recordIOSNotification(deviceCount: number, success: boolean, invalidTokens: number = 0): Promise<void> {
    const metrics: MetricDatum[] = [
      {
        MetricName: 'iOSNotificationCount',
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          { Name: 'Status', Value: success ? 'Success' : 'Failure' }
        ],
        Timestamp: new Date()
      },
      {
        MetricName: 'iOSDeviceCount',
        Value: deviceCount,
        Unit: 'Count',
        Timestamp: new Date()
      }
    ];

    if (invalidTokens > 0) {
      metrics.push({
        MetricName: 'iOSInvalidTokens',
        Value: invalidTokens,
        Unit: 'Count',
        Timestamp: new Date()
      });
    }

    await this.putMetrics(metrics);
  }

  /**
   * Records iOS device registration metrics
   */
  async recordIOSDeviceRegistration(success: boolean, errorType?: string): Promise<void> {
    const metrics: MetricDatum[] = [
      {
        MetricName: 'iOSDeviceRegistrationCount',
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          { Name: 'Status', Value: success ? 'Success' : 'Failure' }
        ],
        Timestamp: new Date()
      }
    ];

    if (!success && errorType) {
      metrics.push({
        MetricName: 'iOSRegistrationErrorType',
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          { Name: 'ErrorType', Value: errorType }
        ],
        Timestamp: new Date()
      });
    }

    await this.putMetrics(metrics);
  }

  /**
   * Records APNS certificate health metrics
   */
  async recordAPNSCertificateHealth(
    isValid: boolean, 
    daysUntilExpiration?: number, 
    warningCount: number = 0, 
    errorCount: number = 0
  ): Promise<void> {
    const metrics: MetricDatum[] = [
      {
        MetricName: 'APNSCertificateValid',
        Value: isValid ? 1 : 0,
        Unit: 'Count',
        Timestamp: new Date()
      },
      {
        MetricName: 'APNSCertificateWarnings',
        Value: warningCount,
        Unit: 'Count',
        Timestamp: new Date()
      },
      {
        MetricName: 'APNSCertificateErrors',
        Value: errorCount,
        Unit: 'Count',
        Timestamp: new Date()
      }
    ];

    if (daysUntilExpiration !== undefined) {
      metrics.push({
        MetricName: 'APNSCertificateDaysUntilExpiration',
        Value: daysUntilExpiration,
        Unit: 'Count',
        Timestamp: new Date()
      });
    }

    await this.putMetrics(metrics);
  }

  /**
   * Records iOS notification payload metrics
   */
  async recordIOSPayloadMetrics(payloadSize: number, deliveryTime: number, retryCount: number): Promise<void> {
    const metrics: MetricDatum[] = [
      {
        MetricName: 'iOSPayloadSize',
        Value: payloadSize,
        Unit: 'Bytes',
        Timestamp: new Date()
      },
      {
        MetricName: 'iOSNotificationDeliveryTime',
        Value: deliveryTime,
        Unit: 'Milliseconds',
        Timestamp: new Date()
      }
    ];

    if (retryCount > 0) {
      metrics.push({
        MetricName: 'iOSNotificationRetryCount',
        Value: retryCount,
        Unit: 'Count',
        Timestamp: new Date()
      });
    }

    await this.putMetrics(metrics);
  }

  /**
   * Records iOS fallback usage metrics
   */
  async recordIOSFallbackUsage(fallbackChannels: string[], success: boolean): Promise<void> {
    const metrics: MetricDatum[] = [
      {
        MetricName: 'iOSFallbackUsed',
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          { Name: 'Status', Value: success ? 'Success' : 'Failure' }
        ],
        Timestamp: new Date()
      },
      {
        MetricName: 'iOSFallbackChannelCount',
        Value: fallbackChannels.length,
        Unit: 'Count',
        Timestamp: new Date()
      }
    ];

    // Record metrics per fallback channel
    for (const channel of fallbackChannels) {
      metrics.push({
        MetricName: 'iOSFallbackChannelUsage',
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          { Name: 'Channel', Value: channel },
          { Name: 'Status', Value: success ? 'Success' : 'Failure' }
        ],
        Timestamp: new Date()
      });
    }

    await this.putMetrics(metrics);
  }

  /**
   * Records API call metrics
   */
  async recordAPICall(service: string, operation: string, durationMs: number, success: boolean): Promise<void> {
    const metrics: MetricDatum[] = [
      {
        MetricName: 'APICallDuration',
        Value: durationMs,
        Unit: 'Milliseconds',
        Dimensions: [
          { Name: 'Service', Value: service },
          { Name: 'Operation', Value: operation },
          { Name: 'Status', Value: success ? 'Success' : 'Failure' }
        ],
        Timestamp: new Date()
      },
      {
        MetricName: 'APICallCount',
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          { Name: 'Service', Value: service },
          { Name: 'Operation', Value: operation },
          { Name: 'Status', Value: success ? 'Success' : 'Failure' }
        ],
        Timestamp: new Date()
      }
    ];

    await this.putMetrics(metrics);
  }

  /**
   * Records Bedrock AI analysis metrics
   */
  async recordBedrockAnalysis(
    modelId: string,
    analysisType: string,
    durationMs: number,
    success: boolean,
    tokenCount?: number,
    cost?: number,
    confidenceScore?: number
  ): Promise<void> {
    const metrics: MetricDatum[] = [
      {
        MetricName: 'BedrockAnalysisCount',
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          { Name: 'ModelId', Value: modelId },
          { Name: 'AnalysisType', Value: analysisType },
          { Name: 'Status', Value: success ? 'Success' : 'Failure' }
        ],
        Timestamp: new Date()
      },
      {
        MetricName: 'BedrockAnalysisDuration',
        Value: durationMs,
        Unit: 'Milliseconds',
        Dimensions: [
          { Name: 'ModelId', Value: modelId },
          { Name: 'AnalysisType', Value: analysisType }
        ],
        Timestamp: new Date()
      }
    ];

    if (tokenCount !== undefined) {
      metrics.push({
        MetricName: 'BedrockTokenCount',
        Value: tokenCount,
        Unit: 'Count',
        Dimensions: [
          { Name: 'ModelId', Value: modelId },
          { Name: 'AnalysisType', Value: analysisType }
        ],
        Timestamp: new Date()
      });
    }

    if (cost !== undefined) {
      metrics.push({
        MetricName: 'BedrockAnalysisCost',
        Value: cost,
        Unit: 'None',
        Dimensions: [
          { Name: 'ModelId', Value: modelId },
          { Name: 'AnalysisType', Value: analysisType }
        ],
        Timestamp: new Date()
      });
    }

    if (confidenceScore !== undefined) {
      metrics.push({
        MetricName: 'BedrockConfidenceScore',
        Value: confidenceScore,
        Unit: 'None',
        Dimensions: [
          { Name: 'ModelId', Value: modelId },
          { Name: 'AnalysisType', Value: analysisType }
        ],
        Timestamp: new Date()
      });
    }

    await this.putMetrics(metrics);
  }

  /**
   * Records Bedrock cost tracking metrics
   */
  async recordBedrockCostTracking(
    monthlySpend: number,
    costThreshold: number,
    callCount: number,
    rateLimitHits: number = 0
  ): Promise<void> {
    const metrics: MetricDatum[] = [
      {
        MetricName: 'BedrockMonthlySpend',
        Value: monthlySpend,
        Unit: 'None',
        Timestamp: new Date()
      },
      {
        MetricName: 'BedrockCostThreshold',
        Value: costThreshold,
        Unit: 'None',
        Timestamp: new Date()
      },
      {
        MetricName: 'BedrockCallCount',
        Value: callCount,
        Unit: 'Count',
        Timestamp: new Date()
      },
      {
        MetricName: 'BedrockCostUtilization',
        Value: (monthlySpend / costThreshold) * 100,
        Unit: 'Percent',
        Timestamp: new Date()
      }
    ];

    if (rateLimitHits > 0) {
      metrics.push({
        MetricName: 'BedrockRateLimitHits',
        Value: rateLimitHits,
        Unit: 'Count',
        Timestamp: new Date()
      });
    }

    await this.putMetrics(metrics);
  }

  /**
   * Records Bedrock cache performance metrics
   */
  async recordBedrockCacheMetrics(
    cacheHits: number,
    cacheMisses: number,
    cacheSize: number,
    costSavings?: number
  ): Promise<void> {
    const totalRequests = cacheHits + cacheMisses;
    const hitRate = totalRequests > 0 ? (cacheHits / totalRequests) * 100 : 0;

    const metrics: MetricDatum[] = [
      {
        MetricName: 'BedrockCacheHits',
        Value: cacheHits,
        Unit: 'Count',
        Timestamp: new Date()
      },
      {
        MetricName: 'BedrockCacheMisses',
        Value: cacheMisses,
        Unit: 'Count',
        Timestamp: new Date()
      },
      {
        MetricName: 'BedrockCacheHitRate',
        Value: hitRate,
        Unit: 'Percent',
        Timestamp: new Date()
      },
      {
        MetricName: 'BedrockCacheSize',
        Value: cacheSize,
        Unit: 'Count',
        Timestamp: new Date()
      }
    ];

    if (costSavings !== undefined) {
      metrics.push({
        MetricName: 'BedrockCacheCostSavings',
        Value: costSavings,
        Unit: 'None',
        Timestamp: new Date()
      });
    }

    await this.putMetrics(metrics);
  }

  /**
   * Records Bedrock health check metrics
   */
  async recordBedrockHealthCheck(
    modelId: string,
    isHealthy: boolean,
    responseTime?: number,
    errorType?: string
  ): Promise<void> {
    const metrics: MetricDatum[] = [
      {
        MetricName: 'BedrockHealthCheck',
        Value: isHealthy ? 1 : 0,
        Unit: 'Count',
        Dimensions: [
          { Name: 'ModelId', Value: modelId },
          { Name: 'Status', Value: isHealthy ? 'Healthy' : 'Unhealthy' }
        ],
        Timestamp: new Date()
      }
    ];

    if (responseTime !== undefined) {
      metrics.push({
        MetricName: 'BedrockHealthCheckResponseTime',
        Value: responseTime,
        Unit: 'Milliseconds',
        Dimensions: [
          { Name: 'ModelId', Value: modelId }
        ],
        Timestamp: new Date()
      });
    }

    if (!isHealthy && errorType) {
      metrics.push({
        MetricName: 'BedrockHealthCheckError',
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          { Name: 'ModelId', Value: modelId },
          { Name: 'ErrorType', Value: errorType }
        ],
        Timestamp: new Date()
      });
    }

    await this.putMetrics(metrics);
  }

  /**
   * Records Bedrock anomaly detection metrics
   */
  async recordBedrockAnomalyDetection(
    anomaliesDetected: number,
    highSeverityCount: number,
    mediumSeverityCount: number,
    lowSeverityCount: number,
    averageConfidence: number
  ): Promise<void> {
    const metrics: MetricDatum[] = [
      {
        MetricName: 'BedrockAnomaliesDetected',
        Value: anomaliesDetected,
        Unit: 'Count',
        Timestamp: new Date()
      },
      {
        MetricName: 'BedrockHighSeverityAnomalies',
        Value: highSeverityCount,
        Unit: 'Count',
        Timestamp: new Date()
      },
      {
        MetricName: 'BedrockMediumSeverityAnomalies',
        Value: mediumSeverityCount,
        Unit: 'Count',
        Timestamp: new Date()
      },
      {
        MetricName: 'BedrockLowSeverityAnomalies',
        Value: lowSeverityCount,
        Unit: 'Count',
        Timestamp: new Date()
      },
      {
        MetricName: 'BedrockAnomalyConfidence',
        Value: averageConfidence,
        Unit: 'None',
        Timestamp: new Date()
      }
    ];

    await this.putMetrics(metrics);
  }

  /**
   * Records Bedrock optimization recommendations metrics
   */
  async recordBedrockOptimizationRecommendations(
    recommendationCount: number,
    highPriorityCount: number,
    estimatedSavings: number,
    categoryCounts: { [category: string]: number }
  ): Promise<void> {
    const metrics: MetricDatum[] = [
      {
        MetricName: 'BedrockRecommendationCount',
        Value: recommendationCount,
        Unit: 'Count',
        Timestamp: new Date()
      },
      {
        MetricName: 'BedrockHighPriorityRecommendations',
        Value: highPriorityCount,
        Unit: 'Count',
        Timestamp: new Date()
      },
      {
        MetricName: 'BedrockEstimatedSavings',
        Value: estimatedSavings,
        Unit: 'None',
        Timestamp: new Date()
      }
    ];

    // Record metrics per recommendation category
    for (const [category, count] of Object.entries(categoryCounts)) {
      metrics.push({
        MetricName: 'BedrockRecommendationsByCategory',
        Value: count,
        Unit: 'Count',
        Dimensions: [
          { Name: 'Category', Value: category }
        ],
        Timestamp: new Date()
      });
    }

    await this.putMetrics(metrics);
  }

  /**
   * Sends metrics to CloudWatch
   */
  private async putMetrics(metrics: MetricDatum[]): Promise<void> {
    try {
      const command = new PutMetricDataCommand({
        Namespace: this.namespace,
        MetricData: metrics
      });

      await this.cloudWatch.send(command);
      
      this.logger.debug('Metrics sent to CloudWatch', {
        namespace: this.namespace,
        metricCount: metrics.length,
        metrics: metrics.map(m => ({ name: m.MetricName, value: m.Value, unit: m.Unit }))
      });

    } catch (error) {
      this.logger.error('Failed to send metrics to CloudWatch', error as Error, {
        namespace: this.namespace,
        metricCount: metrics.length
      });
      // Don't throw error to avoid breaking main execution
    }
  }

  /**
   * Creates a timer for measuring operation duration
   */
  createTimer(operation: string): {
    stop: (success: boolean) => Promise<void>;
  } {
    const startTime = Date.now();
    
    return {
      stop: async (success: boolean) => {
        const duration = Date.now() - startTime;
        await this.recordExecutionDuration(operation, duration, success);
        await this.recordExecutionResult(operation, success);
      }
    };
  }
}

/**
 * Creates a metrics collector instance
 */
export function createMetricsCollector(region: string, namespace?: string): MetricsCollector {
  return new MetricsCollector(region, namespace);
}