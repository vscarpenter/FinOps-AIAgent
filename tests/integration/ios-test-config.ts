/**
 * iOS Integration Test Configuration
 * 
 * This file contains iOS-specific configuration and utilities for integration tests
 * that require APNS platform applications and real iOS device tokens.
 */

import { iOSPushConfig } from '../../src/types';

export interface iOSTestConfig {
  /** Whether iOS integration tests should run */
  enabled: boolean;
  /** SNS Platform Application ARN for APNS */
  platformApplicationArn?: string;
  /** iOS app bundle identifier */
  bundleId?: string;
  /** Use APNS sandbox environment */
  sandbox: boolean;
  /** Test timeout for iOS operations */
  testTimeout: number;
  /** Performance thresholds for iOS operations */
  performanceThresholds: {
    deviceRegistration: number;
    payloadFormatting: number;
    notificationDelivery: number;
    batchOperations: number;
  };
  /** Test device limits */
  deviceLimits: {
    maxTestDevices: number;
    maxBatchSize: number;
  };
}

export const DEFAULT_IOS_TEST_CONFIG: iOSTestConfig = {
  enabled: process.env.TEST_IOS_INTEGRATION === 'true',
  platformApplicationArn: process.env.TEST_IOS_PLATFORM_ARN,
  bundleId: process.env.TEST_IOS_BUNDLE_ID || 'com.example.spendmonitor.test',
  sandbox: true,
  testTimeout: 30000, // 30 seconds
  performanceThresholds: {
    deviceRegistration: 3000,    // 3 seconds
    payloadFormatting: 100,      // 100ms
    notificationDelivery: 5000,  // 5 seconds
    batchOperations: 10000       // 10 seconds
  },
  deviceLimits: {
    maxTestDevices: 10,
    maxBatchSize: 5
  }
};

/**
 * Validates iOS test environment configuration
 */
