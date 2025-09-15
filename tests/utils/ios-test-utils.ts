/**
 * iOS Testing Utilities
 * 
 * This file provides utilities for testing iOS push notifications,
 * APNS payload validation, and device registration scenarios.
 */

import { APNSPayload, iOSDeviceRegistration, iOSPushConfig } from '../../src/types';
import { SNSClient, CreatePlatformEndpointCommand, DeleteEndpointCommand, PublishCommand } from '@aws-sdk/client-sns';

/**
 * APNS payload validation utilities
 */
export class APNSPayloadValidator {
  /**
   * Validates APNS payload structure and content
   */
  static validatePayload(payload: APNSPayload): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate required aps structure
    if (!payload.aps) {
      errors.push('Missing required "aps" field');
      return { isValid: false, errors, warnings };
    }

    // Validate alert structure
    if (!payload.aps.alert) {
      errors.push('Missing required "aps.alert" field');
    } else {
      if (!payload.aps.alert.title || typeof payload.aps.alert.title !== 'string') {
        errors.push('Missing or invalid "aps.alert.title"');
      } else if (payload.aps.alert.title.length > 100) {
        warnings.push('Alert title exceeds recommended 100 character limit');
      }

      if (!payload.aps.alert.body || typeof payload.aps.alert.body !== 'string') {
        errors.push('Missing or invalid "aps.alert.body"');
      } else if (payload.aps.alert.body.length > 200) {
        warnings.push('Alert body exceeds recommended 200 character limit');
      }

      if (payload.aps.alert.subtitle && payload.aps.alert.subtitle.length > 100) {
        warnings.push('Alert subtitle exceeds recommended 100 character limit');
      }
    }

    // Validate badge
    if (typeof payload.aps.badge !== 'number' || payload.aps.badge < 0) {
      errors.push('Invalid "aps.badge" - must be a non-negative number');
    }

    // Validate sound
    if (!payload.aps.sound || typeof payload.aps.sound !== 'string') {
      errors.push('Missing or invalid "aps.sound"');
    }

    // Validate content-available
    if (payload.aps['content-available'] !== 1) {
      warnings.push('content-available should be 1 for background updates');
    }

    // Validate custom data
    if (!payload.customData) {
      warnings.push('Missing customData field');
    } else {
      const requiredFields = ['spendAmount', 'threshold', 'exceedAmount', 'topService', 'alertId'];
      for (const field of requiredFields) {
        if (!(field in payload.customData)) {
          warnings.push(`Missing customData.${field}`);
        }
      }

      if (typeof payload.customData.spendAmount !== 'number' || payload.customData.spendAmount < 0) {
        errors.push('Invalid customData.spendAmount - must be a non-negative number');
      }

      if (typeof payload.customData.threshold !== 'number' || payload.customData.threshold < 0) {
        errors.push('Invalid customData.threshold - must be a non-negative number');
      }

      if (typeof payload.customData.exceedAmount !== 'number' || payload.customData.exceedAmount < 0) {
        errors.push('Invalid customData.exceedAmount - must be a non-negative number');
      }
    }

    // Check total payload size (APNS limit is 4KB)
    const payloadSize = JSON.stringify(payload).length;
    if (payloadSize > 4096) {
      errors.push(`Payload size (${payloadSize} bytes) exceeds APNS limit of 4096 bytes`);
    } else if (payloadSize > 3500) {
      warnings.push(`Payload size (${payloadSize} bytes) is close to APNS limit`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      payloadSize
    };
  }

  /**
   * Validates payload against APNS sandbox requirements
   */
  static validateForSandbox(payload: APNSPayload): ValidationResult {
    const result = this.validatePayload(payload);
    
    // Additional sandbox-specific validations
    if (payload.aps.sound && !['default', 'critical-alert.caf'].includes(payload.aps.sound)) {
      result.warnings.push('Custom sound files may not work in sandbox environment');
    }

    return result;
  }

