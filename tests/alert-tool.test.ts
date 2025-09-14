import { AlertTool } from '../src/tools/alert-tool';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { CostAnalysis, AlertContext, ServiceCost } from '../src/types';

// Mock the AWS SDK
jest.mock('@aws-sdk/client-sns');

const mockSNSClient = {
  send: jest.fn()
};

(SNSClient as jest.Mock).mockImplementation(() => mockSNSClient);

describe('AlertTool', () => {
  let tool: AlertTool;
  let mockCostAnalysis: CostAnalysis;
  let mockAlertContext: AlertContext;
  let mockTopServices: ServiceCost[];

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new AlertTool('us-east-1', { maxAttempts: 1 }); // Disable retries for tests
    
    // Mock the logger
    tool.logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    // Setup test data
    mockCostAnalysis = {
      totalCost: 15.50,
      serviceBreakdown: {
        'EC2': 10.00,
        'S3': 3.50,
        'Lambda': 2.00
      },
      period: {
        start: '2023-01-01T00:00:00.000Z',
        end: '2023-01-15T23:59:59.999Z'
      },
      projectedMonthly: 31.00,
      currency: 'USD',
      lastUpdated: '2023-01-15T12:00:00.000Z'
    };

    mockTopServices = [
      { serviceName: 'EC2', cost: 10.00, percentage: 64.5 },
      { serviceName: 'S3', cost: 3.50, percentage: 22.6 },
      { serviceName: 'Lambda', cost: 2.00, percentage: 12.9 }
    ];

    mockAlertContext = {
      threshold: 10.00,
      exceedAmount: 5.50,
      percentageOver: 55.0,
      topServices: mockTopServices,
      alertLevel: 'CRITICAL'
    };
  });

  describe('sendSpendAlert', () => {
    it('should send alert successfully without iOS config', async () => {
      mockSNSClient.send.mockResolvedValue({ MessageId: 'test-message-id' });

      await tool.sendSpendAlert(
        mockCostAnalysis,
        mockAlertContext,
        'arn:aws:sns:us-east-1:123456789012:spend-alerts'
      );

      expect(mockSNSClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-alerts',
            Subject: 'AWS Spend Alert: $5.50 over budget',
            Message: expect.stringContaining('AWS Spend Alert - CRITICAL'),
            MessageStructure: undefined
          })
        })
      );

      expect(tool.logger.info).toHaveBeenCalledWith(
        'Spend alert sent successfully',
        expect.objectContaining({
          totalCost: 15.50,
          threshold: 10.00,
          exceedAmount: 5.50,
          alertLevel: 'CRITICAL',
          hasIOSPayload: false
        })
      );
    });

    it('should send alert with iOS payload when iOS config provided', async () => {
      mockSNSClient.send.mockResolvedValue({ MessageId: 'test-message-id' });

      const iosConfig = {
        platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/MyApp',
        bundleId: 'com.example.spendmonitor'
      };

      await tool.sendSpendAlert(
        mockCostAnalysis,
        mockAlertContext,
        'arn:aws:sns:us-east-1:123456789012:spend-alerts',
        iosConfig
      );

      expect(mockSNSClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            MessageStructure: 'json',
            Message: expect.stringContaining('APNS')
          })
        })
      );

      expect(tool.logger.info).toHaveBeenCalledWith(
        'Spend alert sent successfully',
        expect.objectContaining({
          hasIOSPayload: true
        })
      );
    });

    it('should handle SNS delivery failures', async () => {
      const snsError = new Error('Topic not found');
      snsError.name = 'NotFound';
      mockSNSClient.send.mockRejectedValue(snsError);

      await expect(tool.sendSpendAlert(
        mockCostAnalysis,
        mockAlertContext,
        'arn:aws:sns:us-east-1:123456789012:invalid-topic'
      )).rejects.toThrow('Alert delivery failed: Topic not found');

      expect(tool.logger.error).toHaveBeenCalledWith(
        'Failed to send spend alert',
        expect.objectContaining({
          error: snsError,
          totalCost: 15.50,
          threshold: 10.00
        })
      );
    });

    it('should retry on retryable errors', async () => {
      const throttleError = new Error('Rate exceeded');
      throttleError.name = 'ThrottlingException';
      
      // Create a new tool with retries enabled for this test
      const retryTool = new AlertTool('us-east-1', { maxAttempts: 2, baseDelay: 10 });
      retryTool.logger = tool.logger;

      mockSNSClient.send
        .mockRejectedValueOnce(throttleError)
        .mockResolvedValueOnce({ MessageId: 'test-message-id' });

      await retryTool.sendSpendAlert(
        mockCostAnalysis,
        mockAlertContext,
        'arn:aws:sns:us-east-1:123456789012:spend-alerts'
      );

      expect(mockSNSClient.send).toHaveBeenCalledTimes(2);
      expect(retryTool.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('SNS operation failed, retrying'),
        expect.objectContaining({
          attempt: 1,
          maxAttempts: 2
        })
      );
    });
  });

  describe('formatAlertMessage', () => {
    it('should format comprehensive alert message', () => {
      const message = tool.formatAlertMessage(mockCostAnalysis, mockAlertContext);

      expect(message).toContain('AWS Spend Alert - CRITICAL');
      expect(message).toContain('Current Spending: $15.50');
      expect(message).toContain('Threshold: $10.00');
      expect(message).toContain('Over Budget: $5.50 (55.0%)');
      expect(message).toContain('Projected Monthly: $31.00');
      expect(message).toContain('Top Cost-Driving Services:');
      expect(message).toContain('1. EC2: $10.00 (64.5%)');
      expect(message).toContain('2. S3: $3.50 (22.6%)');
      expect(message).toContain('3. Lambda: $2.00 (12.9%)');
      expect(message).toContain('Recommendations:');
    });

    it('should handle empty top services list', () => {
      const contextWithoutServices = {
        ...mockAlertContext,
        topServices: []
      };

      const message = tool.formatAlertMessage(mockCostAnalysis, contextWithoutServices);

      expect(message).toContain('AWS Spend Alert - CRITICAL');
      expect(message).not.toContain('Top Cost-Driving Services:');
      expect(message).toContain('Recommendations:');
    });
  });

  describe('formatSMSMessage', () => {
    it('should format concise SMS message', () => {
      const smsMessage = tool.formatSMSMessage(mockCostAnalysis, mockAlertContext);

      expect(smsMessage).toBe(
        'AWS Spend Alert: $15.50 spent (over $10 threshold by $5.50). Top service: EC2 ($10.00) Projected monthly: $31.00'
      );
    });

    it('should handle empty top services for SMS', () => {
      const contextWithoutServices = {
        ...mockAlertContext,
        topServices: []
      };

      const smsMessage = tool.formatSMSMessage(mockCostAnalysis, contextWithoutServices);

      expect(smsMessage).toBe(
        'AWS Spend Alert: $15.50 spent (over $10 threshold by $5.50). Projected monthly: $31.00'
      );
    });
  });

  describe('formatIOSPayload', () => {
    it('should format iOS push notification payload correctly', () => {
      const iosPayload = tool.formatIOSPayload(mockCostAnalysis, mockAlertContext);

      expect(iosPayload.aps.alert.title).toBe('AWS Spend Alert');
      expect(iosPayload.aps.alert.body).toBe('$15.50 spent - $5.50 over budget');
      expect(iosPayload.aps.alert.subtitle).toBe('Critical Budget Exceeded');
      expect(iosPayload.aps.badge).toBe(1);
      expect(iosPayload.aps.sound).toBe('critical-alert.caf');
      expect(iosPayload.aps['content-available']).toBe(1);

      expect(iosPayload.customData.spendAmount).toBe(15.50);
      expect(iosPayload.customData.threshold).toBe(10.00);
      expect(iosPayload.customData.exceedAmount).toBe(5.50);
      expect(iosPayload.customData.topService).toBe('EC2');
      expect(iosPayload.customData.alertId).toMatch(/^spend-alert-\d+$/);
    });

    it('should use warning sound for WARNING level alerts', () => {
      const warningContext = {
        ...mockAlertContext,
        alertLevel: 'WARNING' as const
      };

      const iosPayload = tool.formatIOSPayload(mockCostAnalysis, warningContext);

      expect(iosPayload.aps.alert.subtitle).toBe('Budget Threshold Exceeded');
      expect(iosPayload.aps.sound).toBe('default');
    });

    it('should handle missing top service', () => {
      const contextWithoutServices = {
        ...mockAlertContext,
        topServices: []
      };

      const iosPayload = tool.formatIOSPayload(mockCostAnalysis, contextWithoutServices);

      expect(iosPayload.customData.topService).toBe('Unknown');
    });
  });

  describe('createAlertContext', () => {
    it('should create alert context with WARNING level for moderate overage', () => {
      const context = tool.createAlertContext(mockCostAnalysis, 12.00, mockTopServices);

      expect(context.threshold).toBe(12.00);
      expect(context.exceedAmount).toBe(3.50);
      expect(context.percentageOver).toBeCloseTo(29.17, 2);
      expect(context.alertLevel).toBe('WARNING');
      expect(context.topServices).toBe(mockTopServices);
    });

    it('should create alert context with CRITICAL level for high overage', () => {
      const context = tool.createAlertContext(mockCostAnalysis, 8.00, mockTopServices);

      expect(context.threshold).toBe(8.00);
      expect(context.exceedAmount).toBe(7.50);
      expect(context.percentageOver).toBeCloseTo(93.75, 2);
      expect(context.alertLevel).toBe('CRITICAL');
    });
  });

  describe('validateChannels', () => {
    it('should validate valid SNS topic ARN', async () => {
      const channels = await tool.validateChannels('arn:aws:sns:us-east-1:123456789012:spend-alerts');

      expect(channels.email).toBe(true);
      expect(channels.sms).toBe(true);
      expect(channels.ios).toBe(true);
    });

    it('should reject invalid SNS topic ARN', async () => {
      const channels = await tool.validateChannels('invalid-arn');

      expect(channels.email).toBe(false);
      expect(channels.sms).toBe(false);
      expect(channels.ios).toBe(false);
    });
  });

  describe('sendTestAlert', () => {
    it('should send test alert successfully', async () => {
      mockSNSClient.send.mockResolvedValue({ MessageId: 'test-message-id' });

      await tool.sendTestAlert('arn:aws:sns:us-east-1:123456789012:spend-alerts');

      expect(mockSNSClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-alerts',
            Message: expect.stringContaining('AWS Spend Alert'),
            Subject: expect.stringContaining('AWS Spend Alert')
          })
        })
      );

      expect(tool.logger.info).toHaveBeenCalledWith(
        'Test alert sent successfully',
        { topicArn: 'arn:aws:sns:us-east-1:123456789012:spend-alerts' }
      );
    });

    it('should send test alert with iOS configuration', async () => {
      mockSNSClient.send.mockResolvedValue({ MessageId: 'test-message-id' });

      const iosConfig = {
        platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/MyApp',
        bundleId: 'com.example.spendmonitor'
      };

      await tool.sendTestAlert(
        'arn:aws:sns:us-east-1:123456789012:spend-alerts',
        iosConfig
      );

      expect(mockSNSClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            MessageStructure: 'json',
            Message: expect.stringContaining('APNS')
          })
        })
      );
    });
  });
});