export function validateiOSTestEnvironment(): void {
  if (!DEFAULT_IOS_TEST_CONFIG.enabled) {
    throw new Error('iOS integration tests are disabled. Set TEST_IOS_INTEGRATION=true to enable.');
  }

  const requiredVars = [
    'TEST_IOS_PLATFORM_ARN',
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY'
  ];

  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables for iOS integration tests: ${missingVars.join(', ')}\n` +
      'Please ensure the following are configured:\n' +
      '  TEST_IOS_INTEGRATION=true\n' +
      '  TEST_IOS_PLATFORM_ARN=<your-sns-platform-application-arn>\n' +
      '  TEST_IOS_BUNDLE_ID=<your-ios-bundle-id> (optional)\n' +
      '  AWS_REGION=<aws-region>\n' +
      '  AWS_ACCESS_KEY_ID=<your-access-key>\n' +
      '  AWS_SECRET_ACCESS_KEY=<your-secret-key>'
    );
  }

  // Validate platform application ARN format
  const platformArn = process.env.TEST_IOS_PLATFORM_ARN!;
  if (!platformArn.includes('app/APNS/')) {
    throw new Error(
      `Invalid TEST_IOS_PLATFORM_ARN format: ${platformArn}\n` +
      'Expected format: arn:aws:sns:region:account:app/APNS/application-name'
    );
  }

  console.log('✓ iOS integration test environment validated');
}

/**
 * Creates iOS configuration for testing
 */
export function createiOSTestConfig(): iOSPushConfig {
  if (!DEFAULT_IOS_TEST_CONFIG.enabled) {
    throw new Error('iOS integration tests are not enabled');
  }

  return {
    platformApplicationArn: DEFAULT_IOS_TEST_CONFIG.platformApplicationArn!,
    bundleId: DEFAULT_IOS_TEST_CONFIG.bundleId!,
    sandbox: DEFAULT_IOS_TEST_CONFIG.sandbox
  };
}

/**
 * Test scenarios for iOS notifications
 */
export interface iOSTestScenario {
  name: string;
  description: string;
  costAmount: number;
  threshold: number;
  expectedAlertLevel: 'WARNING' | 'CRITICAL';
  expectedNotificationCount: number;
  shouldSucceed: boolean;
}

export const IOS_TEST_SCENARIOS: iOSTestScenario[] = [
  {
    name: 'under-threshold',
    description: 'Cost under threshold - no alert expected',
    costAmount: 5.00,
    threshold: 10.00,
    expectedAlertLevel: 'WARNING',
    expectedNotificationCount: 0,
    shouldSucceed: true
  },
  {
    name: 'warning-level',
    description: 'Cost moderately over threshold - warning alert',
    costAmount: 12.00,
    threshold: 10.00,
    expectedAlertLevel: 'WARNING',
    expectedNotificationCount: 1,
    shouldSucceed: true
  },
  {
    name: 'critical-level',
    description: 'Cost significantly over threshold - critical alert',
    costAmount: 20.00,
    threshold: 10.00,
    expectedAlertLevel: 'CRITICAL',
    expectedNotificationCount: 1,
    shouldSucceed: true
  },
  {
    name: 'high-cost',
    description: 'Very high cost - critical alert with large numbers',
    costAmount: 999.99,
    threshold: 100.00,
    expectedAlertLevel: 'CRITICAL',
    expectedNotificationCount: 1,
    shouldSucceed: true
  },
  {
    name: 'edge-case-exact',
    description: 'Cost exactly at threshold',
    costAmount: 10.00,
    threshold: 10.00,
    expectedAlertLevel: 'WARNING',
    expectedNotificationCount: 0,
    shouldSucceed: true
  }
];

/**
 * Performance test configurations for iOS operations
 */
export interface iOSPerformanceTest {
  name: string;
  description: string;
  operationType: 'registration' | 'notification' | 'validation' | 'batch';
  iterations: number;
  expectedMaxDuration: number;
  concurrency?: number;
}

export const IOS_PERFORMANCE_TESTS: iOSPerformanceTest[] = [
  {
    name: 'single-device-registration',
    description: 'Register a single iOS device',
    operationType: 'registration',
    iterations: 1,
    expectedMaxDuration: 3000
  },
  {
    name: 'batch-device-registration',
    description: 'Register multiple iOS devices',
    operationType: 'batch',
    iterations: 5,
    expectedMaxDuration: 10000
  },
  {
    name: 'notification-delivery',
    description: 'Send notification to registered device',
    operationType: 'notification',
    iterations: 1,
    expectedMaxDuration: 5000
  },
  {
    name: 'payload-validation',
    description: 'Validate APNS payload structure',
    operationType: 'validation',
    iterations: 100,
    expectedMaxDuration: 1000
  },
  {
    name: 'concurrent-notifications',
    description: 'Send multiple notifications concurrently',
    operationType: 'notification',
    iterations: 3,
    expectedMaxDuration: 8000,
    concurrency: 3
  }
];

/**
 * Test data generators for iOS scenarios
 */
export class iOSTestDataGenerator {
  /**
   * Generates test cost analysis for iOS scenarios
   */
  static generateCostAnalysisForScenario(scenario: iOSTestScenario) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // Generate realistic service breakdown
    const services = [
      'Amazon Elastic Compute Cloud - Compute',
      'Amazon Simple Storage Service',
      'AWS Lambda',
      'Amazon CloudWatch',
      'Amazon Simple Notification Service'
    ];

    const serviceBreakdown: { [key: string]: number } = {};
    let remainingCost = scenario.costAmount;

    // Distribute cost across services
    for (let i = 0; i < Math.min(3, services.length); i++) {
      const isLast = i === 2;
      const serviceCost = isLast ? remainingCost : Math.round((remainingCost * Math.random() * 0.6) * 100) / 100;
      
      if (serviceCost > 0) {
        serviceBreakdown[services[i]] = serviceCost;
        remainingCost -= serviceCost;
      }
    }

    // Ensure total matches
    if (remainingCost > 0.01) {
      serviceBreakdown[services[0]] = (serviceBreakdown[services[0]] || 0) + remainingCost;
    }

    return {
      totalCost: scenario.costAmount,
      serviceBreakdown,
      period: {
        start: startOfMonth.toISOString(),
        end: now.toISOString()
      },
      projectedMonthly: Math.round((scenario.costAmount / now.getDate()) * 30 * 100) / 100,
      currency: 'USD',
      lastUpdated: now.toISOString()
    };
  }

  /**
   * Generates alert context for iOS scenarios
   */
  static generateAlertContextForScenario(scenario: iOSTestScenario) {
    const exceedAmount = Math.max(0, scenario.costAmount - scenario.threshold);
    const percentageOver = scenario.threshold > 0 ? (exceedAmount / scenario.threshold) * 100 : 0;
    
    return {
      threshold: scenario.threshold,
      exceedAmount,
      percentageOver,
      topServices: [
        { serviceName: 'EC2', cost: scenario.costAmount * 0.6, percentage: 60 },
        { serviceName: 'S3', cost: scenario.costAmount * 0.4, percentage: 40 }
      ],
      alertLevel: scenario.expectedAlertLevel
    };
  }

  /**
   * Generates test device tokens for iOS testing
   */
  static generateTestDeviceTokens(count: number): string[] {
    const tokens: string[] = [];
    const chars = '0123456789abcdef';
    
    for (let i = 0; i < count; i++) {
      let token = '';
      for (let j = 0; j < 64; j++) {
        token += chars[Math.floor(Math.random() * chars.length)];
      }
      tokens.push(token);
    }
    
    return tokens;
  }

  /**
   * Generates test user IDs for device registration
   */
  static generateTestUserIds(count: number): string[] {
    return Array.from({ length: count }, (_, i) => `ios-test-user-${i + 1}-${Date.now()}`);
  }
}

/**
 * iOS test result validation utilities
 */
export class iOSTestValidator {
  /**
   * Validates iOS notification payload structure
   */
  static validateiOSPayload(payload: any): void {
    expect(payload).toMatchObject({
      aps: {
        alert: {
          title: expect.any(String),
          body: expect.any(String)
        },
        badge: expect.any(Number),
        sound: expect.any(String),
        'content-available': 1
      },
      customData: {
        spendAmount: expect.any(Number),
        threshold: expect.any(Number),
        exceedAmount: expect.any(Number),
        topService: expect.any(String),
        alertId: expect.any(String)
      }
    });

    // Validate APNS size limits
    const payloadSize = JSON.stringify(payload).length;
    expect(payloadSize).toBeLessThanOrEqual(4096);
  }

  /**
   * Validates device registration response
   */
  static validateDeviceRegistration(registration: any): void {
    expect(registration).toMatchObject({
      deviceToken: expect.stringMatching(/^[0-9a-fA-F]{64}$/),
      platformEndpointArn: expect.stringMatching(/^arn:aws:sns:/),
      registrationDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      lastUpdated: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      active: true
    });

    // Validate dates are reasonable
    const regDate = new Date(registration.registrationDate);
    const updateDate = new Date(registration.lastUpdated);
    const now = new Date();
    
    expect(regDate.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(updateDate.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(updateDate.getTime()).toBeGreaterThanOrEqual(regDate.getTime());
  }

  /**
   * Validates notification delivery result
   */
  static validateNotificationDelivery(result: any): void {
    expect(result).toMatchObject({
      messageId: expect.any(String),
      success: expect.any(Boolean)
    });

    if (!result.success) {
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
    }
  }

  /**
   * Validates performance metrics
   */
  static validatePerformanceMetrics(metrics: any, thresholds: any): void {
    expect(metrics).toMatchObject({
      count: expect.any(Number),
      min: expect.any(Number),
      max: expect.any(Number),
      average: expect.any(Number),
      median: expect.any(Number),
      p95: expect.any(Number),
      p99: expect.any(Number)
    });

    expect(metrics.count).toBeGreaterThan(0);
    expect(metrics.min).toBeGreaterThanOrEqual(0);
    expect(metrics.max).toBeGreaterThanOrEqual(metrics.min);
    expect(metrics.average).toBeGreaterThanOrEqual(metrics.min);
    expect(metrics.average).toBeLessThanOrEqual(metrics.max);
  }
}

/**
 * iOS test environment setup and teardown utilities
 */
export class iOSTestEnvironment {
  private static instance: iOSTestEnvironment;
  private isSetup = false;
  private testConfig: iOSTestConfig;

  private constructor() {
    this.testConfig = DEFAULT_IOS_TEST_CONFIG;
  }

  static getInstance(): iOSTestEnvironment {
    if (!iOSTestEnvironment.instance) {
      iOSTestEnvironment.instance = new iOSTestEnvironment();
    }
    return iOSTestEnvironment.instance;
  }

  async setup(): Promise<void> {
    if (this.isSetup) {
      return;
    }

    if (!this.testConfig.enabled) {
      throw new Error('iOS integration tests are not enabled');
    }

    try {
      validateiOSTestEnvironment();
      console.log('✓ iOS test environment setup complete');
      this.isSetup = true;
    } catch (error) {
      console.error('❌ iOS test environment setup failed:', error.message);
      throw error;
    }
  }

  async teardown(): Promise<void> {
    if (!this.isSetup) {
      return;
    }

    console.log('✓ iOS test environment teardown complete');
    this.isSetup = false;
  }

  getConfig(): iOSTestConfig {
    return { ...this.testConfig };
  }

  isEnabled(): boolean {
    return this.testConfig.enabled;
  }
}

/**
 * Utility function to skip iOS tests if not enabled
 */
export function describeiOS(name: string, fn: () => void): void {
  const env = iOSTestEnvironment.getInstance();
  
  if (env.isEnabled()) {
    describe(name, fn);
  } else {
    describe.skip(`${name} (iOS tests disabled)`, fn);
  }
}

/**
 * Utility function to conditionally run iOS tests
 */
export function itiOS(name: string, fn: () => void | Promise<void>, timeout?: number): void {
  const env = iOSTestEnvironment.getInstance();
  
  if (env.isEnabled()) {
    it(name, fn, timeout || DEFAULT_IOS_TEST_CONFIG.testTimeout);
  } else {
    it.skip(`${name} (iOS tests disabled)`, fn);
  }
}