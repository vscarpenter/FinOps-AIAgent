/**
 * Deployment Validation Integration Tests
 * 
 * Tests the complete deployment validation workflow including
 * configuration validation, pre-deployment checks, and iOS validation.
 */

import { execSync } from 'child_process';
import { ConfigValidator, validateEnvironmentVariables } from '../../src/utils/config-validator';
import * as fs from 'fs';
import * as path from 'path';

describe('Deployment Validation Integration', () => {
  const originalEnv = process.env;
  const testConfigPath = path.join(__dirname, 'test-config.json');

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Clean up test files
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Configuration Validation Workflow', () => {
    it('should validate complete configuration workflow', async () => {
      // Setup test configuration
      const testConfig = {
        spendThreshold: 10,
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts',
        region: 'us-east-1',
        checkPeriodDays: 1,
        retryAttempts: 3,
        minServiceCostThreshold: 1,
        iosConfig: {
          platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/SpendMonitorApp',
          bundleId: 'com.example.spendmonitor',
          sandbox: true
        }
      };

      // Write test configuration file
      fs.writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      // Test configuration validation
      const validator = new ConfigValidator('us-east-1');
      const result = await validator.validateConfiguration(testConfig, { skipAwsValidation: true });

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.info).toContain('Spend threshold: $10');
      expect(result.info).toContain('iOS platform application ARN: arn:aws:sns:us-east-1:123456789012:app/APNS/SpendMonitorApp');
    });

    it('should detect configuration errors in workflow', async () => {
      // Setup invalid test configuration
      const invalidConfig = {
        spendThreshold: -5, // Invalid threshold
        snsTopicArn: 'invalid-arn', // Invalid ARN
        region: 'invalid-region', // Invalid region
        iosConfig: {
          platformApplicationArn: 'invalid-platform-arn', // Invalid platform ARN
          bundleId: 'invalid-bundle', // Invalid bundle ID
          sandbox: true
        }
      };

      const validator = new ConfigValidator('us-east-1');
      const result = await validator.validateConfiguration(invalidConfig, { skipAwsValidation: true });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Spend threshold must be a positive number');
      expect(result.errors).toContain('SNS topic ARN format is invalid');
      expect(result.errors).toContain('iOS platform application ARN format is invalid');
      expect(result.errors).toContain('iOS bundle ID format is invalid');
      expect(result.warnings).toContain('AWS region may be invalid: invalid-region');
    });
  });

  describe('Environment Variable Validation', () => {
    it('should validate required environment variables', () => {
      // Setup required environment variables
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

    it('should validate iOS environment variables', () => {
      // Setup all environment variables including iOS
      process.env.SPEND_THRESHOLD = '10';
      process.env.SNS_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts';
      process.env.AWS_REGION = 'us-east-1';
      process.env.IOS_PLATFORM_APP_ARN = 'arn:aws:sns:us-east-1:123456789012:app/APNS/SpendMonitorApp';
      process.env.IOS_BUNDLE_ID = 'com.example.spendmonitor';
      process.env.APNS_SANDBOX = 'true';

      const result = validateEnvironmentVariables();

      expect(result.isValid).toBe(true);
      expect(result.info).toContain('iOS environment variable set: IOS_PLATFORM_APP_ARN');
      expect(result.info).toContain('iOS environment variable set: IOS_BUNDLE_ID');
      expect(result.info).toContain('iOS environment variable set: APNS_SANDBOX');
    });

    it('should warn when iOS variables are missing', () => {
      // Setup only required variables, no iOS
      process.env.SPEND_THRESHOLD = '10';
      process.env.SNS_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts';
      process.env.AWS_REGION = 'us-east-1';

      const result = validateEnvironmentVariables();

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('No iOS environment variables configured - iOS notifications will be disabled');
    });
  });

  describe('Device Token Validation', () => {
    it('should validate device token formats in workflow', () => {
      const testCases = [
        {
          token: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          shouldBeValid: true,
          description: 'valid 64-character hex token'
        },
        {
          token: '0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF',
          shouldBeValid: true,
          description: 'valid uppercase hex token'
        },
        {
          token: '',
          shouldBeValid: false,
          description: 'empty token'
        },
        {
          token: '0123456789abcdef',
          shouldBeValid: false,
          description: 'too short token'
        },
        {
          token: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefg',
          shouldBeValid: false,
          description: 'invalid character in token'
        }
      ];

      for (const testCase of testCases) {
        const result = ConfigValidator.validateDeviceToken(testCase.token);
        
        if (testCase.shouldBeValid) {
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
        } else {
          expect(result.isValid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Validation Script Integration', () => {
    it('should run TypeScript validation script', () => {
      // Setup environment for script
      process.env.SPEND_THRESHOLD = '10';
      process.env.SNS_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts';
      process.env.AWS_REGION = 'us-east-1';

      // Test that the script can be executed (skip AWS validation)
      expect(() => {
        execSync('npx ts-node scripts/validate-config.ts --skip-aws --help', {
          cwd: process.cwd(),
          stdio: 'pipe'
        });
      }).not.toThrow();
    });

    it('should generate sample configuration', () => {
      const output = execSync('npx ts-node scripts/validate-config.ts --sample', {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: 'pipe'
      });

      expect(output).toContain('Sample Configuration');
      expect(output).toContain('SPEND_THRESHOLD=');
      expect(output).toContain('SNS_TOPIC_ARN=');
      expect(output).toContain('IOS_PLATFORM_APP_ARN=');
      expect(output).toContain('IOS_BUNDLE_ID=');
    });

    it('should validate shell scripts exist and are executable', () => {
      const scripts = [
        'scripts/pre-deployment-check.sh',
        'scripts/validate-deployment.sh',
        'scripts/validate-ios-config.sh'
      ];

      for (const script of scripts) {
        expect(fs.existsSync(script)).toBe(true);
        
        // Check if file is executable
        const stats = fs.statSync(script);
        expect(stats.mode & parseInt('111', 8)).toBeTruthy(); // Check execute permissions
      }
    });
  });

  describe('Configuration File Validation', () => {
    it('should validate configuration from JSON file', async () => {
      const testConfig = {
        spendThreshold: 25,
        snsTopicArn: 'arn:aws:sns:eu-west-1:987654321098:custom-alerts',
        region: 'eu-west-1',
        checkPeriodDays: 2,
        retryAttempts: 5,
        minServiceCostThreshold: 2,
        iosConfig: {
          platformApplicationArn: 'arn:aws:sns:eu-west-1:987654321098:app/APNS_SANDBOX/TestApp',
          bundleId: 'com.company.testapp',
          sandbox: true
        }
      };

      // Write test configuration file
      fs.writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      const validator = new ConfigValidator('eu-west-1');
      const result = await validator.validateConfiguration(testConfig, { skipAwsValidation: true });

      expect(result.isValid).toBe(true);
      expect(result.info).toContain('Spend threshold: $25');
      expect(result.info).toContain('AWS region: eu-west-1');
      expect(result.info).toContain('iOS bundle ID: com.company.testapp');
    });

    it('should handle malformed JSON configuration', () => {
      const malformedJson = '{ "spendThreshold": 10, "snsTopicArn": }'; // Invalid JSON
      fs.writeFileSync(testConfigPath, malformedJson);

      expect(() => {
        JSON.parse(fs.readFileSync(testConfigPath, 'utf8'));
      }).toThrow();
    });
  });

  describe('Validation Report Generation', () => {
    it('should generate comprehensive validation report', () => {
      const mockResult = {
        isValid: false,
        errors: [
          'SNS topic ARN format is invalid',
          'iOS platform application ARN format is invalid'
        ],
        warnings: [
          'Spend threshold is very low (< $1), may generate frequent alerts',
          'iOS environment variable not set: IOS_BUNDLE_ID'
        ],
        info: [
          'AWS region: us-east-1',
          'Configuration loaded successfully'
        ]
      };

      const report = ConfigValidator.generateValidationReport(mockResult);

      expect(report).toContain('Configuration Validation Report');
      expect(report).toContain('✗ Configuration has errors');
      expect(report).toContain('Errors: 2');
      expect(report).toContain('Warnings: 2');
      expect(report).toContain('Info: 2');
      expect(report).toContain('✗ SNS topic ARN format is invalid');
      expect(report).toContain('⚠ Spend threshold is very low');
      expect(report).toContain('ℹ AWS region: us-east-1');
    });

    it('should generate success report for valid configuration', () => {
      const mockResult = {
        isValid: true,
        errors: [],
        warnings: [],
        info: [
          'Configuration is valid',
          'All checks passed'
        ]
      };

      const report = ConfigValidator.generateValidationReport(mockResult);

      expect(report).toContain('✓ Configuration is valid');
      expect(report).toContain('Errors: 0');
      expect(report).toContain('Warnings: 0');
      expect(report).toContain('ℹ Configuration is valid');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle missing configuration gracefully', async () => {
      const validator = new ConfigValidator('us-east-1');
      
      // Test with minimal invalid configuration
      const minimalConfig = {
        spendThreshold: 0, // Invalid
        snsTopicArn: '', // Invalid
        region: '' // Invalid
      };

      const result = await validator.validateConfiguration(minimalConfig, { skipAwsValidation: true });

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle network errors in AWS validation', async () => {
      const validator = new ConfigValidator('us-east-1');
      
      // Mock network error
      const mockSend = jest.fn().mockRejectedValue(new Error('Network timeout'));
      (validator as any).snsClient.send = mockSend;
      (validator as any).costExplorerClient.send = mockSend;

      const config = {
        spendThreshold: 10,
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts',
        region: 'us-east-1'
      };

      const result = await validator.validateConfiguration(config);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(error => error.includes('Network timeout'))).toBe(true);
    });

    it('should validate extreme configuration values', async () => {
      const extremeConfig = {
        spendThreshold: 999999, // Very high threshold
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts',
        region: 'us-east-1',
        checkPeriodDays: 365, // Very high period
        retryAttempts: 100, // Very high retries
        minServiceCostThreshold: -1 // Negative threshold
      };

      const validator = new ConfigValidator('us-east-1');
      const result = await validator.validateConfiguration(extremeConfig, { skipAwsValidation: true });

      expect(result.warnings).toContain('Spend threshold is very high (> $10,000), may miss cost overruns');
      expect(result.warnings).toContain('Check period should be between 1 and 30 days');
      expect(result.warnings).toContain('Retry attempts should be between 1 and 10');
      expect(result.errors).toContain('Minimum service cost threshold cannot be negative');
    });
  });

  describe('iOS Specific Validation Scenarios', () => {
    it('should validate different iOS platform ARN formats', async () => {
      const testCases = [
        {
          arn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/ProductionApp',
          shouldBeValid: true,
          description: 'production APNS ARN'
        },
        {
          arn: 'arn:aws:sns:us-west-2:987654321098:app/APNS_SANDBOX/DevelopmentApp',
          shouldBeValid: true,
          description: 'sandbox APNS ARN'
        },
        {
          arn: 'arn:aws:sns:eu-central-1:555666777888:app/GCM/AndroidApp',
          shouldBeValid: false,
          description: 'GCM ARN (not APNS)'
        },
        {
          arn: 'arn:aws:sns:us-east-1:123456789012:MyTopic',
          shouldBeValid: false,
          description: 'regular SNS topic ARN'
        }
      ];

      const validator = new ConfigValidator('us-east-1');

      for (const testCase of testCases) {
        const config = {
          spendThreshold: 10,
          snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts',
          region: 'us-east-1',
          iosConfig: {
            platformApplicationArn: testCase.arn,
            bundleId: 'com.example.app'
          }
        };

        const result = await validator.validateConfiguration(config, { skipAwsValidation: true });

        if (testCase.shouldBeValid) {
          expect(result.errors).not.toContain('iOS platform application ARN format is invalid');
        } else {
          expect(result.errors).toContain('iOS platform application ARN format is invalid');
        }
      }
    });

    it('should validate different bundle ID formats', async () => {
      const testCases = [
        {
          bundleId: 'com.example.app',
          shouldBeValid: true,
          description: 'standard bundle ID'
        },
        {
          bundleId: 'org.opensource.project.module',
          shouldBeValid: true,
          description: 'multi-level bundle ID'
        },
        {
          bundleId: 'com.company-name.app-name',
          shouldBeValid: true,
          description: 'bundle ID with hyphens'
        },
        {
          bundleId: 'invalid',
          shouldBeValid: false,
          description: 'single component'
        },
        {
          bundleId: 'com.',
          shouldBeValid: false,
          description: 'trailing dot'
        },
        {
          bundleId: '.com.example',
          shouldBeValid: false,
          description: 'leading dot'
        }
      ];

      const validator = new ConfigValidator('us-east-1');

      for (const testCase of testCases) {
        const config = {
          spendThreshold: 10,
          snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts',
          region: 'us-east-1',
          iosConfig: {
            platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/SpendMonitorApp',
            bundleId: testCase.bundleId
          }
        };

        const result = await validator.validateConfiguration(config, { skipAwsValidation: true });

        if (testCase.shouldBeValid) {
          expect(result.errors).not.toContain('iOS bundle ID format is invalid');
        } else {
          expect(result.errors).toContain('iOS bundle ID format is invalid');
        }
      }
    });
  });
});