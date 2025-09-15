# Integration Tests

This directory contains end-to-end integration tests for the AWS Spend Monitor Agent that use real AWS services in a test environment.

## Overview

The integration tests validate:
- Real AWS service interactions (Cost Explorer, SNS)
- End-to-end agent execution workflows
- Performance characteristics under real conditions
- Error handling with actual AWS API responses
- Multi-channel notification delivery
- iOS push notification functionality (optional)

## Test Structure

### Core Test Files

- **`e2e.test.ts`** - Main end-to-end integration tests
- **`performance.test.ts`** - Performance and load testing
- **`test-config.ts`** - Test configuration and utilities
- **`setup.ts`** - Global test setup and teardown

### Test Categories

1. **Real AWS Service Integration**
   - Cost Explorer API interactions
   - SNS topic creation and message delivery
   - IAM permission validation
   - API rate limit handling

2. **Test Scenarios**
   - Under-threshold spending scenarios
   - Over-threshold spending scenarios
   - Edge cases (zero spending, exact threshold)
   - Service breakdown variations

3. **Lambda Handler Integration**
   - Full Lambda execution simulation
   - Error handling validation
   - Environment variable processing

4. **Performance Tests**
   - Execution time validation
   - Memory usage monitoring
   - Concurrent execution testing
   - Cold start performance

5. **SNS Message Delivery**
   - Alert formatting validation
   - Multi-channel delivery testing
   - Retry logic verification

6. **iOS Push Notifications** (Optional)
   - APNS payload formatting
   - Device registration simulation
   - Platform application integration

## Setup Requirements

### Required Environment Variables

```bash
# Enable integration tests
export RUN_INTEGRATION_TESTS=true

# AWS Configuration
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key

# Optional: AWS Session Token for temporary credentials
export AWS_SESSION_TOKEN=your-session-token
```

### Optional iOS Testing

```bash
# Enable iOS integration tests
export TEST_IOS_INTEGRATION=true
export TEST_IOS_PLATFORM_ARN=arn:aws:sns:us-east-1:123456789012:app/APNS/YourApp
export TEST_IOS_BUNDLE_ID=com.yourcompany.yourapp
```

### AWS Permissions Required

The test AWS account/role needs the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ce:GetCostAndUsage",
        "ce:GetUsageReport"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sns:CreateTopic",
        "sns:DeleteTopic",
        "sns:Publish",
        "sns:Subscribe",
        "sns:Unsubscribe",
        "sns:ListTopics"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sns:CreatePlatformApplication",
        "sns:DeletePlatformApplication",
        "sns:CreatePlatformEndpoint",
        "sns:DeleteEndpoint"
      ],
      "Resource": "*"
    }
  ]
}
```

## Running Tests

### All Integration Tests

```bash
npm run test:integration:run
```

### Performance Tests Only

```bash
npm run test:performance
```

### iOS Integration Tests

```bash
npm run test:integration:ios
```

### Unit Tests + Integration Tests

```bash
npm run test:all
```

## Test Configuration

### Performance Thresholds

- **Lambda Execution**: < 5 seconds
- **Cost Analysis**: < 3 seconds  
- **Alert Delivery**: < 2 seconds
- **Memory Usage**: < 50MB initialization, < 20MB execution

### Test Timeouts

- **Individual Tests**: 30 seconds
- **Performance Tests**: 60 seconds
- **Setup/Teardown**: 30 seconds

### Retry Configuration

- **Max Attempts**: 3
- **Base Delay**: 1000ms
- **Max Delay**: 5000ms

## Test Data Management

### Automatic Cleanup

Tests automatically create and clean up:
- SNS topics with unique names
- Test-specific configurations
- Temporary resources

### Test Isolation

- Each test run uses unique resource names
- Tests don't interfere with production resources
- Parallel test execution is limited to prevent rate limiting

## Troubleshooting

### Common Issues

1. **AWS Credentials Not Found**
   ```
   Error: Missing required environment variables: AWS_ACCESS_KEY_ID
   ```
   **Solution**: Configure AWS credentials using environment variables or AWS CLI

2. **Permission Denied**
   ```
   Error: User is not authorized to perform: ce:GetCostAndUsage
   ```
   **Solution**: Ensure the AWS user/role has required permissions

3. **Rate Limiting**
   ```
   Error: ThrottlingException: Rate exceeded
   ```
   **Solution**: Tests include retry logic, but reduce concurrent execution if needed

4. **Test Timeouts**
   ```
   Error: Timeout - Async callback was not invoked within the 30000ms timeout
   ```
   **Solution**: Check AWS service availability and network connectivity

### Debug Mode

Enable verbose logging:

```bash
export SUPPRESS_TEST_LOGS=false
npm run test:integration:run -- --verbose
```

### Test Specific Scenarios

Run specific test suites:

```bash
# Only end-to-end tests
npm run test:integration -- --testNamePattern="End-to-End"

# Only performance tests  
npm run test:integration -- --testNamePattern="Performance"

# Only AWS service tests
npm run test:integration -- --testNamePattern="Real AWS Service"
```

## Cost Considerations

### AWS Costs

Integration tests incur minimal AWS costs:
- Cost Explorer API calls: ~$0.01 per 1000 requests
- SNS operations: ~$0.50 per million requests
- Data transfer: Negligible for test volumes

### Cost Optimization

- Tests use minimal data requests
- Resources are cleaned up immediately
- Concurrent execution is limited
- Test data is kept small

## Continuous Integration

### GitHub Actions Example

```yaml
name: Integration Tests
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  integration:
    runs-on: ubuntu-latest
    if: github.event_name == 'push' || contains(github.event.pull_request.labels.*.name, 'run-integration-tests')
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Build
      run: npm run build
      
    - name: Run integration tests
      env:
        RUN_INTEGRATION_TESTS: true
        AWS_REGION: us-east-1
        AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
        AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
      run: npm run test:integration:run
      
    - name: Upload test results
      uses: actions/upload-artifact@v3
      if: always()
      with:
        name: integration-test-results
        path: coverage/integration/
```

## Best Practices

### Test Design

1. **Idempotent Tests**: Tests should produce the same results when run multiple times
2. **Resource Cleanup**: Always clean up created AWS resources
3. **Error Handling**: Test both success and failure scenarios
4. **Performance Validation**: Include performance assertions
5. **Real Data**: Use actual AWS API responses when possible

### Security

1. **Test Credentials**: Use dedicated test AWS accounts with minimal permissions
2. **Resource Isolation**: Ensure tests don't access production resources
3. **Data Privacy**: Don't log sensitive information in test output
4. **Cleanup**: Remove all test resources to prevent security exposure

### Maintenance

1. **Regular Updates**: Keep test scenarios current with AWS API changes
2. **Performance Monitoring**: Track test execution times over time
3. **Dependency Updates**: Keep AWS SDK versions current
4. **Documentation**: Update test documentation with any changes