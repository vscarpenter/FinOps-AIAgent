/**
 * iOS Notification Performance Tests
 * 
 * These tests measure the performance of iOS push notification operations
 * including device registration, payload formatting, and notification delivery.
 */

import { 
  iOSPerformanceTestHelper,
  TestDeviceTokenGenerator,
  APNSPayloadValidator,
  iOSDeviceTestHelper
} from '../utils/ios-test-utils';
import { AlertTool } from '../../src/tools/alert-tool';
import { iOSManagementTool } from '../../src/tools/ios-management-tool';
import { 
  shouldRunIOSIntegrationTests,
  TestDataGenerator,
  IntegrationTestSetup,
  DEFAULT_INTEGRATION_CONFIG
} from './test-config';
import { iOSPushConfig } from '../../src/types';

// Skip all tests if iOS integration is not enabled
const describeIOS = shouldRunIOSIntegrationTests() ? describe : describe.skip;

describeIOS('iOS Notification Performance Tests', () => {
  let performanceHelper: iOSPerformanceTestHelper;
  let deviceHelper: iOSDeviceTestHelper;
  let testSetup: IntegrationTestSetup;
  let alertTool: AlertTool;
  let iosManagementTool: iOSManagementTool;
  let iosConfig: iOSPushConfig;
  let testTopicArn: string;

  // Performance thresholds (in milliseconds)
  const PERFORMANCE_THRESHOLDS = {
    deviceRegistration: 3000,      // 3 seconds max for device registration
    payloadFormatting: 100,        // 100ms max for payload formatting
    notificationSend: 5000,        // 5 seconds max for notification delivery
    batchRegistration: 10000,      // 10 seconds max for batch operations
    tokenValidation: 50,           // 50ms max for token validation
    payloadValidation: 100         // 100ms max for payload validation
  };

  beforeAll(async () => {
    if (!shouldRunIOSIntegrationTests()) {
      return;
    }

    // Setup test environment
    testSetup = new IntegrationTestSetup();
    const { topicArn } = await testSetup.setup();
    testTopicArn = topicArn;

    // Initialize iOS configuration
    iosConfig = {
      platformApplicationArn: process.env.TEST_IOS_PLATFORM_ARN!,
      bundleId: process.env.TEST_IOS_BUNDLE_ID || 'com.example.spendmonitor.test',
      sandbox: true
    };

    // Initialize tools and helpers
    performanceHelper = new iOSPerformanceTestHelper();
    deviceHelper = new iOSDeviceTestHelper();
    alertTool = new AlertTool();
    iosManagementTool = new iOSManagementTool(iosConfig);

    console.log('iOS performance test setup complete');
  }, 60000);

  afterAll(async () => {
    if (!shouldRunIOSIntegrationTests()) {
      return;
    }

    // Print performance summary
    const allStats = performanceHelper.getAllStats();
    console.log('\n=== iOS Performance Test Summary ===');
    
    for (const [operation, stats] of Object.entries(allStats)) {
      console.log(`${operation}:`);
      console.log(`  Count: ${stats.count}`);
      console.log(`  Average: ${stats.average.toFixed(2)}ms`);
      console.log(`  Min: ${stats.min}ms, Max: ${stats.max}ms`);
      console.log(`  P95: ${stats.p95}ms, P99: ${stats.p99}ms`);
    }
    console.log('=====================================\n');

    // Cleanup test resources
    await deviceHelper.cleanup();
    await testSetup.teardown();
  }, 30000);

  beforeEach(() => {
    // Reset performance measurements for each test
    performanceHelper.reset();
  });

  describe('Device Registration Performance', () => {
    it('should register single device within performance threshold', async () => {
      const deviceToken = TestDeviceTokenGenerator.generateValidToken();
      
      const { result, duration } = await performanceHelper.measureOperation(
        'single-device-registration',
        () => iosManagementTool.registerDevice(deviceToken, 'perf-test-user')
      );

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.deviceRegistration);
      expect(result.deviceToken).toBe(deviceToken);
      
      console.log(`Single device registration: ${duration}ms`);
    });

    it('should handle batch device registration efficiently', async () => {
      const batchSize = 5;
      const deviceTokens = TestDeviceTokenGenerator.generateValidTokens(batchSize);
      
      const { result, duration } = await performanceHelper.measureOperation(
        'batch-device-registration',
        async () => {
          const registrations = [];
          for (let i = 0; i < deviceTokens.length; i++) {
            const registration = await iosManagementTool.registerDevice(
              deviceTokens[i],
              `perf-batch-user-${i}`
            );
            registrations.push(registration);
          }
          return registrations;
        }
      );

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.batchRegistration);
      expect(result).toHaveLength(batchSize);
      
      const avgPerDevice = duration / batchSize;
      console.log(`Batch registration (${batchSize} devices): ${duration}ms (${avgPerDevice.toFixed(2)}ms per device)`);
    });

    it('should validate device tokens quickly', async () => {
      const validTokens = TestDeviceTokenGenerator.generateValidTokens(10);
      const invalidTokens = [
        TestDeviceTokenGenerator.generateInvalidToken('too-short'),
        TestDeviceTokenGenerator.generateInvalidToken('too-long'),
        TestDeviceTokenGenerator.generateInvalidToken('invalid-chars')
      ];

      // Test valid token validation performance
      const { duration: validDuration } = await performanceHelper.measureOperation(
        'valid-token-validation',
        async () => {
          for (const token of validTokens) {
            TestDeviceTokenGenerator.validateToken(token);
          }
        }
      );

      // Test invalid token validation performance
      const { duration: invalidDuration } = await performanceHelper.measureOperation(
        'invalid-token-validation',
        async () => {
          for (const token of invalidTokens) {
            TestDeviceTokenGenerator.validateToken(token);
          }
        }
      );

      expect(validDuration).toBeLessThan(PERFORMANCE_THRESHOLDS.tokenValidation);
      expect(invalidDuration).toBeLessThan(PERFORMANCE_THRESHOLDS.tokenValidation);
      
      console.log(`Token validation - Valid: ${validDuration}ms, Invalid: ${invalidDuration}ms`);
    });

    it('should update device tokens efficiently', async () => {
      // First register a device
      const oldToken = TestDeviceTokenGenerator.generateValidToken();
      const registration = await iosManagementTool.registerDevice(oldToken);
      
      const newToken = TestDeviceTokenGenerator.generateValidToken();
      
      const { duration } = await performanceHelper.measureOperation(
        'device-token-update',
        () => iosManagementTool.updateDeviceToken(registration.platformEndpointArn, newToken)
      );

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.deviceRegistration);
      
      console.log(`Device token update: ${duration}ms`);
    });
  });

  describe('Payload Formatting Performance', () => {
    it('should format iOS payloads quickly', async () => {
      const costAnalysis = TestDataGenerator.generateCostAnalysis(25.50, 5);
      const alertContext = TestDataGenerator.generateAlertContext(25.50, 10.00);
      
      const { result, duration } = await performanceHelper.measureOperation(
        'ios-payload-formatting',
        () => Promise.resolve(alertTool.formatIOSPayload(costAnalysis, alertContext))
      );

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.payloadFormatting);
      expect(result.aps.alert.title).toBeDefined();
      
      console.log(`iOS payload formatting: ${duration}ms`);
    });

    it('should validate payloads efficiently', async () => {
      const payloads = Array.from({ length: 10 }, () => 
        APNSPayloadValidator.createTestPayload()
      );
      
      const { duration } = await performanceHelper.measureOperation(
        'payload-validation-batch',
        async () => {
          for (const payload of payloads) {
            APNSPayloadValidator.validatePayload(payload);
          }
        }
      );

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.payloadValidation);
      
      const avgPerPayload = duration / payloads.length;
      console.log(`Payload validation (${payloads.length} payloads): ${duration}ms (${avgPerPayload.toFixed(2)}ms per payload)`);
    });

    it('should handle large payload validation efficiently', async () => {
      const largePayload = APNSPayloadValidator.createTestPayload({
        customData: {
          spendAmount: 999.99,
          threshold: 100.00,
          exceedAmount: 899.99,
          topService: 'Amazon Elastic Compute Cloud - Compute Instance Running',
          alertId: `large-performance-test-alert-${Date.now()}-with-very-long-identifier-for-testing-purposes`
        }
      });
      
      const { result, duration } = await performanceHelper.measureOperation(
        'large-payload-validation',
        () => Promise.resolve(APNSPayloadValidator.validatePayload(largePayload))
      );

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.payloadValidation);
      expect(result.isValid).toBe(true);
      
      console.log(`Large payload validation: ${duration}ms (${result.payloadSize} bytes)`);
    });
  });

  describe('Notification Delivery Performance', () => {
    let testRegistration: any;

    beforeEach(async () => {
      // Create a test device for each notification test
      testRegistration = await deviceHelper.createTestRegistration(
        iosConfig.platformApplicationArn,
        TestDeviceTokenGenerator.generateValidToken(),
        'perf-notification-user'
      );
    });

    it('should send notifications within performance threshold', async () => {
      const payload = APNSPayloadValidator.createTestPayload({
        aps: {
          alert: {
            title: 'Performance Test Alert',
            body: 'Testing notification delivery performance'
          }
        }
      });
      
      const { result, duration } = await performanceHelper.measureOperation(
        'notification-delivery',
        () => deviceHelper.sendTestNotification(testRegistration.platformEndpointArn, payload)
      );

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.notificationSend);
      expect(result.success).toBe(true);
      
      console.log(`Notification delivery: ${duration}ms`);
    });

    it('should handle multiple notifications efficiently', async () => {
      const notificationCount = 3;
      const payload = APNSPayloadValidator.createTestPayload();
      
      const { duration } = await performanceHelper.measureOperation(
        'multiple-notifications',
        async () => {
          const promises = [];
          for (let i = 0; i < notificationCount; i++) {
            promises.push(
              deviceHelper.sendTestNotification(testRegistration.platformEndpointArn, {
                ...payload,
                customData: {
                  ...payload.customData,
                  alertId: `perf-test-${i}-${Date.now()}`
                }
              })
            );
          }
          return Promise.all(promises);
        }
      );

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.notificationSend * notificationCount);
      
      const avgPerNotification = duration / notificationCount;
      console.log(`Multiple notifications (${notificationCount}): ${duration}ms (${avgPerNotification.toFixed(2)}ms per notification)`);
    });

    it('should send spend alerts efficiently', async () => {
      const costAnalysis = TestDataGenerator.generateCostAnalysis(15.50, 3);
      const alertContext = TestDataGenerator.generateAlertContext(15.50, 10.00);
      
      const { duration } = await performanceHelper.measureOperation(
        'spend-alert-delivery',
        () => alertTool.sendSpendAlert(
          costAnalysis,
          alertContext,
          testTopicArn,
          {
            platformApplicationArn: iosConfig.platformApplicationArn,
            bundleId: iosConfig.bundleId
          }
        )
      );

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.notificationSend);
      
      console.log(`Spend alert delivery: ${duration}ms`);
    });
  });

  describe('Bulk Operations Performance', () => {
    it('should handle bulk device cleanup efficiently', async () => {
      // Create multiple test devices
      const deviceCount = 5;
      const registrations = await deviceHelper.createMultipleTestRegistrations(
        iosConfig.platformApplicationArn,
        deviceCount
      );
      
      const endpointArns = registrations.map(r => r.platformEndpointArn);
      
      const { result, duration } = await performanceHelper.measureOperation(
        'bulk-device-cleanup',
        () => iosManagementTool.removeInvalidTokens(endpointArns)
      );

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.batchRegistration);
      expect(Array.isArray(result)).toBe(true);
      
      console.log(`Bulk device cleanup (${deviceCount} devices): ${duration}ms`);
    });

    it('should validate APNS configuration quickly', async () => {
      const { result, duration } = await performanceHelper.measureOperation(
        'apns-config-validation',
        () => iosManagementTool.validateAPNSConfig()
      );

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.deviceRegistration);
      expect(typeof result).toBe('boolean');
      
      console.log(`APNS configuration validation: ${duration}ms`);
    });
  });

  describe('Memory and Resource Usage', () => {
    it('should handle large numbers of payload validations without memory issues', async () => {
      const payloadCount = 100;
      const startMemory = process.memoryUsage();
      
      const { duration } = await performanceHelper.measureOperation(
        'memory-stress-test',
        async () => {
          for (let i = 0; i < payloadCount; i++) {
            const payload = APNSPayloadValidator.createTestPayload({
              customData: {
                spendAmount: Math.random() * 100,
                threshold: 10.00,
                exceedAmount: Math.random() * 50,
                topService: `Test Service ${i}`,
                alertId: `stress-test-${i}-${Date.now()}`
              }
            });
            
            APNSPayloadValidator.validatePayload(payload);
            
            // Occasionally force garbage collection if available
            if (i % 20 === 0 && global.gc) {
              global.gc();
            }
          }
        }
      );

      const endMemory = process.memoryUsage();
      const memoryIncrease = endMemory.heapUsed - startMemory.heapUsed;
      
      console.log(`Memory stress test (${payloadCount} validations): ${duration}ms`);
      console.log(`Memory increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)} MB`);
      
      // Memory increase should be reasonable (less than 50MB for 100 operations)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });

    it('should clean up resources properly after operations', async () => {
      const initialHandles = process._getActiveHandles().length;
      
      // Perform various operations
      const deviceToken = TestDeviceTokenGenerator.generateValidToken();
      await iosManagementTool.registerDevice(deviceToken);
      
      const payload = APNSPayloadValidator.createTestPayload();
      APNSPayloadValidator.validatePayload(payload);
      
      // Allow some time for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const finalHandles = process._getActiveHandles().length;
      
      console.log(`Resource handles - Initial: ${initialHandles}, Final: ${finalHandles}`);
      
      // Should not have significantly more handles (allowing for some variance)
      expect(finalHandles).toBeLessThanOrEqual(initialHandles + 5);
    });
  });

  describe('Performance Regression Detection', () => {
    it('should maintain consistent performance across multiple runs', async () => {
      const runCount = 5;
      const durations: number[] = [];
      
      for (let i = 0; i < runCount; i++) {
        const deviceToken = TestDeviceTokenGenerator.generateValidToken();
        
        const { duration } = await performanceHelper.measureOperation(
          `consistency-test-run-${i}`,
          () => iosManagementTool.registerDevice(deviceToken, `consistency-user-${i}`)
        );
        
        durations.push(duration);
      }
      
      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      const maxDeviation = Math.max(...durations.map(d => Math.abs(d - avgDuration)));
      const deviationPercentage = (maxDeviation / avgDuration) * 100;
      
      console.log(`Performance consistency test:`);
      console.log(`  Average: ${avgDuration.toFixed(2)}ms`);
      console.log(`  Max deviation: ${maxDeviation.toFixed(2)}ms (${deviationPercentage.toFixed(1)}%)`);
      console.log(`  Durations: ${durations.map(d => d.toFixed(0)).join(', ')}ms`);
      
      // Performance should be consistent (max deviation < 100% of average)
      expect(deviationPercentage).toBeLessThan(100);
      
      // All runs should be within threshold
      for (const duration of durations) {
        expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.deviceRegistration);
      }
    });
  });
});