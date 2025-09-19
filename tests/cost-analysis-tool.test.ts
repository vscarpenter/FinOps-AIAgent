import { CostAnalysisTool } from '../src/tools/cost-analysis-tool';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { BedrockAnalysisTool } from '../src/tools/bedrock-analysis-tool';
import { CostAnalysis, BedrockConfig, AIAnalysisResult, AnomalyDetectionResult, OptimizationRecommendation } from '../src/types';

// Mock the AWS SDK and Bedrock tool
jest.mock('@aws-sdk/client-cost-explorer');
jest.mock('../src/tools/bedrock-analysis-tool');

const mockCostExplorerClient = {
  send: jest.fn()
};

const mockBedrockTool = {
  analyzeSpendingPatterns: jest.fn(),
  detectAnomalies: jest.fn(),
  generateOptimizationRecommendations: jest.fn(),
  validateModelAccess: jest.fn()
};

(CostExplorerClient as jest.Mock).mockImplementation(() => mockCostExplorerClient);
(BedrockAnalysisTool as jest.Mock).mockImplementation(() => mockBedrockTool);

describe('CostAnalysisTool', () => {
  let tool: CostAnalysisTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new CostAnalysisTool('us-east-1', { maxAttempts: 1 }); // Disable retries for tests
    
    // Mock the logger
    (tool as any).logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };
  });

  describe('getCurrentMonthCosts', () => {
    it('should retrieve and format current month costs successfully', async () => {
      const mockResponse = {
        ResultsByTime: [
          {
            Groups: [
              {
                Keys: ['Amazon Elastic Compute Cloud - Compute'],
                Metrics: {
                  BlendedCost: {
                    Amount: '5.50',
                    Unit: 'USD'
                  }
                }
              },
              {
                Keys: ['Amazon Simple Storage Service'],
                Metrics: {
                  BlendedCost: {
                    Amount: '2.25',
                    Unit: 'USD'
                  }
                }
              }
            ],
            Total: {
              BlendedCost: {
                Amount: '7.75',
                Unit: 'USD'
              }
            }
          }
        ]
      };

      mockCostExplorerClient.send.mockResolvedValue(mockResponse);

      const result = await tool.getCurrentMonthCosts();

      expect(result).toMatchObject({
        totalCost: 7.75,
        serviceBreakdown: {
          'Amazon Elastic Compute Cloud - Compute': 5.50,
          'Amazon Simple Storage Service': 2.25
        },
        currency: 'USD'
      });

      expect(result.projectedMonthly).toBeGreaterThan(0);
      expect(result.period.start).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
      expect(result.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should handle empty cost data', async () => {
      const mockResponse = {
        ResultsByTime: [
          {
            Groups: [],
            Total: {
              BlendedCost: {
                Amount: '0.00',
                Unit: 'USD'
              }
            }
          }
        ]
      };

      mockCostExplorerClient.send.mockResolvedValue(mockResponse);

      const result = await tool.getCurrentMonthCosts();

      expect(result.totalCost).toBe(0);
      expect(result.serviceBreakdown).toEqual({});
      expect(result.projectedMonthly).toBe(0);
    });

    it('should handle API errors with proper error message', async () => {
      const apiError = new Error('Access denied');
      apiError.name = 'AccessDeniedException';
      mockCostExplorerClient.send.mockRejectedValue(apiError);

      await expect(tool.getCurrentMonthCosts()).rejects.toThrow('Cost Explorer API error: Access denied');
      expect((tool as any).logger.error).toHaveBeenCalledWith(
        'Failed to retrieve cost data from Cost Explorer',
        { error: apiError }
      );
    });

    it('should retry on throttling errors', async () => {
      const throttleError = new Error('Rate exceeded');
      throttleError.name = 'ThrottlingException';
      
      // Create a new tool with retries enabled for this test
      const retryTool = new CostAnalysisTool('us-east-1', { maxAttempts: 2, baseDelay: 10 });
      (retryTool as any).logger = (tool as any).logger;

      mockCostExplorerClient.send
        .mockRejectedValueOnce(throttleError)
        .mockResolvedValueOnce({
          ResultsByTime: [{ Groups: [], Total: { BlendedCost: { Amount: '0.00' } } }]
        });

      const result = await retryTool.getCurrentMonthCosts();

      expect(result.totalCost).toBe(0);
      expect(mockCostExplorerClient.send).toHaveBeenCalledTimes(2);
      expect((retryTool as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Cost Explorer API call failed, retrying'),
        expect.objectContaining({
          attempt: 1,
          maxAttempts: 2
        })
      );
    });
  });

  describe('enhanceWithAIAnalysis', () => {
    let bedrockConfig: BedrockConfig;
    let toolWithBedrock: CostAnalysisTool;
    let sampleCostAnalysis: CostAnalysis;

    beforeEach(() => {
      bedrockConfig = {
        enabled: true,
        modelId: 'amazon.titan-text-express-v1',
        region: 'us-east-1',
        maxTokens: 1000,
        temperature: 0.7,
        costThreshold: 10.0,
        rateLimitPerMinute: 10,
        cacheResults: true,
        cacheTTLMinutes: 30,
        fallbackOnError: true
      };

      toolWithBedrock = new CostAnalysisTool('us-east-1', { maxAttempts: 1 }, bedrockConfig);
      (toolWithBedrock as any).logger = (tool as any).logger;

      sampleCostAnalysis = {
        totalCost: 100,
        serviceBreakdown: {
          'EC2': 60,
          'S3': 25,
          'Lambda': 15
        },
        period: { start: '2023-01-01T00:00:00.000Z', end: '2023-01-31T23:59:59.999Z' },
        projectedMonthly: 100,
        currency: 'USD',
        lastUpdated: '2023-01-15T12:00:00.000Z'
      };
    });

    it('should return basic analysis when Bedrock is disabled', async () => {
      const toolWithoutBedrock = new CostAnalysisTool('us-east-1');
      (toolWithoutBedrock as any).logger = (tool as any).logger;

      const result = await toolWithoutBedrock.enhanceWithAIAnalysis(sampleCostAnalysis);

      expect(result).toEqual({
        ...sampleCostAnalysis,
        fallbackUsed: true
      });
      expect((toolWithoutBedrock as any).logger.info).toHaveBeenCalledWith(
        'Bedrock AI analysis is disabled, returning basic cost analysis'
      );
    });

    it('should perform full AI enhancement when all services succeed', async () => {
      const mockAIAnalysis: AIAnalysisResult = {
        summary: 'High EC2 usage detected',
        keyInsights: ['EC2 dominates costs', 'Consider rightsizing'],
        confidenceScore: 0.85,
        analysisTimestamp: '2023-01-15T12:00:00.000Z',
        modelUsed: 'amazon.titan-text-express-v1',
        processingCost: 0.001
      };

      const mockAnomalies: AnomalyDetectionResult = {
        anomaliesDetected: true,
        anomalies: [{
          service: 'EC2',
          severity: 'MEDIUM',
          description: 'Unusual spike in EC2 costs',
          confidenceScore: 0.75
        }]
      };

      const mockRecommendations: OptimizationRecommendation[] = [{
        category: 'RIGHTSIZING',
        service: 'EC2',
        description: 'Consider smaller instance types',
        estimatedSavings: 20,
        priority: 'HIGH',
        implementationComplexity: 'MEDIUM'
      }];

      mockBedrockTool.analyzeSpendingPatterns.mockResolvedValue(mockAIAnalysis);
      mockBedrockTool.detectAnomalies.mockResolvedValue(mockAnomalies);
      mockBedrockTool.generateOptimizationRecommendations.mockResolvedValue(mockRecommendations);

      const result = await toolWithBedrock.enhanceWithAIAnalysis(sampleCostAnalysis);

      expect(result).toMatchObject({
        ...sampleCostAnalysis,
        aiAnalysis: mockAIAnalysis,
        anomalies: mockAnomalies,
        recommendations: mockRecommendations,
        fallbackUsed: false
      });
      expect(result.aiProcessingTime).toBeGreaterThanOrEqual(0);
    });

    it('should handle partial AI service failures gracefully', async () => {
      const mockAIAnalysis: AIAnalysisResult = {
        summary: 'Analysis completed',
        keyInsights: ['Key insight'],
        confidenceScore: 0.8,
        analysisTimestamp: '2023-01-15T12:00:00.000Z',
        modelUsed: 'amazon.titan-text-express-v1'
      };

      mockBedrockTool.analyzeSpendingPatterns.mockResolvedValue(mockAIAnalysis);
      mockBedrockTool.detectAnomalies.mockRejectedValue(new Error('Anomaly detection failed'));
      mockBedrockTool.generateOptimizationRecommendations.mockRejectedValue(new Error('Recommendations failed'));

      const result = await toolWithBedrock.enhanceWithAIAnalysis(sampleCostAnalysis);

      expect(result).toMatchObject({
        ...sampleCostAnalysis,
        aiAnalysis: mockAIAnalysis,
        fallbackUsed: false
      });
      expect(result.anomalies).toBeUndefined();
      expect(result.recommendations).toBeUndefined();
      expect((toolWithBedrock as any).logger.warn).toHaveBeenCalledTimes(2);
    });

    it('should use cached results when available', async () => {
      const mockAIAnalysis: AIAnalysisResult = {
        summary: 'Cached analysis',
        keyInsights: ['Cached insight'],
        confidenceScore: 0.9,
        analysisTimestamp: '2023-01-15T12:00:00.000Z',
        modelUsed: 'amazon.titan-text-express-v1'
      };

      mockBedrockTool.analyzeSpendingPatterns.mockResolvedValue(mockAIAnalysis);
      mockBedrockTool.detectAnomalies.mockResolvedValue({ anomaliesDetected: false, anomalies: [] });
      mockBedrockTool.generateOptimizationRecommendations.mockResolvedValue([]);

      // First call should populate cache
      await toolWithBedrock.enhanceWithAIAnalysis(sampleCostAnalysis);
      
      // Second call should use cache
      const result = await toolWithBedrock.enhanceWithAIAnalysis(sampleCostAnalysis);

      expect(result.aiAnalysis).toEqual(mockAIAnalysis);
      expect((toolWithBedrock as any).logger.info).toHaveBeenCalledWith('Using cached AI analysis result');
      
      // Bedrock tools should only be called once (for the first request)
      expect(mockBedrockTool.analyzeSpendingPatterns).toHaveBeenCalledTimes(1);
    });

    it('should respect cost thresholds and skip AI analysis when exceeded', async () => {
      // Set a very low cost threshold
      const lowCostConfig = { ...bedrockConfig, costThreshold: 0.001 };
      const toolWithLowThreshold = new CostAnalysisTool('us-east-1', { maxAttempts: 1 }, lowCostConfig);
      (toolWithLowThreshold as any).logger = (tool as any).logger;

      // Simulate that we've already exceeded the threshold
      (toolWithLowThreshold as any).monthlyBedrockSpend = 0.002;

      const result = await toolWithLowThreshold.enhanceWithAIAnalysis(sampleCostAnalysis);

      expect(result).toEqual({
        ...sampleCostAnalysis,
        fallbackUsed: true
      });
      expect((toolWithLowThreshold as any).logger.warn).toHaveBeenCalledWith(
        'Bedrock cost threshold exceeded, skipping AI analysis',
        expect.objectContaining({
          monthlySpend: 0.002,
          threshold: 0.001
        })
      );
    });

    it('should fallback to basic analysis when AI completely fails and fallback is enabled', async () => {
      mockBedrockTool.analyzeSpendingPatterns.mockRejectedValue(new Error('Complete AI failure'));
      mockBedrockTool.detectAnomalies.mockRejectedValue(new Error('Complete AI failure'));
      mockBedrockTool.generateOptimizationRecommendations.mockRejectedValue(new Error('Complete AI failure'));

      const result = await toolWithBedrock.enhanceWithAIAnalysis(sampleCostAnalysis);

      expect(result).toEqual({
        ...sampleCostAnalysis,
        fallbackUsed: true
      });
    });

    it('should throw error when AI fails and fallback is disabled', async () => {
      const noFallbackConfig = { ...bedrockConfig, fallbackOnError: false };
      const toolNoFallback = new CostAnalysisTool('us-east-1', { maxAttempts: 1 }, noFallbackConfig);
      (toolNoFallback as any).logger = (tool as any).logger;

      mockBedrockTool.analyzeSpendingPatterns.mockRejectedValue(new Error('AI failure'));
      mockBedrockTool.detectAnomalies.mockRejectedValue(new Error('AI failure'));
      mockBedrockTool.generateOptimizationRecommendations.mockRejectedValue(new Error('AI failure'));

      await expect(toolNoFallback.enhanceWithAIAnalysis(sampleCostAnalysis))
        .rejects.toThrow('AI enhancement failed');
    });
  });

  describe('Bedrock cost control and caching', () => {
    let toolWithBedrock: CostAnalysisTool;
    let bedrockConfig: BedrockConfig;

    beforeEach(() => {
      bedrockConfig = {
        enabled: true,
        modelId: 'amazon.titan-text-express-v1',
        region: 'us-east-1',
        maxTokens: 1000,
        temperature: 0.7,
        costThreshold: 5.0,
        rateLimitPerMinute: 10,
        cacheResults: true,
        cacheTTLMinutes: 30,
        fallbackOnError: true
      };

      toolWithBedrock = new CostAnalysisTool('us-east-1', { maxAttempts: 1 }, bedrockConfig);
      (toolWithBedrock as any).logger = (tool as any).logger;
    });

    it('should track Bedrock costs correctly', () => {
      const stats = toolWithBedrock.getBedrockUsageStats();
      
      expect(stats).toMatchObject({
        monthlySpend: 0,
        threshold: 5.0,
        cacheSize: 0
      });
    });

    it('should clear AI cache when requested', () => {
      toolWithBedrock.clearAICache();
      
      expect((toolWithBedrock as any).logger.info).toHaveBeenCalledWith('AI analysis cache cleared');
    });

    it('should disable AI analysis when requested', () => {
      toolWithBedrock.disableAIAnalysis();
      
      expect((toolWithBedrock as any).logger.warn).toHaveBeenCalledWith(
        'AI analysis disabled due to cost threshold or manual override'
      );
    });
  });

  describe('Advanced cost control and rate limiting', () => {
    let toolWithBedrock: CostAnalysisTool;
    let bedrockConfig: BedrockConfig;
    let sampleCostAnalysis: CostAnalysis;

    beforeEach(() => {
      bedrockConfig = {
        enabled: true,
        modelId: 'amazon.titan-text-express-v1',
        region: 'us-east-1',
        maxTokens: 1000,
        temperature: 0.7,
        costThreshold: 1.0, // Low threshold for testing
        rateLimitPerMinute: 10,
        cacheResults: true,
        cacheTTLMinutes: 30,
        fallbackOnError: true
      };

      toolWithBedrock = new CostAnalysisTool('us-east-1', { maxAttempts: 1 }, bedrockConfig);
      (toolWithBedrock as any).logger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
      };

      sampleCostAnalysis = {
        totalCost: 100,
        serviceBreakdown: {
          'EC2': 60,
          'S3': 25,
          'Lambda': 15
        },
        period: { start: '2023-01-01T00:00:00.000Z', end: '2023-01-31T23:59:59.999Z' },
        projectedMonthly: 100,
        currency: 'USD',
        lastUpdated: '2023-01-15T12:00:00.000Z'
      };
    });

    it('should automatically disable AI when cost threshold is exceeded', async () => {
      // Set monthly spend to exceed threshold
      (toolWithBedrock as any).monthlyBedrockSpend = 1.5;

      const result = await toolWithBedrock.enhanceWithAIAnalysisAdvanced(sampleCostAnalysis);

      expect(result.fallbackUsed).toBe(true);
      expect((toolWithBedrock as any).logger.error).toHaveBeenCalledWith(
        'Bedrock cost threshold exceeded, automatically disabling AI analysis',
        expect.objectContaining({
          monthlySpend: 1.5,
          threshold: 1.0
        })
      );
    });

    it('should warn at 80% cost threshold usage', async () => {
      // Set monthly spend to 80% of threshold
      (toolWithBedrock as any).monthlyBedrockSpend = 0.8;

      const mockAIAnalysis: AIAnalysisResult = {
        summary: 'Test analysis',
        keyInsights: ['Test insight'],
        confidenceScore: 0.8,
        analysisTimestamp: '2023-01-15T12:00:00.000Z',
        modelUsed: 'amazon.titan-text-express-v1',
        processingCost: 0.01
      };

      mockBedrockTool.analyzeSpendingPatterns.mockResolvedValue(mockAIAnalysis);
      mockBedrockTool.detectAnomalies.mockResolvedValue({ anomaliesDetected: false, anomalies: [] });
      mockBedrockTool.generateOptimizationRecommendations.mockResolvedValue([]);

      await toolWithBedrock.enhanceWithAIAnalysisAdvanced(sampleCostAnalysis);

      expect((toolWithBedrock as any).logger.warn).toHaveBeenCalledWith(
        'Bedrock cost usage at 80% threshold',
        expect.objectContaining({
          monthlySpend: 0.8,
          threshold: 1.0,
          usagePercentage: '80.0'
        })
      );
    });

    it('should provide cost estimation before execution', async () => {
      const mockAIAnalysis: AIAnalysisResult = {
        summary: 'Test analysis',
        keyInsights: ['Test insight'],
        confidenceScore: 0.8,
        analysisTimestamp: '2023-01-15T12:00:00.000Z',
        modelUsed: 'amazon.titan-text-express-v1',
        processingCost: 0.001
      };

      mockBedrockTool.analyzeSpendingPatterns.mockResolvedValue(mockAIAnalysis);
      mockBedrockTool.detectAnomalies.mockResolvedValue({ anomaliesDetected: false, anomalies: [] });
      mockBedrockTool.generateOptimizationRecommendations.mockResolvedValue([]);

      await toolWithBedrock.enhanceWithAIAnalysisAdvanced(sampleCostAnalysis);

      expect((toolWithBedrock as any).logger.info).toHaveBeenCalledWith(
        'Advanced AI-enhanced cost analysis completed',
        expect.objectContaining({
          estimatedCost: expect.any(Number),
          actualCost: expect.any(Number),
          remainingBudget: expect.any(Number)
        })
      );
    });

    it('should skip expensive requests when budget is insufficient', async () => {
      // Set monthly spend very close to threshold
      (toolWithBedrock as any).monthlyBedrockSpend = 0.999;

      const result = await toolWithBedrock.enhanceWithAIAnalysisAdvanced(sampleCostAnalysis);

      expect(result.fallbackUsed).toBe(true);
      expect((toolWithBedrock as any).logger.warn).toHaveBeenCalledWith(
        'Cannot afford AI analysis request within budget',
        expect.objectContaining({
          estimatedCost: expect.any(Number),
          remainingBudget: expect.any(Number)
        })
      );
    });

    it('should allow selective AI operations to save costs', async () => {
      const mockAIAnalysis: AIAnalysisResult = {
        summary: 'Test analysis',
        keyInsights: ['Test insight'],
        confidenceScore: 0.8,
        analysisTimestamp: '2023-01-15T12:00:00.000Z',
        modelUsed: 'amazon.titan-text-express-v1',
        processingCost: 0.001
      };

      mockBedrockTool.analyzeSpendingPatterns.mockResolvedValue(mockAIAnalysis);

      // Only request basic analysis, no anomalies or recommendations
      const result = await toolWithBedrock.enhanceWithAIAnalysisAdvanced(
        sampleCostAnalysis,
        undefined,
        { includeAnomalies: false, includeRecommendations: false }
      );

      expect(result.aiAnalysis).toEqual(mockAIAnalysis);
      expect(result.anomalies).toBeUndefined();
      expect(result.recommendations).toBeUndefined();
      expect(mockBedrockTool.analyzeSpendingPatterns).toHaveBeenCalledTimes(1);
      expect(mockBedrockTool.detectAnomalies).not.toHaveBeenCalled();
      expect(mockBedrockTool.generateOptimizationRecommendations).not.toHaveBeenCalled();
    });

    it('should force execution when requested despite cost limits', async () => {
      // Set monthly spend to exceed threshold
      (toolWithBedrock as any).monthlyBedrockSpend = 1.5;

      const mockAIAnalysis: AIAnalysisResult = {
        summary: 'Forced analysis',
        keyInsights: ['Forced insight'],
        confidenceScore: 0.8,
        analysisTimestamp: '2023-01-15T12:00:00.000Z',
        modelUsed: 'amazon.titan-text-express-v1',
        processingCost: 0.001
      };

      mockBedrockTool.analyzeSpendingPatterns.mockResolvedValue(mockAIAnalysis);
      mockBedrockTool.detectAnomalies.mockResolvedValue({ anomaliesDetected: false, anomalies: [] });
      mockBedrockTool.generateOptimizationRecommendations.mockResolvedValue([]);

      const result = await toolWithBedrock.enhanceWithAIAnalysisAdvanced(
        sampleCostAnalysis,
        undefined,
        { forceExecution: true }
      );

      expect(result.fallbackUsed).toBe(false);
      expect(result.aiAnalysis).toEqual(mockAIAnalysis);
    });

    it('should provide detailed cost control statistics', () => {
      (toolWithBedrock as any).monthlyBedrockSpend = 0.6;
      (toolWithBedrock as any).costThresholdTracker = 3;

      const stats = toolWithBedrock.getCostControlStats();

      expect(stats).toMatchObject({
        monthlySpend: 0.6,
        threshold: 1.0,
        remainingBudget: 0.4,
        usagePercentage: 60,
        requestsThisMinute: 3,
        dynamicRateLimit: 5, // Actual calculated value at 60% usage
        cacheSize: 0,
        isEnabled: true
      });
    });

    it('should reset monthly cost tracking when requested', () => {
      (toolWithBedrock as any).monthlyBedrockSpend = 0.5;
      
      toolWithBedrock.resetMonthlyCostTracking();

      const stats = toolWithBedrock.getCostControlStats();
      expect(stats.monthlySpend).toBe(0);
      expect((toolWithBedrock as any).logger.info).toHaveBeenCalledWith(
        'Monthly Bedrock cost tracking manually reset'
      );
    });

    it('should implement dynamic rate limiting based on cost usage', async () => {
      // Set usage to 85% to trigger aggressive rate limiting
      (toolWithBedrock as any).monthlyBedrockSpend = 0.85;
      
      const stats = toolWithBedrock.getCostControlStats();
      
      // At 85% usage, rate limit should be 30% of original (3 requests per minute)
      expect(stats.dynamicRateLimit).toBe(3);
      expect(stats.usagePercentage).toBe(85);
    });
  });
});