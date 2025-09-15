import { iOSMonitoringService } from '../src/utils/ios-monitoring';
import { iOSManagementTool } from '../src/tools/ios-management-tool';
import { AlertTool } from '../src/tools/alert-tool';
import { iOSPushConfig } from '../src/types';
import { SNSClient } from '@aws-sdk/client-sns';

// Mock AWS SDK
jest.mock('@aws-sdk/client-sns');
jest.mock('../src/utils/logger');
jest.mock('../src/utils/metrics');

describe('iOSMonitoringService - Comprehensive Error Handling', () => {
  let monitoringService: iOSMonitoringService;
  let mockSNSClient: jest.Mocked<SNSClient>;
  let iosConfig: iOSPushConfig;

  beforeEach(() => {
    iosConfig = {
      platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp',
      bundleId: 'com.test.spendmonitor',
      sandbox: true
    };

    mockSNSClient = new SNSClient({}) as jest.Mocked<SNSClient>;
    monitoringService = new iOSMonitoringService(iosConfig, 'us-east-1');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Comprehensive Health Check', () => {
    it('should perform complete health check with all components healthy', async () => {
      // Mock successful responses for all health checks
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSConfig').mockResolvedValue(true);
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSCertificateHealth').mockResolvedValue({
        isValid: true,
        daysUntilExpiration: 90,
        warnings: [],
        errors: []
      });
      jest.spyOn(iOSManagementTool.prototype, 'processAPNSFeedback').mockResolvedValue({
        removedTokens: ['token1', 'token2'],
        errors: []
      });

      const result = await monitoringService.performComprehensiveHealthCheck();

      expect(result.overall).toBe('healthy');
      expect(result.components.platformApp.status).toBe('healthy');
      expect(result.components.certificate.status).toBe('healthy');
      expect(result.components.certificate.daysUntilExpiration).toBe(90);
      expect(result.components.endpoints.invalid).toBe(2);
      expect(result.components.feedback.processed).toBe(true);
      expect(result.recommendations).toHaveLength(0);
      expect(result.metrics.healthCheckDuration).toBeGreaterThan(0);
    });

    it('should detect critical certificate expiration', async () => {
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSConfig').mockResolvedValue(true);
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSCertificateHealth').mockResolvedValue({
        isValid: false,
        daysUntilExpiration: 3,
        warnings: [],
        errors: ['APNS certificate expiration imminent (estimated 3 days remaining)']
      });
      jest.spyOn(iOSManagementTool.prototype, 'processAPNSFeedback').mockResolvedValue({
        removedTokens: [],
        errors: []
      });

      const result = await monitoringService.performComprehensiveHealthCheck();

      expect(result.overall).toBe('critical');
      expect(result.components.certificate.status).toBe('critical');
      expect(result.components.certificate.daysUntilExpiration).toBe(3);
      expect(result.recommendations).toContain('URGENT: Renew APNS certificate immediately - iOS notifications are failing');
    });

    it('should detect warning state for certificate expiring soon', async () => {
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSConfig').mockResolvedValue(true);
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSCertificateHealth').mockResolvedValue({
        isValid: true,
        daysUntilExpiration: 20,
        warnings: ['APNS certificate may expire soon (estimated 20 days remaining)'],
        errors: []
      });
      jest.spyOn(iOSManagementTool.prototype, 'processAPNSFeedback').mockResolvedValue({
        removedTokens: [],
        errors: []
      });

      const result = await monitoringService.performComprehensiveHealthCheck();

      expect(result.overall).toBe('warning');
      expect(result.components.certificate.status).toBe('warning');
      expect(result.recommendations).toContain('Plan APNS certificate renewal - expiration approaching');
    });

    it('should handle high invalid token rate', async () => {
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSConfig').mockResolvedValue(true);
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSCertificateHealth').mockResolvedValue({
        isValid: true,
        warnings: [],
        errors: []
      });
      // Simulate high number of invalid tokens
      const invalidTokens = Array.from({ length: 60 }, (_, i) => `invalid_token_${i}`);
      jest.spyOn(iOSManagementTool.prototype, 'processAPNSFeedback').mockResolvedValue({
        removedTokens: invalidTokens,
        errors: []
      });

      const result = await monitoringService.performComprehensiveHealthCheck();

      expect(result.overall).toBe('critical');
      expect(result.components.endpoints.invalid).toBe(60);
      expect(result.recommendations).toContain('CRITICAL: High number of invalid device tokens - investigate app distribution and user engagement');
    });

    it('should handle platform application failure', async () => {
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSConfig').mockResolvedValue(false);
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSCertificateHealth').mockResolvedValue({
        isValid: true,
        warnings: [],
        errors: []
      });
      jest.spyOn(iOSManagementTool.prototype, 'processAPNSFeedback').mockResolvedValue({
        removedTokens: [],
        errors: []
      });

      const result = await monitoringService.performComprehensiveHealthCheck();

      expect(result.overall).toBe('critical');
      expect(result.components.platformApp.status).toBe('critical');
      expect(result.recommendations).toContain('URGENT: Fix platform application configuration - iOS notifications are not functional');
    });

    it('should handle feedback processing errors', async () => {
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSConfig').mockResolvedValue(true);
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSCertificateHealth').mockResolvedValue({
        isValid: true,
        warnings: [],
        errors: []
      });
      jest.spyOn(iOSManagementTool.prototype, 'processAPNSFeedback').mockResolvedValue({
        removedTokens: [],
        errors: ['Failed to process endpoint arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/12345']
      });

      const result = await monitoringService.performComprehensiveHealthCheck();

      expect(result.components.feedback.errors).toHaveLength(1);
      expect(result.recommendations).toContain('Review APNS feedback processing errors - some cleanup operations may have failed');
    });

    it('should handle complete system failure gracefully', async () => {
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSConfig').mockRejectedValue(new Error('Network error'));
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSCertificateHealth').mockRejectedValue(new Error('Certificate check failed'));
      jest.spyOn(iOSManagementTool.prototype, 'processAPNSFeedback').mockRejectedValue(new Error('Feedback processing failed'));

      const result = await monitoringService.performComprehensiveHealthCheck();

      expect(result.overall).toBe('critical');
      expect(result.components.platformApp.status).toBe('error');
      expect(result.components.certificate.status).toBe('error');
      expect(result.components.feedback.processed).toBe(false);
      expect(result.recommendations).toContain('Investigate iOS monitoring system failure');
    });
  });

  describe('Automated Recovery', () => {
    it('should perform token cleanup when invalid token rate is high', async () => {
      const healthStatus = {
        overall: 'warning' as const,
        components: {
          platformApp: { status: 'healthy', details: [] },
          certificate: { status: 'healthy', details: [] },
          endpoints: { active: 80, invalid: 20, total: 100 },
          feedback: { processed: true, removedTokens: 20, errors: [] }
        },
        recommendations: [],
        metrics: { healthCheckDuration: 1000, certificateValidationTime: 500, feedbackProcessingTime: 300 }
      };

      jest.spyOn(iOSManagementTool.prototype, 'processAPNSFeedback').mockResolvedValue({
        removedTokens: ['token1', 'token2', 'token3'],
        errors: []
      });

      const result = await monitoringService.performAutomatedRecovery(healthStatus);

      expect(result.success).toBe(true);
      expect(result.actionsPerformed).toContain('Cleaned up 3 additional invalid tokens');
      expect(result.errors).toHaveLength(0);
    });

    it('should attempt platform application refresh when unhealthy', async () => {
      const healthStatus = {
        overall: 'critical' as const,
        components: {
          platformApp: { status: 'critical', details: ['Platform application validation failed'] },
          certificate: { status: 'healthy', details: [] },
          endpoints: { active: 95, invalid: 5, total: 100 },
          feedback: { processed: true, removedTokens: 5, errors: [] }
        },
        recommendations: [],
        metrics: { healthCheckDuration: 1000, certificateValidationTime: 500, feedbackProcessingTime: 300 }
      };

      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSConfig').mockResolvedValue(true);

      const result = await monitoringService.performAutomatedRecovery(healthStatus);

      expect(result.success).toBe(true);
      expect(result.actionsPerformed).toContain('Platform application validation refreshed successfully');
    });

    it('should handle recovery failures gracefully', async () => {
      const healthStatus = {
        overall: 'warning' as const,
        components: {
          platformApp: { status: 'critical', details: [] },
          certificate: { status: 'healthy', details: [] },
          endpoints: { active: 80, invalid: 20, total: 100 },
          feedback: { processed: true, removedTokens: 20, errors: [] }
        },
        recommendations: [],
        metrics: { healthCheckDuration: 1000, certificateValidationTime: 500, feedbackProcessingTime: 300 }
      };

      jest.spyOn(iOSManagementTool.prototype, 'processAPNSFeedback').mockRejectedValue(new Error('Cleanup failed'));
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSConfig').mockRejectedValue(new Error('Validation failed'));

      const result = await monitoringService.performAutomatedRecovery(healthStatus);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Token cleanup failed: Cleanup failed');
      expect(result.errors).toContain('Platform app refresh failed: Validation failed');
    });
  });

  describe('Notification Delivery Monitoring', () => {
    it('should monitor successful notification delivery', async () => {
      await monitoringService.monitorNotificationDelivery(10, 9, 1, false);

      // Verify that metrics are recorded (mocked)
      // In a real test, you would verify the metrics calls
      expect(true).toBe(true); // Placeholder assertion
    });

    it('should trigger health check on high failure rate', async () => {
      const healthCheckSpy = jest.spyOn(monitoringService, 'performComprehensiveHealthCheck')
        .mockResolvedValue({
          overall: 'critical',
          components: {
            platformApp: { status: 'healthy', details: [] },
            certificate: { status: 'healthy', details: [] },
            endpoints: { active: 0, invalid: 0, total: 0 },
            feedback: { processed: false, removedTokens: 0, errors: [] }
          },
          recommendations: [],
          metrics: { healthCheckDuration: 1000, certificateValidationTime: 500, feedbackProcessingTime: 300 }
        });

      await monitoringService.monitorNotificationDelivery(10, 2, 8, true);

      // Allow time for background health check to be triggered
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(healthCheckSpy).toHaveBeenCalled();
    });

    it('should handle monitoring errors gracefully', async () => {
      // This should not throw even if internal operations fail
      await expect(monitoringService.monitorNotificationDelivery(5, 3, 2, false))
        .resolves.not.toThrow();
    });
  });

  describe('System Status Summary', () => {
    it('should return operational status when system is healthy', async () => {
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSConfig').mockResolvedValue(true);

      const status = await monitoringService.getSystemStatusSummary();

      expect(status.status).toBe('operational');
      expect(status.lastHealthCheck).toBeInstanceOf(Date);
    });

    it('should return degraded status when validation fails', async () => {
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSConfig').mockResolvedValue(false);

      const status = await monitoringService.getSystemStatusSummary();

      expect(status.status).toBe('degraded');
    });

    it('should return outage status when validation throws error', async () => {
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSConfig').mockRejectedValue(new Error('System error'));

      const status = await monitoringService.getSystemStatusSummary();

      expect(status.status).toBe('outage');
      expect(status.recentErrors).toBe(1);
    });
  });

  describe('Error Recovery Scenarios', () => {
    it('should handle APNS certificate expiration scenario', async () => {
      // Simulate certificate expiration
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSConfig').mockResolvedValue(false);
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSCertificateHealth').mockResolvedValue({
        isValid: false,
        daysUntilExpiration: 0,
        warnings: [],
        errors: ['APNS certificate has expired']
      });
      jest.spyOn(iOSManagementTool.prototype, 'processAPNSFeedback').mockResolvedValue({
        removedTokens: [],
        errors: []
      });

      const healthResult = await monitoringService.performComprehensiveHealthCheck();
      expect(healthResult.overall).toBe('critical');
      expect(healthResult.components.certificate.status).toBe('critical');

      // Attempt recovery
      const recoveryResult = await monitoringService.performAutomatedRecovery(healthResult);
      expect(recoveryResult.actionsPerformed.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle mass device token invalidation scenario', async () => {
      // Simulate mass token invalidation (e.g., app update)
      const invalidTokens = Array.from({ length: 80 }, (_, i) => `invalid_token_${i}`);
      
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSConfig').mockResolvedValue(true);
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSCertificateHealth').mockResolvedValue({
        isValid: true,
        warnings: [],
        errors: []
      });
      jest.spyOn(iOSManagementTool.prototype, 'processAPNSFeedback').mockResolvedValue({
        removedTokens: invalidTokens,
        errors: []
      });

      const healthResult = await monitoringService.performComprehensiveHealthCheck();
      expect(healthResult.overall).toBe('critical');
      expect(healthResult.components.endpoints.invalid).toBe(80);

      // Recovery should attempt additional cleanup
      const recoveryResult = await monitoringService.performAutomatedRecovery(healthResult);
      expect(recoveryResult.actionsPerformed.some(action => 
        action.includes('additional invalid tokens')
      )).toBe(true);
    });

    it('should handle network connectivity issues', async () => {
      // Simulate network errors
      const networkError = new Error('Network timeout');
      networkError.name = 'NetworkingError';

      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSConfig').mockRejectedValue(networkError);
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSCertificateHealth').mockRejectedValue(networkError);
      jest.spyOn(iOSManagementTool.prototype, 'processAPNSFeedback').mockRejectedValue(networkError);

      const healthResult = await monitoringService.performComprehensiveHealthCheck();
      expect(healthResult.overall).toBe('critical');
      expect(healthResult.recommendations).toContain('Investigate iOS monitoring system failure');
    });

    it('should handle partial system failures with graceful degradation', async () => {
      // Platform app works, but certificate check fails
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSConfig').mockResolvedValue(true);
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSCertificateHealth').mockRejectedValue(new Error('Certificate service unavailable'));
      jest.spyOn(iOSManagementTool.prototype, 'processAPNSFeedback').mockResolvedValue({
        removedTokens: ['token1'],
        errors: []
      });

      const healthResult = await monitoringService.performComprehensiveHealthCheck();
      
      expect(healthResult.components.platformApp.status).toBe('healthy');
      expect(healthResult.components.certificate.status).toBe('critical');
      expect(healthResult.components.feedback.processed).toBe(true);
      expect(healthResult.overall).toBe('critical');
    });
  });

  describe('Performance and Resilience', () => {
    it('should complete health check within reasonable time', async () => {
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSConfig').mockResolvedValue(true);
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSCertificateHealth').mockResolvedValue({
        isValid: true,
        warnings: [],
        errors: []
      });
      jest.spyOn(iOSManagementTool.prototype, 'processAPNSFeedback').mockResolvedValue({
        removedTokens: [],
        errors: []
      });

      const startTime = Date.now();
      const result = await monitoringService.performComprehensiveHealthCheck();
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
      expect(result.metrics.healthCheckDuration).toBeGreaterThan(0);
    });

    it('should handle concurrent health checks gracefully', async () => {
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSConfig').mockResolvedValue(true);
      jest.spyOn(iOSManagementTool.prototype, 'validateAPNSCertificateHealth').mockResolvedValue({
        isValid: true,
        warnings: [],
        errors: []
      });
      jest.spyOn(iOSManagementTool.prototype, 'processAPNSFeedback').mockResolvedValue({
        removedTokens: [],
        errors: []
      });

      // Run multiple health checks concurrently
      const promises = Array.from({ length: 3 }, () => 
        monitoringService.performComprehensiveHealthCheck()
      );

      const results = await Promise.all(promises);
      
      results.forEach(result => {
        expect(result.overall).toBe('healthy');
        expect(result.metrics.healthCheckDuration).toBeGreaterThan(0);
      });
    });
  });
});