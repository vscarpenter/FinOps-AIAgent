import { iOSManagementTool } from '../../src/tools/ios-management-tool';
import { AlertTool } from '../../src/tools/alert-tool';
import { MetricsCollector } from '../../src/utils/metrics';
import { Logger } from '../../src/utils/logger';
import { SNSClient } from '@aws-sdk/client-sns';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';

/**
 * Integration tests for iOS monitoring and error handling
 * These tests require actual AWS services and should be run in a test environment
 */
describe('iOS Monitoring Integration Tests', () => {
  let iosManagementTool: iOSManagementTool;
  let alertTool: AlertTool;
  let metricsCollector: MetricsCollector;
  let logger: Logger;

  const testConfig = {
    region: process.env.AWS_REGION || 'us-east-1',
    platformApplicationArn: process.env.TEST_IOS_PLATFORM_APP_ARN,
    bundleId: process.env.TEST_IOS_BUNDLE_ID || 'com.test.spendmonitor',
    snsTopicArn: process.env.TEST_SNS_TOPIC_ARN
  };

  beforeAll(() => {
    // Skip integration tests if required environment variables are not set
    if (!testConfig.platformApplicationArn || !testConfig.snsTopicArn) {
      console.log('Skipping iOS integration tests - missing required environment variables');
      return;
    }

    const iosConfig = {
      platformApplicationArn: testConfig.platformApplicationArn!,
      bundleId: testConfig.bundleId,
      sandbox: true
    };

    iosManagementTool = new iOSManagementTool(iosConfig, testConfig.region);
    alertTool = new AlertTool(testConfig.region);
    metricsCollector = new MetricsCollector(testConfig.region, 'SpendMonitor/iOS/Test');
    logger = new Logger('iOSIntegrationTest');
  });

  beforeEach(() => {
    if (!testConfig.platformApplicationArn || !testConfig.snsTopicArn) {
      pending('Missing required environment variables for integration tests');
    }
  });

  describe('Real APNS Platform Application Health', () => {
    it('should validate real APNS platform application', async () => {
      const isValid = await iosManagementTool.validateAPNSConfig();
      
      expect(typeof isValid).toBe('boolean');
      
      if (!isValid) {
        logger.warn('APNS platform application validation failed - check configuration');
      }
    }, 30000);

    it('should perform comprehensive certificate health check', async () => {
      const healthResult = await iosManagementTool.validateAPNSCertificateHealth();
      
      expect(healthResult).toHaveProperty('isValid');
      expect(healthResult).toHaveProperty('warnings');
      expect(healthResult).toHaveProperty('errors');
      expect(Array.isArray(healthResult.warnings)).toBe(true);
      expect(Array.isArray(healthResult.errors)).toBe(true);

      logger.info('Certificate health check completed', {
        isValid: healthResult.isValid,
        warningCount: healthResult.warnings.length,
        errorCount: healthResult.errors.length,
        daysUntilExpiration: healthResult.daysUntilExpiration
      });

      // Log warnings and errors for debugging
      if (healthResult.warnings.length > 0) {
        logger.warn('Certificate health warnings', { warnings: healthResult.warnings });
      }
      
      if (healthResult.errors.length > 0) {
        logger.error('Certificate health errors', undefined, { errors: healthResult.errors });
      }
    }, 30000);

    it('should perform full iOS health check', async () => {
      const healthReport = await iosManagementTool.performHealthCheck();
      
      expect(healthReport).toHaveProperty('overall');
      expect(healthReport).toHaveProperty('platformApp');
      expect(healthReport).toHaveProperty('certificate');
      expect(healthReport).toHaveProperty('endpoints');
      expect(healthReport).toHaveProperty('recommendations');

      expect(['healthy', 'warning', 'critical']).toContain(healthReport.overall);

      logger.info('Full iOS health check completed', {
        overall: healthReport.overall,
        platformAppStatus: healthReport.platformApp.status,
        certificateStatus: healthReport.certificate.status,
        activeEndpoints: healthReport.endpoints.active,
        invalidEndpoints: healthReport.endpoints.invalid,
        recommendationCount: healthReport.recommendations.length
      });

      // Log recommendations for operational insights
      if (healthReport.recommendations.length > 0) {
        logger.info('Health check recommendations', { 
          recommendations: healthReport.recommendations 
        });
      }
    }, 60000);
  });

  describe('Real APNS Feedback Processing', () => {
    it('should process real APNS feedback service', async () => {
      const feedbackResult = await iosManagementTool.processAPNSFeedback();
      
      expect(feedbackResult).toHaveProperty('removedTokens');
      expect(feedbackResult).toHaveProperty('errors');
      expect(Array.isArray(feedbackResult.removedTokens)).toBe(true);
      expect(Array.isArray(feedbackResult.errors)).toBe(true);

      logger.info('APNS feedback processing completed', {
        removedTokenCount: feedbackResult.removedTokens.length,
        errorCount: feedbackResult.errors.length
      });

      // Log details about removed tokens (without exposing actual tokens)
      if (feedbackResult.removedTokens.length > 0) {
        logger.info('Invalid tokens removed during feedback processing', {
          count: feedbackResult.removedTokens.length,
          tokenPreviews: feedbackResult.removedTokens.map(token => 
            typeof token === 'string' ? `${token.substring(0, 8)}...` : 'unknown'
          )
        });
      }

      // Log any errors encountered
      if (feedbackResult.errors.length > 0) {
        logger.warn('Errors during feedback processing', { 
          errors: feedbackResult.errors 
        });
      }
    }, 45000);
  });

  describe('Real Device Registration Testing', () => {
    const testDeviceToken = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    let createdEndpointArn: string | undefined;

    afterEach(async () => {
      // Clean up any created test endpoints
      if (createdEndpointArn) {
        try {
          // Note: In a real implementation, you'd call deleteEndpoint
          // For now, we'll just log the cleanup intent
          logger.info('Test endpoint cleanup required', { 
            endpointArn: createdEndpointArn 
          });
        } catch (error) {
          logger.warn('Failed to clean up test endpoint', { 
            endpointArn: createdEndpointArn,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
        createdEndpointArn = undefined;
      }
    });

    it('should register test device with monitoring', async () => {
      const userId = `test-user-${Date.now()}`;
      
      try {
        const registration = await iosManagementTool.registerDeviceWithMonitoring(
          testDeviceToken, 
          userId
        );
        
        expect(registration).toHaveProperty('deviceToken', testDeviceToken);
        expect(registration).toHaveProperty('userId', userId);
        expect(registration).toHaveProperty('platformEndpointArn');
        expect(registration).toHaveProperty('active', true);
        expect(registration.platformEndpointArn).toMatch(/^arn:aws:sns:/);

        createdEndpointArn = registration.platformEndpointArn;

        logger.info('Test device registration successful', {
          userId,
          endpointArn: registration.platformEndpointArn,
          registrationDate: registration.registrationDate
        });

      } catch (error) {
        logger.error('Test device registration failed', error as Error, {
          userId,
          tokenPreview: `${testDeviceToken.substring(0, 8)}...`
        });
        throw error;
      }
    }, 30000);

    it('should handle invalid device token registration', async () => {
      const invalidToken = 'invalid-token-format';
      
      await expect(
        iosManagementTool.registerDeviceWithMonitoring(invalidToken)
      ).rejects.toThrow('Invalid device token format');

      logger.info('Invalid token registration properly rejected');
    });
  });

  describe('Real Alert Delivery with iOS Monitoring', () => {
    const mockCostAnalysis = {
      totalCost: 15.50,
      serviceBreakdown: {
        'Amazon Elastic Compute Cloud - Compute': 10.00,
        'Amazon Simple Storage Service': 3.50,
        'AWS Lambda': 2.00
      },
      period: {
        start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
        end: new Date().toISOString()
      },
      projectedMonthly: 31.00,
      currency: 'USD',
      lastUpdated: new Date().toISOString()
    };

    const mockAlertContext = {
      threshold: 10.00,
      exceedAmount: 5.50,
      percentageOver: 55.0,
      topServices: [
        { serviceName: 'Amazon Elastic Compute Cloud - Compute', cost: 10.00, percentage: 64.5 },
        { serviceName: 'Amazon Simple Storage Service', cost: 3.50, percentage: 22.6 },
        { serviceName: 'AWS Lambda', cost: 2.00, percentage: 12.9 }
      ],
      alertLevel: 'WARNING' as const
    };

    it('should send real alert with iOS monitoring', async () => {
      const iosConfig = {
        platformApplicationArn: testConfig.platformApplicationArn!,
        bundleId: testConfig.bundleId
      };

      try {
        const result = await alertTool.sendSpendAlertWithIOSMonitoring(
          mockCostAnalysis,
          mockAlertContext,
          testConfig.snsTopicArn!,
          iosConfig
        );

        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('channels');
        expect(result).toHaveProperty('iosDelivered');
        expect(result).toHaveProperty('fallbackUsed');
        expect(result).toHaveProperty('metrics');

        logger.info('Enhanced alert delivery completed', {
          success: result.success,
          channels: result.channels,
          iosDelivered: result.iosDelivered,
          fallbackUsed: result.fallbackUsed,
          deliveryTime: result.metrics.deliveryTime,
          retryCount: result.metrics.retryCount,
          payloadSize: result.metrics.payloadSize
        });

        if (result.errors.length > 0) {
          logger.warn('Alert delivery had errors', { errors: result.errors });
        }

      } catch (error) {
        logger.error('Enhanced alert delivery failed', error as Error);
        throw error;
      }
    }, 30000);

    it('should send regular alert without iOS config', async () => {
      try {
        await alertTool.sendSpendAlert(
          mockCostAnalysis,
          mockAlertContext,
          testConfig.snsTopicArn!
        );

        logger.info('Regular alert delivery (without iOS) completed successfully');

      } catch (error) {
        logger.error('Regular alert delivery failed', error as Error);
        throw error;
      }
    }, 30000);
  });

  describe('Real Metrics Collection', () => {
    it('should record iOS-specific metrics to CloudWatch', async () => {
      try {
        // Record various iOS metrics
        await metricsCollector.recordIOSNotification(5, true, 0);
        await metricsCollector.recordIOSDeviceRegistration(true);
        await metricsCollector.recordAPNSCertificateHealth(true, 300, 0, 0);
        await metricsCollector.recordIOSPayloadMetrics(1024, 250, 0);

        logger.info('iOS metrics recorded successfully to CloudWatch');

        // Wait a moment for metrics to be processed
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        logger.error('Failed to record iOS metrics', error as Error);
        throw error;
      }
    }, 15000);

    it('should record iOS error metrics', async () => {
      try {
        // Record error scenarios
        await metricsCollector.recordIOSNotification(3, false, 2);
        await metricsCollector.recordIOSDeviceRegistration(false, 'InvalidToken');
        await metricsCollector.recordAPNSCertificateHealth(false, 5, 1, 2);
        await metricsCollector.recordIOSFallbackUsage(['email', 'sms'], true);

        logger.info('iOS error metrics recorded successfully to CloudWatch');

        // Wait a moment for metrics to be processed
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        logger.error('Failed to record iOS error metrics', error as Error);
        throw error;
      }
    }, 15000);
  });

  describe('End-to-End iOS Monitoring Workflow', () => {
    it('should perform complete iOS monitoring workflow', async () => {
      const workflowStartTime = Date.now();
      
      try {
        logger.info('Starting end-to-end iOS monitoring workflow');

        // Step 1: Health check
        const healthReport = await iosManagementTool.performHealthCheck();
        logger.info('Health check completed', { overall: healthReport.overall });

        // Step 2: Process feedback
        const feedbackResult = await iosManagementTool.processAPNSFeedback();
        logger.info('Feedback processing completed', { 
          removedTokens: feedbackResult.removedTokens.length 
        });

        // Step 3: Validate certificate
        const certHealth = await iosManagementTool.validateAPNSCertificateHealth();
        logger.info('Certificate validation completed', { 
          isValid: certHealth.isValid 
        });

        // Step 4: Record comprehensive metrics
        await metricsCollector.recordExecutionDuration(
          'iOSMonitoringWorkflow',
          Date.now() - workflowStartTime,
          true
        );

        // Step 5: Send test alert if system is healthy
        if (healthReport.overall === 'healthy') {
          const iosConfig = {
            platformApplicationArn: testConfig.platformApplicationArn!,
            bundleId: testConfig.bundleId
          };

          const alertResult = await alertTool.sendSpendAlertWithIOSMonitoring(
            mockCostAnalysis,
            mockAlertContext,
            testConfig.snsTopicArn!,
            iosConfig
          );

          logger.info('Test alert sent', { success: alertResult.success });
        }

        const workflowDuration = Date.now() - workflowStartTime;
        logger.info('End-to-end iOS monitoring workflow completed successfully', {
          duration: workflowDuration,
          healthStatus: healthReport.overall,
          certificateValid: certHealth.isValid,
          invalidTokensRemoved: feedbackResult.removedTokens.length
        });

      } catch (error) {
        const workflowDuration = Date.now() - workflowStartTime;
        
        await metricsCollector.recordExecutionDuration(
          'iOSMonitoringWorkflow',
          workflowDuration,
          false
        );

        logger.error('End-to-end iOS monitoring workflow failed', error as Error, {
          duration: workflowDuration
        });
        
        throw error;
      }
    }, 120000); // 2 minute timeout for full workflow
  });
});

// Helper function to check if integration tests should run
function shouldRunIntegrationTests(): boolean {
  return !!(
    process.env.TEST_IOS_PLATFORM_APP_ARN &&
    process.env.TEST_SNS_TOPIC_ARN &&
    process.env.RUN_INTEGRATION_TESTS === 'true'
  );
}

// Skip all tests if integration test environment is not configured
if (!shouldRunIntegrationTests()) {
  describe.skip('iOS Monitoring Integration Tests', () => {
    it('should be skipped when integration test environment is not configured', () => {
      console.log('Integration tests skipped - set RUN_INTEGRATION_TESTS=true and provide required environment variables');
    });
  });
}