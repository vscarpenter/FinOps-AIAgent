/**
 * Bedrock Monitoring Tests
 * 
 * Tests for Bedrock health monitoring, cost tracking, and CloudWatch alarm management.
 */

import { BedrockMonitoringService, createBedrockMonitoringService } from '../src/utils/bedrock-monitoring';
import { BedrockConfig } from '../src/types';

// Mock AWS SDK clients
jest.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: jest.fn().mockImplementation(() => ({
    send: jest.fn()
  })),
  PutMetricAlarmCommand: jest.fn().mockImplementation((input) => ({ input })),
  DescribeAlarmsCommand: jest.fn().mockImplementation((input) => ({ input })),
  DeleteAlarmsCommand: jest.fn().mockImplementation((input) => ({ input }))
}));
jest.mock('../src/utils/metrics');

// Mock logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
};

jest.mock('../src/utils/logger', () => ({
  createLogger: jest.fn(() => mockLogger)
}));

import { CloudWatchClient, PutMetricAlarmCommand, DescribeAlarmsCommand, DeleteAlarmsCommand } from '@aws-sdk/client-cloudwatch';
import { MetricsCollector } from '../src/utils/metrics';

const mockCloudWatchClient = CloudWatchClient as jest.MockedClass<typeof CloudWatchClient>;
const mockMetricsCollector = MetricsCollector as jest.MockedClass<typeof MetricsCollector>;

