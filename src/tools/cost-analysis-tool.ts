import { Tool } from '../mock-strands-agent';
import { CostExplorerClient, GetCostAndUsageCommand, GetCostAndUsageCommandInput } from '@aws-sdk/client-cost-explorer';
import { CostAnalysis, ServiceCost, RetryConfig } from '../types';

/**
 * Tool for analyzing AWS costs using the Cost Explorer API
 */
export class CostAnalysisTool extends Tool {
  private costExplorerClient: CostExplorerClient;
  private retryConfig: RetryConfig;

  constructor(region: string = 'us-east-1', retryConfig?: Partial<RetryConfig>) {
    super();
    this.costExplorerClient = new CostExplorerClient({ region });
    this.retryConfig = {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
      ...retryConfig
    };
  }

  /**
   * Retrieves current month-to-date AWS costs
   */
  async getCurrentMonthCosts(): Promise<CostAnalysis> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    // Format dates for Cost Explorer API (YYYY-MM-DD)
    const start = startOfMonth.toISOString().split('T')[0];
    const end = now.toISOString().split('T')[0];

    const input: GetCostAndUsageCommandInput = {
      TimePeriod: {
        Start: start,
        End: end
      },
      Granularity: 'MONTHLY',
      Metrics: ['BlendedCost'],
      GroupBy: [
        {
          Type: 'DIMENSION',
          Key: 'SERVICE'
        }
      ]
    };