  /**
   * Creates a test APNS payload with valid structure
   */
  static createTestPayload(overrides: Partial<APNSPayload> = {}): APNSPayload {
    const defaultPayload: APNSPayload = {
      aps: {
        alert: {
          title: 'Test Alert',
          body: 'This is a test notification',
          subtitle: 'Test Subtitle'
        },
        badge: 1,
        sound: 'default',
        'content-available': 1
      },
      customData: {
        spendAmount: 15.50,
        threshold: 10.00,
        exceedAmount: 5.50,
        topService: 'EC2',
        alertId: `test-alert-${Date.now()}`
      }
    };

    return this.mergePayloads(defaultPayload, overrides);
  }

  /**
   * Creates an invalid payload for testing error handling
   */
  static createInvalidPayload(invalidationType: 'missing-aps' | 'invalid-badge' | 'oversized' | 'missing-alert'): any {
    const basePayload = this.createTestPayload();

    switch (invalidationType) {
      case 'missing-aps':
        const { aps, ...withoutAps } = basePayload;
        return withoutAps;

      case 'invalid-badge':
        return {
          ...basePayload,
          aps: {
            ...basePayload.aps,
            badge: -1
          }
        };

      case 'oversized':
        return {
          ...basePayload,
          customData: {
            ...basePayload.customData,
            largeData: 'x'.repeat(5000) // Make payload too large
          }
        };

      case 'missing-alert':
        const { alert, ...apsWithoutAlert } = basePayload.aps;
        return {
          ...basePayload,
          aps: apsWithoutAlert
        };

      default:
        return basePayload;
    }
  }

  /**
   * Merges two APNS payloads deeply
   */
  private static mergePayloads(base: APNSPayload, overrides: Partial<APNSPayload>): APNSPayload {
    return {
      aps: {
        ...base.aps,
        ...overrides.aps,
        alert: {
          ...base.aps.alert,
          ...overrides.aps?.alert
        }
      },
      customData: {
        ...base.customData,
        ...overrides.customData
      }
    };
  }
}

/**
 * Test device token generator and validator
 */
export class TestDeviceTokenGenerator {
  /**
   * Generates a valid test device token (64-character hex string)
   */
  static generateValidToken(): string {
    const chars = '0123456789abcdef';
    let token = '';
    for (let i = 0; i < 64; i++) {
      token += chars[Math.floor(Math.random() * chars.length)];
    }
    return token;
  }

  /**
   * Generates multiple unique valid tokens
   */
  static generateValidTokens(count: number): string[] {
    const tokens = new Set<string>();
    while (tokens.size < count) {
      tokens.add(this.generateValidToken());
    }
    return Array.from(tokens);
  }

  /**
   * Generates invalid tokens for testing error handling
   */
  static generateInvalidToken(type: 'too-short' | 'too-long' | 'invalid-chars' | 'empty'): string {
    switch (type) {
      case 'too-short':
        return '1234567890abcdef'; // 16 chars instead of 64

      case 'too-long':
        return '1234567890abcdef'.repeat(5); // 80 chars instead of 64

      case 'invalid-chars':
        return 'g'.repeat(64); // Invalid hex character

      case 'empty':
        return '';

      default:
        return this.generateValidToken();
    }
  }

  /**
   * Validates device token format
   */
  static validateToken(token: string): { isValid: boolean; error?: string } {
    if (!token) {
      return { isValid: false, error: 'Token is empty' };
    }

    if (token.length !== 64) {
      return { isValid: false, error: `Token length is ${token.length}, expected 64` };
    }

    if (!/^[0-9a-fA-F]{64}$/.test(token)) {
      return { isValid: false, error: 'Token contains invalid characters (must be hexadecimal)' };
    }

    return { isValid: true };
  }
}

/**
 * iOS device registration test helper
 */
export class iOSDeviceTestHelper {
  private snsClient: SNSClient;
  private createdEndpoints: string[] = [];

  constructor(region: string = 'us-east-1') {
    this.snsClient = new SNSClient({ region });
  }