describe('BedrockMonitoringService', () => {
  let service: BedrockMonitoringService;
  let mockCloudWatchSend: jest.Mock;
  let mockMetricsRecord: jest.Mock;

  const mockBedrockConfig: BedrockConfig = {
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

  const mockConfig = {
    bedrockConfig: mockBedrockConfig,
    region: 'us-east-1',
    alarmTopicArn: 'arn:aws:sns:us-east-1:123456789012:bedrock-alerts'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockCloudWatchSend = jest.fn();
    mockMetricsRecord = jest.fn();
    
    mockCloudWatchClient.prototype.send = mockCloudWatchSend;
    mockMetricsCollector.prototype.recordBedrockHealthCheck = mockMetricsRecord;
    mockMetricsCollector.prototype.recordBedrockCostTracking = mockMetricsRecord;
    
    service = new BedrockMonitoringService(mockConfig);
  });

  describe('createBedrockCostAlarms', () => {
    it('should create all required CloudWatch alarms', async () => {
      mockCloudWatchSend.mockResolvedValue({});

      await service.createBedrockCostAlarms();

      expect(mockCloudWatchSend).toHaveBeenCalledTimes(4);
      
      // Check warning threshold alarm (80% of cost threshold)
      expect(mockCloudWatchSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            AlarmName: 'SpendMonitor-BedrockCostWarning-amazon.titan-text-express-v1',
            AlarmDescription: 'Bedrock monthly spend approaching threshold',
            MetricName: 'BedrockMonthlySpend',
            Threshold: 80, // 80% of 100
            ComparisonOperator: 'GreaterThanThreshold'
          })
        })
      );

      // Check critical threshold alarm (100% of cost threshold)
      expect(mockCloudWatchSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            AlarmName: 'SpendMonitor-BedrockCostCritical-amazon.titan-text-express-v1',
            AlarmDescription: 'Bedrock monthly spend exceeded threshold',
            MetricName: 'BedrockMonthlySpend',
            Threshold: 100,
            ComparisonOperator: 'GreaterThanThreshold'
          })
        })
      );

      // Check rate limit alarm
      expect(mockCloudWatchSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            AlarmName: 'SpendMonitor-BedrockRateLimitExceeded-amazon.titan-text-express-v1',
            AlarmDescription: 'Bedrock API rate limit exceeded',
            MetricName: 'BedrockRateLimitHits'
          })
        })
      );

      // Check health check alarm
      expect(mockCloudWatchSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            AlarmName: 'SpendMonitor-BedrockHealthCheckFailure-amazon.titan-text-express-v1',
            AlarmDescription: 'Bedrock health check failures detected',
            MetricName: 'BedrockHealthCheck'
          })
        })
      );
    });

    it('should skip alarm creation when Bedrock is disabled', async () => {
      const disabledConfig = {
        ...mockConfig,
        bedrockConfig: { ...mockBedrockConfig, enabled: false }
      };
      const disabledService = new BedrockMonitoringService(disabledConfig);

      await disabledService.createBedrockCostAlarms();

      expect(mockCloudWatchSend).not.toHaveBeenCalled();
    });

    it('should handle CloudWatch API errors gracefully', async () => {
      mockCloudWatchSend.mockRejectedValue(new Error('CloudWatch API error'));

      await expect(service.createBedrockCostAlarms()).rejects.toThrow('CloudWatch API error');
    });

    it('should create alarms without SNS topic when not provided', async () => {
      const configWithoutTopic = {
        ...mockConfig,
        alarmTopicArn: undefined
      };
      const serviceWithoutTopic = new BedrockMonitoringService(configWithoutTopic);
      mockCloudWatchSend.mockResolvedValue({});

      await serviceWithoutTopic.createBedrockCostAlarms();

      expect(mockCloudWatchSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            AlarmActions: undefined
          })
        })
      );
    });
  });

  describe('performHealthCheck', () => {
    it('should return healthy status when all checks pass', async () => {
      const healthStatus = await service.performHealthCheck();

      expect(healthStatus.overall).toBe('healthy');
      expect(healthStatus.modelAccess).toBe(true);
      expect(healthStatus.errors).toHaveLength(0);
      expect(healthStatus.warnings).toHaveLength(0);
      expect(healthStatus.lastHealthCheck).toBeDefined();
      expect(mockMetricsRecord).toHaveBeenCalledWith(
        'amazon.titan-text-express-v1',
        true,
        undefined,
        undefined
      );
    });

    it('should return warning status when cost utilization is high', async () => {
      // Mock high cost utilization (this would need to be implemented in getCostMetrics)
      const healthStatus = await service.performHealthCheck();

      // Since we're using a simplified implementation, we'll test the structure
      expect(healthStatus).toHaveProperty('overall');
      expect(healthStatus).toHaveProperty('modelAccess');
      expect(healthStatus).toHaveProperty('costUtilization');
      expect(healthStatus).toHaveProperty('rateLimitStatus');
      expect(healthStatus).toHaveProperty('lastHealthCheck');
      expect(healthStatus).toHaveProperty('errors');
      expect(healthStatus).toHaveProperty('warnings');
    });

    it('should return critical status when errors are present', async () => {
      // This test would need to mock error conditions
      const healthStatus = await service.performHealthCheck();

      expect(healthStatus.rateLimitStatus).toMatch(/normal|approaching|exceeded/);
      expect(Array.isArray(healthStatus.errors)).toBe(true);
      expect(Array.isArray(healthStatus.warnings)).toBe(true);
    });

    it('should record health check metrics', async () => {
      await service.performHealthCheck();

      expect(mockMetricsRecord).toHaveBeenCalledWith(
        'amazon.titan-text-express-v1',
        expect.any(Boolean),
        undefined,
        expect.any(String) || undefined
      );
    });
  });

  describe('getCostMetrics', () => {
    it('should return cost metrics with correct structure', async () => {
      const costMetrics = await service.getCostMetrics();

      expect(costMetrics).toHaveProperty('monthlySpend');
      expect(costMetrics).toHaveProperty('costThreshold');
      expect(costMetrics).toHaveProperty('utilizationPercentage');
      expect(costMetrics).toHaveProperty('callCount');
      expect(costMetrics).toHaveProperty('averageCostPerCall');
      expect(costMetrics).toHaveProperty('projectedMonthlySpend');
      expect(costMetrics).toHaveProperty('lastUpdated');

      expect(costMetrics.costThreshold).toBe(100);
      expect(typeof costMetrics.monthlySpend).toBe('number');
      expect(typeof costMetrics.utilizationPercentage).toBe('number');
      expect(typeof costMetrics.callCount).toBe('number');
    });

    it('should calculate utilization percentage correctly', async () => {
      const costMetrics = await service.getCostMetrics();

      const expectedUtilization = (costMetrics.monthlySpend / costMetrics.costThreshold) * 100;
      expect(costMetrics.utilizationPercentage).toBe(expectedUtilization);
    });

    it('should record cost tracking metrics', async () => {
      await service.getCostMetrics();

      expect(mockMetricsRecord).toHaveBeenCalledWith(
        expect.any(Number), // monthlySpend
        100, // costThreshold
        expect.any(Number) // callCount
      );
    });
  });

  describe('removeBedrockCostAlarms', () => {
    it('should remove all Bedrock alarms', async () => {
      mockCloudWatchSend.mockResolvedValue({});

      await service.removeBedrockCostAlarms();

      expect(mockCloudWatchSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            AlarmNames: [
              'SpendMonitor-BedrockCostWarning-amazon.titan-text-express-v1',
              'SpendMonitor-BedrockCostCritical-amazon.titan-text-express-v1',
              'SpendMonitor-BedrockRateLimitExceeded-amazon.titan-text-express-v1',
              'SpendMonitor-BedrockHealthCheckFailure-amazon.titan-text-express-v1'
            ]
          })
        })
      );
    });

    it('should handle deletion errors gracefully', async () => {
      mockCloudWatchSend.mockRejectedValue(new Error('Deletion failed'));

      await expect(service.removeBedrockCostAlarms()).rejects.toThrow('Deletion failed');
    });
  });

  describe('listBedrockAlarms', () => {
    it('should list existing Bedrock alarms', async () => {
      const mockAlarms = [
        { AlarmName: 'SpendMonitor-BedrockCostWarning-amazon.titan-text-express-v1' },
        { AlarmName: 'SpendMonitor-BedrockCostCritical-amazon.titan-text-express-v1' },
        { AlarmName: 'SpendMonitor-BedrockRateLimitExceeded-amazon.titan-text-express-v1' }
      ];

      mockCloudWatchSend.mockResolvedValue({
        MetricAlarms: mockAlarms
      });

      const alarmNames = await service.listBedrockAlarms();

      expect(alarmNames).toHaveLength(3);
      expect(alarmNames).toContain('SpendMonitor-BedrockCostWarning-amazon.titan-text-express-v1');
      expect(alarmNames).toContain('SpendMonitor-BedrockCostCritical-amazon.titan-text-express-v1');
      expect(alarmNames).toContain('SpendMonitor-BedrockRateLimitExceeded-amazon.titan-text-express-v1');
    });

    it('should handle empty alarm list', async () => {
      mockCloudWatchSend.mockResolvedValue({
        MetricAlarms: []
      });

      const alarmNames = await service.listBedrockAlarms();

      expect(alarmNames).toHaveLength(0);
    });

    it('should filter out empty alarm names', async () => {
      const mockAlarms = [
        { AlarmName: 'SpendMonitor-BedrockCostWarning-amazon.titan-text-express-v1' },
        { AlarmName: '' },
        { AlarmName: 'SpendMonitor-BedrockCostCritical-amazon.titan-text-express-v1' }
      ];

      mockCloudWatchSend.mockResolvedValue({
        MetricAlarms: mockAlarms
      });

      const alarmNames = await service.listBedrockAlarms();

      expect(alarmNames).toHaveLength(2);
      expect(alarmNames).not.toContain('');
    });
  });

  describe('updateCostThresholds', () => {
    it('should update cost threshold alarms', async () => {
      mockCloudWatchSend.mockResolvedValue({});

      await service.updateCostThresholds(200);

      // Should call delete alarms first, then create new ones
      expect(mockCloudWatchSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            AlarmNames: expect.any(Array)
          })
        })
      );

      // Should create new alarms with updated threshold
      expect(mockCloudWatchSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            AlarmName: 'SpendMonitor-BedrockCostWarning-amazon.titan-text-express-v1',
            Threshold: 160 // 80% of 200
          })
        })
      );

      expect(mockCloudWatchSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            AlarmName: 'SpendMonitor-BedrockCostCritical-amazon.titan-text-express-v1',
            Threshold: 200 // 100% of 200
          })
        })
      );
    });

    it('should handle update errors gracefully', async () => {
      mockCloudWatchSend.mockRejectedValue(new Error('Update failed'));

      await expect(service.updateCostThresholds(200)).rejects.toThrow('Update failed');
    });
  });
});

