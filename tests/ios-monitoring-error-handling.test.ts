import { iOSManagementTool } from '../src/tools/ios-management-tool';
import { AlertTool } from '../src/tools/alert-tool';
import { SNSClient } from '@aws-sdk/client-sns';
import { CostAnalysis, AlertContext, ServiceCost, iOSPushConfig } from '../src/types';

// Mock AWS SDK
jest.mock('@aws-sdk/client-sns');
jest.mock('../src/utils/logger');
jest.mock('../src/utils/metrics');

const mockSNSClient = SNSClient as jest.MockedClass<typeof SNSClient>;

describe('iOS Monitoring and Error Handling', () => {
  let iosManagementTool: iOSManagementTool;
  let alertTool: AlertTool;
  let mockSNSInstance: jest.Mocked<SNSClient>;

  const mockIOSConfig: iOSPushConfig = {
    platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp',
    bundleId: 'com.test.spendmonitor',
    sandbox: true
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockSNSInstance = {
      send: jest.fn().mockImplementation(() => Promise.resolve({}))
    } as any;
    
    mockSNSClient.mockImplementation(() => mockSNSInstance);
    
    iosManagementTool = new iOSManagementTool(mockIOSConfig, 'us-east-1');
    alertTool = new AlertTool('us-east-1');
  });

  describe('APNS Feedback Processing', () => {
    it('should process APNS feedback and remove invalid tokens', async () => {
      // Mock list endpoints response
      mockSNSInstance.send
        .mockResolvedValueOnce({
          Endpoints: [
            {
              EndpointArn: 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/valid-endpoint',
              Attributes: {
                Token: 'validtoken123456789012345678901234567890123456789012345678901234',
                Enabled: 'true'
              }
            },
            {
              EndpointArn: 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/invalid-endpoint',
              Attributes: {
                Token: 'invalidtoken123456789012345678901234567890123456789012345678901',
                Enabled: 'false'
              }
            }
          ]
        })
        .mockResolvedValueOnce({ Attributes: { Enabled: 'true', Token: 'validtoken123456789012345678901234567890123456789012345678901234' } })
        .mockResolvedValueOnce({ Attributes: { Enabled: 'false', Token: 'invalidtoken123456789012345678901234567890123456789012345678901' } })
        .mockResolvedValueOnce({}); // Delete endpoint response

      const result = await iosManagementTool.processAPNSFeedback();

      expect(result.removedTokens).toHaveLength(1);
      expect(result.removedTokens[0]).toBe('invalidtoken123456789012345678901234567890123456789012345678901');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle errors during feedback processing gracefully', async () => {
      // Mock list endpoints to throw error
      mockSNSInstance.send.mockRejectedValueOnce(new Error('SNS service unavailable'));

      await expect(iosManagementTool.processAPNSFeedback()).rejects.toThrow('SNS service unavailable');
    });

    it('should handle invalid endpoint attributes during feedback processing', async () => {
      mockSNSInstance.send
        .mockResolvedValueOnce({
          Endpoints: [
            {
              EndpointArn: 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/problematic-endpoint'
            }
          ]
        })
        .mockRejectedValueOnce(new Error('EndpointDisabled'))
        .mockResolvedValueOnce({}); // Delete endpoint response

      const result = await iosManagementTool.processAPNSFeedback();

      expect(result.removedTokens).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to process endpoint');
    });
  });

  describe('APNS Certificate Health Validation', () => {
    it('should validate healthy APNS certificate', async () => {
      // Mock platform application attributes
      mockSNSInstance.send
        .mockResolvedValueOnce({
          Attributes: {
            Enabled: 'true',
            CreationTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days ago
          }
        })
        .mockResolvedValueOnce({ EndpointArn: 'test-endpoint' }) // Test endpoint creation
        .mockResolvedValueOnce({}); // Delete test endpoint

      const result = await iosManagementTool.validateAPNSCertificateHealth();

      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(result.daysUntilExpiration).toBeGreaterThan(300);
    });

    it('should detect certificate expiration warnings', async () => {
      // Mock platform application created 350 days ago (close to 1 year expiration)
      mockSNSInstance.send
        .mockResolvedValueOnce({
          Attributes: {
            Enabled: 'true',
            CreationTime: new Date(Date.now() - 350 * 24 * 60 * 60 * 1000).toISOString()
          }
        })
        .mockResolvedValueOnce({ EndpointArn: 'test-endpoint' })
        .mockResolvedValueOnce({});

      const result = await iosManagementTool.validateAPNSCertificateHealth();

      expect(result.isValid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('may expire soon');
      expect(result.daysUntilExpiration).toBeLessThan(30);
    });

    it('should detect certificate expiration errors', async () => {
      // Mock platform application created 360 days ago (very close to expiration)
      mockSNSInstance.send
        .mockResolvedValueOnce({
          Attributes: {
            Enabled: 'true',
            CreationTime: new Date(Date.now() - 360 * 24 * 60 * 60 * 1000).toISOString()
          }
        })
        .mockResolvedValueOnce({ EndpointArn: 'test-endpoint' })
        .mockResolvedValueOnce({});

      const result = await iosManagementTool.validateAPNSCertificateHealth();

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('expiration imminent');
    });

    it('should handle certificate validation errors', async () => {
      mockSNSInstance.send
        .mockResolvedValueOnce({
          Attributes: {
            Enabled: 'true',
            CreationTime: new Date().toISOString()
          }
        })
        .mockRejectedValueOnce(new Error('InvalidParameterException: Certificate expired'));

      const result = await iosManagementTool.validateAPNSCertificateHealth();

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Certificate expired');
    });

    it('should handle disabled platform application', async () => {
      mockSNSInstance.send.mockResolvedValueOnce({
        Attributes: {
          Enabled: 'false',
          CreationTime: new Date().toISOString()
        }
      });

      const result = await iosManagementTool.validateAPNSCertificateHealth();

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Platform application is disabled');
    });
  });

  describe('Enhanced Device Registration with Monitoring', () => {
    it('should register device with comprehensive logging and metrics', async () => {
      const deviceToken = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const userId = 'test-user-123';

      mockSNSInstance.send.mockResolvedValueOnce({
        EndpointArn: 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/new-endpoint'
      });

      const result = await iosManagementTool.registerDeviceWithMonitoring(deviceToken, userId);

      expect(result.deviceToken).toBe(deviceToken);
      expect(result.userId).toBe(userId);
      expect(result.platformEndpointArn).toBe('arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/new-endpoint');
      expect(result.active).toBe(true);
    });

    it('should handle device registration failures with proper error logging', async () => {
      const deviceToken = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

      mockSNSInstance.send.mockRejectedValueOnce(new Error('Platform application not found'));

      await expect(iosManagementTool.registerDeviceWithMonitoring(deviceToken))
        .rejects.toThrow('Platform application not found');
    });

    it('should validate device token format during registration', async () => {
      const invalidToken = 'invalid-token';

      await expect(iosManagementTool.registerDeviceWithMonitoring(invalidToken))
        .rejects.toThrow('Invalid device token format');
    });
  });

  describe('iOS Notification Delivery with Fallback', () => {
    it('should send notification successfully', async () => {
      const endpointArn = 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/test-endpoint';
      const payload = { test: 'payload' };

      mockSNSInstance.send.mockResolvedValueOnce({
        Attributes: { Enabled: 'true', Token: 'validtoken' }
      });

      const result = await iosManagementTool.sendNotificationWithFallback(endpointArn, payload);

      expect(result.success).toBe(true);
      expect(result.fallbackUsed).toBe(false);
      expect(result.errors).toHaveLength(0);
    });

    it('should use fallback channels when iOS notification fails', async () => {
      const endpointArn = 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/test-endpoint';
      const payload = { test: 'payload' };
      const fallbackChannels = ['email', 'sms'];

      mockSNSInstance.send.mockRejectedValueOnce(new Error('Endpoint is disabled'));

      const result = await iosManagementTool.sendNotificationWithFallback(
        endpointArn, 
        payload, 
        fallbackChannels
      );

      expect(result.success).toBe(true);
      expect(result.fallbackUsed).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBe('Endpoint is disabled');
    });

    it('should handle complete notification failure', async () => {
      const endpointArn = 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/test-endpoint';
      const payload = { test: 'payload' };

      mockSNSInstance.send.mockRejectedValueOnce(new Error('Endpoint is disabled'));

      const result = await iosManagementTool.sendNotificationWithFallback(endpointArn, payload);

      expect(result.success).toBe(false);
      expect(result.fallbackUsed).toBe(false);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('Comprehensive iOS Health Check', () => {
    it('should perform complete health check and return healthy status', async () => {
      // Mock successful platform app validation
      mockSNSInstance.send
        .mockResolvedValueOnce({ EndpointArn: 'test-endpoint' })
        .mockResolvedValueOnce({})
        // Mock certificate health check
        .mockResolvedValueOnce({
          Attributes: {
            Enabled: 'true',
            CreationTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
          }
        })
        .mockResolvedValueOnce({ EndpointArn: 'test-endpoint' })
        .mockResolvedValueOnce({})
        // Mock feedback processing
        .mockResolvedValueOnce({ Endpoints: [] });

      const result = await iosManagementTool.performHealthCheck();

      expect(result.overall).toBe('healthy');
      expect(result.platformApp.status).toBe('healthy');
      expect(result.certificate.status).toBe('healthy');
      expect(result.recommendations).toHaveLength(0);
    });

    it('should detect critical health issues', async () => {
      // Mock platform app validation failure
      mockSNSInstance.send.mockRejectedValueOnce(new Error('Platform application not found'));

      const result = await iosManagementTool.performHealthCheck();

      expect(result.overall).toBe('critical');
      expect(result.platformApp.status).toBe('critical');
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it('should provide actionable recommendations', async () => {
      // Mock certificate expiration warning
      mockSNSInstance.send
        .mockResolvedValueOnce({ EndpointArn: 'test-endpoint' })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          Attributes: {
            Enabled: 'true',
            CreationTime: new Date(Date.now() - 350 * 24 * 60 * 60 * 1000).toISOString()
          }
        })
        .mockResolvedValueOnce({ EndpointArn: 'test-endpoint' })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Endpoints: [] });

      const result = await iosManagementTool.performHealthCheck();

      expect(result.overall).toBe('warning');
      expect(result.certificate.status).toBe('warning');
      expect(result.recommendations).toContain('Plan APNS certificate renewal');
    });
  });

  describe('Alert Tool iOS Error Detection', () => {
    const mockCostAnalysis: CostAnalysis = {
      totalCost: 15.50,
      serviceBreakdown: { 'EC2': 10.00, 'S3': 5.50 },
      period: { start: '2024-01-01', end: '2024-01-15' },
      projectedMonthly: 31.00,
      currency: 'USD',
      lastUpdated: new Date().toISOString()
    };

    const mockAlertContext: AlertContext = {
      threshold: 10.00,
      exceedAmount: 5.50,
      percentageOver: 55.0,
      topServices: [{ serviceName: 'EC2', cost: 10.00, percentage: 64.5 }],
      alertLevel: 'WARNING'
    };

    it('should detect iOS-related errors correctly', async () => {
      const iosError = new Error('APNS certificate expired');
      const nonIOSError = new Error('Network timeout');

      // Access private method for testing
      const isIOSRelatedError = (alertTool as any).isIOSRelatedError;

      expect(isIOSRelatedError(iosError)).toBe(true);
      expect(isIOSRelatedError(nonIOSError)).toBe(false);
    });

    it('should send enhanced alert with iOS monitoring', async () => {
      const topicArn = 'arn:aws:sns:us-east-1:123456789012:test-topic';
      const iosConfig = { platformApplicationArn: mockIOSConfig.platformApplicationArn, bundleId: mockIOSConfig.bundleId };

      mockSNSInstance.send.mockResolvedValueOnce({ MessageId: 'test-message-id' });

      const result = await alertTool.sendSpendAlertWithIOSMonitoring(
        mockCostAnalysis,
        mockAlertContext,
        topicArn,
        iosConfig
      );

      expect(result.success).toBe(true);
      expect(result.iosDelivered).toBe(true);
      expect(result.fallbackUsed).toBe(false);
      expect(result.channels).toContain('ios');
      expect(result.metrics.deliveryTime).toBeGreaterThan(0);
    });

    it('should handle iOS delivery failure with fallback', async () => {
      const topicArn = 'arn:aws:sns:us-east-1:123456789012:test-topic';
      const iosConfig = { platformApplicationArn: mockIOSConfig.platformApplicationArn, bundleId: mockIOSConfig.bundleId };

      // First call fails with iOS error, second call (fallback) succeeds
      mockSNSInstance.send
        .mockRejectedValueOnce(new Error('Platform endpoint disabled'))
        .mockResolvedValueOnce({ MessageId: 'fallback-message-id' });

      const result = await alertTool.sendSpendAlertWithIOSMonitoring(
        mockCostAnalysis,
        mockAlertContext,
        topicArn,
        iosConfig
      );

      expect(result.success).toBe(true);
      expect(result.iosDelivered).toBe(false);
      expect(result.fallbackUsed).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Platform endpoint disabled');
    });

    it('should handle complete delivery failure', async () => {
      const topicArn = 'arn:aws:sns:us-east-1:123456789012:test-topic';
      const iosConfig = { platformApplicationArn: mockIOSConfig.platformApplicationArn, bundleId: mockIOSConfig.bundleId };

      // Both primary and fallback fail
      mockSNSInstance.send
        .mockRejectedValueOnce(new Error('Platform endpoint disabled'))
        .mockRejectedValueOnce(new Error('SNS service unavailable'));

      const result = await alertTool.sendSpendAlertWithIOSMonitoring(
        mockCostAnalysis,
        mockAlertContext,
        topicArn,
        iosConfig
      );

      expect(result.success).toBe(false);
      expect(result.iosDelivered).toBe(false);
      expect(result.fallbackUsed).toBe(true);
      expect(result.errors).toHaveLength(2);
    });

    it('should handle non-iOS errors without fallback', async () => {
      const topicArn = 'arn:aws:sns:us-east-1:123456789012:test-topic';

      mockSNSInstance.send.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await alertTool.sendSpendAlertWithIOSMonitoring(
        mockCostAnalysis,
        mockAlertContext,
        topicArn
      );

      expect(result.success).toBe(false);
      expect(result.iosDelivered).toBe(false);
      expect(result.fallbackUsed).toBe(false);
      expect(result.errors).toHaveLength(0); // Error is thrown, not captured in result
    });
  });

  describe('Error Recovery Scenarios', () => {
    it('should recover from temporary SNS service issues', async () => {
      const deviceToken = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

      // First call fails, second succeeds (simulating retry)
      mockSNSInstance.send
        .mockRejectedValueOnce(new Error('ServiceUnavailable'))
        .mockResolvedValueOnce({
          EndpointArn: 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/recovered-endpoint'
        });

      const result = await iosManagementTool.registerDeviceWithMonitoring(deviceToken);

      expect(result.platformEndpointArn).toBe('arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/recovered-endpoint');
    });

    it('should handle rate limiting gracefully', async () => {
      mockSNSInstance.send
        .mockResolvedValueOnce({
          Endpoints: Array(100).fill(null).map((_, i) => ({
            EndpointArn: `arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/endpoint-${i}`
          }))
        });

      // Mock rate limiting for some endpoint checks
      for (let i = 0; i < 50; i++) {
        mockSNSInstance.send.mockResolvedValueOnce({
          Attributes: { Enabled: 'true', Token: `token${i}`.padEnd(64, '0') }
        });
      }

      // Simulate rate limiting
      for (let i = 50; i < 100; i++) {
        mockSNSInstance.send.mockRejectedValueOnce(new Error('ThrottlingException'));
      }

      const result = await iosManagementTool.processAPNSFeedback();

      // Should handle rate limiting gracefully
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(error => error.includes('ThrottlingException'))).toBe(true);
    });

    it('should maintain service availability during partial failures', async () => {
      // Mock mixed success/failure scenario
      mockSNSInstance.send
        .mockResolvedValueOnce({ EndpointArn: 'test-endpoint' }) // Platform validation succeeds
        .mockResolvedValueOnce({}) // Cleanup succeeds
        .mockRejectedValueOnce(new Error('Certificate validation failed')) // Certificate check fails
        .mockResolvedValueOnce({ Endpoints: [] }); // Feedback processing succeeds

      const result = await iosManagementTool.performHealthCheck();

      // Should still provide useful health information despite partial failures
      expect(result.overall).toBe('critical');
      expect(result.platformApp.status).toBe('healthy');
      expect(result.certificate.status).toBe('error');
      expect(result.recommendations.length).toBeGreaterThan(0);
    });
  });
});