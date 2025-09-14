import {
  validateSpendMonitorConfig,
  validateiOSPushConfig,
  validateiOSDeviceRegistration,
  ValidationError,
  createDefaultConfig
} from '../src/validation';
import { SpendMonitorConfig, iOSPushConfig, iOSDeviceRegistration } from '../src/types';

describe('Validation', () => {
  describe('validateSpendMonitorConfig', () => {
    it('should validate a correct configuration', () => {
      const config: SpendMonitorConfig = {
        spendThreshold: 10,
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-alerts',
        checkPeriodDays: 1,
        region: 'us-east-1',
        retryAttempts: 3,
        minServiceCostThreshold: 1
      };

      expect(() => validateSpendMonitorConfig(config)).not.toThrow();
    });

    it('should reject invalid spending threshold', () => {
      const config = {
        spendThreshold: -5,
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-alerts',
        checkPeriodDays: 1,
        region: 'us-east-1',
        retryAttempts: 3,
        minServiceCostThreshold: 1
      };

      expect(() => validateSpendMonitorConfig(config)).toThrow(ValidationError);
      expect(() => validateSpendMonitorConfig(config)).toThrow('spendThreshold must be a positive number');
    });

    it('should reject invalid SNS topic ARN', () => {
      const config = {
        spendThreshold: 10,
        snsTopicArn: 'invalid-arn',
        checkPeriodDays: 1,
        region: 'us-east-1',
        retryAttempts: 3,
        minServiceCostThreshold: 1
      };

      expect(() => validateSpendMonitorConfig(config)).toThrow(ValidationError);
      expect(() => validateSpendMonitorConfig(config)).toThrow('snsTopicArn must be a valid SNS topic ARN format');
    });

    it('should reject missing required fields', () => {
      const config = {
        spendThreshold: 10
      };

      expect(() => validateSpendMonitorConfig(config)).toThrow(ValidationError);
    });

    it('should validate iOS configuration when provided', () => {
      const config: SpendMonitorConfig = {
        spendThreshold: 10,
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-alerts',
        checkPeriodDays: 1,
        region: 'us-east-1',
        retryAttempts: 3,
        minServiceCostThreshold: 1,
        iosConfig: {
          platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/MyApp',
          bundleId: 'com.example.spendmonitor',
          sandbox: true
        }
      };

      expect(() => validateSpendMonitorConfig(config)).not.toThrow();
    });
  });

  describe('validateiOSPushConfig', () => {
    it('should validate a correct iOS configuration', () => {
      const config: iOSPushConfig = {
        platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/MyApp',
        bundleId: 'com.example.spendmonitor',
        sandbox: true
      };

      const errors: string[] = [];
      validateiOSPushConfig(config, errors);
      expect(errors).toHaveLength(0);
    });

    it('should reject invalid platform application ARN', () => {
      const config: iOSPushConfig = {
        platformApplicationArn: 'invalid-arn',
        bundleId: 'com.example.spendmonitor',
        sandbox: true
      };

      const errors: string[] = [];
      validateiOSPushConfig(config, errors);
      expect(errors).toContain('iOS config: platformApplicationArn must be a valid SNS platform application ARN');
    });

    it('should reject invalid bundle ID', () => {
      const config: iOSPushConfig = {
        platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/MyApp',
        bundleId: 'invalid-bundle-id',
        sandbox: true
      };

      const errors: string[] = [];
      validateiOSPushConfig(config, errors);
      expect(errors).toContain('iOS config: bundleId must be a valid iOS bundle identifier format');
    });

    it('should reject non-boolean sandbox value', () => {
      const config = {
        platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/MyApp',
        bundleId: 'com.example.spendmonitor',
        sandbox: 'true' as any
      };

      const errors: string[] = [];
      validateiOSPushConfig(config, errors);
      expect(errors).toContain('iOS config: sandbox must be a boolean value');
    });
  });

  describe('validateiOSDeviceRegistration', () => {
    it('should validate a correct device registration', () => {
      const registration: iOSDeviceRegistration = {
        deviceToken: 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234567890',
        platformEndpointArn: 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/MyApp/12345678-1234-1234-1234-123456789012',
        registrationDate: '2023-01-01T00:00:00.000Z',
        lastUpdated: '2023-01-01T00:00:00.000Z',
        active: true
      };

      expect(() => validateiOSDeviceRegistration(registration)).not.toThrow();
    });

    it('should reject invalid device token', () => {
      const registration = {
        deviceToken: 'invalid-token',
        platformEndpointArn: 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/MyApp/12345678-1234-1234-1234-123456789012',
        registrationDate: '2023-01-01T00:00:00.000Z',
        lastUpdated: '2023-01-01T00:00:00.000Z',
        active: true
      };

      expect(() => validateiOSDeviceRegistration(registration)).toThrow(ValidationError);
      expect(() => validateiOSDeviceRegistration(registration)).toThrow('deviceToken must be a valid 64-character hexadecimal string');
    });

    it('should reject invalid endpoint ARN', () => {
      const registration = {
        deviceToken: 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234567890',
        platformEndpointArn: 'invalid-endpoint-arn',
        registrationDate: '2023-01-01T00:00:00.000Z',
        lastUpdated: '2023-01-01T00:00:00.000Z',
        active: true
      };

      expect(() => validateiOSDeviceRegistration(registration)).toThrow(ValidationError);
      expect(() => validateiOSDeviceRegistration(registration)).toThrow('platformEndpointArn must be a valid SNS endpoint ARN');
    });

    it('should reject invalid date formats', () => {
      const registration = {
        deviceToken: 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234567890',
        platformEndpointArn: 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/MyApp/12345678-1234-1234-1234-123456789012',
        registrationDate: 'invalid-date',
        lastUpdated: '2023-01-01T00:00:00.000Z',
        active: true
      };

      expect(() => validateiOSDeviceRegistration(registration)).toThrow(ValidationError);
      expect(() => validateiOSDeviceRegistration(registration)).toThrow('registrationDate must be a valid ISO date string');
    });
  });

  describe('createDefaultConfig', () => {
    it('should create a valid default configuration', () => {
      const config = createDefaultConfig({
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-alerts'
      });

      expect(config.spendThreshold).toBe(10);
      expect(config.checkPeriodDays).toBe(1);
      expect(config.region).toBe('us-east-1');
      expect(config.retryAttempts).toBe(3);
      expect(config.minServiceCostThreshold).toBe(1);
    });

    it('should allow overriding default values', () => {
      const config = createDefaultConfig({
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-alerts',
        spendThreshold: 25,
        region: 'us-west-2'
      });

      expect(config.spendThreshold).toBe(25);
      expect(config.region).toBe('us-west-2');
    });

    it('should validate the created configuration', () => {
      expect(() => createDefaultConfig({
        snsTopicArn: 'invalid-arn'
      })).toThrow(ValidationError);
    });
  });
});