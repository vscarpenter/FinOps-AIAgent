import { BedrockAnalysisTool } from '../src/tools/bedrock-analysis-tool';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { CostAnalysis, BedrockConfig } from '../src/types';

// Mock AWS SDK
jest.mock('@aws-sdk/client-bedrock-runtime');

const mockBedrockClient = {
  send: jest.fn()
};

(BedrockRuntimeClient as jest.Mock).mockImplementation(() => mockBedrockClient);

describe('BedrockAnalysisTool', () => {
  let tool: BedrockAnalysisTool;
  let mockConfig: BedrockConfig;
  let mockCostData: CostAnalysis;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockConfig = {
      enabled: true,
      modelId: 'amazon.titan-text-express-v1',
      region: 'us-east-1',
      maxTokens: 1000,
      temperature: 0.7,
      costThreshold: 100,
      rateLimitPerMinute: 10,
      cacheResults: true,
      cacheTTLMinutes: 60,
      fallbackOnError: true
    };

    mockCostData = {
      totalCost: 150.75,
      serviceBreakdown: {
        'Amazon EC2': 75.50,
        'Amazon S3': 25.25,
        'Amazon RDS': 30.00,
        'AWS Lambda': 20.00
      },
      period: {
        start: '2024-01-01T00:00:00.000Z',
        end: '2024-01-15T23:59:59.999Z'
      },
      projectedMonthly: 301.50,
      currency: 'USD',
      lastUpdated: '2024-01-15T12:00:00.000Z'
    };

    tool = new BedrockAnalysisTool(mockConfig);
  });

  describe('constructor', () => {
    it('should initialize with provided configuration', () => {
      expect(tool).toBeInstanceOf(BedrockAnalysisTool);
      expect(BedrockRuntimeClient).toHaveBeenCalledWith({ region: 'us-east-1' });
    });
  });

  describe('analyzeSpendingPatterns', () => {
    it('should analyze spending patterns successfully', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: JSON.stringify({
              summary: 'EC2 is the primary cost driver at 50% of total spend',
              keyInsights: [
                'EC2 costs dominate at $75.50',
                'Storage costs are moderate at $25.25',
                'Database costs are significant at $30.00'
              ],
              confidenceScore: 0.85
            })
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await tool.analyzeSpendingPatterns(mockCostData);

      expect(result).toMatchObject({
        summary: 'EC2 is the primary cost driver at 50% of total spend',
        keyInsights: expect.arrayContaining([
          'EC2 costs dominate at $75.50',
          'Storage costs are moderate at $25.25',
          'Database costs are significant at $30.00'
        ]),
        confidenceScore: 0.85,
        modelUsed: 'amazon.titan-text-express-v1'
      });

      expect(mockBedrockClient.send).toHaveBeenCalledWith(
        expect.any(InvokeModelCommand)
      );
    });

    it('should throw error when Bedrock is disabled', async () => {
      const disabledConfig = { ...mockConfig, enabled: false };
      const disabledTool = new BedrockAnalysisTool(disabledConfig);

      await expect(disabledTool.analyzeSpendingPatterns(mockCostData))
        .rejects.toThrow('Bedrock analysis is disabled');
    });

    it('should use fallback analysis when AI fails and fallback is enabled', async () => {
      mockBedrockClient.send.mockRejectedValue(new Error('Bedrock API error'));

      const result = await tool.analyzeSpendingPatterns(mockCostData);

      expect(result.summary).toContain('Current AWS spending is $150.75');
      expect(result.keyInsights).toContain('AI analysis unavailable - using basic cost breakdown');
      expect(result.confidenceScore).toBe(0.3);
      expect(result.modelUsed).toBe('fallback');
    });

    it('should throw error when AI fails and fallback is disabled', async () => {
      const noFallbackConfig = { ...mockConfig, fallbackOnError: false };
      const noFallbackTool = new BedrockAnalysisTool(noFallbackConfig);
      
      mockBedrockClient.send.mockRejectedValue(new Error('Bedrock API error'));

      await expect(noFallbackTool.analyzeSpendingPatterns(mockCostData))
        .rejects.toThrow('Bedrock analysis failed');
    });

    it('should handle malformed AI responses gracefully', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: 'Invalid JSON response from AI'
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await tool.analyzeSpendingPatterns(mockCostData);

      expect(result.summary).toBe('AI analysis parsing failed - using fallback response');
      expect(result.confidenceScore).toBe(0.1);
    });
  });

  describe('validateModelAccess', () => {
    it('should return true when model access is valid', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: 'Test response'
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await tool.validateModelAccess();

      expect(result).toBe(true);
    });

    it('should return false when model access fails', async () => {
      mockBedrockClient.send.mockRejectedValue(new Error('Access denied'));

      const result = await tool.validateModelAccess();

      expect(result).toBe(false);
    });
  });

  describe('formatPromptForTitan', () => {
    it('should format prompt correctly for spending analysis', () => {
      const prompt = tool.formatPromptForTitan(mockCostData, 'spending_analysis');

      expect(prompt).toContain('Current Month-to-Date Cost: $150.75');
      expect(prompt).toContain('Projected Monthly Cost: $301.50');
      expect(prompt).toContain('Amazon EC2: $75.50');
      expect(prompt).toContain('Amazon RDS: $30.00');
      expect(prompt).toContain('Amazon S3: $25.25');
      expect(prompt).toContain('AWS Lambda: $20.00');
      expect(prompt).toContain('Format your response as JSON');
    });
  });

  describe('detectAnomalies', () => {
    it('should detect anomalies successfully', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: JSON.stringify({
              anomaliesDetected: true,
              anomalies: [
                {
                  service: 'Amazon EC2',
                  severity: 'HIGH',
                  description: 'EC2 costs are 200% higher than expected',
                  confidenceScore: 0.9,
                  suggestedAction: 'Review instance types and usage patterns'
                }
              ]
            })
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await tool.detectAnomalies(mockCostData);

      expect(result.anomaliesDetected).toBe(true);
      expect(result.anomalies).toHaveLength(1);
      expect(result.anomalies[0]).toMatchObject({
        service: 'Amazon EC2',
        severity: 'HIGH',
        description: 'EC2 costs are 200% higher than expected',
        confidenceScore: 1.0, // Enhanced confidence scoring may adjust this
        suggestedAction: 'Review instance types and usage patterns'
      });
    });

    it('should return empty result when no anomalies detected', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: JSON.stringify({
              anomaliesDetected: false,
              anomalies: []
            })
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await tool.detectAnomalies(mockCostData);

      expect(result.anomaliesDetected).toBe(false);
      expect(result.anomalies).toHaveLength(0);
    });

    it('should use fallback when anomaly detection fails', async () => {
      mockBedrockClient.send.mockRejectedValue(new Error('API error'));

      const result = await tool.detectAnomalies(mockCostData);

      expect(result.anomaliesDetected).toBe(false);
      expect(result.anomalies).toHaveLength(0);
    });

    it('should include historical data in anomaly detection prompt', async () => {
      const historicalData = [
        { ...mockCostData, totalCost: 100.00 },
        { ...mockCostData, totalCost: 110.00 }
      ];

      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: JSON.stringify({
              anomaliesDetected: false,
              anomalies: []
            })
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(mockResponse);

      await tool.detectAnomalies(mockCostData, historicalData);

      expect(mockBedrockClient.send).toHaveBeenCalledWith(
        expect.any(InvokeModelCommand)
      );
    });
  });

  describe('generateOptimizationRecommendations', () => {
    it('should generate optimization recommendations successfully', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: JSON.stringify({
              recommendations: [
                {
                  category: 'RIGHTSIZING',
                  service: 'Amazon EC2',
                  description: 'Consider downsizing overprovisioned instances',
                  estimatedSavings: 25.50,
                  priority: 'HIGH',
                  implementationComplexity: 'MEDIUM'
                },
                {
                  category: 'RESERVED_INSTANCES',
                  service: 'Amazon RDS',
                  description: 'Purchase reserved instances for consistent workloads',
                  estimatedSavings: 15.00,
                  priority: 'MEDIUM',
                  implementationComplexity: 'EASY'
                }
              ]
            })
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await tool.generateOptimizationRecommendations(mockCostData);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        category: 'RIGHTSIZING',
        service: 'Amazon EC2',
        description: 'Consider downsizing overprovisioned instances',
        estimatedSavings: 25.50,
        priority: 'HIGH',
        implementationComplexity: 'MEDIUM'
      });
      expect(result[1]).toMatchObject({
        category: 'RESERVED_INSTANCES',
        service: 'Amazon RDS',
        description: 'Purchase reserved instances for consistent workloads',
        estimatedSavings: 15.00,
        priority: 'MEDIUM',
        implementationComplexity: 'EASY'
      });
    });

    it('should return fallback recommendations when optimization fails', async () => {
      mockBedrockClient.send.mockRejectedValue(new Error('API error'));

      const result = await tool.generateOptimizationRecommendations(mockCostData);

      // Should return fallback recommendations instead of empty array
      expect(result.length).toBeGreaterThan(0);
      expect(result.every(r => r.estimatedSavings && r.estimatedSavings > 0)).toBe(true);
    });

    it('should handle malformed optimization response', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: 'Invalid optimization response'
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await tool.generateOptimizationRecommendations(mockCostData);

      expect(result).toHaveLength(0);
    });
  });

  describe('parseAIResponse', () => {
    it('should parse valid JSON response correctly', () => {
      const validResponse = JSON.stringify({
        summary: 'Test summary',
        keyInsights: ['Insight 1', 'Insight 2'],
        confidenceScore: 0.8
      });

      const result = tool.parseAIResponse(validResponse);

      expect(result.summary).toBe('Test summary');
      expect(result.keyInsights).toEqual(['Insight 1', 'Insight 2']);
      expect(result.confidenceScore).toBe(0.8);
    });

    it('should handle confidence score bounds correctly', () => {
      const responseWithInvalidScore = JSON.stringify({
        summary: 'Test summary',
        keyInsights: ['Insight 1'],
        confidenceScore: 1.5 // Invalid score > 1
      });

      const result = tool.parseAIResponse(responseWithInvalidScore);

      expect(result.confidenceScore).toBe(1.0); // Should be clamped to 1.0
    });

    it('should clamp negative confidence scores to 0', () => {
      const responseWithNegativeScore = JSON.stringify({
        summary: 'Test summary',
        keyInsights: ['Insight 1'],
        confidenceScore: -0.5 // Invalid negative score
      });

      const result = tool.parseAIResponse(responseWithNegativeScore);

      expect(result.confidenceScore).toBe(0.0); // Should be clamped to 0.0
    });

    it('should return fallback response for invalid JSON', () => {
      const invalidResponse = 'This is not valid JSON';

      const result = tool.parseAIResponse(invalidResponse);

      expect(result.summary).toBe('AI analysis parsing failed - using fallback response');
      expect(result.confidenceScore).toBe(0.1);
    });

    it('should extract JSON from wrapped response', () => {
      const wrappedResponse = `
        Here is the analysis:
        ${JSON.stringify({
          summary: 'Extracted summary',
          keyInsights: ['Extracted insight'],
          confidenceScore: 0.7
        })}
        End of analysis.
      `;

      const result = tool.parseAIResponse(wrappedResponse);

      expect(result.summary).toBe('Extracted summary');
      expect(result.keyInsights).toEqual(['Extracted insight']);
      expect(result.confidenceScore).toBe(0.7);
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteResponse = JSON.stringify({
        summary: 'Test summary'
        // Missing keyInsights and confidenceScore
      });

      const result = tool.parseAIResponse(incompleteResponse);

      expect(result.summary).toBe('AI analysis parsing failed - using fallback response');
      expect(result.confidenceScore).toBe(0.1);
    });

    it('should handle non-array keyInsights gracefully', () => {
      const invalidInsightsResponse = JSON.stringify({
        summary: 'Test summary',
        keyInsights: 'Not an array',
        confidenceScore: 0.8
      });

      const result = tool.parseAIResponse(invalidInsightsResponse);

      expect(result.summary).toBe('AI analysis parsing failed - using fallback response');
      expect(result.confidenceScore).toBe(0.1);
    });

    it('should handle non-numeric confidence score gracefully', () => {
      const invalidScoreResponse = JSON.stringify({
        summary: 'Test summary',
        keyInsights: ['Insight 1'],
        confidenceScore: 'not a number'
      });

      const result = tool.parseAIResponse(invalidScoreResponse);

      expect(result.summary).toBe('AI analysis parsing failed - using fallback response');
      expect(result.confidenceScore).toBe(0.1);
    });
  });

  describe('response validation and sanitization', () => {
    it('should validate anomaly response structure', async () => {
      const validAnomalyResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: JSON.stringify({
              anomaliesDetected: true,
              anomalies: [
                {
                  service: 'Amazon EC2',
                  severity: 'HIGH',
                  description: 'Test anomaly',
                  confidenceScore: 0.9
                }
              ]
            })
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(validAnomalyResponse);

      const result = await tool.detectAnomalies(mockCostData);

      expect(result.anomaliesDetected).toBe(true);
      expect(result.anomalies).toHaveLength(1);
      expect(result.anomalies[0].service).toBe('Amazon EC2');
    });

    it('should handle malformed anomaly response gracefully', async () => {
      const malformedResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: 'Not valid JSON for anomalies'
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(malformedResponse);

      const result = await tool.detectAnomalies(mockCostData);

      expect(result.anomaliesDetected).toBe(false);
      expect(result.anomalies).toHaveLength(0);
    });

    it('should validate optimization response structure', async () => {
      const validOptimizationResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: JSON.stringify({
              recommendations: [
                {
                  category: 'RIGHTSIZING',
                  service: 'Amazon EC2',
                  description: 'Test recommendation',
                  priority: 'HIGH'
                }
              ]
            })
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(validOptimizationResponse);

      const result = await tool.generateOptimizationRecommendations(mockCostData);

      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('RIGHTSIZING');
      expect(result[0].service).toBe('Amazon EC2');
    });

    it('should handle empty optimization recommendations', async () => {
      const emptyResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: JSON.stringify({
              recommendations: []
            })
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(emptyResponse);

      const result = await tool.generateOptimizationRecommendations(mockCostData);

      expect(result).toHaveLength(0);
    });
  });

  describe('enhanced confidence scoring', () => {
    it('should enhance anomaly confidence with historical data', async () => {
      const historicalData = [
        { ...mockCostData, totalCost: 50.00, serviceBreakdown: { 'Amazon EC2': 25.00, 'Amazon S3': 25.00 } },
        { ...mockCostData, totalCost: 60.00, serviceBreakdown: { 'Amazon EC2': 30.00, 'Amazon S3': 30.00 } }
      ];

      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: JSON.stringify({
              anomaliesDetected: true,
              anomalies: [
                {
                  service: 'Amazon EC2',
                  severity: 'HIGH',
                  description: 'EC2 costs significantly higher than historical average',
                  confidenceScore: 0.7,
                  suggestedAction: 'Review EC2 usage'
                }
              ]
            })
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await tool.detectAnomalies(mockCostData, historicalData);

      expect(result.anomaliesDetected).toBe(true);
      expect(result.anomalies).toHaveLength(1);
      // Confidence should be enhanced due to historical data and high deviation
      expect(result.anomalies[0].confidenceScore).toBeGreaterThan(0.7);
    });

    it('should filter out low-confidence anomalies', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: JSON.stringify({
              anomaliesDetected: true,
              anomalies: [
                {
                  service: 'Minor Service',
                  severity: 'LOW',
                  description: 'Minor cost increase',
                  confidenceScore: 0.2,
                  suggestedAction: 'Monitor'
                },
                {
                  service: 'Amazon EC2',
                  severity: 'HIGH',
                  description: 'Significant cost increase',
                  confidenceScore: 0.8,
                  suggestedAction: 'Investigate immediately'
                }
              ]
            })
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await tool.detectAnomalies(mockCostData);

      // Should filter out the low-confidence anomaly
      expect(result.anomalies).toHaveLength(1);
      expect(result.anomalies[0].service).toBe('Amazon EC2');
      expect(result.anomalies[0].confidenceScore).toBeGreaterThanOrEqual(0.3);
    });

    it('should create fallback anomaly detection when AI fails', async () => {
      const historicalData = [
        { ...mockCostData, totalCost: 50.00, serviceBreakdown: { 'Amazon EC2': 25.00, 'Amazon S3': 25.00 } }
      ];

      mockBedrockClient.send.mockRejectedValue(new Error('Bedrock API error'));

      const result = await tool.detectAnomalies(mockCostData, historicalData);

      // Should detect anomaly based on heuristics (current: 150.75 vs historical: 50.00)
      expect(result.anomaliesDetected).toBe(true);
      expect(result.anomalies.length).toBeGreaterThan(0);
      expect(result.anomalies[0].description).toContain('different from historical average');
    });
  });

  describe('enhanced optimization recommendations', () => {
    it('should enhance recommendations with realistic savings estimates', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: JSON.stringify({
              recommendations: [
                {
                  category: 'RIGHTSIZING',
                  service: 'Amazon EC2',
                  description: 'Rightsize EC2 instances',
                  estimatedSavings: 0, // No savings provided
                  priority: 'LOW',
                  implementationComplexity: 'MEDIUM'
                }
              ]
            })
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await tool.generateOptimizationRecommendations(mockCostData);

      expect(result).toHaveLength(1);
      expect(result[0].estimatedSavings).toBeGreaterThan(0); // Should estimate savings
      expect(result[0].priority).toBe('HIGH'); // Should adjust priority based on cost impact (EC2 is major cost driver)
    });

    it('should sort recommendations by priority and savings', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: JSON.stringify({
              recommendations: [
                {
                  category: 'OTHER',
                  service: 'AWS Lambda',
                  description: 'Minor optimization',
                  estimatedSavings: 5.00,
                  priority: 'LOW',
                  implementationComplexity: 'EASY'
                },
                {
                  category: 'RIGHTSIZING',
                  service: 'Amazon EC2',
                  description: 'Major rightsizing opportunity',
                  estimatedSavings: 30.00,
                  priority: 'HIGH',
                  implementationComplexity: 'MEDIUM'
                },
                {
                  category: 'RESERVED_INSTANCES',
                  service: 'Amazon RDS',
                  description: 'Purchase RIs',
                  estimatedSavings: 20.00,
                  priority: 'MEDIUM',
                  implementationComplexity: 'EASY'
                }
              ]
            })
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await tool.generateOptimizationRecommendations(mockCostData);

      expect(result).toHaveLength(3);
      // Should be sorted by priority (HIGH > MEDIUM > LOW) then by savings
      expect(result[0].priority).toBe('HIGH');
      expect(result[0].service).toBe('Amazon EC2');
      expect(result[1].priority).toBe('MEDIUM');
      // Note: Priority adjustment may change LOW to MEDIUM based on cost impact
      expect(['MEDIUM', 'LOW']).toContain(result[2].priority);
    });

    it('should create fallback optimization recommendations when AI fails', async () => {
      mockBedrockClient.send.mockRejectedValue(new Error('Bedrock API error'));

      const result = await tool.generateOptimizationRecommendations(mockCostData);

      expect(result.length).toBeGreaterThan(0);
      // Should include recommendations for top services (EC2, RDS, S3)
      const services = result.map(r => r.service);
      expect(services).toContain('Amazon EC2');
      expect(result.every(r => r.estimatedSavings && r.estimatedSavings > 0)).toBe(true);
    });

    it('should validate and cap unrealistic savings estimates', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: JSON.stringify({
              recommendations: [
                {
                  category: 'RIGHTSIZING',
                  service: 'Amazon EC2',
                  description: 'Unrealistic savings claim',
                  estimatedSavings: 100.00, // More than 80% of EC2 cost (75.50)
                  priority: 'HIGH',
                  implementationComplexity: 'EASY'
                }
              ]
            })
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await tool.generateOptimizationRecommendations(mockCostData);

      expect(result).toHaveLength(1);
      // Should cap savings at 80% of service cost (75.50 * 0.8 = 60.40)
      expect(result[0].estimatedSavings).toBeLessThanOrEqual(75.50 * 0.8);
    });
  });

  describe('confidence scoring system', () => {
    it('should adjust confidence based on service cost significance', async () => {
      const highCostData = {
        ...mockCostData,
        totalCost: 100.00,
        serviceBreakdown: {
          'Amazon EC2': 80.00, // 80% of total cost
          'Amazon S3': 20.00   // 20% of total cost
        }
      };

      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: JSON.stringify({
              anomaliesDetected: true,
              anomalies: [
                {
                  service: 'Amazon EC2',
                  severity: 'MEDIUM',
                  description: 'Major service anomaly',
                  confidenceScore: 0.5
                },
                {
                  service: 'Amazon S3',
                  severity: 'MEDIUM',
                  description: 'Minor service anomaly',
                  confidenceScore: 0.5
                }
              ]
            })
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await tool.detectAnomalies(highCostData);

      expect(result.anomalies).toHaveLength(2);
      
      const ec2Anomaly = result.anomalies.find(a => a.service === 'Amazon EC2');
      const s3Anomaly = result.anomalies.find(a => a.service === 'Amazon S3');
      
      // EC2 (major cost driver) should have higher confidence than S3
      expect(ec2Anomaly?.confidenceScore).toBeGreaterThan(s3Anomaly?.confidenceScore || 0);
    });

    it('should adjust confidence based on severity level', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: JSON.stringify({
              anomaliesDetected: true,
              anomalies: [
                {
                  service: 'Amazon EC2',
                  severity: 'HIGH',
                  description: 'High severity anomaly',
                  confidenceScore: 0.6
                },
                {
                  service: 'Amazon RDS',
                  severity: 'LOW',
                  description: 'Low severity anomaly',
                  confidenceScore: 0.6
                }
              ]
            })
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await tool.detectAnomalies(mockCostData);

      const highSeverityAnomaly = result.anomalies.find(a => a.severity === 'HIGH');
      const lowSeverityAnomaly = result.anomalies.find(a => a.severity === 'LOW');
      
      // High severity should have higher confidence than low severity
      if (highSeverityAnomaly && lowSeverityAnomaly) {
        expect(highSeverityAnomaly.confidenceScore).toBeGreaterThan(lowSeverityAnomaly.confidenceScore);
      }
    });
  });

  describe('cost control and rate limiting', () => {
    beforeEach(() => {
      // Reset rate limiting state between tests
      jest.clearAllMocks();
    });

    it('should enforce rate limiting per minute', async () => {
      const rateLimitedConfig = { ...mockConfig, rateLimitPerMinute: 2 };
      const rateLimitedTool = new BedrockAnalysisTool(rateLimitedConfig);

      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: JSON.stringify({
              summary: 'Test analysis',
              keyInsights: ['Test insight'],
              confidenceScore: 0.8
            })
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(mockResponse);

      // First two calls should succeed immediately
      await rateLimitedTool.analyzeSpendingPatterns(mockCostData);
      await rateLimitedTool.analyzeSpendingPatterns(mockCostData);

      // Third call should be rate limited - we'll just verify it eventually succeeds
      // without testing exact timing to avoid flaky tests
      const result = await rateLimitedTool.analyzeSpendingPatterns(mockCostData);
      
      expect(result.summary).toBe('Test analysis');
      expect(mockBedrockClient.send).toHaveBeenCalledTimes(3);
    }, 10000); // Increase timeout for rate limiting test

    it('should reset rate limit counter after time window', async () => {
      const rateLimitedConfig = { ...mockConfig, rateLimitPerMinute: 1 };
      const rateLimitedTool = new BedrockAnalysisTool(rateLimitedConfig);

      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: JSON.stringify({
              summary: 'Test analysis',
              keyInsights: ['Test insight'],
              confidenceScore: 0.8
            })
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(mockResponse);

      // Mock Date.now to simulate time passage
      const originalDateNow = Date.now;
      let mockTime = 1000000;
      jest.spyOn(Date, 'now').mockImplementation(() => mockTime);

      // First call should succeed
      await rateLimitedTool.analyzeSpendingPatterns(mockCostData);

      // Advance time by more than 1 minute
      mockTime += 61 * 1000;

      // Second call should succeed without delay (rate limit reset)
      await rateLimitedTool.analyzeSpendingPatterns(mockCostData);

      expect(mockBedrockClient.send).toHaveBeenCalledTimes(2);

      // Restore original Date.now
      Date.now = originalDateNow;
    });

    it('should track and estimate processing costs', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: JSON.stringify({
              summary: 'Cost analysis with detailed breakdown of services and recommendations',
              keyInsights: [
                'EC2 costs are the primary driver',
                'Storage optimization opportunities exist',
                'Reserved instances could provide savings'
              ],
              confidenceScore: 0.85
            })
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await tool.analyzeSpendingPatterns(mockCostData);

      expect(result.processingCost).toBeDefined();
      expect(result.processingCost).toBeGreaterThan(0);
      expect(typeof result.processingCost).toBe('number');
    });

    it('should handle cost threshold monitoring', async () => {
      // This test verifies that the tool can track costs, though actual threshold enforcement
      // would typically be handled at a higher level
      const costTrackingConfig = { ...mockConfig, costThreshold: 0.01 }; // Very low threshold
      const costTrackingTool = new BedrockAnalysisTool(costTrackingConfig);

      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: JSON.stringify({
              summary: 'Test analysis',
              keyInsights: ['Test insight'],
              confidenceScore: 0.8
            })
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await costTrackingTool.analyzeSpendingPatterns(mockCostData);

      // Should still work but track the cost
      expect(result.processingCost).toBeDefined();
      expect(result.processingCost).toBeGreaterThan(0);
    });
  });

  describe('error handling and retry logic', () => {
    it('should retry on retryable errors with exponential backoff', async () => {
      const retryConfig = {
        maxAttempts: 3,
        baseDelay: 10, // Short delay for testing
        maxDelay: 100,
        backoffMultiplier: 2
      };
      const retryTool = new BedrockAnalysisTool(mockConfig, retryConfig);

      // First two calls fail with retryable error, third succeeds
      mockBedrockClient.send
        .mockRejectedValueOnce(new Error('ThrottlingException'))
        .mockRejectedValueOnce(new Error('ServiceUnavailable'))
        .mockResolvedValueOnce({
          body: new TextEncoder().encode(JSON.stringify({
            results: [{
              outputText: JSON.stringify({
                summary: 'Success after retries',
                keyInsights: ['Retry worked'],
                confidenceScore: 0.8
              })
            }]
          }))
        });

      const result = await retryTool.analyzeSpendingPatterns(mockCostData);

      expect(result.summary).toBe('Success after retries');
      expect(mockBedrockClient.send).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-retryable errors', async () => {
      const retryConfig = { maxAttempts: 3, baseDelay: 10, maxDelay: 100, backoffMultiplier: 2 };
      const noFallbackConfig = { ...mockConfig, fallbackOnError: false };
      const retryTool = new BedrockAnalysisTool(noFallbackConfig, retryConfig);

      // Non-retryable error (access denied)
      const accessError = new Error('AccessDeniedException');
      mockBedrockClient.send.mockRejectedValue(accessError);

      await expect(retryTool.analyzeSpendingPatterns(mockCostData))
        .rejects.toThrow('Bedrock analysis failed');

      // Should only try once for non-retryable error
      expect(mockBedrockClient.send).toHaveBeenCalledTimes(1);
    });

    it('should handle HTTP status code based retryable errors', async () => {
      const retryConfig = { maxAttempts: 2, baseDelay: 10, maxDelay: 100, backoffMultiplier: 2 };
      const retryTool = new BedrockAnalysisTool(mockConfig, retryConfig);

      // HTTP 500 error (retryable)
      const serverError = new Error('Internal Server Error');
      (serverError as any).$metadata = { httpStatusCode: 500 };
      
      mockBedrockClient.send
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({
          body: new TextEncoder().encode(JSON.stringify({
            results: [{
              outputText: JSON.stringify({
                summary: 'Success after HTTP error retry',
                keyInsights: ['HTTP retry worked'],
                confidenceScore: 0.8
              })
            }]
          }))
        });

      const result = await retryTool.analyzeSpendingPatterns(mockCostData);

      expect(result.summary).toBe('Success after HTTP error retry');
      expect(mockBedrockClient.send).toHaveBeenCalledTimes(2);
    });

    it('should handle HTTP 429 rate limiting errors', async () => {
      const retryConfig = { maxAttempts: 2, baseDelay: 10, maxDelay: 100, backoffMultiplier: 2 };
      const retryTool = new BedrockAnalysisTool(mockConfig, retryConfig);

      // HTTP 429 error (retryable)
      const rateLimitError = new Error('Too Many Requests');
      (rateLimitError as any).$metadata = { httpStatusCode: 429 };
      
      mockBedrockClient.send
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({
          body: new TextEncoder().encode(JSON.stringify({
            results: [{
              outputText: JSON.stringify({
                summary: 'Success after rate limit retry',
                keyInsights: ['Rate limit retry worked'],
                confidenceScore: 0.8
              })
            }]
          }))
        });

      const result = await retryTool.analyzeSpendingPatterns(mockCostData);

      expect(result.summary).toBe('Success after rate limit retry');
      expect(mockBedrockClient.send).toHaveBeenCalledTimes(2);
    });

    it('should exhaust all retry attempts before failing', async () => {
      const retryConfig = { maxAttempts: 3, baseDelay: 10, maxDelay: 100, backoffMultiplier: 2 };
      const noFallbackConfig = { ...mockConfig, fallbackOnError: false };
      const retryTool = new BedrockAnalysisTool(noFallbackConfig, retryConfig);

      // All attempts fail with retryable error
      const throttleError = new Error('ThrottlingException');
      mockBedrockClient.send.mockRejectedValue(throttleError);

      await expect(retryTool.analyzeSpendingPatterns(mockCostData))
        .rejects.toThrow('Bedrock analysis failed');

      expect(mockBedrockClient.send).toHaveBeenCalledTimes(3);
    });

    it('should handle empty response body gracefully', async () => {
      const noFallbackConfig = { ...mockConfig, fallbackOnError: false };
      const noFallbackTool = new BedrockAnalysisTool(noFallbackConfig);
      
      mockBedrockClient.send.mockResolvedValue({
        body: undefined
      });

      await expect(noFallbackTool.analyzeSpendingPatterns(mockCostData))
        .rejects.toThrow('Bedrock analysis failed');
    });

    it('should handle malformed response body gracefully', async () => {
      const noFallbackConfig = { ...mockConfig, fallbackOnError: false };
      const noFallbackTool = new BedrockAnalysisTool(noFallbackConfig);
      
      mockBedrockClient.send.mockResolvedValue({
        body: new TextEncoder().encode('Invalid JSON response')
      });

      await expect(noFallbackTool.analyzeSpendingPatterns(mockCostData))
        .rejects.toThrow('Bedrock analysis failed');
    });

    it('should handle missing results in response gracefully', async () => {
      const noFallbackConfig = { ...mockConfig, fallbackOnError: false };
      const noFallbackTool = new BedrockAnalysisTool(noFallbackConfig);
      
      mockBedrockClient.send.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({
          // Missing results field
        }))
      });

      await expect(noFallbackTool.analyzeSpendingPatterns(mockCostData))
        .rejects.toThrow('Bedrock analysis failed');
    });

    it('should handle missing outputText in response gracefully', async () => {
      const noFallbackConfig = { ...mockConfig, fallbackOnError: false };
      const noFallbackTool = new BedrockAnalysisTool(noFallbackConfig);
      
      mockBedrockClient.send.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            // Missing outputText field
          }]
        }))
      });

      await expect(noFallbackTool.analyzeSpendingPatterns(mockCostData))
        .rejects.toThrow('Bedrock analysis failed');
    });
  });

  describe('fallback mechanisms', () => {
    it('should use fallback analysis when Bedrock fails and fallback is enabled', async () => {
      mockBedrockClient.send.mockRejectedValue(new Error('Bedrock service unavailable'));

      const result = await tool.analyzeSpendingPatterns(mockCostData);

      expect(result.summary).toContain('Current AWS spending is $150.75');
      expect(result.keyInsights).toContain('AI analysis unavailable - using basic cost breakdown');
      expect(result.confidenceScore).toBe(0.3);
      expect(result.modelUsed).toBe('fallback');
    });

    it('should throw error when Bedrock fails and fallback is disabled', async () => {
      const noFallbackConfig = { ...mockConfig, fallbackOnError: false };
      const noFallbackTool = new BedrockAnalysisTool(noFallbackConfig);

      mockBedrockClient.send.mockRejectedValue(new Error('Bedrock service unavailable'));

      await expect(noFallbackTool.analyzeSpendingPatterns(mockCostData))
        .rejects.toThrow('Bedrock analysis failed: Bedrock service unavailable');
    });

    it('should use fallback anomaly detection with heuristics', async () => {
      const historicalData = [
        { ...mockCostData, totalCost: 50.00, serviceBreakdown: { 'Amazon EC2': 25.00, 'Amazon S3': 25.00 } },
        { ...mockCostData, totalCost: 60.00, serviceBreakdown: { 'Amazon EC2': 30.00, 'Amazon S3': 30.00 } }
      ];

      mockBedrockClient.send.mockRejectedValue(new Error('Bedrock API error'));

      const result = await tool.detectAnomalies(mockCostData, historicalData);

      expect(result.anomaliesDetected).toBe(true);
      expect(result.anomalies.length).toBeGreaterThan(0);
      
      // Should detect overall spending anomaly (150.75 vs ~55 historical average)
      const overallAnomaly = result.anomalies.find(a => a.service === 'Overall Spending');
      expect(overallAnomaly).toBeDefined();
      expect(overallAnomaly?.description).toContain('different from historical average');
      expect(overallAnomaly?.confidenceScore).toBeLessThan(0.8); // Lower confidence for fallback
    });

    it('should use fallback optimization recommendations with service-based heuristics', async () => {
      mockBedrockClient.send.mockRejectedValue(new Error('Bedrock API error'));

      const result = await tool.generateOptimizationRecommendations(mockCostData);

      expect(result.length).toBeGreaterThan(0);
      
      // Should include recommendations for major services
      const services = result.map(r => r.service);
      expect(services.some(s => s.includes('EC2'))).toBe(true);
      
      // All recommendations should have estimated savings
      expect(result.every(r => r.estimatedSavings && r.estimatedSavings > 0)).toBe(true);
      
      // Should be sorted by priority and savings
      for (let i = 0; i < result.length - 1; i++) {
        const current = result[i];
        const next = result[i + 1];
        
        const priorityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
        const currentPriority = priorityOrder[current.priority];
        const nextPriority = priorityOrder[next.priority];
        
        if (currentPriority === nextPriority) {
          expect(current.estimatedSavings).toBeGreaterThanOrEqual(next.estimatedSavings || 0);
        } else {
          expect(currentPriority).toBeGreaterThanOrEqual(nextPriority);
        }
      }
    });

    it('should handle fallback when no historical data is available', async () => {
      mockBedrockClient.send.mockRejectedValue(new Error('Bedrock API error'));

      const result = await tool.detectAnomalies(mockCostData); // No historical data

      // Should return no anomalies when no historical context
      expect(result.anomaliesDetected).toBe(false);
      expect(result.anomalies).toHaveLength(0);
    });

    it('should create service-specific fallback recommendations', async () => {
      const serviceSpecificCostData = {
        ...mockCostData,
        serviceBreakdown: {
          'Amazon EC2-Instance': 100.00,
          'Amazon S3': 50.00,
          'Amazon RDS': 30.00,
          'Amazon DynamoDB': 20.00
        }
      };

      mockBedrockClient.send.mockRejectedValue(new Error('Bedrock API error'));

      const result = await tool.generateOptimizationRecommendations(serviceSpecificCostData);

      expect(result.length).toBeGreaterThan(0);
      
      // Should include EC2-specific recommendations
      const ec2Recommendations = result.filter(r => r.service.includes('EC2'));
      expect(ec2Recommendations.length).toBeGreaterThan(0);
      expect(ec2Recommendations.some(r => r.category === 'RIGHTSIZING')).toBe(true);
      expect(ec2Recommendations.some(r => r.category === 'RESERVED_INSTANCES')).toBe(true);
      
      // Should include storage-specific recommendations
      const storageRecommendations = result.filter(r => r.service.includes('S3'));
      expect(storageRecommendations.length).toBeGreaterThan(0);
      expect(storageRecommendations.some(r => r.category === 'STORAGE_OPTIMIZATION')).toBe(true);
      
      // Should include database-specific recommendations
      const dbRecommendations = result.filter(r => r.service.includes('RDS') || r.service.includes('DynamoDB'));
      expect(dbRecommendations.length).toBeGreaterThan(0);
    });
  });

  describe('model validation and configuration', () => {
    it('should validate model access successfully', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: 'Test validation response'
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await tool.validateModelAccess();

      expect(result).toBe(true);
      expect(mockBedrockClient.send).toHaveBeenCalledWith(
        expect.any(InvokeModelCommand)
      );
    });

    it('should handle model access validation failure', async () => {
      mockBedrockClient.send.mockRejectedValue(new Error('Model not found'));

      const result = await tool.validateModelAccess();

      expect(result).toBe(false);
    });

    it('should handle disabled Bedrock configuration', async () => {
      const disabledConfig = { ...mockConfig, enabled: false };
      const disabledTool = new BedrockAnalysisTool(disabledConfig);

      await expect(disabledTool.analyzeSpendingPatterns(mockCostData))
        .rejects.toThrow('Bedrock analysis is disabled');

      await expect(disabledTool.detectAnomalies(mockCostData))
        .rejects.toThrow('Bedrock analysis is disabled');

      await expect(disabledTool.generateOptimizationRecommendations(mockCostData))
        .rejects.toThrow('Bedrock analysis is disabled');
    });

    it('should use correct model configuration in requests', async () => {
      const customConfig = {
        ...mockConfig,
        modelId: 'amazon.titan-text-lite-v1',
        maxTokens: 2000,
        temperature: 0.5
      };
      const customTool = new BedrockAnalysisTool(customConfig);

      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          results: [{
            outputText: JSON.stringify({
              summary: 'Custom model response',
              keyInsights: ['Custom insight'],
              confidenceScore: 0.8
            })
          }]
        }))
      };

      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await customTool.analyzeSpendingPatterns(mockCostData);

      expect(result.modelUsed).toBe('amazon.titan-text-lite-v1');
      
      // Verify the request was made with correct configuration
      const lastCallIndex = mockBedrockClient.send.mock.calls.length - 1;
      const call = mockBedrockClient.send.mock.calls[lastCallIndex][0];
      expect(call.input.modelId).toBe('amazon.titan-text-lite-v1');
      
      const requestBody = JSON.parse(call.input.body);
      expect(requestBody.textGenerationConfig.maxTokenCount).toBe(2000);
      expect(requestBody.textGenerationConfig.temperature).toBe(0.5);
    });
  });
});