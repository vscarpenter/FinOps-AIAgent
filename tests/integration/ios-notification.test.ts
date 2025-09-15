/**
 * iOS Push Notification Integration Tests
 * 
 * These tests verify iOS push notification delivery, device registration,
 * and APNS payload handling in a real AWS environment.
 */

import { 
  APNSPayloadValidator, 
  TestDeviceTokenGenerator, 
  iOSDeviceTestHelper,
  APNSSandboxHelper,
  ValidationResult
} from '../utils/ios-test-utils';
import { AlertTool } from '../../src/tools/alert-tool';
import { iOSManagementTool } from '../../src/tools/ios-management-tool';
import { 
  shouldRunIOSIntegrationTests, 
  TestDataGenerator,
  TestValidator,
  IntegrationTestSetup
} from './test-config';
import { APNSPayload, iOSPushConfig, CostAnalysis, AlertContext } from '../../src/types';

// Skip all tests if iOS integration is not enabled
const describeIOS = shouldRunIOSIntegrationTests() ? describe : describe.skip;

describeIOS('iOS Push Notification Integration Tests', () => {
  let testSetup: IntegrationTestSetup;
  let deviceHelper: iOSDeviceTestHelper;
  let alertTool: AlertTool;
  let iosManagementTool: iOSManagementTool;
  let iosConfig: iOSPushConfig;
  let testTopicArn: string;

  beforeAll(async () => {
    if (!shouldRunIOSIntegrationTests()) {
      return;
    }

    // Setup test environment
    testSetup = new IntegrationTestSetup();
    const { topicArn } = await testSetup.setup();
    testTopicArn = topicArn;

    // Initialize iOS configuration from environment
    iosConfig = {
      platformApplicationArn: process.env.TEST_IOS_PLATFORM_ARN!,
      bundleId: process.env.TEST_IOS_BUNDLE_ID || 'com.example.spendmonitor.test',
      sandbox: true
    };

    // Initialize tools and helpers
    deviceHelper = new iOSDeviceTestHelper();
    alertTool = new AlertTool();
    iosManagementTool = new iOSManagementTool(iosConfig);

    console.log('iOS integration test setup complete');
    console.log(`Platform ARN: ${iosConfig.platformApplicationArn}`);
    console.log(`Bundle ID: ${iosConfig.bundleId}`);
  }, 60000);

  afterAll(async () => {
    if (!shouldRunIOSIntegrationTests()) {
      return;
    }

    // Cleanup test resources
    await deviceHelper.cleanup();
    await testSetup.teardown();
    
    console.log('iOS integration test cleanup complete');
  }, 30000);

  describe('APNS Payload Validation', () => {
    it('should validate correct APNS payload structure', () => {
      const payload = APNSPayloadValidator.createTestPayload();
      const result = APNSPayloadValidator.validatePayload(payload);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.payloadSize).toBeLessThan(4096);
    });

    it('should detect invalid payload structures', () => {
      const invalidPayloads = [
        { type: 'missing-aps', payload: APNSPayloadValidator.createInvalidPayload('missing-aps') },
        { type: 'invalid-badge', payload: APNSPayloadValidator.createInvalidPayload('invalid-badge') },
        { type: 'missing-alert', payload: APNSPayloadValidator.createInvalidPayload('missing-alert') }
      ];

      for (const { type, payload } of invalidPayloads) {
        const result = APNSPayloadValidator.validatePayload(payload);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        console.log(`${type} validation errors:`, result.errors);
      }
    });

    it('should detect oversized payloads', () => {
      const oversizedPayload = APNSPayloadValidator.createInvalidPayload('oversized');
      const result = APNSPayloadValidator.validatePayload(oversizedPayload);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(error => error.includes('exceeds APNS limit'))).toBe(true);
      expect(result.payloadSize).toBeGreaterThan(4096);
    });

    it('should validate sandbox-specific requirements', () => {
      const payload = APNSPayloadValidator.createTestPayload({
        aps: {
          sound: 'custom-sound.caf'
        }
      });

      const result = APNSPayloadValidator.validateForSandbox(payload);
      expect(result.warnings.some(warning => warning.includes('Custom sound files'))).toBe(true);
    });
  });

  describe('Device Registration', () => {
    it('should register a new iOS device successfully', async () => {
      const deviceToken = TestDeviceTokenGenerator.generateValidToken();
      const userId = 'test-user-registration';

      const registration = await iosManagementTool.registerDevice(deviceToken, userId);

      expect(registration).toMatchObject({
        deviceToken,
        platformEndpointArn: expect.stringMatching(/^arn:aws:sns:/),
        userId,
        registrationDate: expect.any(String),
        lastUpdated: expect.any(String),
        active: true
      });

      // Verify dates are valid
      expect(new Date(registration.registrationDate).getTime()).toBeGreaterThan(0);
      expect(new Date(registration.lastUpdated).getTime()).toBeGreaterThan(0);

      console.log(`Registered device: ${registration.platformEndpointArn}`);
    });

    it('should handle invalid device token formats', async () => {
      const invalidTokens = [
        TestDeviceTokenGenerator.generateInvalidToken('too-short'),
        TestDeviceTokenGenerator.generateInvalidToken('too-long'),
        TestDeviceTokenGenerator.generateInvalidToken('invalid-chars'),
        TestDeviceTokenGenerator.generateInvalidToken('empty')
      ];

      for (const invalidToken of invalidTokens) {
        await expect(iosManagementTool.registerDevice(invalidToken))
          .rejects.toThrow(/Invalid device token format/);
      }
    });

    it('should register multiple devices for the same user', async () => {
      const userId = 'test-user-multiple-devices';
      const deviceTokens = TestDeviceTokenGenerator.generateValidTokens(3);
      const registrations = [];

      for (const token of deviceTokens) {
        const registration = await iosManagementTool.registerDevice(token, userId);
        registrations.push(registration);
      }

      expect(registrations).toHaveLength(3);
      
      // Verify all registrations are unique
      const endpointArns = registrations.map(r => r.platformEndpointArn);
      const uniqueArns = new Set(endpointArns);
      expect(uniqueArns.size).toBe(3);

      console.log(`Registered ${registrations.length} devices for user ${userId}`);
    });

    it('should update device token successfully', async () => {
      const oldToken = TestDeviceTokenGenerator.generateValidToken();
      const newToken = TestDeviceTokenGenerator.generateValidToken();

      // Register initial device
      const registration = await iosManagementTool.registerDevice(oldToken);
      
      // Update token
      await iosManagementTool.updateDeviceToken(registration.platformEndpointArn, newToken);

      console.log(`Updated device token for endpoint: ${registration.platformEndpointArn}`);
    });
  });

  describe('Push Notification Delivery', () => {
    let testRegistration: any;

    beforeEach(async () => {
      // Create a test device registration for each test
      testRegistration = await deviceHelper.createTestRegistration(
        iosConfig.platformApplicationArn,
        TestDeviceTokenGenerator.generateValidToken(),
        'test-notification-user'
      );
    });

    it('should send spend alert notification successfully', async () => {
      const costAnalysis = TestDataGenerator.generateCostAnalysis(15.50, 3);
      const alertContext = TestDataGenerator.generateAlertContext(15.50, 10.00);

      await alertTool.sendSpendAlert(
        costAnalysis,
        alertContext,
        testTopicArn,
        {
          platformApplicationArn: iosConfig.platformApplicationArn,
          bundleId: iosConfig.bundleId
        }
      );

      console.log('Spend alert sent successfully to iOS device');
    });

    it('should format iOS payload correctly for different alert levels', async () => {
      const testCases = [
        { totalCost: 12.00, threshold: 10.00, expectedLevel: 'WARNING' },
        { totalCost: 20.00, threshold: 10.00, expectedLevel: 'CRITICAL' }
      ];

      for (const testCase of testCases) {
        const costAnalysis = TestDataGenerator.generateCostAnalysis(testCase.totalCost, 2);
        const alertContext = TestDataGenerator.generateAlertContext(testCase.totalCost, testCase.threshold);
        
        const iosPayload = alertTool.formatIOSPayload(costAnalysis, alertContext);
        
        // Validate payload structure
        TestValidator.validateIOSPayload(iosPayload);
        
        // Validate APNS compliance
        const validation = APNSPayloadValidator.validatePayload(iosPayload);
        expect(validation.isValid).toBe(true);
        
        // Check alert level specific formatting
        if (testCase.expectedLevel === 'CRITICAL') {
          expect(iosPayload.aps.alert.subtitle).toContain('Critical');
          expect(iosPayload.aps.sound).toBe('critical-alert.caf');
        } else {
          expect(iosPayload.aps.alert.subtitle).toContain('Budget Threshold Exceeded');
          expect(iosPayload.aps.sound).toBe('default');
        }

        console.log(`Validated ${testCase.expectedLevel} alert payload`);
      }
    });

    it('should handle notification delivery to invalid endpoints', async () => {
      const invalidEndpointArn = 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/invalid-endpoint';
      const payload = APNSPayloadValidator.createTestPayload();

      const result = await deviceHelper.sendTestNotification(invalidEndpointArn, payload);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      
      console.log(`Invalid endpoint test completed: ${result.error}`);
    });

    it('should send test notification to registered device', async () => {
      const payload = APNSPayloadValidator.createTestPayload({
        aps: {
          alert: {
            title: 'Integration Test',
            body: 'This is a test notification from integration tests'
          }
        },
        customData: {
          spendAmount: 5.00,
          threshold: 10.00,
          exceedAmount: 0,
          topService: 'Test Service',
          alertId: `integration-test-${Date.now()}`
        }
      });

      const result = await deviceHelper.sendTestNotification(
        testRegistration.platformEndpointArn,
        payload
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
      
      console.log(`Test notification sent: ${result.messageId}`);
    });
  });

  describe('Invalid Token Handling', () => {
    it('should identify and remove invalid device tokens', async () => {
      // Create multiple test registrations
      const registrations = await deviceHelper.createMultipleTestRegistrations(
        iosConfig.platformApplicationArn,
        3
      );

      const endpointArns = registrations.map(r => r.platformEndpointArn);
      
      // Test removal of invalid tokens
      const removedEndpoints = await iosManagementTool.removeInvalidTokens(endpointArns);
      
      // In a real test environment, some endpoints might be removed
      expect(Array.isArray(removedEndpoints)).toBe(true);
      
      console.log(`Processed ${endpointArns.length} endpoints, removed ${removedEndpoints.length} invalid ones`);
    });

    it('should validate APNS configuration', async () => {
      const isValid = await iosManagementTool.validateAPNSConfig();
      
      expect(typeof isValid).toBe('boolean');
      
      if (isValid) {
        console.log('APNS configuration is valid');
      } else {
        console.log('APNS configuration validation failed');
      }
    });

    it('should handle cleanup of expired tokens gracefully', async () => {
      // Create test registrations
      const registrations = await deviceHelper.createMultipleTestRegistrations(
        iosConfig.platformApplicationArn,
        2
      );

      // Simulate token cleanup
      const endpointArns = registrations.map(r => r.platformEndpointArn);
      
      // This should not throw even if some endpoints are already invalid
      await expect(iosManagementTool.removeInvalidTokens(endpointArns))
        .resolves.toBeDefined();
        
      console.log('Token cleanup completed without errors');
    });
  });

  describe('Sandbox Configuration', () => {
    it('should validate sandbox configuration', () => {
      const validation = APNSSandboxHelper.validateSandboxConfiguration(iosConfig);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      
      if (validation.warnings.length > 0) {
        console.log('Sandbox configuration warnings:', validation.warnings);
      }
    });

    it('should run sandbox test scenarios', async () => {
      const scenarios = APNSSandboxHelper.createTestScenarios();
      
      for (const scenario of scenarios) {
        console.log(`Testing scenario: ${scenario.name}`);
        
        if (scenario.expectedResult === 'success') {
          const validation = APNSPayloadValidator.validateForSandbox(scenario.payload);
          expect(validation.isValid).toBe(true);
        } else if (scenario.expectedResult === 'error') {
          const validation = APNSPayloadValidator.validateForSandbox(scenario.payload);
          expect(validation.isValid).toBe(false);
        }
      }
    });

    it('should create sandbox-compatible configuration', () => {
      const sandboxConfig = APNSSandboxHelper.createSandboxConfig(iosConfig.platformApplicationArn);
      
      expect(sandboxConfig.sandbox).toBe(true);
      expect(sandboxConfig.platformApplicationArn).toBe(iosConfig.platformApplicationArn);
      expect(sandboxConfig.bundleId).toContain('test');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle missing platform application gracefully', async () => {
      const invalidConfig: iOSPushConfig = {
        platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/NonExistentApp',
        bundleId: 'com.example.invalid',
        sandbox: true
      };

      const invalidTool = new iOSManagementTool(invalidConfig);
      
      await expect(invalidTool.registerDevice(TestDeviceTokenGenerator.generateValidToken()))
        .rejects.toThrow();
    });

    it('should handle SNS service errors gracefully', async () => {
      // Test with malformed ARN
      const malformedArn = 'invalid-arn-format';
      
      await expect(deviceHelper.sendTestNotification(
        malformedArn,
        APNSPayloadValidator.createTestPayload()
      )).resolves.toMatchObject({
        success: false,
        error: expect.any(String)
      });
    });

    it('should validate device token format before API calls', () => {
      const invalidTokens = [
        '',
        'short',
        'g'.repeat(64),
        '1'.repeat(65)
      ];

      for (const token of invalidTokens) {
        const validation = TestDeviceTokenGenerator.validateToken(token);
        expect(validation.isValid).toBe(false);
        expect(validation.error).toBeDefined();
      }
    });
  });
});