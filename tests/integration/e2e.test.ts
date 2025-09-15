import { SpendMonitorAgent } from '../../src/agent';
import { handler } from '../../src/index';
import { SpendMonitorConfig, CostAnalysis } from '../../src/types';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { SNSClient, PublishCommand, CreateTopicCommand, DeleteTopicCommand } from '@aws-sdk/client-sns';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

// Integration test configuration
const INTEGRATION_TEST_CONFIG = {
  region: process.env.AWS_REGION || 'us-east-1',
  testTopicPrefix: 'spend-monitor-test',
  testTimeout: 30000, // 30 seconds
  performanceThreshold: 5000, // 5 seconds max execution time
  costThresholds: {
    under: 0.01, // $0.01 - should be under any real spending
    over: 1000000, // $1M - should be over any test account spending
    exact: 10 // $10 - configurable exact threshold
  }
};

describe('End-to-End Integration Tests', () => {
  let testTopicArn: string;
  let snsClient: SNSClient;
  let costExplorerClient: CostExplorerClient;
  let lambdaClient: LambdaClient;
  let testConfig: SpendMonitorConfig;

  beforeAll(async () => {
    // Skip integration tests if not in integration test environment
    if (!process.env.RUN_INTEGRATION_TESTS) {
      console.log('Skipping integration tests - set RUN_INTEGRATION_TESTS=true to run');
      return;
    }

    // Initialize AWS clients
    snsClient = new SNSClient({ region: INTEGRATION_TEST_CONFIG.region });
    costExplorerClient = new CostExplorerClient({ region: INTEGRATION_TEST_CONFIG.region });
    lambdaClient = new LambdaClient({ region: INTEGRATION_TEST_CONFIG.region });

    // Create test SNS topic
    const topicName = `${INTEGRATION_TEST_CONFIG.testTopicPrefix}-${Date.now()}`;
    const createTopicResult = await snsClient.send(new CreateTopicCommand({
      Name: topicName
    }));
    testTopicArn = createTopicResult.TopicArn!;

    // Set up test configuration
    testConfig = {
      spendThreshold: INTEGRATION_TEST_CONFIG.costThresholds.exact,
      snsTopicArn: testTopicArn,
      checkPeriodDays: 1,
      region: INTEGRATION_TEST_CONFIG.region,
      retryAttempts: 3,
      minServiceCostThreshold: 1
    };

    console.log(`Integration test setup complete. Test topic: ${testTopicArn}`);
  }, INTEGRATION_TEST_CONFIG.testTimeout);

  afterAll(async () => {
    if (!process.env.RUN_INTEGRATION_TESTS || !testTopicArn) {
      return;
    }

    // Clean up test SNS topic
    try {
      await snsClient.send(new DeleteTopicCommand({
        TopicArn: testTopicArn
      }));
      console.log(`Cleaned up test topic: ${testTopicArn}`);
    } catch (error) {
      console.warn(`Failed to clean up test topic: ${error}`);
    }
  }, INTEGRATION_TEST_CONFIG.testTimeout);

  describe('Real AWS Service Integration', () => {
    beforeEach(() => {
      if (!process.env.RUN_INTEGRATION_TESTS) {
        pending('Integration tests disabled');
      }
    });

    it('should retrieve real cost data from Cost Explorer API', async () => {
      const agent = new SpendMonitorAgent(testConfig);
      await agent.initialize();

      const costAnalysisTool = agent.getTool('CostAnalysisTool');
      expect(costAnalysisTool).toBeDefined();

      const costAnalysis = await costAnalysisTool.getCurrentMonthCosts();

      // Validate cost analysis structure
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

      // Validate cost data is reasonable
      expect(costAnalysis.totalCost).toBeGreaterThanOrEqual(0);
      expect(costAnalysis.projectedMonthly).toBeGreaterThanOrEqual(0);
      expect(Object.keys(costAnalysis.serviceBreakdown).length).toBeGreaterThanOrEqual(0);

      console.log('Real cost data retrieved:', {
        totalCost: costAnalysis.totalCost,
        serviceCount: Object.keys(costAnalysis.serviceBreakdown).length,
        projectedMonthly: costAnalysis.projectedMonthly
      });
    }, INTEGRATION_TEST_CONFIG.testTimeout);

    it('should successfully send SNS notifications to real topic', async () => {
      const agent = new SpendMonitorAgent(testConfig);
      await agent.initialize();

      const alertTool = agent.getTool('AlertTool');
      expect(alertTool).toBeDefined();

      // Create test alert context
      const testAlertContext = {
        threshold: 10,
        exceedAmount: 5,
        percentageOver: 50,
        topServices: [
          { serviceName: 'EC2-Instance', cost: 8, percentage: 53 },
          { serviceName: 'S3', cost: 7, percentage: 47 }
        ],
        alertLevel: 'WARNING' as const
      };

      const testCostAnalysis: CostAnalysis = {
        totalCost: 15,
        serviceBreakdown: {
          'EC2-Instance': 8,
          'S3': 7
        },
        period: {
          start: new Date().toISOString(),
          end: new Date().toISOString()
        },
        projectedMonthly: 30,
        currency: 'USD',
        lastUpdated: new Date().toISOString()
      };

      // Send test alert - should not throw
      await expect(
        alertTool.sendSpendAlert(testCostAnalysis, testAlertContext)
      ).resolves.not.toThrow();

      console.log('SNS alert sent successfully to test topic');
    }, INTEGRATION_TEST_CONFIG.testTimeout);

    it('should handle Cost Explorer API rate limits gracefully', async () => {
      const agent = new SpendMonitorAgent({
        ...testConfig,
        retryAttempts: 2 // Reduced for faster test
      });
      await agent.initialize();

      const costAnalysisTool = agent.getTool('CostAnalysisTool');

      // Make multiple rapid requests to potentially trigger rate limiting
      const promises = Array.from({ length: 5 }, () => 
        costAnalysisTool.getCurrentMonthCosts()
      );

      // All requests should eventually succeed despite potential rate limiting
      const results = await Promise.all(promises);
      
      results.forEach(result => {
        expect(result).toMatchObject({
          totalCost: expect.any(Number),
          serviceBreakdown: expect.any(Object)
        });
      });

      console.log('Rate limit handling test completed successfully');
    }, INTEGRATION_TEST_CONFIG.testTimeout);

    it('should validate IAM permissions for all required services', async () => {
      // Test Cost Explorer permissions
      const costExplorerCommand = new GetCostAndUsageCommand({
        TimePeriod: {
          Start: new Date(Date.now() - 86400000).toISOString().split('T')[0], // Yesterday
          End: new Date().toISOString().split('T')[0] // Today
        },
        Granularity: 'DAILY',
        Metrics: ['BlendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
      });

      await expect(
        costExplorerClient.send(costExplorerCommand)
      ).resolves.not.toThrow();

      // Test SNS permissions
      const snsCommand = new PublishCommand({
        TopicArn: testTopicArn,
        Message: 'Integration test message',
        Subject: 'Test'
      });

      await expect(
        snsClient.send(snsCommand)
      ).resolves.not.toThrow();

      console.log('IAM permissions validated successfully');
    }, INTEGRATION_TEST_CONFIG.testTimeout);
  });

  describe('Test Scenarios', () => {
    beforeEach(() => {
      if (!process.env.RUN_INTEGRATION_TESTS) {
        pending('Integration tests disabled');
      }
    });

    it('should handle under-threshold scenario correctly', async () => {
      const underThresholdConfig = {
        ...testConfig,
        spendThreshold: INTEGRATION_TEST_CONFIG.costThresholds.over // Set very high threshold
      };

      const agent = new SpendMonitorAgent(underThresholdConfig);
      await agent.initialize();

      const executionResult = await agent.execute();

      // Should complete without sending alerts
      expect(executionResult).toBeDefined();
      
      console.log('Under-threshold scenario completed successfully');
    }, INTEGRATION_TEST_CONFIG.testTimeout);

    it('should handle over-threshold scenario correctly', async () => {
      const overThresholdConfig = {
        ...testConfig,
        spendThreshold: INTEGRATION_TEST_CONFIG.costThresholds.under // Set very low threshold
      };

      const agent = new SpendMonitorAgent(overThresholdConfig);
      await agent.initialize();

      const executionResult = await agent.execute();

      // Should complete and likely send alerts (unless account has zero spending)
      expect(executionResult).toBeDefined();
      
      console.log('Over-threshold scenario completed successfully');
    }, INTEGRATION_TEST_CONFIG.testTimeout);

    it('should handle edge case: zero spending', async () => {
      // This test assumes the test account might have zero spending
      // If not, it will still validate the agent handles low spending correctly
      
      const agent = new SpendMonitorAgent(testConfig);
      await agent.initialize();

      const costAnalysisTool = agent.getTool('CostAnalysisTool');
      const costAnalysis = await costAnalysisTool.getCurrentMonthCosts();

      if (costAnalysis.totalCost === 0) {
        console.log('Zero spending detected - validating zero cost handling');
        
        expect(costAnalysis.serviceBreakdown).toEqual({});
        expect(costAnalysis.projectedMonthly).toBe(0);
      } else {
        console.log(`Non-zero spending detected: $${costAnalysis.totalCost}`);
      }

      // Agent should handle both cases gracefully
      await expect(agent.execute()).resolves.not.toThrow();
    }, INTEGRATION_TEST_CONFIG.testTimeout);

    it('should handle edge case: exact threshold match', async () => {
      // Get current spending first
      const agent = new SpendMonitorAgent(testConfig);
      await agent.initialize();

      const costAnalysisTool = agent.getTool('CostAnalysisTool');
      const costAnalysis = await costAnalysisTool.getCurrentMonthCosts();

      // Set threshold to exactly match current spending
      const exactThresholdConfig = {
        ...testConfig,
        spendThreshold: Math.max(costAnalysis.totalCost, 0.01) // Ensure non-zero threshold
      };

      const exactAgent = new SpendMonitorAgent(exactThresholdConfig);
      await exactAgent.initialize();

      await expect(exactAgent.execute()).resolves.not.toThrow();
      
      console.log(`Exact threshold test: spending=${costAnalysis.totalCost}, threshold=${exactThresholdConfig.spendThreshold}`);
    }, INTEGRATION_TEST_CONFIG.testTimeout);

    it('should handle service breakdown edge cases', async () => {
      const agent = new SpendMonitorAgent(testConfig);
      await agent.initialize();

      const costAnalysisTool = agent.getTool('CostAnalysisTool');
      const costAnalysis = await costAnalysisTool.getCurrentMonthCosts();

      // Test service consolidation
      const topServices = costAnalysisTool.getTopServices(costAnalysis, 5);
      
      expect(Array.isArray(topServices)).toBe(true);
      expect(topServices.length).toBeLessThanOrEqual(5);
      
      // Validate service data structure
      topServices.forEach(service => {
        expect(service).toMatchObject({
          serviceName: expect.any(String),
          cost: expect.any(Number),
          percentage: expect.any(Number)
        });
        expect(service.cost).toBeGreaterThanOrEqual(0);
        expect(service.percentage).toBeGreaterThanOrEqual(0);
        expect(service.percentage).toBeLessThanOrEqual(100);
      });

      console.log(`Service breakdown test: ${topServices.length} services found`);
    }, INTEGRATION_TEST_CONFIG.testTimeout);
  });

  describe('Lambda Handler Integration', () => {
    beforeEach(() => {
      if (!process.env.RUN_INTEGRATION_TESTS) {
        pending('Integration tests disabled');
      }
    });

    it('should execute Lambda handler end-to-end', async () => {
      // Set environment variables for handler
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        SNS_TOPIC_ARN: testTopicArn,
        SPEND_THRESHOLD: testConfig.spendThreshold.toString(),
        AWS_REGION: testConfig.region,
        CHECK_PERIOD_DAYS: testConfig.checkPeriodDays.toString(),
        RETRY_ATTEMPTS: testConfig.retryAttempts.toString(),
        MIN_SERVICE_COST_THRESHOLD: testConfig.minServiceCostThreshold.toString()
      };

      const mockEvent = {
        source: 'aws.events',
        'detail-type': 'Scheduled Event',
        detail: {},
        time: new Date().toISOString()
      };

      const mockContext = {
        awsRequestId: `integration-test-${Date.now()}`,
        functionName: 'spend-monitor-agent-integration-test',
        functionVersion: '$LATEST',
        memoryLimitInMB: 512,
        getRemainingTimeInMillis: () => 25000 // 25 seconds remaining
      };

      const result = await handler(mockEvent, mockContext);

      // Restore environment
      process.env = originalEnv;

      // Validate response
      expect(result.statusCode).toBe(200);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody).toMatchObject({
        success: true,
        message: expect.any(String),
        executionId: mockContext.awsRequestId,
        executionTime: expect.any(Number),
        timestamp: expect.any(String),
        agentStatus: expect.any(Object),
        healthCheck: expect.any(String)
      });

      expect(responseBody.executionTime).toBeGreaterThan(0);
      expect(responseBody.executionTime).toBeLessThan(INTEGRATION_TEST_CONFIG.performanceThreshold);

      console.log('Lambda handler integration test completed:', {
        executionTime: responseBody.executionTime,
        healthCheck: responseBody.healthCheck
      });
    }, INTEGRATION_TEST_CONFIG.testTimeout);

    it('should handle Lambda handler errors gracefully', async () => {
      // Test with invalid configuration
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        SNS_TOPIC_ARN: 'invalid-arn',
        SPEND_THRESHOLD: 'invalid-number'
      };

      const mockEvent = { source: 'aws.events' };
      const mockContext = { awsRequestId: 'error-test' };

      const result = await handler(mockEvent, mockContext);

      // Restore environment
      process.env = originalEnv;

      expect(result.statusCode).toBe(500);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.success).toBe(false);
      expect(responseBody.error).toBeDefined();

      console.log('Lambda handler error handling validated');
    }, INTEGRATION_TEST_CONFIG.testTimeout);
  });

  describe('Performance Tests', () => {
    beforeEach(() => {
      if (!process.env.RUN_INTEGRATION_TESTS) {
        pending('Integration tests disabled');
      }
    });

    it('should complete execution within performance threshold', async () => {
      const startTime = Date.now();
      
      const agent = new SpendMonitorAgent(testConfig);
      await agent.initialize();
      await agent.execute();
      
      const executionTime = Date.now() - startTime;
      
      expect(executionTime).toBeLessThan(INTEGRATION_TEST_CONFIG.performanceThreshold);
      
      console.log(`Performance test passed: ${executionTime}ms (threshold: ${INTEGRATION_TEST_CONFIG.performanceThreshold}ms)`);
    }, INTEGRATION_TEST_CONFIG.testTimeout);

    it('should handle concurrent executions efficiently', async () => {
      const concurrentExecutions = 3;
      const startTime = Date.now();
      
      const agents = Array.from({ length: concurrentExecutions }, () => 
        new SpendMonitorAgent(testConfig)
      );

      // Initialize all agents
      await Promise.all(agents.map(agent => agent.initialize()));
      
      // Execute all agents concurrently
      await Promise.all(agents.map(agent => agent.execute()));
      
      const totalExecutionTime = Date.now() - startTime;
      const averageExecutionTime = totalExecutionTime / concurrentExecutions;
      
      expect(averageExecutionTime).toBeLessThan(INTEGRATION_TEST_CONFIG.performanceThreshold);
      
      console.log(`Concurrent execution test: ${concurrentExecutions} agents, average time: ${averageExecutionTime}ms`);
    }, INTEGRATION_TEST_CONFIG.testTimeout * 2);

    it('should maintain performance with large service breakdowns', async () => {
      const agent = new SpendMonitorAgent(testConfig);
      await agent.initialize();

      const costAnalysisTool = agent.getTool('CostAnalysisTool');
      
      const startTime = Date.now();
      const costAnalysis = await costAnalysisTool.getCurrentMonthCosts();
      const costRetrievalTime = Date.now() - startTime;

      // Test service processing performance
      const processingStartTime = Date.now();
      const topServices = costAnalysisTool.getTopServices(costAnalysis, 10);
      const consolidated = costAnalysisTool.consolidateSmallServices(costAnalysis, 0.1);
      const processingTime = Date.now() - processingStartTime;

      expect(costRetrievalTime).toBeLessThan(INTEGRATION_TEST_CONFIG.performanceThreshold / 2);
      expect(processingTime).toBeLessThan(100); // Processing should be very fast

      console.log(`Performance breakdown - Cost retrieval: ${costRetrievalTime}ms, Processing: ${processingTime}ms`);
      console.log(`Services processed: ${Object.keys(costAnalysis.serviceBreakdown).length}`);
    }, INTEGRATION_TEST_CONFIG.testTimeout);
  });

  describe('SNS Message Delivery and Formatting', () => {
    beforeEach(() => {
      if (!process.env.RUN_INTEGRATION_TESTS) {
        pending('Integration tests disabled');
      }
    });

    it('should format and deliver email/SMS alerts correctly', async () => {
      const agent = new SpendMonitorAgent(testConfig);
      await agent.initialize();

      const alertTool = agent.getTool('AlertTool');
      
      const testCostAnalysis: CostAnalysis = {
        totalCost: 25.75,
        serviceBreakdown: {
          'Amazon Elastic Compute Cloud - Compute': 15.50,
          'Amazon Simple Storage Service': 8.25,
          'AWS Lambda': 2.00
        },
        period: {
          start: '2023-01-01T00:00:00.000Z',
          end: '2023-01-15T23:59:59.999Z'
        },
        projectedMonthly: 53.55,
        currency: 'USD',
        lastUpdated: new Date().toISOString()
      };

      const alertContext = {
        threshold: 10,
        exceedAmount: 15.75,
        percentageOver: 157.5,
        topServices: [
          { serviceName: 'Amazon Elastic Compute Cloud - Compute', cost: 15.50, percentage: 60.2 },
          { serviceName: 'Amazon Simple Storage Service', cost: 8.25, percentage: 32.0 },
          { serviceName: 'AWS Lambda', cost: 2.00, percentage: 7.8 }
        ],
        alertLevel: 'CRITICAL' as const
      };

      // Test message formatting
      const formattedMessage = alertTool.formatAlertMessage(testCostAnalysis, alertContext);
      
      expect(formattedMessage).toContain('AWS Spend Alert');
      expect(formattedMessage).toContain('$25.75');
      expect(formattedMessage).toContain('$10.00');
      expect(formattedMessage).toContain('Amazon Elastic Compute Cloud');
      expect(formattedMessage).toContain('CRITICAL');

      // Test actual delivery
      await expect(
        alertTool.sendSpendAlert(testCostAnalysis, alertContext)
      ).resolves.not.toThrow();

      console.log('Alert formatting and delivery test completed');
      console.log('Sample formatted message:', formattedMessage.substring(0, 200) + '...');
    }, INTEGRATION_TEST_CONFIG.testTimeout);

    it('should handle SNS delivery failures with retry logic', async () => {
      // Create agent with invalid topic to test retry logic
      const invalidConfig = {
        ...testConfig,
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:non-existent-topic',
        retryAttempts: 2
      };

      const agent = new SpendMonitorAgent(invalidConfig);
      await agent.initialize();

      const alertTool = agent.getTool('AlertTool');
      
      const testCostAnalysis: CostAnalysis = {
        totalCost: 15,
        serviceBreakdown: { 'EC2': 15 },
        period: { start: '2023-01-01T00:00:00.000Z', end: '2023-01-31T23:59:59.999Z' },
        projectedMonthly: 31,
        currency: 'USD',
        lastUpdated: new Date().toISOString()
      };

      const alertContext = {
        threshold: 10,
        exceedAmount: 5,
        percentageOver: 50,
        topServices: [{ serviceName: 'EC2', cost: 15, percentage: 100 }],
        alertLevel: 'WARNING' as const
      };

      // Should fail but handle gracefully
      await expect(
        alertTool.sendSpendAlert(testCostAnalysis, alertContext)
      ).rejects.toThrow();

      console.log('SNS retry logic test completed');
    }, INTEGRATION_TEST_CONFIG.testTimeout);
  });

  describe('iOS Push Notification Integration', () => {
    beforeEach(() => {
      if (!process.env.RUN_INTEGRATION_TESTS || !process.env.TEST_IOS_INTEGRATION) {
        pending('iOS integration tests disabled - set TEST_IOS_INTEGRATION=true to run');
      }
    });

    it('should format iOS push notification payload correctly', async () => {
      const iosConfig = {
        ...testConfig,
        iosConfig: {
          platformApplicationArn: process.env.TEST_IOS_PLATFORM_ARN || 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp',
          bundleId: 'com.example.spendmonitor.test',
          sandbox: true
        }
      };

      const agent = new SpendMonitorAgent(iosConfig);
      await agent.initialize();

      const alertTool = agent.getTool('AlertTool');
      
      const testCostAnalysis: CostAnalysis = {
        totalCost: 15.50,
        serviceBreakdown: { 'EC2': 10, 'S3': 5.50 },
        period: { start: '2023-01-01T00:00:00.000Z', end: '2023-01-15T23:59:59.999Z' },
        projectedMonthly: 32,
        currency: 'USD',
        lastUpdated: new Date().toISOString()
      };

      const alertContext = {
        threshold: 10,
        exceedAmount: 5.50,
        percentageOver: 55,
        topServices: [
          { serviceName: 'EC2', cost: 10, percentage: 64.5 },
          { serviceName: 'S3', cost: 5.50, percentage: 35.5 }
        ],
        alertLevel: 'WARNING' as const
      };

      const iosPayload = alertTool.formatIOSPayload(testCostAnalysis, alertContext);
      
      expect(iosPayload).toMatchObject({
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
          spendAmount: 15.50,
          threshold: 10,
          exceedAmount: 5.50,
          topService: 'EC2',
          alertId: expect.any(String)
        }
      });

      console.log('iOS payload formatting test completed');
      console.log('Sample iOS payload:', JSON.stringify(iosPayload, null, 2));
    }, INTEGRATION_TEST_CONFIG.testTimeout);
  });

  describe('Data Setup and Cleanup', () => {
    beforeEach(() => {
      if (!process.env.RUN_INTEGRATION_TESTS) {
        pending('Integration tests disabled');
      }
    });

    it('should handle test data setup and cleanup correctly', async () => {
      // This test validates that our test setup/cleanup doesn't interfere with real data
      
      const agent = new SpendMonitorAgent(testConfig);
      await agent.initialize();

      // Get initial cost data
      const costAnalysisTool = agent.getTool('CostAnalysisTool');
      const initialCostAnalysis = await costAnalysisTool.getCurrentMonthCosts();

      // Perform agent execution
      await agent.execute();

      // Get cost data again - should be consistent
      const finalCostAnalysis = await costAnalysisTool.getCurrentMonthCosts();

      // Cost data should be consistent (allowing for small timing differences)
      expect(Math.abs(finalCostAnalysis.totalCost - initialCostAnalysis.totalCost)).toBeLessThan(0.01);

      console.log('Data consistency test completed');
    }, INTEGRATION_TEST_CONFIG.testTimeout);

    it('should validate test environment isolation', async () => {
      // Ensure test doesn't affect production resources
      expect(testTopicArn).toContain('spend-monitor-test');
      expect(testConfig.snsTopicArn).toContain('spend-monitor-test');
      
      // Validate we're using test configuration
      expect(testConfig.region).toBe(INTEGRATION_TEST_CONFIG.region);
      
      console.log('Test environment isolation validated');
    });
  });

  describe('Error Recovery and Resilience', () => {
    beforeEach(() => {
      if (!process.env.RUN_INTEGRATION_TESTS) {
        pending('Integration tests disabled');
      }
    });

    it('should recover from transient AWS service errors', async () => {
      const resilientConfig = {
        ...testConfig,
        retryAttempts: 3
      };

      const agent = new SpendMonitorAgent(resilientConfig);
      await agent.initialize();

      // Execute multiple times to test resilience
      for (let i = 0; i < 3; i++) {
        await expect(agent.execute()).resolves.not.toThrow();
        
        // Small delay between executions
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log('Resilience test completed - 3 consecutive executions successful');
    }, INTEGRATION_TEST_CONFIG.testTimeout * 2);

    it('should handle partial service failures gracefully', async () => {
      const agent = new SpendMonitorAgent(testConfig);
      await agent.initialize();

      // Test health check during normal operation
      const healthCheck = await agent.healthCheck();
      
      expect(healthCheck.overall).toMatch(/^(healthy|degraded)$/);
      expect(healthCheck.components).toBeDefined();
      expect(Array.isArray(healthCheck.errors)).toBe(true);

      console.log('Health check test completed:', healthCheck.overall);
    }, INTEGRATION_TEST_CONFIG.testTimeout);
  });
});