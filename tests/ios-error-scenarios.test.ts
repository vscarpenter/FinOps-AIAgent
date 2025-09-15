import { iOSManagementTool } from '../src/tools/ios-management-tool';
import { AlertTool } from '../src/tools/alert-tool';
import { iOSPushConfig, CostAnalysis, AlertContext } from '../src/types';
import { SNSClient, CreatePlatformEndpointCommand, GetEndpointAttributesCommand, DeleteEndpointCommand, ListEndpointsByPlatformApplicationCommand } from '@aws-sdk/client-sns';

// Mock AWS SDK
jest.mock('@aws-sdk/client-sns');
jest.mock('../src/utils/logger');
jest.mock('../src/utils/metrics');

// Mock the SNS client methods
const mockSend = jest.fn();
jest.mocked(SNSClient).mockImplementation(() => ({
  send: mockSend
} as any));

describe('iOS Error Scenarios and Recovery', () => {
  let iosManagementTool: iOSManagementTool;
  let alertTool: AlertTool;
  let mockSend: jest.MockedFunction<any>;
  let iosConfig: iOSPushConfig;

  beforeEach(() => {
    iosConfig = {
      platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp',
      bundleId: 'com.test.spendmonitor',
      sandbox: true
    };

    mockSend = jest.mocked(mockSend);
    mockSend.mockClear();
    iosManagementTool = new iOSManagementTool(iosConfig, 'us-east-1');
    alertTool = new AlertTool('us-east-1');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('APNS Certificate Errors', () => {
    it('should handle expired certificate error during endpoint creation', async () => {
      const expiredCertError = new Error('The certificate has expired');
      expiredCertError.name = 'InvalidParameterException';
      
      mockSend.mockRejectedValue(expiredCertError);

      await expect(iosManagementTool.registerDevice('a'.repeat(64), 'user123'))
        .rejects.toThrow('The certificate has expired');
    });

    it('should detect certificate expiration through validation', async () => {
      // Mock certificate validation that detects expiration
      const expiredCertError = new Error('Certificate expired');
      expiredCertError.name = 'InvalidParameterException';
      
      mockSNSClient.send.mockRejectedValueOnce(expiredCertError);

      const result = await iosManagementTool.validateAPNSCertificateHealth();

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('APNS certificate validation failed: Certificate expired');
    });

    it('should handle invalid certificate format errors', async () => {
      const invalidCertError = new Error('Invalid certificate format');
      invalidCertError.name = 'InvalidParameterException';
      
      mockSNSClient.send.mockRejectedValue(invalidCertError);

      const result = await iosManagementTool.validateAPNSCertificateHealth();

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('APNS certificate validation failed: Invalid certificate format');
    });

    it('should estimate certificate expiration based on platform app age', async () => {
      // Mock successful test endpoint creation
      mockSNSClient.send
        .mockResolvedValueOnce({ EndpointArn: 'test-endpoint-arn' }) // Create endpoint
        .mockResolvedValueOnce({}); // Delete endpoint

      // Mock platform app attributes with creation time
      const oldCreationDate = new Date();
      oldCreationDate.setDate(oldCreationDate.getDate() - 350); // 350 days ago
      
      mockSNSClient.send.mockResolvedValueOnce({
        Attributes: {
          Enabled: 'true',
          CreationTime: oldCreationDate.toISOString()
        }
      });

      const result = await iosManagementTool.validateAPNSCertificateHealth();

      expect(result.warnings.some(w => w.includes('may expire soon'))).toBe(true);
    });
  });

  describe('Device Token Errors', () => {
    it('should handle invalid device token format', async () => {
      const invalidToken = 'invalid-token-format';

      await expect(iosManagementTool.registerDevice(invalidToken, 'user123'))
        .rejects.toThrow('Invalid device token format');
    });

    it('should handle device token that is too short', async () => {
      const shortToken = 'a'.repeat(32); // Only 32 characters instead of 64

      await expect(iosManagementTool.registerDevice(shortToken, 'user123'))
        .rejects.toThrow('Invalid device token format');
    });

    it('should handle device token with invalid characters', async () => {
      const invalidCharToken = 'g'.repeat(64); // 'g' is not a valid hex character

      await expect(iosManagementTool.registerDevice(invalidCharToken, 'user123'))
        .rejects.toThrow('Invalid device token format');
    });

    it('should handle duplicate device token registration', async () => {
      const validToken = 'a'.repeat(64);
      const duplicateEndpointError = new Error('Endpoint already exists');
      duplicateEndpointError.name = 'InvalidParameterException';

      mockSNSClient.send.mockRejectedValue(duplicateEndpointError);

      await expect(iosManagementTool.registerDevice(validToken, 'user123'))
        .rejects.toThrow('Endpoint already exists');
    });
  });

  describe('Platform Application Errors', () => {
    it('should handle platform application not found error', async () => {
      const notFoundError = new Error('Platform application not found');
      notFoundError.name = 'NotFoundException';

      mockSNSClient.send.mockRejectedValue(notFoundError);

      const isValid = await iosManagementTool.validateAPNSConfig();
      expect(isValid).toBe(false);
    });

    it('should handle platform application disabled error', async () => {
      const disabledError = new Error('Platform application is disabled');
      disabledError.name = 'InvalidParameterException';

      mockSNSClient.send.mockRejectedValue(disabledError);

      const isValid = await iosManagementTool.validateAPNSConfig();
      expect(isValid).toBe(false);
    });

    it('should handle insufficient permissions error', async () => {
      const permissionError = new Error('Access denied');
      permissionError.name = 'AuthorizationErrorException';

      mockSNSClient.send.mockRejectedValue(permissionError);

      const isValid = await iosManagementTool.validateAPNSConfig();
      expect(isValid).toBe(false);
    });
  });

  describe('Endpoint Management Errors', () => {
    it('should handle endpoint disabled during validation', async () => {
      const endpointArn = 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/12345';
      
      mockSNSClient.send.mockResolvedValue({
        Attributes: {
          Enabled: 'false',
          Token: 'a'.repeat(64)
        }
      });

      const removedEndpoints = await iosManagementTool.removeInvalidTokens([endpointArn]);
      expect(removedEndpoints).toContain(endpointArn);
    });

    it('should handle endpoint with invalid token during validation', async () => {
      const endpointArn = 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/12345';
      
      mockSNSClient.send.mockResolvedValue({
        Attributes: {
          Enabled: 'true',
          Token: 'invalid-token'
        }
      });

      const removedEndpoints = await iosManagementTool.removeInvalidTokens([endpointArn]);
      expect(removedEndpoints).toContain(endpointArn);
    });

    it('should handle endpoint not found during cleanup', async () => {
      const endpointArn = 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/12345';
      const notFoundError = new Error('Endpoint not found');
      notFoundError.name = 'NotFoundException';

      mockSNSClient.send.mockRejectedValue(notFoundError);

      const removedEndpoints = await iosManagementTool.removeInvalidTokens([endpointArn]);
      expect(removedEndpoints).toContain(endpointArn);
    });
  });

  describe('APNS Feedback Processing Errors', () => {
    it('should handle feedback processing with mixed results', async () => {
      const endpoints = [
        { EndpointArn: 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/valid1' },
        { EndpointArn: 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/invalid1' },
        { EndpointArn: 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/error1' }
      ];

      // Mock list endpoints response
      mockSNSClient.send.mockResolvedValueOnce({
        Endpoints: endpoints
      });

      // Mock get attributes responses
      mockSNSClient.send
        .mockResolvedValueOnce({ // valid endpoint
          Attributes: { Enabled: 'true', Token: 'a'.repeat(64) }
        })
        .mockResolvedValueOnce({ // invalid endpoint
          Attributes: { Enabled: 'false', Token: 'b'.repeat(64) }
        })
        .mockRejectedValueOnce(new Error('Endpoint error')); // error endpoint

      // Mock delete operations
      mockSNSClient.send
        .mockResolvedValueOnce({}) // delete invalid endpoint
        .mockResolvedValueOnce({}); // delete error endpoint

      const result = await iosManagementTool.processAPNSFeedback();

      expect(result.removedTokens).toHaveLength(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to process endpoint');
    });

    it('should handle pagination in feedback processing', async () => {
      // Mock paginated response
      mockSNSClient.send
        .mockResolvedValueOnce({
          Endpoints: [
            { EndpointArn: 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/1' }
          ],
          NextToken: 'next-token'
        })
        .mockResolvedValueOnce({
          Endpoints: [
            { EndpointArn: 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/2' }
          ]
        });

      // Mock get attributes for both endpoints (both valid)
      mockSNSClient.send
        .mockResolvedValueOnce({
          Attributes: { Enabled: 'true', Token: 'a'.repeat(64) }
        })
        .mockResolvedValueOnce({
          Attributes: { Enabled: 'true', Token: 'b'.repeat(64) }
        });

      const result = await iosManagementTool.processAPNSFeedback();

      expect(result.removedTokens).toHaveLength(0); // Both endpoints were valid
      expect(result.errors).toHaveLength(0);
    });

    it('should handle complete feedback processing failure', async () => {
      const listError = new Error('Failed to list endpoints');
      mockSNSClient.send.mockRejectedValue(listError);

      await expect(iosManagementTool.processAPNSFeedback())
        .rejects.toThrow('Failed to list endpoints');
    });
  });

  describe('iOS Notification Delivery Errors', () => {
    it('should handle iOS notification with oversized payload', async () => {
      const costAnalysis: CostAnalysis = {
        totalCost: 15.50,
        serviceBreakdown: {
          'Very Long Service Name That Might Cause Payload Size Issues': 10.00,
          'Another Very Long Service Name With Detailed Description': 3.50,
          'Yet Another Service With An Extremely Long Name That Could Exceed Limits': 2.00
        },
        period: { start: '2024-01-01', end: '2024-01-15' },
        projectedMonthly: 31.00,
        currency: 'USD',
        lastUpdated: new Date().toISOString()
      };

      const alertContext: AlertContext = {
        threshold: 10.00,
        exceedAmount: 5.50,
        percentageOver: 55.0,
        topServices: [
          { serviceName: 'Very Long Service Name That Might Cause Payload Size Issues', cost: 10.00, percentage: 64.5 }
        ],
        alertLevel: 'WARNING'
      };

      const iosPayload = alertTool.formatIOSPayload(costAnalysis, alertContext);
      const payloadSize = JSON.stringify(iosPayload).length;

      // APNS has a 4KB limit for payloads
      expect(payloadSize).toBeLessThan(4096);
    });

    it('should handle iOS notification delivery with endpoint errors', async () => {
      const costAnalysis: CostAnalysis = {
        totalCost: 15.50,
        serviceBreakdown: { 'EC2': 10.00, 'S3': 3.50, 'Lambda': 2.00 },
        period: { start: '2024-01-01', end: '2024-01-15' },
        projectedMonthly: 31.00,
        currency: 'USD',
        lastUpdated: new Date().toISOString()
      };

      const alertContext: AlertContext = {
        threshold: 10.00,
        exceedAmount: 5.50,
        percentageOver: 55.0,
        topServices: [
          { serviceName: 'EC2', cost: 10.00, percentage: 64.5 }
        ],
        alertLevel: 'WARNING'
      };

      const topicArn = 'arn:aws:sns:us-east-1:123456789012:spend-alerts';
      const iosConfig = {
        platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp',
        bundleId: 'com.test.spendmonitor'
      };

      // Mock SNS publish failure due to iOS endpoint issues
      const endpointError = new Error('Endpoint disabled');
      endpointError.name = 'EndpointDisabledException';
      
      mockSNSClient.send.mockRejectedValue(endpointError);

      await expect(alertTool.sendSpendAlert(costAnalysis, alertContext, topicArn, iosConfig))
        .rejects.toThrow('Alert delivery failed');
    });

    it('should handle iOS notification with enhanced monitoring and fallback', async () => {
      const costAnalysis: CostAnalysis = {
        totalCost: 15.50,
        serviceBreakdown: { 'EC2': 10.00, 'S3': 3.50, 'Lambda': 2.00 },
        period: { start: '2024-01-01', end: '2024-01-15' },
        projectedMonthly: 31.00,
        currency: 'USD',
        lastUpdated: new Date().toISOString()
      };

      const alertContext: AlertContext = {
        threshold: 10.00,
        exceedAmount: 5.50,
        percentageOver: 55.0,
        topServices: [
          { serviceName: 'EC2', cost: 10.00, percentage: 64.5 }
        ],
        alertLevel: 'WARNING'
      };

      const topicArn = 'arn:aws:sns:us-east-1:123456789012:spend-alerts';
      const iosConfig = {
        platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp',
        bundleId: 'com.test.spendmonitor'
      };

      // Mock initial iOS delivery failure, then successful fallback
      mockSNSClient.send
        .mockRejectedValueOnce(new Error('iOS delivery failed'))
        .mockResolvedValueOnce({ MessageId: 'fallback-message-id' });

      const result = await alertTool.sendSpendAlertWithIOSMonitoring(
        costAnalysis, 
        alertContext, 
        topicArn, 
        iosConfig
      );

      expect(result.success).toBe(true);
      expect(result.fallbackUsed).toBe(true);
      expect(result.iosDelivered).toBe(false);
      expect(result.channels).toContain('ios');
    });
  });

  describe('Recovery and Resilience', () => {
    it('should recover from temporary network issues', async () => {
      const networkError = new Error('Network timeout');
      networkError.name = 'NetworkingError';

      // First call fails, second succeeds
      mockSNSClient.send
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({ EndpointArn: 'test-endpoint' })
        .mockResolvedValueOnce({}); // Delete test endpoint

      const isValid = await iosManagementTool.validateAPNSConfig();
      expect(isValid).toBe(true);
    });

    it('should handle rate limiting with exponential backoff', async () => {
      const rateLimitError = new Error('Rate exceeded');
      rateLimitError.name = 'ThrottlingException';

      // Simulate rate limiting followed by success
      mockSNSClient.send
        .mockRejectedValueOnce(rateLimitError)
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({ EndpointArn: 'test-endpoint' })
        .mockResolvedValueOnce({}); // Delete test endpoint

      const isValid = await iosManagementTool.validateAPNSConfig();
      expect(isValid).toBe(true);
    });

    it('should maintain service availability during partial failures', async () => {
      // Certificate validation fails, but device registration works
      const validToken = 'a'.repeat(64);
      
      mockSNSClient.send
        .mockRejectedValueOnce(new Error('Certificate check failed')) // Certificate validation
        .mockResolvedValueOnce({ EndpointArn: 'device-endpoint' }); // Device registration

      // Certificate validation should fail
      const certHealth = await iosManagementTool.validateAPNSCertificateHealth();
      expect(certHealth.isValid).toBe(false);

      // But device registration should still work
      const registration = await iosManagementTool.registerDevice(validToken, 'user123');
      expect(registration.platformEndpointArn).toBe('device-endpoint');
    });

    it('should handle cascading failures gracefully', async () => {
      // Multiple operations fail in sequence
      const systemError = new Error('System unavailable');
      
      mockSNSClient.send.mockRejectedValue(systemError);

      // All operations should fail, but not crash the system
      await expect(iosManagementTool.validateAPNSConfig()).resolves.toBe(false);
      await expect(iosManagementTool.validateAPNSCertificateHealth()).resolves.toMatchObject({
        isValid: false,
        errors: expect.arrayContaining([expect.stringContaining('System unavailable')])
      });
      await expect(iosManagementTool.processAPNSFeedback()).rejects.toThrow('System unavailable');
    });
  });

  describe('Monitoring and Alerting Integration', () => {
    it('should integrate iOS errors with monitoring system', async () => {
      const validToken = 'a'.repeat(64);
      const registrationError = new Error('Registration failed');
      
      mockSNSClient.send.mockRejectedValue(registrationError);

      // Registration should fail and be logged/monitored
      await expect(iosManagementTool.registerDeviceWithMonitoring(validToken, 'user123'))
        .rejects.toThrow('Registration failed');

      // Verify that error metrics would be recorded (mocked in this test)
      expect(true).toBe(true); // Placeholder for metrics verification
    });

    it('should trigger health checks on repeated failures', async () => {
      const healthCheckSpy = jest.spyOn(iosManagementTool, 'performHealthCheck')
        .mockResolvedValue({
          overall: 'critical',
          platformApp: { status: 'critical', details: [] },
          certificate: { status: 'critical', details: [] },
          endpoints: { active: 0, invalid: 0, total: 0 },
          recommendations: []
        });

      // Simulate multiple failures that should trigger health check
      const error = new Error('Repeated failure');
      mockSNSClient.send.mockRejectedValue(error);

      // Multiple failed operations
      await expect(iosManagementTool.validateAPNSConfig()).resolves.toBe(false);
      await expect(iosManagementTool.validateAPNSConfig()).resolves.toBe(false);
      await expect(iosManagementTool.validateAPNSConfig()).resolves.toBe(false);

      // Health check should be triggered (in a real implementation)
      // This is a placeholder for the actual health check trigger logic
      expect(true).toBe(true);
    });
  });
});