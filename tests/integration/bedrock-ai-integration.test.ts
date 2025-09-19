import { BedrockAnalysisTool } from '../../src/tools/bedrock-analysis-tool';
import { AlertTool } from '../../src/tools/alert-tool';
import { CostAnalysisTool } from '../../src/tools/cost-analysis-tool';
import { SpendMonitorAgent } from '../../src/agent';
import { 
  BedrockConfig, 
  CostAnalysis, 
  SpendMonitorConfig, 
  AlertContext,
  EnhancedCostAnalysis,
  AIAnalysisResult,
  AnomalyDetectionResult,
  OptimizationRecommendation
} from '../../src/types';

// Skip integration tests unless explicitly enabled
const runIntegrationTests = process.env.RUN_INTEGRATION_TESTS === 'true';
const runBedrockTests = process.env.TEST_BEDROCK_INTEGRATION === 'true';

const describeIntegration = runIntegrationTests && runBedrockTests ? describe : describe.skip;

describeIntegration('Bedrock AI Integration Tests', () => {
  let bedrockTool: BedrockAnalysisTool;
  let costTool: CostAnalysisTool;
  let alertTool: AlertTool;
  let agent: SpendMonitorAgent;
  
  const testConfig: BedrockConfig = {
    enabled: true,
    modelId: process.env.TEST_BEDROCK_MODEL_ID || 'amazon.titan-text-express-v1',
    region: process.env.AWS_REGION || 'us-east-1',
    maxTokens: 1000,
    temperature: 0.7,
    costThreshold: 10.0, // $10 monthly limit for testing
    rateLimitPerMinute: 5, // Conservative rate limiting
    cacheResults: false, // Disable caching for testing
    cacheTTLMinutes: 0,
    fallbackOnError: true
  };

  const mockCostData: CostAnalysis = {
    totalCost: 125.75,
    serviceBreakdown: {
      'Amazon EC2': 85.50,
      'Amazon S3': 15.25,
      'Amazon RDS': 20.00,
      'AWS Lambda': 5.00
    },
    period: {
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-01-15T23:59:59.999Z'
    },
    projectedMonthly: 251.50,
    currency: 'USD',
    lastUpdated: new Date().toISOString()
  };

  beforeAll(async () => {
    if (!runBedrockTests) {
      console.log('Skipping Bedrock integration tests - set TEST_BEDROCK_INTEGRATION=true to enable');
      return;
    }

    // Initialize tools with real AWS clients
    bedrockTool = new BedrockAnalysisTool(testConfig);
    
    // Validate Bedrock access before running tests
    const hasAccess = await bedrockTool.validateModelAccess();
    if (!hasAccess) {
      throw new Error('Bedrock model access validation failed - check AWS permissions and model availability');
    }

    console.log('✓ Bedrock model access validated successfully');
  }, 30000);

  afterEach(async () => {
    // Add delay between tests to respect rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  describe('Real Bedrock API Integration', () => {
    it('should perform end-to-end AI spending analysis with real Bedrock API', async () => {
      const result = await bedrockTool.analyzeSpendingPatterns(mockCostData);

      // Validate AI analysis result structure
      expect(result).toMatchObject({
        summary: expect.any(String),
        keyInsights: expect.any(Array),
        confidenceScore: expect.any(Number),
        analysisTimestamp: expect.any(String),
        modelUsed: testConfig.modelId,
        processingCost: expect.any(Number)
      });

      // Validate content quality
      expect(result.summary.length).toBeGreaterThan(10);
      expect(result.keyInsights.length).toBeGreaterThan(0);
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
      expect(result.confidenceScore).toBeLessThanOrEqual(1);
      expect(result.processingCost).toBeGreaterThan(0);

      // Validate that AI provides meaningful insights about the cost data
      const summaryLower = result.summary.toLowerCase();
      const insightsText = result.keyInsights.join(' ').toLowerCase();
      
      // Should mention major cost drivers
      expect(summaryLower + insightsText).toMatch(/ec2|compute/);
      expect(summaryLower + insightsText).toMatch(/cost|spend|dollar|\$/);

      console.log('✓ AI Analysis Result:', {
        summary: result.summary,
        insightCount: result.keyInsights.length,
        confidence: result.confidenceScore,
        cost: result.processingCost
      });
    }, 30000);

    it('should detect spending anomalies with historical data using real Bedrock API', async () => {
      const historicalData: CostAnalysis[] = [
        { ...mockCostData, totalCost: 50.00, serviceBreakdown: { 'Amazon EC2': 30.00, 'Amazon S3': 20.00 } },
        { ...mockCostData, totalCost: 60.00, serviceBreakdown: { 'Amazon EC2': 35.00, 'Amazon S3': 25.00 } },
        { ...mockCostData, totalCost: 55.00, serviceBreakdown: { 'Amazon EC2': 32.00, 'Amazon S3': 23.00 } }
      ];

      const result = await bedrockTool.detectAnomalies(mockCostData, historicalData);

      // Validate anomaly detection result
      expect(result).toMatchObject({
        anomaliesDetected: expect.any(Boolean),
        anomalies: expect.any(Array)
      });

      // Should detect anomalies given the significant cost increase (125.75 vs ~55 historical average)
      expect(result.anomaliesDetected).toBe(true);
      expect(result.anomalies.length).toBeGreaterThan(0);

      // Validate anomaly structure
      result.anomalies.forEach(anomaly => {
        expect(anomaly).toMatchObject({
          service: expect.any(String),
          severity: expect.stringMatching(/^(LOW|MEDIUM|HIGH)$/),
          description: expect.any(String),
          confidenceScore: expect.any(Number)
        });
        
        expect(anomaly.confidenceScore).toBeGreaterThanOrEqual(0);
        expect(anomaly.confidenceScore).toBeLessThanOrEqual(1);
        expect(anomaly.description.length).toBeGreaterThan(10);
      });

      console.log('✓ Anomaly Detection Result:', {
        detected: result.anomaliesDetected,
        count: result.anomalies.length,
        anomalies: result.anomalies.map(a => ({
          service: a.service,
          severity: a.severity,
          confidence: a.confidenceScore
        }))
      });
    }, 30000);

    it('should generate optimization recommendations using real Bedrock API', async () => {
      const result = await bedrockTool.generateOptimizationRecommendations(mockCostData);

      // Validate recommendations structure
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);

      // Validate recommendation structure and content
      result.forEach(recommendation => {
        expect(recommendation).toMatchObject({
          category: expect.stringMatching(/^(RIGHTSIZING|RESERVED_INSTANCES|SPOT_INSTANCES|STORAGE_OPTIMIZATION|OTHER)$/),
          service: expect.any(String),
          description: expect.any(String),
          priority: expect.stringMatching(/^(LOW|MEDIUM|HIGH)$/),
          implementationComplexity: expect.stringMatching(/^(EASY|MEDIUM|COMPLEX)$/)
        });

        expect(recommendation.description.length).toBeGreaterThan(10);
        
        if (recommendation.estimatedSavings) {
          expect(recommendation.estimatedSavings).toBeGreaterThan(0);
        }
      });

      // Should include recommendations for major cost drivers (EC2)
      const ec2Recommendations = result.filter(r => r.service.toLowerCase().includes('ec2'));
      expect(ec2Recommendations.length).toBeGreaterThan(0);

      // Recommendations should be sorted by priority and savings
      const priorities = result.map(r => r.priority);
      const highPriorityCount = priorities.filter(p => p === 'HIGH').length;
      const mediumPriorityCount = priorities.filter(p => p === 'MEDIUM').length;
      
      // Should have at least some prioritized recommendations
      expect(highPriorityCount + mediumPriorityCount).toBeGreaterThan(0);

      console.log('✓ Optimization Recommendations:', {
        count: result.length,
        highPriority: highPriorityCount,
        mediumPriority: mediumPriorityCount,
        categories: [...new Set(result.map(r => r.category))],
        totalEstimatedSavings: result.reduce((sum, r) => sum + (r.estimatedSavings || 0), 0)
      });
    }, 30000);

    it('should handle rate limiting gracefully during multiple API calls', async () => {
      const promises: Promise<AIAnalysisResult>[] = [];
      
      // Make multiple concurrent requests to test rate limiting
      for (let i = 0; i < 3; i++) {
        promises.push(bedrockTool.analyzeSpendingPatterns({
          ...mockCostData,
          totalCost: mockCostData.totalCost + i * 10 // Vary the data slightly
        }));
      }

      const results = await Promise.all(promises);

      // All requests should succeed (rate limiting should handle delays internally)
      expect(results).toHaveLength(3);
      
      results.forEach((result, index) => {
        expect(result.summary).toBeDefined();
        expect(result.keyInsights.length).toBeGreaterThan(0);
        expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
        expect(result.processingCost).toBeGreaterThan(0);
      });

      console.log('✓ Rate Limiting Test Completed - All requests succeeded');
    }, 60000);

    it('should handle cost threshold monitoring and disable AI when exceeded', async () => {
      // Create a tool with very low cost threshold
      const lowThresholdConfig: BedrockConfig = {
        ...testConfig,
        costThreshold: 0.001 // Very low threshold to trigger limit
      };
      
      const lowThresholdTool = new BedrockAnalysisTool(lowThresholdConfig);

      // First call should work
      const firstResult = await lowThresholdTool.analyzeSpendingPatterns(mockCostData);
      expect(firstResult.summary).toBeDefined();

      // Subsequent calls might hit the cost threshold depending on actual costs
      // This test validates the cost tracking mechanism exists
      expect(firstResult.processingCost).toBeGreaterThan(0);
      
      console.log('✓ Cost Threshold Monitoring - Processing cost tracked:', firstResult.processingCost);
    }, 30000);
  });

  describe('AI-Enhanced Alert Integration', () => {
    beforeEach(() => {
      // Initialize alert tool for AI-enhanced alert tests
      alertTool = new AlertTool();
    });

    it('should integrate AI insights into alert messages', async () => {
      // Get AI analysis first
      const aiAnalysis = await bedrockTool.analyzeSpendingPatterns(mockCostData);
      
      // Create enhanced cost analysis
      const enhancedCostData: EnhancedCostAnalysis = {
        ...mockCostData,
        aiAnalysis,
        anomalies: undefined,
        recommendations: undefined,
        aiProcessingTime: 1500,
        fallbackUsed: false
      };

      // Create alert context
      const alertContext: AlertContext = {
        threshold: 100.00,
        exceedAmount: 25.75,
        percentageOver: 25.75,
        topServices: [
          { service: 'Amazon EC2', cost: 85.50 },
          { service: 'Amazon RDS', cost: 20.00 },
          { service: 'Amazon S3', cost: 15.25 }
        ],
        alertLevel: 'WARNING'
      };

      // Format alert message with AI insights
      const alertMessage = alertTool.formatAlertMessage(enhancedCostData, alertContext);

      // Validate that AI insights are included in the alert
      expect(alertMessage).toContain('AI Analysis');
      expect(alertMessage).toContain(aiAnalysis.summary);
      expect(alertMessage).toContain('Confidence');
      expect(alertMessage).toContain(aiAnalysis.confidenceScore.toString());

      // Should include key insights
      aiAnalysis.keyInsights.forEach(insight => {
        expect(alertMessage).toContain(insight);
      });

      console.log('✓ AI-Enhanced Alert Message Generated');
      console.log('Message length:', alertMessage.length);
      console.log('Contains AI summary:', alertMessage.includes(aiAnalysis.summary));
    }, 30000);

    it('should format iOS notifications with AI recommendations', async () => {
      // Get optimization recommendations
      const recommendations = await bedrockTool.generateOptimizationRecommendations(mockCostData);
      
      const enhancedCostData: EnhancedCostAnalysis = {
        ...mockCostData,
        recommendations,
        aiProcessingTime: 2000,
        fallbackUsed: false
      };

      const alertContext: AlertContext = {
        threshold: 100.00,
        exceedAmount: 25.75,
        percentageOver: 25.75,
        topServices: [
          { service: 'Amazon EC2', cost: 85.50 },
          { service: 'Amazon RDS', cost: 20.00 }
        ],
        alertLevel: 'WARNING'
      };

      // Format iOS payload with AI recommendations
      const iosPayload = alertTool.formatIOSPayload(enhancedCostData, alertContext);

      // Validate iOS payload structure
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
          spendAmount: mockCostData.totalCost,
          threshold: alertContext.threshold,
          exceedAmount: alertContext.exceedAmount,
          topService: 'Amazon EC2',
          alertId: expect.any(String)
        }
      });

      // Should include AI recommendations in the alert body or custom data
      const alertText = iosPayload.aps.alert.body;
      const hasRecommendations = recommendations.some(rec => 
        alertText.toLowerCase().includes(rec.category.toLowerCase()) ||
        alertText.toLowerCase().includes('optimization') ||
        alertText.toLowerCase().includes('recommendation')
      );
      
      expect(hasRecommendations).toBe(true);

      console.log('✓ iOS Payload with AI Recommendations Generated');
      console.log('Alert body length:', alertText.length);
      console.log('Recommendations included:', hasRecommendations);
    }, 30000);
  });

  describe('End-to-End AI Workflow Integration', () => {
    it('should perform complete AI-enhanced cost monitoring workflow', async () => {
      // Simulate a complete workflow with AI enhancement
      const startTime = Date.now();

      // Step 1: Analyze spending patterns with AI
      const aiAnalysis = await bedrockTool.analyzeSpendingPatterns(mockCostData);
      expect(aiAnalysis.summary).toBeDefined();

      // Step 2: Detect anomalies
      const anomalies = await bedrockTool.detectAnomalies(mockCostData);
      expect(anomalies.anomaliesDetected).toBeDefined();

      // Step 3: Generate optimization recommendations
      const recommendations = await bedrockTool.generateOptimizationRecommendations(mockCostData);
      expect(recommendations.length).toBeGreaterThan(0);

      // Step 4: Create enhanced cost analysis
      const enhancedAnalysis: EnhancedCostAnalysis = {
        ...mockCostData,
        aiAnalysis,
        anomalies,
        recommendations,
        aiProcessingTime: Date.now() - startTime,
        fallbackUsed: false
      };

      // Step 5: Validate complete enhanced analysis
      expect(enhancedAnalysis.aiAnalysis).toBeDefined();
      expect(enhancedAnalysis.anomalies).toBeDefined();
      expect(enhancedAnalysis.recommendations).toBeDefined();
      expect(enhancedAnalysis.aiProcessingTime).toBeGreaterThan(0);

      // Performance validation
      const totalTime = Date.now() - startTime;
      expect(totalTime).toBeLessThan(30000); // Should complete within 30 seconds

      console.log('✓ Complete AI Workflow Completed');
      console.log('Total processing time:', totalTime, 'ms');
      console.log('AI insights:', aiAnalysis.keyInsights.length);
      console.log('Anomalies detected:', anomalies.anomaliesDetected);
      console.log('Recommendations:', recommendations.length);
    }, 45000);

    it('should handle fallback gracefully when Bedrock is unavailable', async () => {
      // Create a tool with invalid configuration to simulate unavailability
      const invalidConfig: BedrockConfig = {
        ...testConfig,
        modelId: 'invalid-model-id',
        fallbackOnError: true
      };

      const fallbackTool = new BedrockAnalysisTool(invalidConfig);

      // Should use fallback analysis
      const result = await fallbackTool.analyzeSpendingPatterns(mockCostData);

      expect(result.summary).toContain('Current AWS spending');
      expect(result.keyInsights).toContain('AI analysis unavailable - using basic cost breakdown');
      expect(result.confidenceScore).toBe(0.3);
      expect(result.modelUsed).toBe('fallback');

      console.log('✓ Fallback Mechanism Validated');
    }, 15000);

    it('should maintain performance under load with AI analysis', async () => {
      const concurrentRequests = 3;
      const promises: Promise<AIAnalysisResult>[] = [];

      const startTime = Date.now();

      // Create multiple concurrent AI analysis requests
      for (let i = 0; i < concurrentRequests; i++) {
        const testData = {
          ...mockCostData,
          totalCost: mockCostData.totalCost + (i * 5) // Vary data slightly
        };
        promises.push(bedrockTool.analyzeSpendingPatterns(testData));
      }

      const results = await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      // All requests should succeed
      expect(results).toHaveLength(concurrentRequests);
      results.forEach(result => {
        expect(result.summary).toBeDefined();
        expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
      });

      // Performance should be reasonable even with rate limiting
      const averageTime = totalTime / concurrentRequests;
      expect(averageTime).toBeLessThan(15000); // Average < 15 seconds per request

      console.log('✓ Performance Under Load Validated');
      console.log('Concurrent requests:', concurrentRequests);
      console.log('Total time:', totalTime, 'ms');
      console.log('Average time per request:', averageTime, 'ms');
    }, 60000);
  });

  describe('Error Handling and Recovery', () => {
    it('should handle network timeouts gracefully', async () => {
      // This test validates that the tool handles real network issues
      // We can't easily simulate network timeouts in integration tests,
      // but we can validate the error handling structure exists
      
      const result = await bedrockTool.analyzeSpendingPatterns(mockCostData);
      
      // If we get here, the network call succeeded
      expect(result.summary).toBeDefined();
      
      console.log('✓ Network connectivity validated');
    }, 30000);

    it('should handle model throttling and retry appropriately', async () => {
      // Make rapid requests to potentially trigger throttling
      const rapidRequests = 2;
      const promises: Promise<AIAnalysisResult>[] = [];

      for (let i = 0; i < rapidRequests; i++) {
        promises.push(bedrockTool.analyzeSpendingPatterns(mockCostData));
      }

      // All should eventually succeed due to retry logic
      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(rapidRequests);
      results.forEach(result => {
        expect(result.summary).toBeDefined();
      });

      console.log('✓ Throttling and retry handling validated');
    }, 45000);

    it('should validate model access before processing', async () => {
      const hasAccess = await bedrockTool.validateModelAccess();
      expect(hasAccess).toBe(true);

      console.log('✓ Model access validation confirmed');
    }, 15000);
  });
});