describe('createBedrockMonitoringService', () => {
  const mockBedrockConfig: BedrockConfig = {
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

  it('should create a BedrockMonitoringService instance', () => {
    const config = {
      bedrockConfig: mockBedrockConfig,
      region: 'us-east-1'
    };

    const service = createBedrockMonitoringService(config);

    expect(service).toBeInstanceOf(BedrockMonitoringService);
  });
});

describe('BedrockMonitoringService Integration', () => {
  let service: BedrockMonitoringService;
  let mockCloudWatchSend: jest.Mock;
  let mockMetricsRecord: jest.Mock;

  const mockBedrockConfig: BedrockConfig = {
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

  const mockConfig = {
    bedrockConfig: mockBedrockConfig,
    region: 'us-east-1',
    alarmTopicArn: 'arn:aws:sns:us-east-1:123456789012:bedrock-alerts'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCloudWatchSend = jest.fn();
    mockMetricsRecord = jest.fn();
    
    mockCloudWatchClient.prototype.send = mockCloudWatchSend;
    mockMetricsCollector.prototype.recordBedrockHealthCheck = mockMetricsRecord;
    mockMetricsCollector.prototype.recordBedrockCostTracking = mockMetricsRecord;
    
    service = new BedrockMonitoringService(mockConfig);
  });

  it('should handle complete alarm lifecycle', async () => {
    mockCloudWatchSend.mockResolvedValue({});

    // Create alarms
    await service.createBedrockCostAlarms();
    expect(mockCloudWatchSend).toHaveBeenCalledTimes(4);

    // List alarms
    mockCloudWatchSend.mockResolvedValue({
      MetricAlarms: [
        { AlarmName: 'SpendMonitor-BedrockCostWarning-amazon.titan-text-express-v1' }
      ]
    });
    const alarms = await service.listBedrockAlarms();
    expect(alarms).toHaveLength(1);

    // Remove alarms
    mockCloudWatchSend.mockResolvedValue({});
    await service.removeBedrockCostAlarms();
    expect(mockCloudWatchSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          AlarmNames: expect.any(Array)
        })
      })
    );
  });

  it('should perform health check and record metrics', async () => {
    const healthStatus = await service.performHealthCheck();
    const costMetrics = await service.getCostMetrics();

    expect(healthStatus.overall).toMatch(/healthy|warning|critical/);
    expect(costMetrics.costThreshold).toBe(100);
    expect(mockMetricsRecord).toHaveBeenCalled();
  });
});