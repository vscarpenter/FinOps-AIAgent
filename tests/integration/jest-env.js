/**
 * Jest Environment Setup for Integration Tests
 * 
 * This file sets up environment variables and global configurations
 * specifically for integration tests.
 */

// Set default environment variables for integration tests
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// Set test-specific defaults
process.env.SPEND_THRESHOLD = process.env.SPEND_THRESHOLD || '10';
process.env.CHECK_PERIOD_DAYS = process.env.CHECK_PERIOD_DAYS || '1';
process.env.RETRY_ATTEMPTS = process.env.RETRY_ATTEMPTS || '3';
process.env.MIN_SERVICE_COST_THRESHOLD = process.env.MIN_SERVICE_COST_THRESHOLD || '1';

// Disable certain features for testing
process.env.SUPPRESS_TEST_LOGS = process.env.SUPPRESS_TEST_LOGS || 'false';

// AWS SDK configuration for testing
process.env.AWS_SDK_LOAD_CONFIG = '1';

// Set reasonable timeouts for AWS operations
process.env.AWS_MAX_ATTEMPTS = '3';
process.env.AWS_RETRY_DELAY = '1000';

// iOS-specific test configuration
if (process.env.TEST_IOS_INTEGRATION === 'true') {
  // Validate required iOS test environment variables
  const requiredIOSVars = ['TEST_IOS_PLATFORM_ARN'];
  const missingIOSVars = requiredIOSVars.filter(varName => !process.env[varName]);
  
  if (missingIOSVars.length > 0) {
    console.warn(`Warning: Missing iOS test environment variables: ${missingIOSVars.join(', ')}`);
    console.warn('iOS integration tests may fail or be skipped.');
  }
  
  // Set default iOS test bundle ID if not specified
  if (!process.env.TEST_IOS_BUNDLE_ID) {
    process.env.TEST_IOS_BUNDLE_ID = 'com.example.spendmonitor.test';
  }
}

console.log('Integration test environment configured');
console.log(`AWS Region: ${process.env.AWS_REGION}`);
console.log(`Integration Tests Enabled: ${process.env.RUN_INTEGRATION_TESTS || 'false'}`);
console.log(`iOS Tests Enabled: ${process.env.TEST_IOS_INTEGRATION || 'false'}`);

if (process.env.TEST_IOS_INTEGRATION === 'true') {
  console.log(`iOS Platform ARN: ${process.env.TEST_IOS_PLATFORM_ARN || 'not set'}`);
  console.log(`iOS Bundle ID: ${process.env.TEST_IOS_BUNDLE_ID}`);
}