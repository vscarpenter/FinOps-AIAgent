# iOS Push Notification Testing Guide

This guide covers testing iOS push notifications for the AWS Spend Monitor Agent, including setup, configuration, and running various test scenarios.

## Overview

The iOS notification testing suite includes:

- **Unit Tests**: APNS payload validation, device token validation, and formatting logic
- **Integration Tests**: Real AWS SNS operations, device registration, and notification delivery
- **Performance Tests**: Latency, throughput, and resource usage measurements
- **Scenario Tests**: Various device registration and notification scenarios

## Prerequisites

### Required Software

- Node.js 18+ with npm
- AWS CLI configured with appropriate credentials
- Jest testing framework (installed via npm)

### AWS Setup

1. **AWS Account**: Active AWS account with SNS permissions
2. **SNS Platform Application**: APNS platform application configured in AWS SNS
3. **IAM Permissions**: Appropriate permissions for SNS operations

### Apple Developer Setup (for Integration Tests)

1. **Apple Developer Account**: Required for APNS certificates
2. **App ID**: iOS app identifier with Push Notifications capability
3. **APNS Certificate**: Development or production certificate for push notifications

## Environment Configuration

### Required Environment Variables

```bash
# AWS Configuration
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key

# iOS Integration Test Configuration
export TEST_IOS_INTEGRATION=true
export TEST_IOS_PLATFORM_ARN=arn:aws:sns:us-east-1:123456789012:app/APNS/YourApp
export TEST_IOS_BUNDLE_ID=com.yourcompany.yourapp.test

# General Integration Test Configuration
export RUN_INTEGRATION_TESTS=true
```

### Optional Environment Variables

```bash
# Test Timeouts (in milliseconds)
export TEST_TIMEOUT=30000

# Performance Test Thresholds
export PERF_DEVICE_REGISTRATION_THRESHOLD=3000
export PERF_NOTIFICATION_DELIVERY_THRESHOLD=5000

# Test Limits
export MAX_TEST_DEVICES=10
export MAX_BATCH_SIZE=5
```

## Setting Up APNS Platform Application

### 1. Create APNS Certificate

1. Log in to Apple Developer Portal
2. Go to Certificates, Identifiers & Profiles
3. Create a new App ID with Push Notifications capability
4. Generate an APNS certificate (development or production)
5. Download the certificate and private key

### 2. Create SNS Platform Application

Using AWS CLI:

```bash
# Create platform application
aws sns create-platform-application \
  --name "SpendMonitorAPNS" \
  --platform APNS \
  --attributes PlatformCredential="$(cat apns-cert.pem)",PlatformPrincipal="$(cat apns-key.pem)"
```

Using AWS Console:

1. Go to Amazon SNS in AWS Console
2. Click "Mobile" → "Push notifications"
3. Click "Create platform application"
4. Select "Apple iOS/VoIP/Mac" as platform
5. Upload your APNS certificate and private key
6. Note the Platform Application ARN for testing

## Running Tests

### Quick Start

```bash
# Run unit tests only
./scripts/run-ios-tests.sh --unit

# Run all tests (requires full setup)
./scripts/run-ios-tests.sh --all --coverage
```

### Unit Tests Only

Unit tests don't require AWS credentials or APNS setup:

```bash
# Using npm script
npm run test:ios:unit

# Using Jest directly
npx jest --testPathPattern=ios.*test\.ts$ --testPathIgnorePatterns=integration

# Using the test script
./scripts/run-ios-tests.sh --unit
```

### Integration Tests

Integration tests require AWS credentials and APNS platform application:

```bash
# Set up environment
export TEST_IOS_INTEGRATION=true
export TEST_IOS_PLATFORM_ARN=your-platform-arn

# Run integration tests
./scripts/run-ios-tests.sh --integration

# Or using Jest directly
npx jest --config jest.integration.config.js --testPathPattern=ios.*test\.ts$
```

### Performance Tests

Performance tests measure operation latency and throughput:

```bash
# Run performance tests
./scripts/run-ios-tests.sh --performance

# Run with verbose output
./scripts/run-ios-tests.sh --performance --verbose
```

### All Tests with Coverage

```bash
# Run complete test suite with coverage report
./scripts/run-ios-tests.sh --all --coverage
```

## Test Structure

### Unit Tests

Located in `tests/ios-notification-validation.test.ts`:

- APNS payload structure validation
- Device token format validation
- iOS payload formatting by AlertTool
- Sandbox configuration validation
- Mock APNS feedback service

### Integration Tests

Located in `tests/integration/`:

- `ios-notification.test.ts`: End-to-end notification delivery
- `ios-device-scenarios.test.ts`: Device registration scenarios
- `ios-performance.test.ts`: Performance measurements

### Test Utilities

Located in `tests/utils/ios-test-utils.ts`:

- `APNSPayloadValidator`: Payload validation utilities
- `TestDeviceTokenGenerator`: Device token generation and validation
- `iOSDeviceTestHelper`: Device registration helper
- `iOSPerformanceTestHelper`: Performance measurement utilities
- `APNSSandboxHelper`: Sandbox configuration utilities
- `MockAPNSFeedbackService`: Mock feedback service for testing

## Test Scenarios

