/**
 * Configuration Validation Utilities
 * 
 * This module provides comprehensive validation for AWS Spend Monitor configuration
 * including iOS push notification settings, AWS service configurations, and
 * deployment prerequisites.
 */

import { SNSClient, GetTopicAttributesCommand, GetPlatformApplicationAttributesCommand } from '@aws-sdk/client-sns';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { LambdaClient, GetFunctionConfigurationCommand } from '@aws-sdk/client-lambda';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  info: string[];
}

export interface ConfigValidationOptions {
  skipAwsValidation?: boolean;
  skipNetworkTests?: boolean;
  region?: string;
}

export interface SpendMonitorConfigValidation {
  spendThreshold: number;
  snsTopicArn: string;
  region: string;
  checkPeriodDays?: number;
  retryAttempts?: number;
  minServiceCostThreshold?: number;
  iosConfig?: iOSConfigValidation;
}

export interface iOSConfigValidation {
  platformApplicationArn: string;
  bundleId: string;
  sandbox?: boolean;
  apnsCertificatePath?: string;
  apnsPrivateKeyPath?: string;
}

export class ConfigValidator {
  private snsClient: SNSClient;
  private costExplorerClient: CostExplorerClient;
  private lambdaClient: LambdaClient;
  private region: string;

  constructor(region: string = 'us-east-1') {
    this.region = region;
    this.snsClient = new SNSClient({ region });
    this.costExplorerClient = new CostExplorerClient({ region });
    this.lambdaClient = new LambdaClient({ region });
  }

  /**
   * Validates the complete spend monitor configuration
   */
  async validateConfiguration(
    config: SpendMonitorConfigValidation,
    options: ConfigValidationOptions = {}
  ): Promise<ValidationResult> {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      info: []
    };

    // Validate basic configuration
    this.validateBasicConfig(config, result);

    // Validate iOS configuration if present
    if (config.iosConfig) {
      this.validateiOSConfig(config.iosConfig, result);
    }

    // Validate AWS services if not skipped
    if (!options.skipAwsValidation) {
      await this.validateAwsServices(config, result);
    }

    // Set overall validity
    result.isValid = result.errors.length === 0;

