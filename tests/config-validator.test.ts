/**
 * Configuration Validator Tests
 * 
 * Tests for the configuration validation utilities including
 * iOS settings, AWS service validation, and deployment checks.
 */

import { ConfigValidator, validateEnvironmentVariables, createSampleConfig } from '../src/utils/config-validator';
import { SpendMonitorConfigValidation, iOSConfigValidation } from '../src/utils/config-validator';

// Mock AWS SDK clients
jest.mock('@aws-sdk/client-sns');
jest.mock('@aws-sdk/client-cost-explorer');
jest.mock('@aws-sdk/client-lambda');

import { SNSClient, GetTopicAttributesCommand, GetPlatformApplicationAttributesCommand } from '@aws-sdk/client-sns';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { LambdaClient, GetFunctionConfigurationCommand } from '@aws-sdk/client-lambda';

const mockSNSClient = SNSClient as jest.MockedClass<typeof SNSClient>;
const mockCostExplorerClient = CostExplorerClient as jest.MockedClass<typeof CostExplorerClient>;
const mockLambdaClient = LambdaClient as jest.MockedClass<typeof LambdaClient>;

describe('ConfigValidator', () => {
  let validator: ConfigValidator;
  let mockSNSSend: jest.Mock;
  let mockCostExplorerSend: jest.Mock;
  let mockLambdaSend: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mocks
    mockSNSSend = jest.fn();
    mockCostExplorerSend = jest.fn();
    mockLambdaSend = jest.fn();
    
    mockSNSClient.prototype.send = mockSNSSend;
    mockCostExplorerClient.prototype.send = mockCostExplorerSend;
    mockLambdaClient.prototype.send = mockLambdaSend;
    
    validator = new ConfigValidator('us-east-1');
  });

  describe('validateConfiguration', () => {
    it('should validate a complete valid configuration', async () => {
      const config: SpendMonitorConfigValidation = {
        spendThreshold: 10,
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts',
        region: 'us-east-1',
        iosConfig: {
          platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/SpendMonitorApp',
          bundleId: 'com.example.spendmonitor',
          sandbox: true
        }
      };

      // Mock successful AWS responses
      mockSNSSend
        .mockResolvedValueOnce({
          Attributes: {
            DisplayName: 'Spend Monitor Alerts',
            SubscriptionsConfirmed: '2'
          }
        })
        .mockResolvedValueOnce({
          Attributes: {
            Enabled: 'true',
            Platform: 'APNS'
          }
        });

      mockCostExplorerSend.mockResolvedValueOnce({
        ResultsByTime: []
      });

      const result = await validator.validateConfiguration(config);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.info).toContain('Spend threshold: $10');
      expect(result.info).toContain('SNS topic is accessible');
      expect(result.info).toContain('iOS platform application is accessible');
      expect(result.info).toContain('Cost Explorer API is accessible');
    });

    it('should detect invalid spend threshold', async () => {
      const config: SpendMonitorConfigValidation = {
        spendThreshold: -5,
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts',
        region: 'us-east-1'
      };

      const result = await validator.validateConfiguration(config, { skipAwsValidation: true });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Spend threshold must be a positive number');
    });

    it('should detect invalid SNS topic ARN', async () => {
      const config: SpendMonitorConfigValidation = {
        spendThreshold: 10,
        snsTopicArn: 'invalid-arn',
        region: 'us-east-1'
      };

      const result = await validator.validateConfiguration(config, { skipAwsValidation: true });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('SNS topic ARN format is invalid');
    });

    it('should validate iOS configuration', async () => {
      const config: SpendMonitorConfigValidation = {
        spendThreshold: 10,
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts',
        region: 'us-east-1',
        iosConfig: {
          platformApplicationArn: 'invalid-platform-arn',
          bundleId: 'invalid-bundle-id',
          sandbox: true
        }
      };

      const result = await validator.validateConfiguration(config, { skipAwsValidation: true });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('iOS platform application ARN format is invalid');
      expect(result.errors).toContain('iOS bundle ID format is invalid');
    });

    it('should handle AWS service errors gracefully', async () => {
      const config: SpendMonitorConfigValidation = {
        spendThreshold: 10,
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts',
        region: 'us-east-1'
      };

      mockSNSSend.mockRejectedValueOnce(new Error('Access denied'));
      mockCostExplorerSend.mockRejectedValueOnce(new Error('Service unavailable'));

      const result = await validator.validateConfiguration(config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Cannot access SNS topic: Access denied');
      expect(result.errors).toContain('Cannot access Cost Explorer API: Service unavailable');
    });

    it('should generate warnings for edge cases', async () => {
      const config: SpendMonitorConfigValidation = {
        spendThreshold: 0.5, // Very low threshold
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts',
        region: 'invalid-region', // Invalid region
        checkPeriodDays: 50, // Too high
        retryAttempts: 15 // Too high
      };

      const result = await validator.validateConfiguration(config, { skipAwsValidation: true });

      expect(result.warnings).toContain('Spend threshold is very low (< $1), may generate frequent alerts');
      expect(result.warnings).toContain('AWS region may be invalid: invalid-region');
      expect(result.warnings).toContain('Check period should be between 1 and 30 days');
      expect(result.warnings).toContain('Retry attempts should be between 1 and 10');
    });
  });

  describe('validateDeviceToken', () => {
    it('should validate correct device token format', () => {
      const validToken = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const result = ConfigValidator.validateDeviceToken(validToken);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.info).toContain('Device token format is valid');
    });

    it('should reject empty device token', () => {
      const result = ConfigValidator.validateDeviceToken('');

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Device token is required');
    });

    it('should reject device token with wrong length', () => {
      const shortToken = '0123456789abcdef';
      const result = ConfigValidator.validateDeviceToken(shortToken);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Device token must be 64 characters long (got 16)');
    });

    it('should reject device token with invalid characters', () => {
      const invalidToken = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeg';
      const result = ConfigValidator.validateDeviceToken(invalidToken);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Device token must contain only hexadecimal characters');
    });
  });

  describe('validateLambdaFunction', () => {
    it('should validate Lambda function configuration', async () => {
      mockLambdaSend.mockResolvedValueOnce({
        FunctionName: 'spend-monitor-agent',
        Runtime: 'nodejs18.x',
        MemorySize: 512,
        Timeout: 60,
        Environment: {
          Variables: {
            SPEND_THRESHOLD: '10',
            SNS_TOPIC_ARN: 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts',
            IOS_PLATFORM_APP_ARN: 'arn:aws:sns:us-east-1:123456789012:app/APNS/SpendMonitorApp',
            IOS_BUNDLE_ID: 'com.example.spendmonitor'
          }
        }
      });

      const result = await validator.validateLambdaFunction('spend-monitor-agent');

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.info).toContain('Lambda function found: spend-monitor-agent');
      expect(result.info).toContain('Runtime: nodejs18.x');
      expect(result.info).toContain('Memory: 512MB');
      expect(result.info).toContain('Timeout: 60s');
      expect(result.info).toContain('Environment variable set: SPEND_THRESHOLD');
      expect(result.info).toContain('iOS environment variable set: IOS_PLATFORM_APP_ARN');
    });

    it('should detect missing required environment variables', async () => {
      mockLambdaSend.mockResolvedValueOnce({
        FunctionName: 'spend-monitor-agent',
        Runtime: 'nodejs18.x',
        Environment: {
          Variables: {
            // Missing required variables
          }
        }
      });

      const result = await validator.validateLambdaFunction('spend-monitor-agent');

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Required environment variable missing: SPEND_THRESHOLD');
      expect(result.errors).toContain('Required environment variable missing: SNS_TOPIC_ARN');
    });

    it('should warn about suboptimal configuration', async () => {
      mockLambdaSend.mockResolvedValueOnce({
        FunctionName: 'spend-monitor-agent',
        Runtime: 'python3.9', // Unexpected runtime
        MemorySize: 128, // Low memory
        Timeout: 30, // Low timeout
        Environment: {
          Variables: {
            SPEND_THRESHOLD: '10',
            SNS_TOPIC_ARN: 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts'
          }
        }
      });

      const result = await validator.validateLambdaFunction('spend-monitor-agent');

      expect(result.warnings).toContain('Unexpected runtime: python3.9');
      expect(result.warnings).toContain('Memory allocation may be low: 128MB (recommended: 512MB+)');
      expect(result.warnings).toContain('Timeout may be low: 30s (recommended: 60s+)');
    });

    it('should handle Lambda function not found', async () => {
      mockLambdaSend.mockRejectedValueOnce(new Error('Function not found'));

      const result = await validator.validateLambdaFunction('nonexistent-function');

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Cannot access Lambda function: Function not found');
    });
  });

  describe('generateValidationReport', () => {
    it('should generate a comprehensive validation report', () => {
      const result = {
        isValid: false,
        errors: ['Configuration error 1', 'Configuration error 2'],
        warnings: ['Configuration warning 1'],
        info: ['Configuration info 1', 'Configuration info 2']
      };

      const report = ConfigValidator.generateValidationReport(result);

      expect(report).toContain('Configuration Validation Report');
      expect(report).toContain('✗ Configuration has errors');
      expect(report).toContain('Errors: 2');
      expect(report).toContain('Warnings: 1');
      expect(report).toContain('Info: 2');
      expect(report).toContain('✗ Configuration error 1');
      expect(report).toContain('⚠ Configuration warning 1');
      expect(report).toContain('ℹ Configuration info 1');
    });

    it('should generate report for valid configuration', () => {
      const result = {
        isValid: true,
        errors: [],
        warnings: [],
        info: ['All checks passed']
      };

      const report = ConfigValidator.generateValidationReport(result);

      expect(report).toContain('✓ Configuration is valid');
      expect(report).toContain('Errors: 0');
      expect(report).toContain('ℹ All checks passed');
    });
  });
});