### Device Registration Scenarios

1. **Valid Registration**: Register device with valid token and user ID
2. **Invalid Tokens**: Test various invalid token formats
3. **Token Updates**: Update existing device tokens
4. **Multiple Devices**: Register multiple devices for same user
5. **Concurrent Registration**: Handle concurrent registration requests
6. **Cleanup Operations**: Remove invalid or expired tokens

### Notification Scenarios

1. **Warning Alerts**: Moderate spending over threshold
2. **Critical Alerts**: Significant spending over threshold
3. **Payload Validation**: Ensure APNS compliance
4. **Delivery Confirmation**: Verify successful delivery
5. **Error Handling**: Handle delivery failures gracefully

### Performance Scenarios

1. **Single Operations**: Measure individual operation latency
2. **Batch Operations**: Test bulk device registration/cleanup
3. **Concurrent Operations**: Measure concurrent notification delivery
4. **Memory Usage**: Monitor memory consumption during operations
5. **Resource Cleanup**: Verify proper resource cleanup

## Troubleshooting

### Common Issues

#### 1. Missing Environment Variables

**Error**: `Missing required environment variables for iOS integration tests`

**Solution**: Ensure all required environment variables are set:
```bash
export TEST_IOS_INTEGRATION=true
export TEST_IOS_PLATFORM_ARN=your-platform-arn
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key
```

#### 2. Invalid Platform Application ARN

**Error**: `Invalid TEST_IOS_PLATFORM_ARN format`

**Solution**: Verify ARN format matches:
```
arn:aws:sns:region:account:app/APNS/application-name
```

#### 3. APNS Certificate Issues

**Error**: `APNS configuration validation failed`

**Solutions**:
- Verify certificate is valid and not expired
- Ensure certificate matches the bundle ID
- Check that certificate has push notification capability
- Verify private key matches the certificate

#### 4. AWS Permissions Issues

**Error**: `Access denied` or `Insufficient permissions`

**Solution**: Ensure IAM user/role has these permissions:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sns:CreatePlatformEndpoint",
        "sns:DeleteEndpoint",
        "sns:GetEndpointAttributes",
        "sns:SetEndpointAttributes",
        "sns:Publish",
        "sns:CreateTopic",
        "sns:DeleteTopic"
      ],
      "Resource": "*"
    }
  ]
}
```

#### 5. Test Timeouts

**Error**: `Test timeout exceeded`

**Solutions**:
- Increase test timeout in Jest configuration
- Check network connectivity to AWS services
- Verify AWS region is accessible
- Consider using a closer AWS region

### Debug Mode

Enable verbose logging for troubleshooting:

```bash
# Run tests with verbose output
./scripts/run-ios-tests.sh --all --verbose

# Enable debug logging
export DEBUG=true
export SUPPRESS_TEST_LOGS=false
```

### Test Data Cleanup

Clean up test resources after failed tests:

```bash
# The test suite automatically cleans up resources
# But you can manually clean up if needed

# List SNS endpoints (replace with your platform ARN)
aws sns list-endpoints-by-platform-application \
  --platform-application-arn your-platform-arn

# Delete specific endpoint
aws sns delete-endpoint --endpoint-arn endpoint-arn-to-delete
```

## Performance Benchmarks

### Expected Performance Thresholds

| Operation | Expected Time | Threshold |
|-----------|---------------|-----------|
| Device Registration | < 2 seconds | 3 seconds |
| Token Update | < 1 second | 2 seconds |
| Notification Delivery | < 3 seconds | 5 seconds |
| Payload Validation | < 50ms | 100ms |
| Batch Operations (5 devices) | < 8 seconds | 10 seconds |

### Performance Monitoring

The performance tests automatically measure and report:

- Operation latency (min, max, average, median, P95, P99)
- Memory usage during operations
- Resource cleanup efficiency
- Concurrent operation handling

## Best Practices

### Test Development

1. **Isolation**: Each test should be independent and not rely on other tests
2. **Cleanup**: Always clean up resources created during tests
3. **Mocking**: Use mocks for external dependencies in unit tests
4. **Validation**: Validate all inputs and outputs thoroughly
5. **Error Handling**: Test both success and failure scenarios

### Environment Management

1. **Separate Environments**: Use different AWS accounts/regions for testing
2. **Resource Naming**: Use consistent naming conventions for test resources
3. **Cleanup Automation**: Implement automatic cleanup of test resources
4. **Monitoring**: Monitor AWS costs for test resources

### Security

1. **Credentials**: Never commit AWS credentials to version control
2. **Test Data**: Use fake/test data, never real user information
3. **Permissions**: Use minimal required permissions for test IAM roles
4. **Cleanup**: Ensure test resources are properly cleaned up

## Contributing

When adding new iOS notification tests:

1. Follow existing test patterns and naming conventions
2. Add appropriate documentation and comments
3. Include both positive and negative test cases
4. Update this README if adding new test categories
5. Ensure tests are deterministic and don't depend on external state

## Support

For issues with iOS notification testing:

1. Check the troubleshooting section above
2. Review AWS CloudWatch logs for SNS operations
3. Verify APNS certificate configuration
4. Check AWS service status for any outages
5. Review Jest and Node.js compatibility requirements