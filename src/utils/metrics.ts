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