describe('validateEnvironmentVariables', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should validate required environment variables', () => {
    process.env.SPEND_THRESHOLD = '10';
    process.env.SNS_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts';
    process.env.AWS_REGION = 'us-east-1';

    const result = validateEnvironmentVariables();

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.info).toContain('Environment variable set: SPEND_THRESHOLD');
    expect(result.info).toContain('Environment variable set: SNS_TOPIC_ARN');
    expect(result.info).toContain('Environment variable set: AWS_REGION');
  });

  it('should detect missing required environment variables', () => {
    // Clear required variables
    delete process.env.SPEND_THRESHOLD;
    delete process.env.SNS_TOPIC_ARN;
    delete process.env.AWS_REGION;

    const result = validateEnvironmentVariables();

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Required environment variable missing: SPEND_THRESHOLD');
    expect(result.errors).toContain('Required environment variable missing: SNS_TOPIC_ARN');
    expect(result.errors).toContain('Required environment variable missing: AWS_REGION');
  });

  it('should detect iOS configuration', () => {
    process.env.SPEND_THRESHOLD = '10';
    process.env.SNS_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts';
    process.env.AWS_REGION = 'us-east-1';
    process.env.IOS_PLATFORM_APP_ARN = 'arn:aws:sns:us-east-1:123456789012:app/APNS/SpendMonitorApp';
    process.env.IOS_BUNDLE_ID = 'com.example.spendmonitor';

    const result = validateEnvironmentVariables();

    expect(result.isValid).toBe(true);
    expect(result.info).toContain('iOS environment variable set: IOS_PLATFORM_APP_ARN');
    expect(result.info).toContain('iOS environment variable set: IOS_BUNDLE_ID');
  });

  it('should warn when iOS is not configured', () => {
    process.env.SPEND_THRESHOLD = '10';
    process.env.SNS_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts';
    process.env.AWS_REGION = 'us-east-1';

    const result = validateEnvironmentVariables();

    expect(result.isValid).toBe(true);
    expect(result.warnings).toContain('No iOS environment variables configured - iOS notifications will be disabled');
  });

  it('should detect optional environment variables', () => {
    process.env.SPEND_THRESHOLD = '10';
    process.env.SNS_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts';
    process.env.AWS_REGION = 'us-east-1';
    process.env.CHECK_PERIOD_DAYS = '1';
    process.env.RETRY_ATTEMPTS = '3';

    const result = validateEnvironmentVariables();

    expect(result.isValid).toBe(true);
    expect(result.info).toContain('Optional environment variable set: CHECK_PERIOD_DAYS');
    expect(result.info).toContain('Optional environment variable set: RETRY_ATTEMPTS');
  });
});

