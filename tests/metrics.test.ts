import { MetricsCollector, createMetricsCollector } from '../src/utils/metrics';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

// Mock CloudWatch client
jest.mock('@aws-sdk/client-cloudwatch');
const mockCloudWatchClient = CloudWatchClient as jest.MockedClass<typeof CloudWatchClient>;
const mockSend = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockCloudWatchClient.mockImplementation(() => ({
    send: mockSend
  } as any));
});

describe('MetricsCollector', () => {
  let metricsCollector: MetricsCollector;

  beforeEach(() => {
    metricsCollector = new MetricsCollector('us-east-1', 'TestNamespace');
  });

  describe('recordExecutionDuration', () => {
    it('should record execution duration metric', async () => {
      await metricsCollector.recordExecutionDuration('TestOperation', 1500, true);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Namespace: 'TestNamespace',
            MetricData: expect.arrayContaining([
              expect.objectContaining({
                MetricName: 'ExecutionDuration',
                Value: 1500,
                Unit: 'Milliseconds',
                Dimensions: expect.arrayContaining([
                  { Name: 'Operation', Value: 'TestOperation' },
                  { Name: 'Status', Value: 'Success' }
                ])
              })
            ])
          })
        })
      );
    });

    it('should record failed execution duration', async () => {
      await metricsCollector.recordExecutionDuration('TestOperation', 2000, false);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            MetricData: expect.arrayContaining([
              expect.objectContaining({
                Dimensions: expect.arrayContaining([
                  { Name: 'Status', Value: 'Failure' }
                ])
              })
            ])
          })
        })
      );
    });
  });

  describe('recordExecutionResult', () => {
    it('should record successful execution result', async () => {
      await metricsCollector.recordExecutionResult('TestOperation', true);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            MetricData: expect.arrayContaining([
              expect.objectContaining({
                MetricName: 'ExecutionCount',
                Value: 1,
                Unit: 'Count'
              }),
              expect.objectContaining({
                MetricName: 'SuccessRate',
                Value: 1,
                Unit: 'Count'
              })
            ])
          })
        })
      );
    });

    it('should record failed execution result', async () => {
      await metricsCollector.recordExecutionResult('TestOperation', false);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            MetricData: expect.arrayContaining([
              expect.objectContaining({
                MetricName: 'ExecutionCount',
                Value: 1,
                Unit: 'Count'
              }),
              expect.objectContaining({
                MetricName: 'ErrorRate',
                Value: 1,
                Unit: 'Count'
              })
            ])
          })
        })
      );
    });
  });

  describe('recordCostAnalysis', () => {
    it('should record cost analysis metrics', async () => {
      await metricsCollector.recordCostAnalysis(15.50, 25.00, 3);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            MetricData: expect.arrayContaining([
              expect.objectContaining({
                MetricName: 'CurrentSpend',
                Value: 15.50,
                Unit: 'None'
              }),
              expect.objectContaining({
                MetricName: 'ProjectedMonthlySpend',
                Value: 25.00,
                Unit: 'None'
              }),
              expect.objectContaining({
                MetricName: 'ServiceCount',
                Value: 3,
                Unit: 'Count'
              })
            ])
          })
        })
      );
    });
  });

  describe('recordAlertDelivery', () => {
    it('should record successful alert delivery', async () => {
      const channels = ['email', 'sms', 'ios'];
      await metricsCollector.recordAlertDelivery(channels, true, 0);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            MetricData: expect.arrayContaining([
              expect.objectContaining({
                MetricName: 'AlertDeliveryCount',
                Value: 1,
                Unit: 'Count',
                Dimensions: [{ Name: 'Status', Value: 'Success' }]
              }),
              expect.objectContaining({
                MetricName: 'AlertChannelCount',
                Value: 3,
                Unit: 'Count'
              })
            ])
          })
        })
      );
    });

    it('should record alert delivery with retries', async () => {
      const channels = ['email'];
      await metricsCollector.recordAlertDelivery(channels, true, 2);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            MetricData: expect.arrayContaining([
              expect.objectContaining({
                MetricName: 'AlertRetryCount',
                Value: 2,
                Unit: 'Count'
              })
            ])
          })
        })
      );
    });

    it('should record per-channel metrics', async () => {
      const channels = ['email', 'sms'];
      await metricsCollector.recordAlertDelivery(channels, true, 0);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            MetricData: expect.arrayContaining([
              expect.objectContaining({
                MetricName: 'ChannelDelivery',
                Value: 1,
                Dimensions: [
                  { Name: 'Channel', Value: 'email' },
                  { Name: 'Status', Value: 'Success' }
                ]
              }),
              expect.objectContaining({
                MetricName: 'ChannelDelivery',
                Value: 1,
                Dimensions: [
                  { Name: 'Channel', Value: 'sms' },
                  { Name: 'Status', Value: 'Success' }
                ]
              })
            ])
          })
        })
      );
    });
  });

  describe('recordThresholdBreach', () => {
    it('should record threshold breach metrics', async () => {
      await metricsCollector.recordThresholdBreach(15.00, 10.00, 5.00);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            MetricData: expect.arrayContaining([
              expect.objectContaining({
                MetricName: 'ThresholdBreach',
                Value: 1,
                Unit: 'Count'
              }),
              expect.objectContaining({
                MetricName: 'ThresholdExceedAmount',
                Value: 5.00,
                Unit: 'None'
              }),
              expect.objectContaining({
                MetricName: 'ThresholdExceedPercentage',
                Value: 50,
                Unit: 'Percent'
              })
            ])
          })
        })
      );
    });
  });

  describe('recordIOSNotification', () => {
    it('should record iOS notification metrics', async () => {
      await metricsCollector.recordIOSNotification(5, true, 1);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            MetricData: expect.arrayContaining([
              expect.objectContaining({
                MetricName: 'iOSNotificationCount',
                Value: 1,
                Unit: 'Count',
                Dimensions: [{ Name: 'Status', Value: 'Success' }]
              }),
              expect.objectContaining({
                MetricName: 'iOSDeviceCount',
                Value: 5,
                Unit: 'Count'
              }),
              expect.objectContaining({
                MetricName: 'iOSInvalidTokens',
                Value: 1,
                Unit: 'Count'
              })
            ])
          })
        })
      );
    });
  });

  describe('recordAPICall', () => {
    it('should record API call metrics', async () => {
      await metricsCollector.recordAPICall('CostExplorer', 'GetCostAndUsage', 1200, true);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            MetricData: expect.arrayContaining([
              expect.objectContaining({
                MetricName: 'APICallDuration',
                Value: 1200,
                Unit: 'Milliseconds',
                Dimensions: expect.arrayContaining([
                  { Name: 'Service', Value: 'CostExplorer' },
                  { Name: 'Operation', Value: 'GetCostAndUsage' },
                  { Name: 'Status', Value: 'Success' }
                ])
              }),
              expect.objectContaining({
                MetricName: 'APICallCount',
                Value: 1,
                Unit: 'Count'
              })
            ])
          })
        })
      );
    });
  });

  describe('createTimer', () => {
    it('should create timer and record metrics on stop', async () => {
      const timer = metricsCollector.createTimer('TestOperation');
      
      // Wait a bit to ensure duration > 0
      await new Promise(resolve => setTimeout(resolve, 10));
      
      await timer.stop(true);

      expect(mockSend).toHaveBeenCalledTimes(2); // One for duration, one for result
    });
  });

  describe('error handling', () => {
    it('should handle CloudWatch errors gracefully', async () => {
      mockSend.mockRejectedValueOnce(new Error('CloudWatch error'));
      
      // Should not throw error
      await expect(metricsCollector.recordExecutionDuration('TestOperation', 1000, true))
        .resolves.not.toThrow();
    });
  });
});

describe('createMetricsCollector', () => {
  it('should create metrics collector with default namespace', () => {
    const collector = createMetricsCollector('us-east-1');
    expect(collector).toBeInstanceOf(MetricsCollector);
  });

  it('should create metrics collector with custom namespace', () => {
    const collector = createMetricsCollector('us-east-1', 'CustomNamespace');
    expect(collector).toBeInstanceOf(MetricsCollector);
  });
});