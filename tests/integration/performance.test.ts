/**
 * Performance Integration Tests
 * 
 * These tests measure and validate the performance characteristics of the
 * AWS Spend Monitor Agent in real AWS environments.
 */

import { SpendMonitorAgent } from '../../src/agent';
import { handler } from '../../src/index';
import { SpendMonitorConfig } from '../../src/types';
import { 
  DEFAULT_INTEGRATION_CONFIG, 
  IntegrationTestSetup, 
  PerformanceTracker, 
  TestValidator,
  TestDataGenerator,
  shouldRunIntegrationTests
} from './test-config';

describe('Performance Integration Tests', () => {
  let testSetup: IntegrationTestSetup;
  let testTopicArn: string;
  let testConfig: SpendMonitorConfig;
  let performanceTracker: PerformanceTracker;

  beforeAll(async () => {
    if (!shouldRunIntegrationTests()) {
      console.log('Skipping performance tests - set RUN_INTEGRATION_TESTS=true to run');
      return;
    }

    testSetup = new IntegrationTestSetup(DEFAULT_INTEGRATION_CONFIG);
    const setup = await testSetup.setup();
    testTopicArn = setup.topicArn;

    testConfig = {
      spendThreshold: 10,
      snsTopicArn: testTopicArn,
      checkPeriodDays: 1,
      region: DEFAULT_INTEGRATION_CONFIG.region,
      retryAttempts: 3,
      minServiceCostThreshold: 1
    };

    console.log('Performance test environment initialized');
  }, DEFAULT_INTEGRATION_CONFIG.testTimeout);

  afterAll(async () => {
    if (!shouldRunIntegrationTests() || !testSetup) {
      return;
    }

    await testSetup.teardown();
  }, DEFAULT_INTEGRATION_CONFIG.testTimeout);

  beforeEach(() => {
    if (!shouldRunIntegrationTests()) {
      pending('Performance tests disabled');
    }
    performanceTracker = new PerformanceTracker();
  });

  describe('Lambda Handler Performance', () => {
    it('should complete Lambda execution within performance threshold', async () => {
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

      const mockEvent = TestDataGenerator.generateLambdaEvent('scheduled');
      const mockContext = TestDataGenerator.generateLambdaContext();

      performanceTracker.mark('handler-start');
      const result = await handler(mockEvent, mockContext);
      performanceTracker.mark('handler-complete');

      // Restore environment
      process.env = originalEnv;

      const executionTime = performanceTracker.getMeasurement('handler-complete');
      
      TestValidator.validateLambdaResponse(result, 200);
      TestValidator.validatePerformance(executionTime, DEFAULT_INTEGRATION_CONFIG.performanceThreshold);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.executionTime).toBeLessThan(DEFAULT_INTEGRATION_CONFIG.performanceThreshold);

      console.log(`Lambda handler performance: ${executionTime}ms (reported: ${responseBody.executionTime}ms)`);
    }, DEFAULT_INTEGRATION_CONFIG.testTimeout);

    it('should handle cold start performance within acceptable limits', async () => {
      // Simulate cold start by creating fresh agent instances
      const coldStartTests = 3;
      const executionTimes: number[] = [];

      for (let i = 0; i < coldStartTests; i++) {
        const tracker = new PerformanceTracker();
        
        tracker.mark('cold-start-begin');
        const agent = new SpendMonitorAgent(testConfig);
        await agent.initialize();
        await agent.execute();
        tracker.mark('cold-start-complete');

        const executionTime = tracker.getMeasurement('cold-start-complete');
        executionTimes.push(executionTime);

        // Allow some time between tests
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const averageExecutionTime = executionTimes.reduce((sum, time) => sum + time, 0) / executionTimes.length;
      const maxExecutionTime = Math.max(...executionTimes);

      // Cold starts should still be within reasonable limits (allowing 2x normal threshold)
      const coldStartThreshold = DEFAULT_INTEGRATION_CONFIG.performanceThreshold * 2;
      
      expect(averageExecutionTime).toBeLessThan(coldStartThreshold);
      expect(maxExecutionTime).toBeLessThan(coldStartThreshold);

      console.log(`Cold start performance - Average: ${averageExecutionTime}ms, Max: ${maxExecutionTime}ms`);
      console.log(`Individual times: ${executionTimes.join(', ')}ms`);
    }, DEFAULT_INTEGRATION_CONFIG.testTimeout * 2);

    it('should maintain performance under memory constraints', async () => {
      // Test with different memory configurations (simulated)
      const memoryConfigs = [256, 512, 1024]; // MB
      const results: Array<{ memory: number; executionTime: number }> = [];

      for (const memoryLimit of memoryConfigs) {
        const tracker = new PerformanceTracker();
        
        // Create agent with memory-conscious configuration
        const memoryConfig = {
          ...testConfig,
          retryAttempts: 1 // Reduce retries to simulate memory constraints
        };

        tracker.mark(`memory-${memoryLimit}-start`);
        const agent = new SpendMonitorAgent(memoryConfig);
        await agent.initialize();
        await agent.execute();
        tracker.mark(`memory-${memoryLimit}-complete`);

        const executionTime = tracker.getMeasurement(`memory-${memoryLimit}-complete`);
        results.push({ memory: memoryLimit, executionTime });

        console.log(`Memory ${memoryLimit}MB: ${executionTime}ms`);
      }

      // All configurations should complete within threshold
      results.forEach(result => {
        expect(result.executionTime).toBeLessThan(DEFAULT_INTEGRATION_CONFIG.performanceThreshold);
      });

      // Performance should not degrade significantly with lower memory
      const performanceDifference = Math.max(...results.map(r => r.executionTime)) - 
                                   Math.min(...results.map(r => r.executionTime));
      
      expect(performanceDifference).toBeLessThan(DEFAULT_INTEGRATION_CONFIG.performanceThreshold / 2);
    }, DEFAULT_INTEGRATION_CONFIG.testTimeout * 2);
  });

  describe('Cost Analysis Performance', () => {
    it('should retrieve cost data within acceptable time limits', async () => {
      const agent = new SpendMonitorAgent(testConfig);
      await agent.initialize();

      const costAnalysisTool = agent.getTool('CostAnalysisTool');
      
      performanceTracker.mark('cost-analysis-start');
      const costAnalysis = await costAnalysisTool.getCurrentMonthCosts();
      performanceTracker.mark('cost-analysis-complete');

      const executionTime = performanceTracker.getMeasurement('cost-analysis-complete');
      
      TestValidator.validateCostAnalysis(costAnalysis);
      
      // Cost analysis should complete within 3 seconds
      const costAnalysisThreshold = 3000;
      expect(executionTime).toBeLessThan(costAnalysisThreshold);

      console.log(`Cost analysis performance: ${executionTime}ms`);
      console.log(`Services analyzed: ${Object.keys(costAnalysis.serviceBreakdown).length}`);
    }, DEFAULT_INTEGRATION_CONFIG.testTimeout);

    it('should handle large service breakdowns efficiently', async () => {
      const agent = new SpendMonitorAgent(testConfig);
      await agent.initialize();

      const costAnalysisTool = agent.getTool('CostAnalysisTool');
      const costAnalysis = await costAnalysisTool.getCurrentMonthCosts();

      // Test service processing performance with various operations
      const operations = [
        { name: 'getTopServices-5', fn: () => costAnalysisTool.getTopServices(costAnalysis, 5) },
        { name: 'getTopServices-10', fn: () => costAnalysisTool.getTopServices(costAnalysis, 10) },
        { name: 'consolidateSmallServices-1', fn: () => costAnalysisTool.consolidateSmallServices(costAnalysis, 1) },
        { name: 'consolidateSmallServices-0.1', fn: () => costAnalysisTool.consolidateSmallServices(costAnalysis, 0.1) }
      ];

      const processingResults: Array<{ operation: string; time: number }> = [];

      for (const operation of operations) {
        const startTime = Date.now();
        const result = operation.fn();
        const endTime = Date.now();
        
        const processingTime = endTime - startTime;
        processingResults.push({ operation: operation.name, time: processingTime });

        // Processing operations should be very fast (< 100ms)
        expect(processingTime).toBeLessThan(100);
        expect(result).toBeDefined();
      }

      console.log('Service processing performance:');
      processingResults.forEach(result => {
        console.log(`  ${result.operation}: ${result.time}ms`);
      });
    }, DEFAULT_INTEGRATION_CONFIG.testTimeout);

    it('should maintain performance with concurrent cost analysis requests', async () => {
      const concurrentRequests = 5;
      const agents = Array.from({ length: concurrentRequests }, () => new SpendMonitorAgent(testConfig));

      // Initialize all agents
      await Promise.all(agents.map(agent => agent.initialize()));

      performanceTracker.mark('concurrent-start');
      
      // Execute cost analysis concurrently
      const costAnalysisPromises = agents.map(async (agent, index) => {
        const startTime = Date.now();
        const costAnalysisTool = agent.getTool('CostAnalysisTool');
        const result = await costAnalysisTool.getCurrentMonthCosts();
        const endTime = Date.now();
        
        return {
          index,
          result,
          executionTime: endTime - startTime
        };
      });

      const results = await Promise.all(costAnalysisPromises);
      performanceTracker.mark('concurrent-complete');

      const totalConcurrentTime = performanceTracker.getMeasurement('concurrent-complete');
      const averageExecutionTime = results.reduce((sum, r) => sum + r.executionTime, 0) / results.length;
      const maxExecutionTime = Math.max(...results.map(r => r.executionTime));

      // Concurrent execution should not significantly degrade performance
      expect(averageExecutionTime).toBeLessThan(DEFAULT_INTEGRATION_CONFIG.performanceThreshold);
      expect(maxExecutionTime).toBeLessThan(DEFAULT_INTEGRATION_CONFIG.performanceThreshold);
      
      // Total concurrent time should be less than sequential execution
      const estimatedSequentialTime = averageExecutionTime * concurrentRequests;
      expect(totalConcurrentTime).toBeLessThan(estimatedSequentialTime);

      console.log(`Concurrent cost analysis (${concurrentRequests} requests):`);
      console.log(`  Total time: ${totalConcurrentTime}ms`);
      console.log(`  Average per request: ${averageExecutionTime}ms`);
      console.log(`  Max per request: ${maxExecutionTime}ms`);
      console.log(`  Estimated sequential: ${estimatedSequentialTime}ms`);
    }, DEFAULT_INTEGRATION_CONFIG.testTimeout * 2);
  });

  describe('Alert Delivery Performance', () => {
    it('should send SNS alerts within acceptable time limits', async () => {
      const agent = new SpendMonitorAgent(testConfig);
      await agent.initialize();

      const alertTool = agent.getTool('AlertTool');
      
      const testCostAnalysis = TestDataGenerator.generateCostAnalysis(25.75, 3);
      const testAlertContext = TestDataGenerator.generateAlertContext(25.75, 10);

      performanceTracker.mark('alert-start');
      await alertTool.sendSpendAlert(testCostAnalysis, testAlertContext);
      performanceTracker.mark('alert-complete');

      const executionTime = performanceTracker.getMeasurement('alert-complete');
      
      // Alert delivery should complete within 2 seconds
      const alertThreshold = 2000;
      expect(executionTime).toBeLessThan(alertThreshold);

      console.log(`Alert delivery performance: ${executionTime}ms`);
    }, DEFAULT_INTEGRATION_CONFIG.testTimeout);

    it('should handle multiple alert formats efficiently', async () => {
      const agent = new SpendMonitorAgent(testConfig);
      await agent.initialize();

      const alertTool = agent.getTool('AlertTool');
      
      const testCostAnalysis = TestDataGenerator.generateCostAnalysis(15.50, 2);
      const testAlertContext = TestDataGenerator.generateAlertContext(15.50, 10);

      // Test different alert formatting operations
      const formatOperations = [
        { name: 'formatAlertMessage', fn: () => alertTool.formatAlertMessage(testCostAnalysis, testAlertContext) },
        { name: 'formatIOSPayload', fn: () => alertTool.formatIOSPayload(testCostAnalysis, testAlertContext) }
      ];

      const formatResults: Array<{ operation: string; time: number }> = [];

      for (const operation of formatOperations) {
        const startTime = Date.now();
        const result = operation.fn();
        const endTime = Date.now();
        
        const formatTime = endTime - startTime;
        formatResults.push({ operation: operation.name, time: formatTime });

        // Formatting operations should be very fast (< 50ms)
        expect(formatTime).toBeLessThan(50);
        expect(result).toBeDefined();
      }

      console.log('Alert formatting performance:');
      formatResults.forEach(result => {
        console.log(`  ${result.operation}: ${result.time}ms`);
      });
    }, DEFAULT_INTEGRATION_CONFIG.testTimeout);
  });

  describe('End-to-End Performance', () => {
    it('should complete full agent execution within performance threshold', async () => {
      performanceTracker.mark('e2e-start');
      
      const agent = new SpendMonitorAgent(testConfig);
      
      performanceTracker.mark('initialization-start');
      await agent.initialize();
      performanceTracker.mark('initialization-complete');
      
      performanceTracker.mark('execution-start');
      await agent.execute();
      performanceTracker.mark('execution-complete');
      
      performanceTracker.mark('e2e-complete');

      const measurements = performanceTracker.getAllMeasurements();
      
      // Validate individual phase performance
      expect(measurements['initialization-complete']).toBeLessThan(1000); // 1 second for init
      expect(measurements['execution-complete'] - measurements['execution-start']).toBeLessThan(4000); // 4 seconds for execution
      expect(measurements['e2e-complete']).toBeLessThan(DEFAULT_INTEGRATION_CONFIG.performanceThreshold);

      console.log('End-to-end performance breakdown:');
      console.log(`  Initialization: ${measurements['initialization-complete']}ms`);
      console.log(`  Execution: ${measurements['execution-complete'] - measurements['execution-start']}ms`);
      console.log(`  Total: ${measurements['e2e-complete']}ms`);
    }, DEFAULT_INTEGRATION_CONFIG.testTimeout);

    it('should maintain consistent performance across multiple executions', async () => {
      const executionCount = 5;
      const executionTimes: number[] = [];

      const agent = new SpendMonitorAgent(testConfig);
      await agent.initialize();

      for (let i = 0; i < executionCount; i++) {
        const startTime = Date.now();
        await agent.execute();
        const endTime = Date.now();
        
        const executionTime = endTime - startTime;
        executionTimes.push(executionTime);

        // Small delay between executions
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const averageTime = executionTimes.reduce((sum, time) => sum + time, 0) / executionTimes.length;
      const maxTime = Math.max(...executionTimes);
      const minTime = Math.min(...executionTimes);
      const variance = Math.max(...executionTimes) - Math.min(...executionTimes);

      // All executions should be within threshold
      executionTimes.forEach(time => {
        expect(time).toBeLessThan(DEFAULT_INTEGRATION_CONFIG.performanceThreshold);
      });

      // Performance should be consistent (variance < 50% of average)
      expect(variance).toBeLessThan(averageTime * 0.5);

      console.log(`Performance consistency (${executionCount} executions):`);
      console.log(`  Average: ${averageTime}ms`);
      console.log(`  Min: ${minTime}ms, Max: ${maxTime}ms`);
      console.log(`  Variance: ${variance}ms (${Math.round(variance / averageTime * 100)}%)`);
      console.log(`  Individual times: ${executionTimes.join(', ')}ms`);
    }, DEFAULT_INTEGRATION_CONFIG.testTimeout * 2);
  });

  describe('Resource Usage Performance', () => {
    it('should monitor memory usage during execution', async () => {
      const getMemoryUsage = () => process.memoryUsage();
      
      const initialMemory = getMemoryUsage();
      
      const agent = new SpendMonitorAgent(testConfig);
      await agent.initialize();
      
      const postInitMemory = getMemoryUsage();
      
      await agent.execute();
      
      const postExecutionMemory = getMemoryUsage();

      // Calculate memory increases
      const initMemoryIncrease = postInitMemory.heapUsed - initialMemory.heapUsed;
      const executionMemoryIncrease = postExecutionMemory.heapUsed - postInitMemory.heapUsed;

      // Memory usage should be reasonable (< 50MB for initialization, < 20MB for execution)
      expect(initMemoryIncrease).toBeLessThan(50 * 1024 * 1024); // 50MB
      expect(executionMemoryIncrease).toBeLessThan(20 * 1024 * 1024); // 20MB

      console.log('Memory usage analysis:');
      console.log(`  Initial heap: ${Math.round(initialMemory.heapUsed / 1024 / 1024)}MB`);
      console.log(`  Post-init heap: ${Math.round(postInitMemory.heapUsed / 1024 / 1024)}MB (+${Math.round(initMemoryIncrease / 1024 / 1024)}MB)`);
      console.log(`  Post-execution heap: ${Math.round(postExecutionMemory.heapUsed / 1024 / 1024)}MB (+${Math.round(executionMemoryIncrease / 1024 / 1024)}MB)`);
    }, DEFAULT_INTEGRATION_CONFIG.testTimeout);

    it('should handle garbage collection efficiently', async () => {
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const initialMemory = process.memoryUsage();
      
      // Create multiple agent instances to test memory cleanup
      const agents = [];
      for (let i = 0; i < 3; i++) {
        const agent = new SpendMonitorAgent(testConfig);
        await agent.initialize();
        await agent.execute();
        agents.push(agent);
      }

      const peakMemory = process.memoryUsage();

      // Clear references
      agents.length = 0;

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      // Wait for potential cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));

      const finalMemory = process.memoryUsage();

      const peakIncrease = peakMemory.heapUsed - initialMemory.heapUsed;
      const finalIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      const memoryReclaimed = peakMemory.heapUsed - finalMemory.heapUsed;

      console.log('Garbage collection analysis:');
      console.log(`  Peak memory increase: ${Math.round(peakIncrease / 1024 / 1024)}MB`);
      console.log(`  Final memory increase: ${Math.round(finalIncrease / 1024 / 1024)}MB`);
      console.log(`  Memory reclaimed: ${Math.round(memoryReclaimed / 1024 / 1024)}MB`);

      // Some memory should be reclaimed (at least 25% of peak increase)
      if (peakIncrease > 0) {
        expect(memoryReclaimed).toBeGreaterThan(peakIncrease * 0.25);
      }
    }, DEFAULT_INTEGRATION_CONFIG.testTimeout);
  });
});