describe('createSampleConfig', () => {
  it('should create a valid sample configuration', () => {
    const sampleConfig = createSampleConfig();

    expect(sampleConfig.spendThreshold).toBe(10);
    expect(sampleConfig.snsTopicArn).toMatch(/^arn:aws:sns:/);
    expect(sampleConfig.region).toBe('us-east-1');
    expect(sampleConfig.iosConfig).toBeDefined();
    expect(sampleConfig.iosConfig?.bundleId).toBe('com.example.spendmonitor');
    expect(sampleConfig.iosConfig?.sandbox).toBe(true);
  });

  it('should create configuration that passes validation', async () => {
    const sampleConfig = createSampleConfig();
    const validator = new ConfigValidator();

    const result = await validator.validateConfiguration(sampleConfig, { skipAwsValidation: true });

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('iOS Configuration Validation', () => {
  it('should validate iOS platform application ARN formats', async () => {
    const validator = new ConfigValidator();
    
    const validArns = [
      'arn:aws:sns:us-east-1:123456789012:app/APNS/SpendMonitorApp',
      'arn:aws:sns:us-west-2:987654321098:app/APNS_SANDBOX/TestApp'
    ];

    const invalidArns = [
      'invalid-arn',
      'arn:aws:sns:us-east-1:123456789012:SpendMonitorApp', // Missing app/ prefix
      'arn:aws:sns:us-east-1:123456789012:app/GCM/AndroidApp' // Wrong platform
    ];

    for (const arn of validArns) {
      const config: SpendMonitorConfigValidation = {
        spendThreshold: 10,
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts',
        region: 'us-east-1',
        iosConfig: {
          platformApplicationArn: arn,
          bundleId: 'com.example.app'
        }
      };

      const result = await validator.validateConfiguration(config, { skipAwsValidation: true });
      expect(result.errors).not.toContain('iOS platform application ARN format is invalid');
    }

    for (const arn of invalidArns) {
      const config: SpendMonitorConfigValidation = {
        spendThreshold: 10,
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts',
        region: 'us-east-1',
        iosConfig: {
          platformApplicationArn: arn,
          bundleId: 'com.example.app'
        }
      };

      const result = await validator.validateConfiguration(config, { skipAwsValidation: true });
      expect(result.errors).toContain('iOS platform application ARN format is invalid');
    }
  });

  it('should validate bundle ID formats', async () => {
    const validator = new ConfigValidator();
    
    const validBundleIds = [
      'com.example.app',
      'com.company.product.module',
      'org.opensource.project'
    ];

    const invalidBundleIds = [
      'invalid',
      'com',
      'com.',
      '.com.example'
    ];

    for (const bundleId of validBundleIds) {
      const config: SpendMonitorConfigValidation = {
        spendThreshold: 10,
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts',
        region: 'us-east-1',
        iosConfig: {
          platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/SpendMonitorApp',
          bundleId
        }
      };

      const result = await validator.validateConfiguration(config, { skipAwsValidation: true });
      expect(result.errors).not.toContain('iOS bundle ID format is invalid');
    }

    for (const bundleId of invalidBundleIds) {
      const config: SpendMonitorConfigValidation = {
        spendThreshold: 10,
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts',
        region: 'us-east-1',
        iosConfig: {
          platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/SpendMonitorApp',
          bundleId
        }
      };

      const result = await validator.validateConfiguration(config, { skipAwsValidation: true });
      expect(result.errors).toContain('iOS bundle ID format is invalid');
    }
  });
});