    try {
      const response = await this.executeWithRetry(() => 
        this.costExplorerClient.send(new GetCostAndUsageCommand(input))
      );

      return this.formatCostData(response, start, end, now, endOfMonth);
    } catch (error) {
      this.logger.error('Failed to retrieve cost data from Cost Explorer', { error });
      throw new Error(`Cost Explorer API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Formats raw Cost Explorer API response into CostAnalysis object
   */
  private formatCostData(response: any, start: string, end: string, now: Date, endOfMonth: Date): CostAnalysis {
    const serviceBreakdown: { [service: string]: number } = {};
    let totalCost = 0;

    if (response.ResultsByTime && response.ResultsByTime.length > 0) {
      const result = response.ResultsByTime[0];
      
      if (result.Groups) {
        for (const group of result.Groups) {
          const serviceName = group.Keys?.[0] || 'Unknown Service';
          const cost = parseFloat(group.Metrics?.BlendedCost?.Amount || '0');
          
          if (cost > 0) {
            serviceBreakdown[serviceName] = cost;
            totalCost += cost;
          }
        }
      }

      // Also include total from the result if available
      if (result.Total?.BlendedCost?.Amount) {
        const apiTotal = parseFloat(result.Total.BlendedCost.Amount);
        if (apiTotal > totalCost) {
          totalCost = apiTotal;
        }
      }
    }

    // Calculate projected monthly cost
    const projectedMonthly = this.calculateProjectedMonthlyCost(totalCost, now, endOfMonth);

    return {
      totalCost,
      serviceBreakdown,
      period: {
        start: `${start}T00:00:00.000Z`,
        end: `${end}T23:59:59.999Z`
      },
      projectedMonthly,
      currency: 'USD',
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Calculates projected monthly cost based on current usage
   */
  private calculateProjectedMonthlyCost(currentCost: number, now: Date, endOfMonth: Date): number {
    const dayOfMonth = now.getDate();
    const daysInMonth = endOfMonth.getDate();
    
    if (dayOfMonth === 0) {
      return currentCost;
    }

    // Simple linear projection based on elapsed days
    const projectedCost = (currentCost / dayOfMonth) * daysInMonth;
    
    // Round to 2 decimal places
    return Math.round(projectedCost * 100) / 100;
  }

  /**
   * Gets top cost-driving services sorted by cost
   */
  getTopServices(costAnalysis: CostAnalysis, limit: number = 5, minThreshold: number = 1): ServiceCost[] {
    const services = Object.entries(costAnalysis.serviceBreakdown)
      .filter(([_, cost]) => cost >= minThreshold)
      .map(([serviceName, cost]) => ({
        serviceName,
        cost,
        percentage: Math.round((cost / costAnalysis.totalCost) * 100 * 100) / 100 // Round to 2 decimal places
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, limit);

    return services;
  }

  /**
   * Groups small services under "Other services" category
   */
  consolidateSmallServices(costAnalysis: CostAnalysis, minThreshold: number = 1): CostAnalysis {
    const consolidatedBreakdown: { [service: string]: number } = {};
    let otherServicesCost = 0;

    for (const [serviceName, cost] of Object.entries(costAnalysis.serviceBreakdown)) {
      if (cost >= minThreshold) {
        consolidatedBreakdown[serviceName] = cost;
      } else {
        otherServicesCost += cost;
      }
    }

    if (otherServicesCost > 0) {
      consolidatedBreakdown['Other services'] = otherServicesCost;
    }

    return {
      ...costAnalysis,
      serviceBreakdown: consolidatedBreakdown
    };
  }

  /**
   * Executes a function with exponential backoff retry logic
   */
  private async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        if (attempt === this.retryConfig.maxAttempts) {
          break;
        }

        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          throw lastError;
        }

        const delay = Math.min(
          this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt - 1),
          this.retryConfig.maxDelay
        );

        this.logger.warn(`Cost Explorer API call failed, retrying in ${delay}ms`, {
          attempt,
          maxAttempts: this.retryConfig.maxAttempts,
          error: lastError.message
        });

        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  /**
   * Determines if an error is retryable
   */
  private isRetryableError(error: any): boolean {
    if (!error) return false;

    // AWS SDK error codes that are retryable
    const retryableErrorCodes = [
      'ThrottlingException',
      'Throttling',
      'TooManyRequestsException',
      'ServiceUnavailable',
      'InternalServerError',
      'RequestTimeout'
    ];

    // Check error code
    if (error.name && retryableErrorCodes.includes(error.name)) {
      return true;
    }

    // Check HTTP status codes
    if (error.$metadata?.httpStatusCode) {
      const statusCode = error.$metadata.httpStatusCode;
      return statusCode >= 500 || statusCode === 429;
    }

    // Check for network errors
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      return true;
    }

    return false;
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validates date range for cost analysis
   */
  validateDateRange(start: Date, end: Date): void {
    if (start >= end) {
      throw new Error('Start date must be before end date');
    }

    const now = new Date();
    if (end > now) {
      throw new Error('End date cannot be in the future');
    }

    const maxRangeMonths = 12;
    const maxEndDate = new Date(start);
    maxEndDate.setMonth(maxEndDate.getMonth() + maxRangeMonths);
    
    if (end > maxEndDate) {
      throw new Error(`Date range cannot exceed ${maxRangeMonths} months`);
    }
  }

  /**
   * Gets cost data for a custom date range
   */
  async getCostDataForRange(startDate: Date, endDate: Date): Promise<CostAnalysis> {
    this.validateDateRange(startDate, endDate);

    const start = startDate.toISOString().split('T')[0];
    const end = endDate.toISOString().split('T')[0];

    const input: GetCostAndUsageCommandInput = {
      TimePeriod: {
        Start: start,
        End: end
      },
      Granularity: 'MONTHLY',
      Metrics: ['BlendedCost'],
      GroupBy: [
        {
          Type: 'DIMENSION',
          Key: 'SERVICE'
        }
      ]
    };

    try {
      const response = await this.executeWithRetry(() => 
        this.costExplorerClient.send(new GetCostAndUsageCommand(input))
      );

      return this.formatCostData(response, start, end, endDate, endDate);
    } catch (error) {
      this.logger.error('Failed to retrieve cost data for custom range', { 
        error, 
        startDate: start, 
        endDate: end 
      });
      throw new Error(`Cost Explorer API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}