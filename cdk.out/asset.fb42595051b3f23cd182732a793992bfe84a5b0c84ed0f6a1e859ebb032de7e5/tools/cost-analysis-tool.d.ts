import { Tool } from 'strands-agents';
import { CostAnalysis, ServiceCost, RetryConfig } from '../types';
/**
 * Tool for analyzing AWS costs using the Cost Explorer API
 */
export declare class CostAnalysisTool extends Tool {
    private costExplorerClient;
    private retryConfig;
    constructor(region?: string, retryConfig?: Partial<RetryConfig>);
    /**
     * Retrieves current month-to-date AWS costs
     */
    getCurrentMonthCosts(): Promise<CostAnalysis>;
    /**
     * Formats raw Cost Explorer API response into CostAnalysis object
     */
    private formatCostData;
    /**
     * Calculates projected monthly cost based on current usage
     */
    private calculateProjectedMonthlyCost;
    /**
     * Gets top cost-driving services sorted by cost
     */
    getTopServices(costAnalysis: CostAnalysis, limit?: number, minThreshold?: number): ServiceCost[];
    /**
     * Groups small services under "Other services" category
     */
    consolidateSmallServices(costAnalysis: CostAnalysis, minThreshold?: number): CostAnalysis;
    /**
     * Executes a function with exponential backoff retry logic
     */
    private executeWithRetry;
    /**
     * Determines if an error is retryable
     */
    private isRetryableError;
    /**
     * Sleep utility for retry delays
     */
    private sleep;
    /**
     * Validates date range for cost analysis
     */
    validateDateRange(start: Date, end: Date): void;
    /**
     * Gets cost data for a custom date range
     */
    getCostDataForRange(startDate: Date, endDate: Date): Promise<CostAnalysis>;
}
