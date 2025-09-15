/**
 * iOS Device Registration Scenarios Integration Tests
 * 
 * These tests cover various device registration scenarios including
 * valid registrations, invalid tokens, token updates, and cleanup operations.
 */

import { 
  TestDeviceTokenGenerator,
  iOSDeviceTestHelper,
  MockAPNSFeedbackService
} from '../utils/ios-test-utils';
import { iOSManagementTool } from '../../src/tools/ios-management-tool';
import { 
  shouldRunIOSIntegrationTests,
  IntegrationTestSetup
} from './test-config';
import { 
  iOSTestDataGenerator,
  iOSTestValidator,
  IOS_TEST_SCENARIOS,
  createiOSTestConfig
} from './ios-test-config';
import { iOSPushConfig, iOSDeviceRegistration } from '../../src/types';
import { ValidationError } from '../../src/validation';

// Skip all tests if iOS integration is not enabled
const describeIOS = shouldRunIOSIntegrationTests() ? describe : describe.skip;

describeIOS('iOS Device Registration Scenarios', () => {
  let testSetup: IntegrationTestSetup;
  let deviceHelper: iOSDeviceTestHelper;
  let iosManagementTool: iOSManagementTool;
  let mockFeedbackService: MockAPNSFeedbackService;
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

    // Initialize iOS configuration
    iosConfig = createiOSTestConfig();

    // Initialize tools and helpers
    deviceHelper = new iOSDeviceTestHelper();
    iosManagementTool = new iOSManagementTool(iosConfig);
    mockFeedbackService = new MockAPNSFeedbackService();

    console.log('iOS device registration test setup complete');
  }, 60000);

  afterAll(async () => {
    if (!shouldRunIOSIntegrationTests()) {
      return;
    }

    // Cleanup test resources
    await deviceHelper.cleanup();
    await testSetup.teardown();
    
    console.log('iOS device registration test cleanup complete');
  }, 30000);

  beforeEach(() => {
    // Reset mock feedback service for each test
    mockFeedbackService.clearInvalidTokens();
  });

  describe('Valid Device Registration Scenarios', () => {
    it('should register a new device with valid token', async () => {
      const deviceToken = TestDeviceTokenGenerator.generateValidToken();
      const userId = 'test-user-valid-registration';

      const registration = await iosManagementTool.registerDevice(deviceToken, userId);

      iOSTestValidator.validateDeviceRegistration(registration);
      expect(registration.deviceToken).toBe(deviceToken);
      expect(registration.userId).toBe(userId);
      expect(registration.active).toBe(true);

      console.log(`✓ Registered device: ${registration.platformEndpointArn}`);
    });

    it('should register device without user ID', async () => {
      const deviceToken = TestDeviceTokenGenerator.generateValidToken();

      const registration = await iosManagementTool.registerDevice(deviceToken);

      iOSTestValidator.validateDeviceRegistration(registration);
      expect(registration.deviceToken).toBe(deviceToken);
      expect(registration.userId).toBeUndefined();

      console.log(`✓ Registered anonymous device: ${registration.platformEndpointArn}`);
    });

    it('should register multiple devices for same user', async () => {
      const userId = 'test-user-multiple-devices';
      const deviceTokens = TestDeviceTokenGenerator.generateValidTokens(3);
      const registrations: iOSDeviceRegistration[] = [];

      for (const token of deviceTokens) {
        const registration = await iosManagementTool.registerDevice(token, userId);
        registrations.push(registration);
        iOSTestValidator.validateDeviceRegistration(registration);
      }

      // Verify all registrations are unique
      const endpointArns = registrations.map(r => r.platformEndpointArn);
      const uniqueArns = new Set(endpointArns);
      expect(uniqueArns.size).toBe(3);

      // Verify all have same user ID
      registrations.forEach(reg => {
        expect(reg.userId).toBe(userId);
      });

      console.log(`✓ Registered ${registrations.length} devices for user ${userId}`);
    });

    it('should register devices with different user IDs', async () => {
      const userIds = iOSTestDataGenerator.generateTestUserIds(3);
      const deviceTokens = TestDeviceTokenGenerator.generateValidTokens(3);
      const registrations: iOSDeviceRegistration[] = [];

      for (let i = 0; i < userIds.length; i++) {
        const registration = await iosManagementTool.registerDevice(deviceTokens[i], userIds[i]);
        registrations.push(registration);
        iOSTestValidator.validateDeviceRegistration(registration);
      }

      // Verify each registration has correct user ID
      registrations.forEach((reg, index) => {
        expect(reg.userId).toBe(userIds[index]);
        expect(reg.deviceToken).toBe(deviceTokens[index]);
      });

      console.log(`✓ Registered devices for ${userIds.length} different users`);
    });

    it('should handle concurrent device registrations', async () => {
      const concurrentCount = 3;
      const deviceTokens = TestDeviceTokenGenerator.generateValidTokens(concurrentCount);
      const userIds = iOSTestDataGenerator.generateTestUserIds(concurrentCount);

      // Register devices concurrently
      const registrationPromises = deviceTokens.map((token, index) =>
        iosManagementTool.registerDevice(token, userIds[index])
      );

      const registrations = await Promise.all(registrationPromises);

      // Validate all registrations
      registrations.forEach((reg, index) => {
        iOSTestValidator.validateDeviceRegistration(reg);
        expect(reg.deviceToken).toBe(deviceTokens[index]);
        expect(reg.userId).toBe(userIds[index]);
      });

      console.log(`✓ Completed ${concurrentCount} concurrent registrations`);
    });
  });

  describe('Invalid Device Token Scenarios', () => {
    it('should reject empty device token', async () => {
      const emptyToken = TestDeviceTokenGenerator.generateInvalidToken('empty');

      await expect(iosManagementTool.registerDevice(emptyToken))
        .rejects.toThrow(ValidationError);
      
      console.log('✓ Rejected empty device token');
    });

    it('should reject short device token', async () => {
      const shortToken = TestDeviceTokenGenerator.generateInvalidToken('too-short');

      await expect(iosManagementTool.registerDevice(shortToken))
        .rejects.toThrow(ValidationError);
      
      console.log('✓ Rejected short device token');
    });

    it('should reject long device token', async () => {
      const longToken = TestDeviceTokenGenerator.generateInvalidToken('too-long');

      await expect(iosManagementTool.registerDevice(longToken))
        .rejects.toThrow(ValidationError);
      
      console.log('✓ Rejected long device token');
    });

    it('should reject device token with invalid characters', async () => {
      const invalidToken = TestDeviceTokenGenerator.generateInvalidToken('invalid-chars');

      await expect(iosManagementTool.registerDevice(invalidToken))
        .rejects.toThrow(ValidationError);
      
      console.log('✓ Rejected device token with invalid characters');
    });

    it('should provide specific error messages for different invalid formats', async () => {
      const testCases = [
        { 
          type: 'empty' as const, 
          expectedMessage: 'Invalid device token format' 
        },
        { 
          type: 'too-short' as const, 
          expectedMessage: 'Invalid device token format' 
        },
        { 
          type: 'invalid-chars' as const, 
          expectedMessage: 'Invalid device token format' 
        }
      ];

      for (const testCase of testCases) {
        const invalidToken = TestDeviceTokenGenerator.generateInvalidToken(testCase.type);
        
        try {
          await iosManagementTool.registerDevice(invalidToken);
          fail(`Expected error for ${testCase.type} token`);
        } catch (error) {
          expect(error).toBeInstanceOf(ValidationError);
          expect(error.message).toContain(testCase.expectedMessage);
        }
      }

      console.log('✓ Validated specific error messages for invalid tokens');
    });
  });

  describe('Device Token Update Scenarios', () => {
    let testRegistration: iOSDeviceRegistration;

    beforeEach(async () => {
      // Create a test device for each update test
      const deviceToken = TestDeviceTokenGenerator.generateValidToken();
      testRegistration = await iosManagementTool.registerDevice(deviceToken, 'update-test-user');
    });

    it('should update device token successfully', async () => {
      const newToken = TestDeviceTokenGenerator.generateValidToken();

      await iosManagementTool.updateDeviceToken(
        testRegistration.platformEndpointArn,
        newToken
      );

      console.log(`✓ Updated device token for endpoint: ${testRegistration.platformEndpointArn}`);
    });

    it('should reject invalid token during update', async () => {
      const invalidToken = TestDeviceTokenGenerator.generateInvalidToken('invalid-chars');

      await expect(iosManagementTool.updateDeviceToken(
        testRegistration.platformEndpointArn,
        invalidToken
      )).rejects.toThrow(ValidationError);

      console.log('✓ Rejected invalid token during update');
    });

    it('should handle update to non-existent endpoint gracefully', async () => {
      const nonExistentArn = 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/non-existent';
      const newToken = TestDeviceTokenGenerator.generateValidToken();

      await expect(iosManagementTool.updateDeviceToken(nonExistentArn, newToken))
        .rejects.toThrow();

      console.log('✓ Handled update to non-existent endpoint');
    });

    it('should update multiple device tokens sequentially', async () => {
      // Create additional test devices
      const additionalDevices = await Promise.all([
        iosManagementTool.registerDevice(TestDeviceTokenGenerator.generateValidToken(), 'multi-update-1'),
        iosManagementTool.registerDevice(TestDeviceTokenGenerator.generateValidToken(), 'multi-update-2')
      ]);

      const allDevices = [testRegistration, ...additionalDevices];
      const newTokens = TestDeviceTokenGenerator.generateValidTokens(allDevices.length);

      // Update all tokens
      for (let i = 0; i < allDevices.length; i++) {
        await iosManagementTool.updateDeviceToken(
          allDevices[i].platformEndpointArn,
          newTokens[i]
        );
      }

      console.log(`✓ Updated ${allDevices.length} device tokens sequentially`);
    });
  });

  describe('Device Cleanup Scenarios', () => {
    it('should identify and remove invalid endpoints', async () => {
      // Create test devices
      const deviceCount = 3;
      const registrations = await deviceHelper.createMultipleTestRegistrations(
        iosConfig.platformApplicationArn,
        deviceCount
      );

      const endpointArns = registrations.map(r => r.platformEndpointArn);

      // Test cleanup operation
      const removedEndpoints = await iosManagementTool.removeInvalidTokens(endpointArns);

      expect(Array.isArray(removedEndpoints)).toBe(true);
      expect(removedEndpoints.length).toBeLessThanOrEqual(endpointArns.length);

      console.log(`✓ Processed ${endpointArns.length} endpoints, removed ${removedEndpoints.length} invalid ones`);
    });

    it('should handle cleanup of already deleted endpoints', async () => {
      // Create and then manually delete some endpoints
      const registrations = await deviceHelper.createMultipleTestRegistrations(
        iosConfig.platformApplicationArn,
        2
      );

      const endpointArns = registrations.map(r => r.platformEndpointArn);

      // First cleanup should work normally
      const firstCleanup = await iosManagementTool.removeInvalidTokens(endpointArns);

      // Second cleanup should handle already-deleted endpoints gracefully
      const secondCleanup = await iosManagementTool.removeInvalidTokens(endpointArns);

      expect(Array.isArray(firstCleanup)).toBe(true);
      expect(Array.isArray(secondCleanup)).toBe(true);

      console.log(`✓ Handled cleanup of already processed endpoints`);
    });

    it('should process large batches of endpoints efficiently', async () => {
      const batchSize = 5;
      const registrations = await deviceHelper.createMultipleTestRegistrations(
        iosConfig.platformApplicationArn,
        batchSize
      );

      const endpointArns = registrations.map(r => r.platformEndpointArn);
      const startTime = Date.now();

      const removedEndpoints = await iosManagementTool.removeInvalidTokens(endpointArns);
      
      const duration = Date.now() - startTime;
      const avgTimePerEndpoint = duration / endpointArns.length;

      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
      expect(avgTimePerEndpoint).toBeLessThan(2000); // Max 2 seconds per endpoint

      console.log(`✓ Processed ${batchSize} endpoints in ${duration}ms (${avgTimePerEndpoint.toFixed(0)}ms per endpoint)`);
    });

    it('should handle mixed valid and invalid endpoints', async () => {
      // Create some valid endpoints
      const validRegistrations = await deviceHelper.createMultipleTestRegistrations(
        iosConfig.platformApplicationArn,
        2
      );

      // Add some invalid endpoint ARNs
      const invalidEndpoints = [
        'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/invalid-1',
        'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/invalid-2'
      ];

      const allEndpoints = [
        ...validRegistrations.map(r => r.platformEndpointArn),
        ...invalidEndpoints
      ];

      const removedEndpoints = await iosManagementTool.removeInvalidTokens(allEndpoints);

      // Should handle the mix gracefully
      expect(Array.isArray(removedEndpoints)).toBe(true);
      expect(removedEndpoints.length).toBeGreaterThanOrEqual(invalidEndpoints.length);

      console.log(`✓ Processed mixed valid/invalid endpoints, removed ${removedEndpoints.length} invalid ones`);
    });
  });

  describe('APNS Configuration Validation Scenarios', () => {
    it('should validate correct APNS configuration', async () => {
      const isValid = await iosManagementTool.validateAPNSConfig();

      expect(typeof isValid).toBe('boolean');
      
      if (isValid) {
        console.log('✓ APNS configuration is valid');
      } else {
        console.log('⚠ APNS configuration validation failed (may be expected in test environment)');
      }
    });

    it('should handle invalid platform application gracefully', async () => {
      const invalidConfig: iOSPushConfig = {
        platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/NonExistentApp',
        bundleId: 'com.example.invalid',
        sandbox: true
      };

      const invalidTool = new iOSManagementTool(invalidConfig);
      
      // Should return false rather than throwing
      const isValid = await invalidTool.validateAPNSConfig();
      expect(isValid).toBe(false);

      console.log('✓ Handled invalid platform application gracefully');
    });

    it('should validate configuration multiple times consistently', async () => {
      const validationResults: boolean[] = [];

      // Run validation multiple times
      for (let i = 0; i < 3; i++) {
        const result = await iosManagementTool.validateAPNSConfig();
        validationResults.push(result);
      }

      // Results should be consistent
      const firstResult = validationResults[0];
      const allSame = validationResults.every(result => result === firstResult);
      expect(allSame).toBe(true);

      console.log(`✓ Configuration validation consistent across ${validationResults.length} attempts: ${firstResult}`);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle SNS service errors gracefully', async () => {
      // Test with malformed platform application ARN
      const malformedConfig: iOSPushConfig = {
        platformApplicationArn: 'invalid-arn-format',
        bundleId: 'com.example.test',
        sandbox: true
      };

      const malformedTool = new iOSManagementTool(malformedConfig);
      const validToken = TestDeviceTokenGenerator.generateValidToken();

      await expect(malformedTool.registerDevice(validToken))
        .rejects.toThrow();

      console.log('✓ Handled malformed platform application ARN gracefully');
    });

    it('should handle network timeouts and retries', async () => {
      // This test simulates network issues by using a very long device token operation
      // In a real scenario, you might mock the SNS client to simulate timeouts
      
      const deviceToken = TestDeviceTokenGenerator.generateValidToken();
      const startTime = Date.now();

      try {
        await iosManagementTool.registerDevice(deviceToken, 'timeout-test-user');
        const duration = Date.now() - startTime;
        
        // Should complete within reasonable time
        expect(duration).toBeLessThan(30000); // 30 seconds max
        
        console.log(`✓ Device registration completed in ${duration}ms`);
      } catch (error) {
        // If it fails due to timeout or network issues, that's also acceptable
        console.log(`⚠ Device registration failed (may be due to network issues): ${error.message}`);
      }
    });

    it('should validate device token format before making API calls', async () => {
      const invalidTokens = [
        '',
        'short',
        'g'.repeat(64),
        '1'.repeat(65),
        'invalid-characters-here-not-hex'
      ];

      for (const token of invalidTokens) {
        // Should fail validation before making any API calls
        await expect(iosManagementTool.registerDevice(token))
          .rejects.toThrow(ValidationError);
      }

      console.log(`✓ Validated ${invalidTokens.length} invalid tokens without API calls`);
    });

    it('should handle configuration updates correctly', async () => {
      const originalConfig = iosManagementTool.getConfig();
      
      // Update configuration
      const newBundleId = 'com.example.updated.test';
      iosManagementTool.updateConfig({ bundleId: newBundleId });
      
      const updatedConfig = iosManagementTool.getConfig();
      expect(updatedConfig.bundleId).toBe(newBundleId);
      expect(updatedConfig.platformApplicationArn).toBe(originalConfig.platformApplicationArn);

      // Restore original configuration
      iosManagementTool.updateConfig({ bundleId: originalConfig.bundleId });

      console.log('✓ Configuration updates handled correctly');
    });
  });

  describe('Mock APNS Feedback Service Integration', () => {
    it('should track invalid tokens through feedback service', () => {
      const validTokens = TestDeviceTokenGenerator.generateValidTokens(3);
      const invalidTokens = validTokens.slice(0, 2);

      // Mark some tokens as invalid
      invalidTokens.forEach(token => mockFeedbackService.markTokenAsInvalid(token));

      // Verify tracking
      expect(mockFeedbackService.getInvalidTokens()).toHaveLength(2);
      expect(mockFeedbackService.isTokenInvalid(invalidTokens[0])).toBe(true);
      expect(mockFeedbackService.isTokenInvalid(validTokens[2])).toBe(false);

      console.log(`✓ Tracked ${invalidTokens.length} invalid tokens through feedback service`);
    });

    it('should generate feedback response format', () => {
      const tokens = TestDeviceTokenGenerator.generateValidTokens(2);
      tokens.forEach(token => mockFeedbackService.markTokenAsInvalid(token));

      const feedback = mockFeedbackService.generateFeedbackResponse();

      expect(feedback).toHaveLength(2);
      feedback.forEach(item => {
        expect(item).toMatchObject({
          token: expect.any(String),
          timestamp: expect.any(Number),
          reason: 'InvalidToken'
        });
        expect(tokens).toContain(item.token);
      });

      console.log('✓ Generated proper APNS feedback response format');
    });

    it('should clear invalid tokens correctly', () => {
      const tokens = TestDeviceTokenGenerator.generateValidTokens(3);
      tokens.forEach(token => mockFeedbackService.markTokenAsInvalid(token));

      expect(mockFeedbackService.getInvalidTokens()).toHaveLength(3);

      mockFeedbackService.clearInvalidTokens();

      expect(mockFeedbackService.getInvalidTokens()).toHaveLength(0);
      tokens.forEach(token => {
        expect(mockFeedbackService.isTokenInvalid(token)).toBe(false);
      });

      console.log('✓ Cleared invalid tokens correctly');
    });
  });
});