    return result;
  }

  /**
   * Validates basic configuration parameters
   */
  private validateBasicConfig(config: SpendMonitorConfigValidation, result: ValidationResult): void {
    // Validate spend threshold
    if (typeof config.spendThreshold !== 'number' || config.spendThreshold <= 0) {
      result.errors.push('Spend threshold must be a positive number');
    } else if (config.spendThreshold < 1) {
      result.warnings.push('Spend threshold is very low (< $1), may generate frequent alerts');
    } else if (config.spendThreshold > 10000) {
      result.warnings.push('Spend threshold is very high (> $10,000), may miss cost overruns');
    } else {
      result.info.push(`Spend threshold: $${config.spendThreshold}`);
    }

    // Validate SNS topic ARN
    if (!config.snsTopicArn) {
      result.errors.push('SNS topic ARN is required');
    } else if (!this.isValidSnsTopicArn(config.snsTopicArn)) {
      result.errors.push('SNS topic ARN format is invalid');
    } else {
      result.info.push(`SNS topic ARN: ${config.snsTopicArn}`);
    }

    // Validate region
    if (!config.region) {
      result.errors.push('AWS region is required');
    } else if (!this.isValidAwsRegion(config.region)) {
      result.warnings.push(`AWS region may be invalid: ${config.region}`);
    } else {
      result.info.push(`AWS region: ${config.region}`);
    }

    // Validate optional parameters
    if (config.checkPeriodDays !== undefined) {
      if (config.checkPeriodDays < 1 || config.checkPeriodDays > 30) {
        result.warnings.push('Check period should be between 1 and 30 days');
      }
    }

    if (config.retryAttempts !== undefined) {
      if (config.retryAttempts < 1 || config.retryAttempts > 10) {
        result.warnings.push('Retry attempts should be between 1 and 10');
      }
    }

    if (config.minServiceCostThreshold !== undefined) {
      if (config.minServiceCostThreshold < 0) {
        result.errors.push('Minimum service cost threshold cannot be negative');
      }
    }
  }

  /**
   * Validates iOS configuration parameters
   */
  private validateiOSConfig(iosConfig: iOSConfigValidation, result: ValidationResult): void {
    // Validate platform application ARN
    if (!iosConfig.platformApplicationArn) {
      result.errors.push('iOS platform application ARN is required');
    } else if (!this.isValidPlatformApplicationArn(iosConfig.platformApplicationArn)) {
      result.errors.push('iOS platform application ARN format is invalid');
    } else {
      result.info.push(`iOS platform application ARN: ${iosConfig.platformApplicationArn}`);
    }

    // Validate bundle ID
    if (!iosConfig.bundleId) {
      result.errors.push('iOS bundle ID is required');
    } else if (!this.isValidBundleId(iosConfig.bundleId)) {
      result.errors.push('iOS bundle ID format is invalid');
    } else {
      result.info.push(`iOS bundle ID: ${iosConfig.bundleId}`);
    }

    // Validate sandbox setting
    if (iosConfig.sandbox !== undefined) {
      result.info.push(`APNS sandbox mode: ${iosConfig.sandbox}`);
    } else {
      result.warnings.push('APNS sandbox mode not specified, defaulting to production');
    }

    // Validate certificate paths if provided
    if (iosConfig.apnsCertificatePath) {
      if (!iosConfig.apnsCertificatePath.endsWith('.pem')) {
        result.warnings.push('APNS certificate should be a .pem file');
      }
    }

    if (iosConfig.apnsPrivateKeyPath) {
      if (!iosConfig.apnsPrivateKeyPath.endsWith('.pem')) {
        result.warnings.push('APNS private key should be a .pem file');
      }
    }
  }

  /**
   * Validates AWS services accessibility and configuration
   */
  private async validateAwsServices(config: SpendMonitorConfigValidation, result: ValidationResult): Promise<void> {
    try {
      // Validate SNS topic
      await this.validateSnsTopicAccess(config.snsTopicArn, result);

      // Validate iOS platform application if configured
      if (config.iosConfig?.platformApplicationArn) {
        await this.validatePlatformApplicationAccess(config.iosConfig.platformApplicationArn, result);
      }

      // Validate Cost Explorer access
      await this.validateCostExplorerAccess(result);

    } catch (error) {
      result.errors.push(`AWS service validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validates SNS topic accessibility
   */
  private async validateSnsTopicAccess(topicArn: string, result: ValidationResult): Promise<void> {
    try {
      const command = new GetTopicAttributesCommand({ TopicArn: topicArn });
      const response = await this.snsClient.send(command);
      
      if (response.Attributes) {
        result.info.push('SNS topic is accessible');
        
        // Check topic attributes
        const displayName = response.Attributes.DisplayName;
        if (displayName) {
          result.info.push(`SNS topic display name: ${displayName}`);
        }

        const subscriptionsConfirmed = response.Attributes.SubscriptionsConfirmed;
        if (subscriptionsConfirmed && parseInt(subscriptionsConfirmed) === 0) {
          result.warnings.push('SNS topic has no confirmed subscriptions');
        } else if (subscriptionsConfirmed) {
          result.info.push(`SNS topic has ${subscriptionsConfirmed} confirmed subscription(s)`);
        }
      }
    } catch (error) {
      result.errors.push(`Cannot access SNS topic: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validates iOS platform application accessibility
   */
  private async validatePlatformApplicationAccess(platformArn: string, result: ValidationResult): Promise<void> {
    try {
      const command = new GetPlatformApplicationAttributesCommand({ PlatformApplicationArn: platformArn });
      const response = await this.snsClient.send(command);
      
      if (response.Attributes) {
        result.info.push('iOS platform application is accessible');
        
        // Check if enabled
        const enabled = response.Attributes.Enabled;
        if (enabled === 'false') {
          result.errors.push('iOS platform application is disabled');
        } else {
          result.info.push('iOS platform application is enabled');
        }

        // Check platform type
        const platform = response.Attributes.Platform;
        if (platform && platform !== 'APNS' && platform !== 'APNS_SANDBOX') {
          result.warnings.push(`Unexpected platform type: ${platform}`);
        } else if (platform) {
          result.info.push(`Platform type: ${platform}`);
        }

        // Check feedback roles
        const successRole = response.Attributes.SuccessFeedbackRoleArn;
        const failureRole = response.Attributes.FailureFeedbackRoleArn;
        
        if (!successRole && !failureRole) {
          result.warnings.push('No feedback roles configured for iOS platform application');
        }
      }
    } catch (error) {
      result.errors.push(`Cannot access iOS platform application: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validates Cost Explorer accessibility
   */
  private async validateCostExplorerAccess(result: ValidationResult): Promise<void> {
    try {
      // Test with a minimal query for the last 2 days
      const endDate = new Date();
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 2);

      const command = new GetCostAndUsageCommand({
        TimePeriod: {
          Start: startDate.toISOString().split('T')[0],
          End: endDate.toISOString().split('T')[0]
        },
        Granularity: 'DAILY',
        Metrics: ['BlendedCost']
      });

      await this.costExplorerClient.send(command);
      result.info.push('Cost Explorer API is accessible');
    } catch (error) {
      result.errors.push(`Cannot access Cost Explorer API: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validates device token format
   */
  static validateDeviceToken(token: string): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      info: []
    };

    if (!token) {
      result.errors.push('Device token is required');
    } else if (token.length !== 64) {
      result.errors.push(`Device token must be 64 characters long (got ${token.length})`);
    } else if (!/^[0-9a-fA-F]+$/.test(token)) {
      result.errors.push('Device token must contain only hexadecimal characters');
    } else {
      result.info.push('Device token format is valid');
    }

    result.isValid = result.errors.length === 0;
    return result;
  }

  /**
   * Validates Lambda function configuration
   */
  async validateLambdaFunction(functionName: string): Promise<ValidationResult> {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      info: []
    };

    try {
      const command = new GetFunctionConfigurationCommand({ FunctionName: functionName });
      const response = await this.lambdaClient.send(command);

      result.info.push(`Lambda function found: ${functionName}`);

      // Check runtime
      if (response.Runtime && !response.Runtime.startsWith('nodejs')) {
        result.warnings.push(`Unexpected runtime: ${response.Runtime}`);
      } else if (response.Runtime) {
        result.info.push(`Runtime: ${response.Runtime}`);
      }

      // Check memory
      if (response.MemorySize && response.MemorySize < 512) {
        result.warnings.push(`Memory allocation may be low: ${response.MemorySize}MB (recommended: 512MB+)`);
      } else if (response.MemorySize) {
        result.info.push(`Memory: ${response.MemorySize}MB`);
      }

      // Check timeout
      if (response.Timeout && response.Timeout < 60) {
        result.warnings.push(`Timeout may be low: ${response.Timeout}s (recommended: 60s+)`);
      } else if (response.Timeout) {
        result.info.push(`Timeout: ${response.Timeout}s`);
      }

      // Check environment variables
      const envVars = response.Environment?.Variables || {};
      const requiredVars = ['SPEND_THRESHOLD', 'SNS_TOPIC_ARN'];
      const iosVars = ['IOS_PLATFORM_APP_ARN', 'IOS_BUNDLE_ID'];

      for (const varName of requiredVars) {
        if (!envVars[varName]) {
          result.errors.push(`Required environment variable missing: ${varName}`);
        } else {
          result.info.push(`Environment variable set: ${varName}`);
        }
      }

      for (const varName of iosVars) {
        if (!envVars[varName]) {
          result.warnings.push(`iOS environment variable not set: ${varName}`);
        } else {
          result.info.push(`iOS environment variable set: ${varName}`);
        }
      }

    } catch (error) {
      result.errors.push(`Cannot access Lambda function: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    result.isValid = result.errors.length === 0;
    return result;
  }

  /**
   * Validates SNS topic ARN format
   */
  private isValidSnsTopicArn(arn: string): boolean {
    const arnPattern = /^arn:aws:sns:[a-z0-9-]+:\d{12}:[a-zA-Z0-9_-]+$/;
    return arnPattern.test(arn);
  }

  /**
   * Validates platform application ARN format
   */
  private isValidPlatformApplicationArn(arn: string): boolean {
    const arnPattern = /^arn:aws:sns:[a-z0-9-]+:\d{12}:app\/APNS[_SANDBOX]*\/[a-zA-Z0-9_-]+$/;
    return arnPattern.test(arn);
  }

  /**
   * Validates iOS bundle ID format
   */
  private isValidBundleId(bundleId: string): boolean {
    const bundleIdPattern = /^[a-zA-Z0-9.-]+\.[a-zA-Z0-9.-]+$/;
    return bundleIdPattern.test(bundleId);
  }

  /**
   * Validates AWS region format
   */
  private isValidAwsRegion(region: string): boolean {
    const regionPattern = /^[a-z]{2}-[a-z]+-\d+$/;
    return regionPattern.test(region);
  }

  /**
   * Generates a configuration validation report
   */
  static generateValidationReport(result: ValidationResult): string {
    const lines: string[] = [];
    
    lines.push('Configuration Validation Report');
    lines.push('================================');
    lines.push('');

    if (result.isValid) {
      lines.push('✓ Configuration is valid');
    } else {
      lines.push('✗ Configuration has errors');
    }

    lines.push('');
    lines.push(`Errors: ${result.errors.length}`);
    lines.push(`Warnings: ${result.warnings.length}`);
    lines.push(`Info: ${result.info.length}`);
    lines.push('');

    if (result.errors.length > 0) {
      lines.push('Errors:');
      result.errors.forEach(error => lines.push(`  ✗ ${error}`));
      lines.push('');
    }

    if (result.warnings.length > 0) {
      lines.push('Warnings:');
      result.warnings.forEach(warning => lines.push(`  ⚠ ${warning}`));
      lines.push('');
    }

    if (result.info.length > 0) {
      lines.push('Information:');
      result.info.forEach(info => lines.push(`  ℹ ${info}`));
      lines.push('');
    }

    return lines.join('\n');
  }
}

/**
 * Validates environment variables for the spend monitor
 */
export function validateEnvironmentVariables(): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
    info: []
  };

  const requiredVars = [
    'SPEND_THRESHOLD',
    'SNS_TOPIC_ARN',
    'AWS_REGION'
  ];

  const optionalVars = [
    'CHECK_PERIOD_DAYS',
    'RETRY_ATTEMPTS',
    'MIN_SERVICE_COST_THRESHOLD'
  ];

  const iosVars = [
    'IOS_PLATFORM_APP_ARN',
    'IOS_BUNDLE_ID',
    'APNS_SANDBOX'
  ];

  // Check required variables
  for (const varName of requiredVars) {
    const value = process.env[varName];
    if (!value) {
      result.errors.push(`Required environment variable missing: ${varName}`);
    } else {
      result.info.push(`Environment variable set: ${varName}`);
    }
  }

  // Check optional variables
  for (const varName of optionalVars) {
    const value = process.env[varName];
    if (value) {
      result.info.push(`Optional environment variable set: ${varName}`);
    }
  }

  // Check iOS variables
  let iosConfigured = false;
  for (const varName of iosVars) {
    const value = process.env[varName];
    if (value) {
      result.info.push(`iOS environment variable set: ${varName}`);
      iosConfigured = true;
    }
  }

  if (!iosConfigured) {
    result.warnings.push('No iOS environment variables configured - iOS notifications will be disabled');
  }

  result.isValid = result.errors.length === 0;
  return result;
}

/**
 * Creates a sample configuration for testing
 */
export function createSampleConfig(): SpendMonitorConfigValidation {
  return {
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
}