  /**
   * Creates a test device registration
   */
  async createTestRegistration(
    platformApplicationArn: string,
    deviceToken?: string,
    userId?: string
  ): Promise<iOSDeviceRegistration> {
    const token = deviceToken || TestDeviceTokenGenerator.generateValidToken();
    const now = new Date().toISOString();

    const createEndpointCommand = new CreatePlatformEndpointCommand({
      PlatformApplicationArn: platformApplicationArn,
      Token: token,
      CustomUserData: userId ? JSON.stringify({ userId, testDevice: true }) : JSON.stringify({ testDevice: true })
    });

    const response = await this.snsClient.send(createEndpointCommand);
    
    if (!response.EndpointArn) {
      throw new Error('Failed to create test endpoint');
    }

    this.createdEndpoints.push(response.EndpointArn);

    return {
      deviceToken: token,
      platformEndpointArn: response.EndpointArn,
      userId,
      registrationDate: now,
      lastUpdated: now,
      active: true
    };
  }

  /**
   * Creates multiple test registrations
   */
  async createMultipleTestRegistrations(
    platformApplicationArn: string,
    count: number
  ): Promise<iOSDeviceRegistration[]> {
    const registrations: iOSDeviceRegistration[] = [];
    const tokens = TestDeviceTokenGenerator.generateValidTokens(count);

    for (let i = 0; i < count; i++) {
      const registration = await this.createTestRegistration(
        platformApplicationArn,
        tokens[i],
        `test-user-${i + 1}`
      );
      registrations.push(registration);
    }

    return registrations;
  }

