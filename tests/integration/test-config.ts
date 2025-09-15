/**
 * Integration Test Configuration
 * 
 * This file contains configuration and utilities for end-to-end integration tests
 * that use real AWS services in a test environment.
 */

export interface IntegrationTestConfig {
  region: string;
  testTopicPrefix: string;
  testTimeout: number;
  performanceThreshold: number;
  costThresholds: {
    under: number;
    over: number;
    exact: number;
  };
  retryConfig: {
    maxAttempts: number;
    baseDelay: number;
    maxDelay: number;
  };
}

export const DEFAULT_INTEGRATION_CONFIG: IntegrationTestConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
  testTopicPrefix: 'spend-monitor-integration-test',
  testTimeout: 30000, // 30 seconds
  performanceThreshold: 5000, // 5 seconds max execution time
  costThresholds: {
    under: 0.01, // $0.01 - should be under any real spending
    over: 1000000, // $1M - should be over any test account spending
    exact: 10 // $10 - configurable exact threshold
  },
  retryConfig: {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 5000
  }
};

/**
 * Environment variable validation for integration tests
 */
export function validateIntegrationTestEnvironment(): void {
  const requiredVars = [
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY'
  ];

  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables for integration tests: ${missingVars.join(', ')}\n` +
      'Please ensure AWS credentials are configured for integration testing.'
    );
  }

  // Warn about optional iOS test variables
  if (process.env.TEST_IOS_INTEGRATION === 'true') {
    const iosVars = ['TEST_IOS_PLATFORM_ARN', 'TEST_IOS_BUNDLE_ID'];
    const missingIosVars = iosVars.filter(varName => !process.env[varName]);
    
    if (missingIosVars.length > 0) {
      console.warn(
        `Missing iOS test environment variables: ${missingIosVars.join(', ')}\n` +
        'iOS integration tests may fail or be skipped.'
      );
    }
  }
}

/**
 * Check if integration tests should run
 */
export function shouldRunIntegrationTests(): boolean {
  return process.env.RUN_INTEGRATION_TESTS === 'true';
}

/**
 * Check if iOS integration tests should run
 */
export function shouldRunIOSIntegrationTests(): boolean {
  return shouldRunIntegrationTests() && process.env.TEST_IOS_INTEGRATION === 'true';
}

/**
 * Generate unique test resource names
 */
export function generateTestResourceName(prefix: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Test data generators for consistent test scenarios
 */
export class TestDataGenerator {
  static generateCostAnalysis(totalCost: number, serviceCount: number = 3) {
    const services = [
      'Amazon Elastic Compute Cloud - Compute',
      'Amazon Simple Storage Service',
      'AWS Lambda',
      'Amazon CloudWatch',
      'Amazon Simple Notification Service',
      'Amazon DynamoDB'
    ];

    const serviceBreakdown: { [key: string]: number } = {};
    let remainingCost = totalCost;

    // Distribute cost across services
    for (let i = 0; i < Math.min(serviceCount, services.length); i++) {
      const isLast = i === serviceCount - 1;
      const serviceCost = isLast ? remainingCost : Math.round((remainingCost / (serviceCount - i)) * 100) / 100;
      
      serviceBreakdown[services[i]] = Math.max(serviceCost, 0);
      remainingCost -= serviceCost;
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    return {
      totalCost,
      serviceBreakdown,
      period: {
        start: startOfMonth.toISOString(),
        end: now.toISOString()
      },
      projectedMonthly: Math.round((totalCost / now.getDate()) * endOfMonth.getDate() * 100) / 100,
      currency: 'USD',
      lastUpdated: now.toISOString()
    };
  }

  static generateAlertContext(totalCost: number, threshold: number) {
    const exceedAmount = Math.max(0, totalCost - threshold);
    const percentageOver = threshold > 0 ? Math.round((exceedAmount / threshold) * 100) : 0;
    
    return {
      threshold,
      exceedAmount,
      percentageOver,
      topServices: [
        { serviceName: 'EC2', cost: totalCost * 0.6, percentage: 60 },
        { serviceName: 'S3', cost: totalCost * 0.4, percentage: 40 }
      ],
      alertLevel: percentageOver > 50 ? 'CRITICAL' as const : 'WARNING' as const
    };
  }

  static generateLambdaEvent(eventType: 'scheduled' | 'manual' = 'scheduled') {
    return {
      source: eventType === 'scheduled' ? 'aws.events' : 'manual',
      'detail-type': eventType === 'scheduled' ? 'Scheduled Event' : 'Manual Trigger',
      detail: {
        timestamp: new Date().toISOString(),
        testRun: true
      },
      time: new Date().toISOString()
    };
  }

  static generateLambdaContext(requestId?: string) {
    return {
      awsRequestId: requestId || `test-${Date.now()}`,
      functionName: 'spend-monitor-agent-integration-test',
      functionVersion: '$LATEST',
      memoryLimitInMB: 512,
      getRemainingTimeInMillis: () => 25000 // 25 seconds remaining
    };
  }
}

/**
 * Performance measurement utilities
 */
export class PerformanceTracker {
  private startTime: number;
  private measurements: { [key: string]: number } = {};

  constructor() {
    this.startTime = Date.now();
  }

  mark(label: string): void {
    this.measurements[label] = Date.now() - this.startTime;
  }

  getMeasurement(label: string): number {
    return this.measurements[label] || 0;
  }

  getAllMeasurements(): { [key: string]: number } {
    return { ...this.measurements };
  }

  getTotalTime(): number {
    return Date.now() - this.startTime;
  }

  reset(): void {
    this.startTime = Date.now();
    this.measurements = {};
  }
}

/**
 * Test result validation utilities
 */
export class TestValidator {
  static validateCostAnalysis(costAnalysis: any): void {
    expect(costAnalysis).toMatchObject({
      totalCost: expect.any(Number),
      serviceBreakdown: expect.any(Object),
      period: {
        start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        end: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      },
      projectedMonthly: expect.any(Number),
      currency: 'USD',
      lastUpdated: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    });

    expect(costAnalysis.totalCost).toBeGreaterThanOrEqual(0);
    expect(costAnalysis.projectedMonthly).toBeGreaterThanOrEqual(0);
    expect(Object.keys(costAnalysis.serviceBreakdown).length).toBeGreaterThanOrEqual(0);
  }

  static validateLambdaResponse(response: any, expectedStatusCode: number = 200): void {
    expect(response).toMatchObject({
      statusCode: expectedStatusCode,
      body: expect.any(String)
    });

    const body = JSON.parse(response.body);
    
    if (expectedStatusCode === 200) {
      expect(body).toMatchObject({
        success: true,
        message: expect.any(String),
        executionId: expect.any(String),
        executionTime: expect.any(Number),
        timestamp: expect.any(String)
      });
    } else {
      expect(body).toMatchObject({
        success: false,
        error: expect.any(String)
      });
    }
  }

  static validatePerformance(executionTime: number, threshold: number): void {
    expect(executionTime).toBeGreaterThan(0);
    expect(executionTime).toBeLessThan(threshold);
  }

  static validateHealthCheck(healthCheck: any): void {
    expect(healthCheck).toMatchObject({
      overall: expect.stringMatching(/^(healthy|degraded|unhealthy)$/),
      components: expect.any(Object),
      errors: expect.any(Array)
    });
  }

  static validateIOSPayload(payload: any): void {
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
  }
}

/**
 * AWS resource cleanup utilities
 */
export class TestResourceManager {
  private createdResources: Array<{
    type: 'sns-topic' | 'lambda-function' | 'iam-role';
    arn: string;
    client: any;
  }> = [];

  addResource(type: 'sns-topic' | 'lambda-function' | 'iam-role', arn: string, client: any): void {
    this.createdResources.push({ type, arn, client });
  }

  async cleanupAll(): Promise<void> {
    const cleanupPromises = this.createdResources.map(async (resource) => {
      try {
        switch (resource.type) {
          case 'sns-topic':
            await resource.client.send(new (require('@aws-sdk/client-sns').DeleteTopicCommand)({
              TopicArn: resource.arn
            }));
            break;
          // Add other resource types as needed
        }
        console.log(`Cleaned up ${resource.type}: ${resource.arn}`);
      } catch (error) {
        console.warn(`Failed to cleanup ${resource.type} ${resource.arn}:`, error);
      }
    });

    await Promise.all(cleanupPromises);
    this.createdResources = [];
  }

  getCreatedResources(): Array<{ type: string; arn: string }> {
    return this.createdResources.map(({ type, arn }) => ({ type, arn }));
  }
}

/**
 * Test environment setup and teardown
 */
export class IntegrationTestSetup {
  private resourceManager: TestResourceManager;
  private config: IntegrationTestConfig;

  constructor(config: IntegrationTestConfig = DEFAULT_INTEGRATION_CONFIG) {
    this.config = config;
    this.resourceManager = new TestResourceManager();
  }

  async setup(): Promise<{ topicArn: string; config: IntegrationTestConfig }> {
    if (!shouldRunIntegrationTests()) {
      throw new Error('Integration tests are disabled. Set RUN_INTEGRATION_TESTS=true to enable.');
    }

    validateIntegrationTestEnvironment();

    // Create test SNS topic
    const { SNSClient, CreateTopicCommand } = require('@aws-sdk/client-sns');
    const snsClient = new SNSClient({ region: this.config.region });
    
    const topicName = generateTestResourceName(this.config.testTopicPrefix);
    const createTopicResult = await snsClient.send(new CreateTopicCommand({
      Name: topicName
    }));
    
    const topicArn = createTopicResult.TopicArn!;
    this.resourceManager.addResource('sns-topic', topicArn, snsClient);

    console.log(`Integration test setup complete. Test topic: ${topicArn}`);

    return {
      topicArn,
      config: this.config
    };
  }

  async teardown(): Promise<void> {
    await this.resourceManager.cleanupAll();
    console.log('Integration test teardown complete');
  }

  getResourceManager(): TestResourceManager {
    return this.resourceManager;
  }
}