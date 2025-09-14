import { SpendMonitorConfig, iOSPushConfig, iOSDeviceRegistration } from './types';

/**
 * Validation error class for configuration issues
 */
export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validates the spend monitor configuration
 */
export function validateSpendMonitorConfig(config: Partial<SpendMonitorConfig>): void {
  const errors: string[] = [];

  // Validate spending threshold
  if (typeof config.spendThreshold !== 'number' || config.spendThreshold <= 0) {
    errors.push('spendThreshold must be a positive number');
  }

  // Validate SNS topic ARN
  if (!config.snsTopicArn || typeof config.snsTopicArn !== 'string') {
    errors.push('snsTopicArn is required and must be a string');
  } else if (!isValidSNSTopicArn(config.snsTopicArn)) {
    errors.push('snsTopicArn must be a valid SNS topic ARN format');
  }

  // Validate check period
  if (typeof config.checkPeriodDays !== 'number' || config.checkPeriodDays <= 0) {
    errors.push('checkPeriodDays must be a positive number');
  }

  // Validate region
  if (!config.region || typeof config.region !== 'string') {
    errors.push('region is required and must be a string');
  }

  // Validate retry attempts
  if (typeof config.retryAttempts !== 'number' || config.retryAttempts < 0) {
    errors.push('retryAttempts must be a non-negative number');
  }

  // Validate minimum service cost threshold
  if (typeof config.minServiceCostThreshold !== 'number' || config.minServiceCostThreshold < 0) {
    errors.push('minServiceCostThreshold must be a non-negative number');
  }

  // Validate iOS configuration if provided
  if (config.iosConfig) {
    validateiOSPushConfig(config.iosConfig, errors);
  }

  if (errors.length > 0) {
    throw new ValidationError(`Configuration validation failed: ${errors.join(', ')}`);
  }
}

/**
 * Validates iOS push notification configuration
 */
export function validateiOSPushConfig(config: iOSPushConfig, errors: string[] = []): void {
  if (!config.platformApplicationArn || typeof config.platformApplicationArn !== 'string') {
    errors.push('iOS config: platformApplicationArn is required and must be a string');
  } else if (!isValidSNSPlatformApplicationArn(config.platformApplicationArn)) {
    errors.push('iOS config: platformApplicationArn must be a valid SNS platform application ARN');
  }

  if (!config.bundleId || typeof config.bundleId !== 'string') {
    errors.push('iOS config: bundleId is required and must be a string');
  } else if (!isValidBundleId(config.bundleId)) {
    errors.push('iOS config: bundleId must be a valid iOS bundle identifier format');
  }

  if (typeof config.sandbox !== 'boolean') {
    errors.push('iOS config: sandbox must be a boolean value');
  }

  if (config.apnsCertificatePath && typeof config.apnsCertificatePath !== 'string') {
    errors.push('iOS config: apnsCertificatePath must be a string if provided');
  }

  if (config.apnsPrivateKeyPath && typeof config.apnsPrivateKeyPath !== 'string') {
    errors.push('iOS config: apnsPrivateKeyPath must be a string if provided');
  }
}

/**
 * Validates iOS device registration data
 */
export function validateiOSDeviceRegistration(registration: Partial<iOSDeviceRegistration>): void {
  const errors: string[] = [];

  if (!registration.deviceToken || typeof registration.deviceToken !== 'string') {
    errors.push('deviceToken is required and must be a string');
  } else if (!isValidAPNSDeviceToken(registration.deviceToken)) {
    errors.push('deviceToken must be a valid 64-character hexadecimal string');
  }

  if (!registration.platformEndpointArn || typeof registration.platformEndpointArn !== 'string') {
    errors.push('platformEndpointArn is required and must be a string');
  } else if (!isValidSNSEndpointArn(registration.platformEndpointArn)) {
    errors.push('platformEndpointArn must be a valid SNS endpoint ARN');
  }

  if (registration.userId && typeof registration.userId !== 'string') {
    errors.push('userId must be a string if provided');
  }

  if (!registration.registrationDate || typeof registration.registrationDate !== 'string') {
    errors.push('registrationDate is required and must be a string');
  } else if (!isValidISODate(registration.registrationDate)) {
    errors.push('registrationDate must be a valid ISO date string');
  }

  if (!registration.lastUpdated || typeof registration.lastUpdated !== 'string') {
    errors.push('lastUpdated is required and must be a string');
  } else if (!isValidISODate(registration.lastUpdated)) {
    errors.push('lastUpdated must be a valid ISO date string');
  }

  if (typeof registration.active !== 'boolean') {
    errors.push('active must be a boolean value');
  }

  if (errors.length > 0) {
    throw new ValidationError(`Device registration validation failed: ${errors.join(', ')}`);
  }
}

/**
 * Validates SNS topic ARN format
 */
function isValidSNSTopicArn(arn: string): boolean {
  const snsTopicArnPattern = /^arn:aws:sns:[a-z0-9-]+:\d{12}:[a-zA-Z0-9_-]+$/;
  return snsTopicArnPattern.test(arn);
}

/**
 * Validates SNS platform application ARN format
 */
function isValidSNSPlatformApplicationArn(arn: string): boolean {
  const platformAppArnPattern = /^arn:aws:sns:[a-z0-9-]+:\d{12}:app\/[A-Z_]+\/[a-zA-Z0-9_-]+$/;
  return platformAppArnPattern.test(arn);
}

/**
 * Validates SNS endpoint ARN format
 */
function isValidSNSEndpointArn(arn: string): boolean {
  const endpointArnPattern = /^arn:aws:sns:[a-z0-9-]+:\d{12}:endpoint\/[A-Z_]+\/[a-zA-Z0-9_-]+\/[a-f0-9-]+$/;
  return endpointArnPattern.test(arn);
}

/**
 * Validates iOS bundle identifier format
 */
function isValidBundleId(bundleId: string): boolean {
  const bundleIdPattern = /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/;
  return bundleIdPattern.test(bundleId);
}

/**
 * Validates APNS device token format (64-character hex string)
 */
function isValidAPNSDeviceToken(token: string): boolean {
  const tokenPattern = /^[a-fA-F0-9]{64}$/;
  return tokenPattern.test(token);
}

/**
 * Validates ISO date string format
 */
function isValidISODate(dateString: string): boolean {
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime()) && date.toISOString() === dateString;
}

/**
 * Creates a default spend monitor configuration with validation
 */
export function createDefaultConfig(overrides: Partial<SpendMonitorConfig> = {}): SpendMonitorConfig {
  const defaultConfig: SpendMonitorConfig = {
    spendThreshold: 10,
    snsTopicArn: '',
    checkPeriodDays: 1,
    region: 'us-east-1',
    retryAttempts: 3,
    minServiceCostThreshold: 1,
    ...overrides
  };

  validateSpendMonitorConfig(defaultConfig);
  return defaultConfig;
}