  /**
   * Sends a test notification to a device
   */
  async sendTestNotification(
    endpointArn: string,
    payload: APNSPayload
  ): Promise<{ messageId: string; success: boolean; error?: string }> {
    try {
      const publishCommand = new PublishCommand({
        TargetArn: endpointArn,
        Message: JSON.stringify({
          APNS: JSON.stringify(payload),
          APNS_SANDBOX: JSON.stringify(payload)
        }),
        MessageStructure: 'json'
      });

      const response = await this.snsClient.send(publishCommand);
      
      return {
        messageId: response.MessageId || 'unknown',
        success: true
      };
    } catch (error) {
      return {
        messageId: '',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Cleans up all created test endpoints
   */
  async cleanup(): Promise<void> {
    const cleanupPromises = this.createdEndpoints.map(async (endpointArn) => {
      try {
        const deleteCommand = new DeleteEndpointCommand({
          EndpointArn: endpointArn
        });
        await this.snsClient.send(deleteCommand);
        console.log(`Cleaned up test endpoint: ${endpointArn}`);
      } catch (error) {
        console.warn(`Failed to cleanup endpoint ${endpointArn}:`, error);
      }
    });

    await Promise.all(cleanupPromises);
    this.createdEndpoints = [];
  }

  /**
   * Gets the list of created endpoints for verification
   */
  getCreatedEndpoints(): string[] {
    return [...this.createdEndpoints];
  }
}

/**
 * Performance testing utilities for iOS notifications
 */
export class iOSPerformanceTestHelper {
  private measurements: { [key: string]: number[] } = {};

  /**
   * Measures the time taken for a notification operation
   */
  async measureOperation<T>(
    operationName: string,
    operation: () => Promise<T>
  ): Promise<{ result: T; duration: number }> {
    const startTime = Date.now();
    
    try {
      const result = await operation();
      const duration = Date.now() - startTime;
      
      if (!this.measurements[operationName]) {
        this.measurements[operationName] = [];
      }
      this.measurements[operationName].push(duration);
      
      return { result, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (!this.measurements[operationName]) {
        this.measurements[operationName] = [];
      }
      this.measurements[operationName].push(duration);
      
      throw error;
    }
  }

  /**
   * Gets performance statistics for an operation
   */
  getOperationStats(operationName: string): PerformanceStats | null {
    const measurements = this.measurements[operationName];
    if (!measurements || measurements.length === 0) {
      return null;
    }

    const sorted = [...measurements].sort((a, b) => a - b);
    const sum = measurements.reduce((a, b) => a + b, 0);

    return {
      count: measurements.length,
      min: Math.min(...measurements),
      max: Math.max(...measurements),
      average: sum / measurements.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  /**
   * Resets all measurements
   */
  reset(): void {
    this.measurements = {};
  }

  /**
   * Gets all measurements
   */
  getAllStats(): { [operationName: string]: PerformanceStats } {
    const stats: { [operationName: string]: PerformanceStats } = {};
    
    for (const operationName of Object.keys(this.measurements)) {
      const operationStats = this.getOperationStats(operationName);
      if (operationStats) {
        stats[operationName] = operationStats;
      }
    }
    
    return stats;
  }
}

/**
 * APNS sandbox configuration helper
 */
export class APNSSandboxHelper {
  /**
   * Creates a sandbox-compatible iOS configuration
   */
  static createSandboxConfig(platformApplicationArn: string): iOSPushConfig {
    return {
      platformApplicationArn,
      bundleId: 'com.example.spendmonitor.test',
      sandbox: true
    };
  }

  /**
   * Validates that a platform application is configured for sandbox
   */
  static validateSandboxConfiguration(config: iOSPushConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.sandbox) {
      warnings.push('Configuration is not set for sandbox environment');
    }

    if (!config.platformApplicationArn.includes('APNS')) {
      errors.push('Platform application ARN does not appear to be for APNS');
    }

    if (config.bundleId && !config.bundleId.includes('test') && !config.bundleId.includes('dev')) {
      warnings.push('Bundle ID does not appear to be for testing/development');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Creates test scenarios for sandbox testing
   */
  static createTestScenarios(): TestScenario[] {
    return [
      {
        name: 'Valid notification',
        payload: APNSPayloadValidator.createTestPayload(),
        expectedResult: 'success'
      },
      {
        name: 'Critical alert',
        payload: APNSPayloadValidator.createTestPayload({
          aps: {
            alert: {
              title: 'Critical AWS Spend Alert',
              body: '$50.00 spent - $40.00 over budget',
              subtitle: 'Critical Budget Exceeded'
            },
            badge: 1,
            sound: 'critical-alert.caf',
            'content-available': 1
          }
        }),
        expectedResult: 'success'
      },
      {
        name: 'Large payload',
        payload: APNSPayloadValidator.createTestPayload({
          customData: {
            spendAmount: 999.99,
            threshold: 100.00,
            exceedAmount: 899.99,
            topService: 'Amazon Elastic Compute Cloud - Compute',
            alertId: `large-alert-${Date.now()}-with-long-identifier`
          }
        }),
        expectedResult: 'success'
      },
      {
        name: 'Invalid payload structure',
        payload: APNSPayloadValidator.createInvalidPayload('missing-aps'),
        expectedResult: 'error'
      }
    ];
  }
}

/**
 * Type definitions for test utilities
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  payloadSize?: number;
}

export interface PerformanceStats {
  count: number;
  min: number;
  max: number;
  average: number;
  median: number;
  p95: number;
  p99: number;
}

export interface TestScenario {
  name: string;
  payload: any;
  expectedResult: 'success' | 'error' | 'warning';
}

/**
 * Mock APNS feedback service for testing invalid token handling
 */
export class MockAPNSFeedbackService {
  private invalidTokens: Set<string> = new Set();

  /**
   * Marks a token as invalid (simulates APNS feedback)
   */
  markTokenAsInvalid(token: string): void {
    this.invalidTokens.add(token);
  }

  /**
   * Checks if a token is marked as invalid
   */
  isTokenInvalid(token: string): boolean {
    return this.invalidTokens.has(token);
  }

  /**
   * Gets all invalid tokens
   */
  getInvalidTokens(): string[] {
    return Array.from(this.invalidTokens);
  }

  /**
   * Clears all invalid tokens
   */
  clearInvalidTokens(): void {
    this.invalidTokens.clear();
  }

  /**
   * Simulates APNS feedback response
   */
  generateFeedbackResponse(): Array<{ token: string; timestamp: number; reason: string }> {
    return Array.from(this.invalidTokens).map(token => ({
      token,
      timestamp: Date.now(),
      reason: 'InvalidToken'
    }));
  }
}