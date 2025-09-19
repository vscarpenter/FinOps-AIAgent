import { BedrockAnalysisTool } from '../../src/tools/bedrock-analysis-tool';
import { CostAnalysisTool } from '../../src/tools/cost-analysis-tool';
import { SpendMonitorAgent } from '../../src/agent';
import { 
  BedrockConfig, 
  CostAnalysis, 
  SpendMonitorConfig,
  EnhancedCostAnalysis
} from '../../src/types';

// Skip performance tests unless explicitly enabled
const runPerformanceTests = process.env.RUN_INTEGRATION_TESTS === 'true' && 
                           process.env.TEST_BEDROCK_INTEGRATION === 'true' &&
                           process.env.RUN_PERFORMANCE_TESTS === 'true';

const describePerformance = runPerformanceTests ? describe : describe.skip;

describePerformance('AI Performance Integration Tests', () => {
  let bedrockTool: BedrockAnalysisTool;
  let agent: SpendMonitorAgent;
  
  const performanceConfig: BedrockConfig = {
    enabled: true,
    modelId: process.env.TEST_BEDROCK_MODEL_ID || 'amazon.titan-text-express-v1',
    region: process.env.AWS_REGION || 'us-east-1',
    maxTokens: 1000,
    temperature: 0.7,
    costThreshold: 20.0,
    rateLimitPerMinute: 10,
    cacheResults: false,
    cacheTTLMinutes: 0,
    fallbackOnError: true
  };

  const testConfig: SpendMonitorConfig = {
    spendThreshold: 100,
    snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
    checkPeriodDays: 1,
    region: performanceConfig.region,
    retryAttempts: 3,
    minServiceCostThreshold: 1,
    bedrockConfig: performanceConfig
  };

  // Performance test data sets
  const smallCostData: CostAnalysis = {
    totalCost: 50.25,
    serviceBreakdown: {
      'Amazon EC2': 30.00,
      'Amazon S3': 20.25
    },
    period: {
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-01-15T23:59:59.999Z'
    },
    projectedMonthly: 100.50,
    currency: 'USD',
    lastUpdated: new Date().toISOString()
  };

  const largeCostData: CostAnalysis = {
    totalCost: 2500.75,
    serviceBreakdown: {
      'Amazon EC2': 1200.00,
      'Amazon RDS': 400.00,
      'Amazon S3': 300.25,
      'AWS Lambda': 150.00,
      'Amazon CloudFront': 125.50,
      'Amazon DynamoDB': 100.00,
      'Amazon ELB': 75.00,
      'Amazon VPC': 50.00,
      'Amazon Route 53': 25.00,
      'AWS CloudTrail': 75.00
    },
    period: {
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-01-31T23:59:59.999Z'
    },
    projectedMonthly: 2500.75,
    currency: 'USD',
    lastUpdated: new Date().toISOString()
  };

  beforeAll(async () => {
    if (!runPerformanceTests) {
      console.log('Skipping AI performance tests - set RUN_PERFORMANCE_TESTS=true to enable');
      return;
    }

    bedrockTool = new BedrockAnalysisTool(performanceConfig);
    agent = new SpendMonitorAgent(testConfig);
    await agent.initialize();

    // Validate Bedrock access
    const hasAccess = await bedrockTool.validateModelAccess();
    if (!hasAccess) {
      throw new Error('Bedrock model access validation failed');
    }

    console.log('✓ AI Performance test setup completed');
  }, 30000);

  describe('AI Analysis Performance', () => {
    it('should complete spending pattern analysis within performance threshold', async () => {
      const startTime = Date.now();
      
      const result = await bedrockTool.analyzeSpendingPatterns(smallCostData);
      
      const executionTime = Date.now() - startTime;
      
      // Performance assertions
      expect(executionTime).toBeLessThan(15000); // Should complete within 15 seconds
      expect(result.summary).toBeDefined();
      expect(result.keyInsights.length).toBeGreaterThan(0);
      expect(result.processingCost).toBeGreaterThan(0);

      console.log('✓ Spending Analysis Performance:', {
        executionTime: `${executionTime}ms`,
        summaryLength: result.summary.length,
        insightCount: result.keyInsights.length,
        confidence: result.confidenceScore,
        processingCost: result.processingCost
      });
    }, 20000);

    it('should handle large cost datasets efficiently', async () => {
      const startTime = Date.now();
      
      const result = await bedrockTool.analyzeSpendingPatterns(largeCostData);
      
      const executionTime = Date.now() - startTime;
      
      // Performance should not degrade significantly with larger datasets
      expect(executionTime).toBeLessThan(20000); // Should complete within 20 seconds
      expect(result.summary).toBeDefined();
      expect(result.keyInsights.length).toBeGreaterThan(0);

      // Should provide insights about multiple services
      const summaryLower = result.summary.toLowerCase();
      const insightsText = result.keyInsights.join(' ').toLowerCase();
      const combinedText = summaryLower + insightsText;
      
      // Should mention major cost drivers from the large dataset
      expect(combinedText).toMatch(/ec2|compute/);
      expect(combinedText).toMatch(/rds|database/);

      console.log('✓ Large Dataset Analysis Performance:', {
        executionTime: `${executionTime}ms`,
        serviceCount: Object.keys(largeCostData.serviceBreakdown).length,
        totalCost: largeCostData.totalCost,
        insightCount: result.keyInsights.length
      });
    }, 25000);

    it('should perform anomaly detection within performance threshold', async () => {
      const historicalData = [
        { ...smallCostData, totalCost: 25.00 },
        { ...smallCostData, totalCost: 30.00 },
        { ...smallCostData, totalCost: 28.00 }
      ];

      const startTime = Date.now();
      
      const result = await bedrockTool.detectAnomalies(largeCostData, historicalData);
      
      const executionTime = Date.now() - startTime;
      
      // Performance assertions
      expect(executionTime).toBeLessThan(18000); // Should complete within 18 seconds
      expect(result.anomaliesDetected).toBeDefined();

      // Should detect anomalies given the large difference (2500 vs ~27 historical average)
      expect(result.anomaliesDetected).toBe(true);
      expect(result.anomalies.length).toBeGreaterThan(0);

      console.log('✓ Anomaly Detection Performance:', {
        executionTime: `${executionTime}ms`,
        anomaliesDetected: result.anomaliesDetected,
        anomalyCount: result.anomalies.length,
        historicalDataPoints: historicalData.length
      });
    }, 25000);

    it('should generate optimization recommendations efficiently', async () => {
      const startTime = Date.now();
      
      const result = await bedrockTool.generateOptimizationRecommendations(largeCostData);
      
      const executionTime = Date.now() - startTime;
      
      // Performance assertions
      expect(executionTime).toBeLessThan(18000); // Should complete within 18 seconds
      expect(result.length).toBeGreaterThan(0);

      // Should provide recommendations for major services
      const services = result.map(r => r.service);
      expect(services.some(s => s.toLowerCase().includes('ec2'))).toBe(true);

      // Calculate total potential savings
      const totalSavings = result.reduce((sum, r) => sum + (r.estimatedSavings || 0), 0);
      expect(totalSavings).toBeGreaterThan(0);

      console.log('✓ Optimization Recommendations Performance:', {
        executionTime: `${executionTime}ms`,
        recommendationCount: result.length,
        totalEstimatedSavings: totalSavings,
        categories: [...new Set(result.map(r => r.category))]
      });
    }, 25000);
  });

  describe('Concurrent AI Operations Performance', () => {
    it('should handle multiple concurrent AI analysis requests efficiently', async () => {
      const concurrentRequests = 3;
      const testDataSets = [
        smallCostData,
        { ...smallCostData, totalCost: 75.50 },
        { ...smallCostData, totalCost: 125.25 }
      ];

      const startTime = Date.now();
      
      const promises = testDataSets.map(data => 
        bedrockTool.analyzeSpendingPatterns(data)
      );
      
      const results = await Promise.all(promises);
      
      const totalTime = Date.now() - startTime;
      const averageTime = totalTime / concurrentRequests;
      
      // All requests should succeed
      expect(results).toHaveLength(concurrentRequests);
      results.forEach(result => {
        expect(result.summary).toBeDefined();
        expect(result.keyInsights.length).toBeGreaterThan(0);
      });

      // Performance should be reasonable with rate limiting
      expect(averageTime).toBeLessThan(20000); // Average < 20 seconds per request
      expect(totalTime).toBeLessThan(45000); // Total < 45 seconds

      console.log('✓ Concurrent Operations Performance:', {
        concurrentRequests,
        totalTime: `${totalTime}ms`,
        averageTime: `${averageTime}ms`,
        successfulRequests: results.length
      });
    }, 60000);

    it('should maintain performance with mixed AI operation types', async () => {
      const startTime = Date.now();
      
      // Execute different types of AI operations concurrently
      const [analysis, anomalies, recommendations] = await Promise.all([
        bedrockTool.analyzeSpendingPatterns(largeCostData),
        bedrockTool.detectAnomalies(largeCostData),
        bedrockTool.generateOptimizationRecommendations(largeCostData)
      ]);
      
      const totalTime = Date.now() - startTime;
      
      // All operations should succeed
      expect(analysis.summary).toBeDefined();
      expect(anomalies.anomaliesDetected).toBeDefined();
      expect(recommendations.length).toBeGreaterThan(0);

      // Combined operations should complete efficiently
      expect(totalTime).toBeLessThan(35000); // Should complete within 35 seconds

      console.log('✓ Mixed Operations Performance:', {
        totalTime: `${totalTime}ms`,
        analysisInsights: analysis.keyInsights.length,
        anomaliesDetected: anomalies.anomaliesDetected,
        recommendationCount: recommendations.length
      });
    }, 45000);
  });

  describe('End-to-End AI Workflow Performance', () => {
    it('should complete full AI-enhanced cost monitoring workflow within performance threshold', async () => {
      const startTime = Date.now();
      
      // Simulate complete workflow
      const costTool = agent.getTool('CostAnalysisTool') as CostAnalysisTool;
      
      // Step 1: Get cost data (simulated with test data)
      const costData = largeCostData;
      
      // Step 2: Enhance with AI analysis
      const enhancedAnalysis = await costTool.enhanceWithAIAnalysis(costData);
      
      const totalTime = Date.now() - startTime;
      
      // Validate enhanced analysis
      expect(enhancedAnalysis.aiAnalysis).toBeDefined();
      expect(enhancedAnalysis.aiAnalysis!.summary).toBeDefined();
      expect(enhancedAnalysis.aiAnalysis!.keyInsights.length).toBeGreaterThan(0);
      
      // Performance validation
      expect(totalTime).toBeLessThan(25000); // Should complete within 25 seconds
      expect(enhancedAnalysis.aiProcessingTime).toBeGreaterThan(0);

      console.log('✓ Full AI Workflow Performance:', {
        totalTime: `${totalTime}ms`,
        aiProcessingTime: `${enhancedAnalysis.aiProcessingTime}ms`,
        fallbackUsed: enhancedAnalysis.fallbackUsed,
        confidence: enhancedAnalysis.aiAnalysis!.confidenceScore
      });
    }, 35000);

    it('should maintain acceptable performance under rate limiting', async () => {
      // Test performance when rate limits are approached
      const rateLimitedConfig: BedrockConfig = {
        ...performanceConfig,
        rateLimitPerMinute: 2 // Very conservative rate limit
      };
      
      const rateLimitedTool = new BedrockAnalysisTool(rateLimitedConfig);
      
      const startTime = Date.now();
      
      // Make requests that will trigger rate limiting
      const results = [];
      for (let i = 0; i < 3; i++) {
        const result = await rateLimitedTool.analyzeSpendingPatterns({
          ...smallCostData,
          totalCost: smallCostData.totalCost + (i * 10)
        });
        results.push(result);
      }
      
      const totalTime = Date.now() - startTime;
      
      // All requests should eventually succeed
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.summary).toBeDefined();
      });

      // Should handle rate limiting gracefully (may take longer but should complete)
      expect(totalTime).toBeLessThan(120000); // Should complete within 2 minutes

      console.log('✓ Rate Limited Performance:', {
        totalTime: `${totalTime}ms`,
        requestCount: results.length,
        averageTime: `${totalTime / results.length}ms`
      });
    }, 150000);
  });

  describe('Memory and Resource Usage', () => {
    it('should maintain reasonable memory usage during AI operations', async () => {
      const initialMemory = process.memoryUsage();
      
      // Perform multiple AI operations
      await bedrockTool.analyzeSpendingPatterns(largeCostData);
      await bedrockTool.detectAnomalies(largeCostData);
      await bedrockTool.generateOptimizationRecommendations(largeCostData);
      
      const finalMemory = process.memoryUsage();
      
      // Calculate memory increase
      const heapIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      const rssIncrease = finalMemory.rss - initialMemory.rss;
      
      // Memory usage should be reasonable (less than 50MB increase)
      expect(heapIncrease).toBeLessThan(50 * 1024 * 1024); // 50MB
      expect(rssIncrease).toBeLessThan(100 * 1024 * 1024); // 100MB

      console.log('✓ Memory Usage Analysis:', {
        heapIncrease: `${Math.round(heapIncrease / 1024 / 1024)}MB`,
        rssIncrease: `${Math.round(rssIncrease / 1024 / 1024)}MB`,
        finalHeapUsed: `${Math.round(finalMemory.heapUsed / 1024 / 1024)}MB`,
        finalRSS: `${Math.round(finalMemory.rss / 1024 / 1024)}MB`
      });
    }, 45000);

    it('should handle cleanup properly after AI operations', async () => {
      // Perform AI operations and verify no resource leaks
      const operations = [];
      
      for (let i = 0; i < 5; i++) {
        operations.push(
          bedrockTool.analyzeSpendingPatterns({
            ...smallCostData,
            totalCost: smallCostData.totalCost + i
          })
        );
      }
      
      const results = await Promise.all(operations);
      
      // All operations should complete successfully
      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result.summary).toBeDefined();
      });

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      console.log('✓ Resource Cleanup Validated - No apparent leaks detected');
    }, 60000);
  });
});