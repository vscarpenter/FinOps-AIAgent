/**
 * Integration Test Setup
 * 
 * This file provides setup and teardown utilities for integration tests
 * that require real AWS services and resources.
 */

import { 
  validateIntegrationTestEnvironment, 
  shouldRunIntegrationTests,
  shouldRunIOSIntegrationTests 
} from './test-config';

// Global setup for integration tests
beforeAll(async () => {
  if (!shouldRunIntegrationTests()) {
    console.log('\n=== Integration Tests Disabled ===');
    console.log('To run integration tests, set the following environment variables:');
    console.log('  RUN_INTEGRATION_TESTS=true');
    console.log('  AWS_REGION=us-east-1 (or your preferred region)');
    console.log('  AWS_ACCESS_KEY_ID=<your-access-key>');
    console.log('  AWS_SECRET_ACCESS_KEY=<your-secret-key>');
    console.log('\nOptional for iOS tests:');
    console.log('  TEST_IOS_INTEGRATION=true');
    console.log('  TEST_IOS_PLATFORM_ARN=<your-sns-platform-app-arn>');
    console.log('  TEST_IOS_BUNDLE_ID=<your-ios-bundle-id>');
    console.log('=====================================\n');
    return;
  }

  console.log('\n=== Integration Test Environment ===');
  
  try {
    validateIntegrationTestEnvironment();
    console.log('✓ AWS credentials configured');
    console.log(`✓ AWS region: ${process.env.AWS_REGION}`);
    
    if (shouldRunIOSIntegrationTests()) {
      console.log('✓ iOS integration tests enabled');
      console.log(`✓ iOS Platform ARN: ${process.env.TEST_IOS_PLATFORM_ARN}`);
    } else {
      console.log('- iOS integration tests disabled');
    }
    
    console.log('=====================================\n');
  } catch (error) {
    console.error('❌ Integration test environment validation failed:');
    console.error(error.message);
    console.log('=====================================\n');
    throw error;
  }
}, 30000);

// Global teardown for integration tests
afterAll(async () => {
  if (!shouldRunIntegrationTests()) {
    return;
  }

  console.log('\n=== Integration Test Cleanup ===');
  console.log('Integration tests completed');
  console.log('================================\n');
}, 10000);

// Set longer timeout for integration tests
jest.setTimeout(60000); // 60 seconds

// Suppress console.log in tests unless explicitly needed
if (process.env.SUPPRESS_TEST_LOGS === 'true') {
  global.console = {
    ...console,
    log: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };
}