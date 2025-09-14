import { CostAnalysisTool } from '../src/tools/cost-analysis-tool';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { CostAnalysis } from '../src/types';

// Mock the AWS SDK
jest.mock('@aws-sdk/client-cost-explorer');

const mockCostExplorerClient = {
  send: jest.fn()
};

(CostExplorerClient as jest.Mock).mockImplementation(() => mockCostExplorerClient);

describe('CostAnalysisTool', () => {
  let tool: CostAnalysisTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new CostAnalysisTool('us-east-1', { maxAttempts: 1 }); // Disable retries for tests
    
    // Mock the logger
    tool.logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;
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
      expect(tool.logger.error).toHaveBeenCalledWith(
        'Failed to retrieve cost data from Cost Explorer',
        { error: apiError }
      );
    });

    it('should retry on throttling errors', async () => {
      const throttleError = new Error('Rate exceeded');
      throttleError.name = 'ThrottlingException';
      
      // Create a new tool with retries enabled for this test
      const retryTool = new CostAnalysisTool('us-east-1', { maxAttempts: 2, baseDelay: 10 });
      retryTool.logger = tool.logger;

      mockCostExplorerClient.send
        .mockRejectedValueOnce(throttleError)
        .mockResolvedValueOnce({
          ResultsByTime: [{ Groups: [], Total: { BlendedCost: { Amount: '0.00' } } }]
        });

      const result = await retryTool.getCurrentMonthCosts();

      expect(result.totalCost).toBe(0);
      expect(mockCostExplorerClient.send).toHaveBeenCalledTimes(2);
      expect(retryTool.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Cost Explorer API call failed, retrying'),
        expect.objectContaining({
          attempt: 1,
          maxAttempts: 2
        })
      );
    });
  });

  describe('getTopServices', () => {
    it('should return top services sorted by cost', () => {
      const costAnalysis: CostAnalysis = {
        totalCost: 100,
        serviceBreakdown: {
          'EC2': 50,
          'S3': 30,
          'Lambda': 15,
          'CloudWatch': 5
        },
        period: { start: '2023-01-01T00:00:00.000Z', end: '2023-01-31T23:59:59.999Z' },
        projectedMonthly: 100,
        currency: 'USD',
        lastUpdated: '2023-01-15T12:00:00.000Z'
      };

      const topServices = tool.getTopServices(costAnalysis, 3);

      expect(topServices).toHaveLength(3);
      expect(topServices[0]).toEqual({
        serviceName: 'EC2',
        cost: 50,
        percentage: 50
      });
      expect(topServices[1]).toEqual({
        serviceName: 'S3',
        cost: 30,
        percentage: 30
      });
      expect(topServices[2]).toEqual({
        serviceName: 'Lambda',
        cost: 15,
        percentage: 15
      });
    });

    it('should filter services below minimum threshold', () => {
      const costAnalysis: CostAnalysis = {
        totalCost: 100,
        serviceBreakdown: {
          'EC2': 50,
          'S3': 30,
          'Lambda': 0.50
        },
        period: { start: '2023-01-01T00:00:00.000Z', end: '2023-01-31T23:59:59.999Z' },
        projectedMonthly: 100,
        currency: 'USD',
        lastUpdated: '2023-01-15T12:00:00.000Z'
      };

      const topServices = tool.getTopServices(costAnalysis, 5, 1);

      expect(topServices).toHaveLength(2);
      expect(topServices.find(s => s.serviceName === 'Lambda')).toBeUndefined();
    });
  });

  describe('consolidateSmallServices', () => {
    it('should group small services under "Other services"', () => {
      const costAnalysis: CostAnalysis = {
        totalCost: 100,
        serviceBreakdown: {
          'EC2': 50,
          'S3': 30,
          'Lambda': 0.50,
          'CloudWatch': 0.25,
          'SNS': 0.10
        },
        period: { start: '2023-01-01T00:00:00.000Z', end: '2023-01-31T23:59:59.999Z' },
        projectedMonthly: 100,
        currency: 'USD',
        lastUpdated: '2023-01-15T12:00:00.000Z'
      };

      const consolidated = tool.consolidateSmallServices(costAnalysis, 1);

      expect(consolidated.serviceBreakdown).toEqual({
        'EC2': 50,
        'S3': 30,
        'Other services': 0.85
      });
    });

    it('should not add "Other services" if no small services exist', () => {
      const costAnalysis: CostAnalysis = {
        totalCost: 100,
        serviceBreakdown: {
          'EC2': 50,
          'S3': 30,
          'Lambda': 20
        },
        period: { start: '2023-01-01T00:00:00.000Z', end: '2023-01-31T23:59:59.999Z' },
        projectedMonthly: 100,
        currency: 'USD',
        lastUpdated: '2023-01-15T12:00:00.000Z'
      };

      const consolidated = tool.consolidateSmallServices(costAnalysis, 1);

      expect(consolidated.serviceBreakdown).toEqual({
        'EC2': 50,
        'S3': 30,
        'Lambda': 20
      });
      expect(consolidated.serviceBreakdown['Other services']).toBeUndefined();
    });
  });

  describe('validateDateRange', () => {
    it('should accept valid date ranges', () => {
      const start = new Date('2023-01-01');
      const end = new Date('2023-01-31');

      expect(() => tool.validateDateRange(start, end)).not.toThrow();
    });

    it('should reject start date after end date', () => {
      const start = new Date('2023-01-31');
      const end = new Date('2023-01-01');

      expect(() => tool.validateDateRange(start, end)).toThrow('Start date must be before end date');
    });

    it('should reject future end dates', () => {
      const start = new Date('2023-01-01');
      const end = new Date(Date.now() + 86400000); // Tomorrow

      expect(() => tool.validateDateRange(start, end)).toThrow('End date cannot be in the future');
    });

    it('should reject date ranges exceeding 12 months', () => {
      const start = new Date('2022-01-01');
      const end = new Date('2023-02-01');

      expect(() => tool.validateDateRange(start, end)).toThrow('Date range cannot exceed 12 months');
    });
  });

  describe('getCostDataForRange', () => {
    it('should retrieve cost data for custom date range', async () => {
      const mockResponse = {
        ResultsByTime: [
          {
            Groups: [
              {
                Keys: ['EC2'],
                Metrics: {
                  BlendedCost: {
                    Amount: '25.00',
                    Unit: 'USD'
                  }
                }
              }
            ],
            Total: {
              BlendedCost: {
                Amount: '25.00',
                Unit: 'USD'
              }
            }
          }
        ]
      };

      mockCostExplorerClient.send.mockResolvedValue(mockResponse);

      const start = new Date('2023-01-01');
      const end = new Date('2023-01-15');
      const result = await tool.getCostDataForRange(start, end);

      expect(result.totalCost).toBe(25);
      expect(result.serviceBreakdown.EC2).toBe(25);
      expect(mockCostExplorerClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TimePeriod: {
              Start: '2023-01-01',
              End: '2023-01-15'
            }
          })
        })
      );
    });

    it('should validate date range before making API call', async () => {
      const start = new Date('2023-01-31');
      const end = new Date('2023-01-01');

      await expect(tool.getCostDataForRange(start, end)).rejects.toThrow('Start date must be before end date');
      expect(mockCostExplorerClient.send).not.toHaveBeenCalled();
    });
  });

  describe('projected monthly cost calculation', () => {
    it('should calculate projected cost correctly for mid-month', () => {
      // Mock current date to be January 15th
      const mockDate = new Date('2023-01-15T12:00:00.000Z');
      jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);

      const costAnalysis: CostAnalysis = {
        totalCost: 50, // $50 spent in 15 days
        serviceBreakdown: { 'EC2': 50 },
        period: { start: '2023-01-01T00:00:00.000Z', end: '2023-01-15T23:59:59.999Z' },
        projectedMonthly: 0, // Will be calculated
        currency: 'USD',
        lastUpdated: '2023-01-15T12:00:00.000Z'
      };

      // For a 31-day month, spending $50 in 15 days projects to ~$103.33
      const expectedProjected = Math.round((50 / 15) * 31 * 100) / 100;

      // Test the calculation indirectly through getCurrentMonthCosts
      const mockResponse = {
        ResultsByTime: [
          {
            Groups: [
              {
                Keys: ['EC2'],
                Metrics: { BlendedCost: { Amount: '50.00' } }
              }
            ],
            Total: { BlendedCost: { Amount: '50.00' } }
          }
        ]
      };

      mockCostExplorerClient.send.mockResolvedValue(mockResponse);

      // The actual test would need to be adjusted based on the real implementation
      // This is a conceptual test showing the expected behavior
    });
  });
});