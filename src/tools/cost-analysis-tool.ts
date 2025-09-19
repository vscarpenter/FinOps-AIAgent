import { Tool } from '../mock-strands-agent';
import { CostExplorerClient, GetCostAndUsageCommand, GetCostAndUsageCommandInput } from '@aws-sdk/client-cost-explorer';
import { CostAnalysis, ServiceCost, RetryConfig, EnhancedCostAnalysis, BedrockConfig, OptimizationRecommendation } from '../types';
import { BedrockAnalysisTool } from './bedrock-analysis-tool';

/**
 * Cache entry for AI analysis results
 */
interface CacheEntry {
  result: EnhancedCostAnalysis;
  timestamp: number;
  costDataHash: string;
}

/**
 * Tool for analyzing AWS costs using the Cost Explorer API with AI enhancement capabilities
 */
export class CostAnalysisTool extends Tool {
  private costExplorerClient: CostExplorerClient;
  private retryConfig: RetryConfig;
  private bedrockTool?: BedrockAnalysisTool;
  private bedrockConfig?: BedrockConfig;
  private aiAnalysisCache: Map<string, CacheEntry> = new Map();
  private costThresholdTracker: number = 0;
  private monthlyBedrockSpend: number = 0;
  private lastSpendReset: number = Date.now();

  constructor(region: string = 'us-east-1', retryConfig?: Partial<RetryConfig>, bedrockConfig?: BedrockConfig) {
    super();
    this.costExplorerClient = new CostExplorerClient({ region });
    this.retryConfig = {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
      ...retryConfig
    };
    
    if (bedrockConfig?.enabled) {
      this.bedrockConfig = bedrockConfig;
      this.bedrockTool = new BedrockAnalysisTool(bedrockConfig, retryConfig);
    }
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

  /**
   * Enhances cost analysis with AI insights from Bedrock
   * Includes caching and cost control mechanisms
   */
  async enhanceWithAIAnalysis(costAnalysis: CostAnalysis, historicalData?: CostAnalysis[]): Promise<EnhancedCostAnalysis> {
    // Return basic analysis if Bedrock is not configured or disabled
    if (!this.bedrockConfig?.enabled || !this.bedrockTool) {
      this.logger.info('Bedrock AI analysis is disabled, returning basic cost analysis');
      return {
        ...costAnalysis,
        fallbackUsed: true
      };
    }

    // Check cost threshold before proceeding
    if (!this.canAffordAIAnalysis()) {
      this.logger.warn('Bedrock cost threshold exceeded, skipping AI analysis', {
        monthlySpend: this.monthlyBedrockSpend,
        threshold: this.bedrockConfig.costThreshold
      });
      return {
        ...costAnalysis,
        fallbackUsed: true
      };
    }

    // Check cache first if enabled
    if (this.bedrockConfig.cacheResults) {
      const cachedResult = this.getCachedAnalysis(costAnalysis);
      if (cachedResult) {
        this.logger.info('Using cached AI analysis result');
        return cachedResult;
      }
    }

    try {
      const startTime = Date.now();
      
      // Perform AI analysis
      const [aiAnalysis, anomalies, recommendations] = await Promise.allSettled([
        this.bedrockTool.analyzeSpendingPatterns(costAnalysis),
        this.bedrockTool.detectAnomalies(costAnalysis, historicalData),
        this.bedrockTool.generateOptimizationRecommendations(costAnalysis)
      ]);

      const processingTime = Date.now() - startTime;

      // Build enhanced result with successful analyses
      const enhancedResult: EnhancedCostAnalysis = {
        ...costAnalysis,
        aiProcessingTime: processingTime,
        fallbackUsed: false
      };

      // Add AI analysis if successful
      if (aiAnalysis.status === 'fulfilled') {
        enhancedResult.aiAnalysis = aiAnalysis.value;
        this.trackBedrockCost(aiAnalysis.value.processingCost || 0);
      } else {
        this.logger.warn('AI analysis failed', { error: aiAnalysis.reason });
      }

      // Add anomaly detection if successful
      if (anomalies.status === 'fulfilled') {
        enhancedResult.anomalies = anomalies.value;
      } else {
        this.logger.warn('Anomaly detection failed', { error: anomalies.reason });
      }

      // Add optimization recommendations if successful
      if (recommendations.status === 'fulfilled') {
        enhancedResult.recommendations = recommendations.value;
      } else {
        this.logger.warn('Optimization recommendations failed', { error: recommendations.reason });
      }

      // Check if all AI operations failed
      const hasAnyAIResult = enhancedResult.aiAnalysis || enhancedResult.anomalies || enhancedResult.recommendations;
      
      if (!hasAnyAIResult) {
        // All AI operations failed, use fallback if enabled
        if (this.bedrockConfig.fallbackOnError) {
          this.logger.warn('All AI operations failed, using fallback');
          return {
            ...costAnalysis,
            fallbackUsed: true
          };
        } else {
          throw new Error('All AI operations failed and fallback is disabled');
        }
      }

      // Cache the result if caching is enabled and we have at least one successful AI result
      if (this.bedrockConfig.cacheResults) {
        this.cacheAnalysisResult(costAnalysis, enhancedResult);
      }

      this.logger.info('AI-enhanced cost analysis completed', {
        processingTime,
        hasAIAnalysis: !!enhancedResult.aiAnalysis,
        hasAnomalies: !!enhancedResult.anomalies,
        hasRecommendations: !!enhancedResult.recommendations,
        monthlyBedrockSpend: this.monthlyBedrockSpend
      });

      return enhancedResult;

    } catch (error) {
      this.logger.error('AI enhancement failed completely', { error });
      
      // Return fallback result if configured to do so
      if (this.bedrockConfig.fallbackOnError) {
        return {
          ...costAnalysis,
          fallbackUsed: true
        };
      }
      
      throw new Error(`AI enhancement failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Checks if AI analysis can be performed within cost limits
   */
  private canAffordAIAnalysis(): boolean {
    if (!this.bedrockConfig) return false;

    // Reset monthly spend tracking if it's a new month
    const now = new Date();
    const lastResetDate = new Date(this.lastSpendReset);
    if (now.getMonth() !== lastResetDate.getMonth() || now.getFullYear() !== lastResetDate.getFullYear()) {
      this.monthlyBedrockSpend = 0;
      this.lastSpendReset = Date.now();
    }

    return this.monthlyBedrockSpend < this.bedrockConfig.costThreshold;
  }

  /**
   * Tracks Bedrock API costs
   */
  private trackBedrockCost(cost: number): void {
    this.monthlyBedrockSpend += cost;
    
    if (this.monthlyBedrockSpend >= this.bedrockConfig!.costThreshold * 0.9) {
      this.logger.warn('Approaching Bedrock cost threshold', {
        currentSpend: this.monthlyBedrockSpend,
        threshold: this.bedrockConfig!.costThreshold,
        percentageUsed: (this.monthlyBedrockSpend / this.bedrockConfig!.costThreshold) * 100
      });
    }
  }

  /**
   * Generates a hash for cost data to use as cache key
   */
  private generateCostDataHash(costAnalysis: CostAnalysis): string {
    const hashData = {
      totalCost: costAnalysis.totalCost,
      projectedMonthly: costAnalysis.projectedMonthly,
      period: costAnalysis.period,
      serviceCount: Object.keys(costAnalysis.serviceBreakdown).length,
      topServices: Object.entries(costAnalysis.serviceBreakdown)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([service, cost]) => `${service}:${cost.toFixed(2)}`)
        .join('|')
    };
    
    return Buffer.from(JSON.stringify(hashData)).toString('base64');
  }

  /**
   * Retrieves cached AI analysis result if available and valid
   */
  private getCachedAnalysis(costAnalysis: CostAnalysis): EnhancedCostAnalysis | null {
    if (!this.bedrockConfig?.cacheResults) return null;

    const cacheKey = this.generateCostDataHash(costAnalysis);
    const cacheEntry = this.aiAnalysisCache.get(cacheKey);
    
    if (!cacheEntry) return null;

    // Check if cache entry is still valid
    const now = Date.now();
    const cacheAge = now - cacheEntry.timestamp;
    const maxAge = this.bedrockConfig.cacheTTLMinutes * 60 * 1000;
    
    if (cacheAge > maxAge) {
      this.aiAnalysisCache.delete(cacheKey);
      return null;
    }

    // Verify the cached result matches current cost data
    if (cacheEntry.costDataHash !== cacheKey) {
      this.aiAnalysisCache.delete(cacheKey);
      return null;
    }

    return cacheEntry.result;
  }

  /**
   * Caches AI analysis result
   */
  private cacheAnalysisResult(costAnalysis: CostAnalysis, enhancedResult: EnhancedCostAnalysis): void {
    if (!this.bedrockConfig?.cacheResults) return;

    const cacheKey = this.generateCostDataHash(costAnalysis);
    const cacheEntry: CacheEntry = {
      result: enhancedResult,
      timestamp: Date.now(),
      costDataHash: cacheKey
    };

    this.aiAnalysisCache.set(cacheKey, cacheEntry);

    // Clean up old cache entries to prevent memory leaks
    this.cleanupExpiredCacheEntries();
  }

  /**
   * Removes expired cache entries
   */
  private cleanupExpiredCacheEntries(): void {
    if (!this.bedrockConfig?.cacheResults) return;

    const now = Date.now();
    const maxAge = this.bedrockConfig.cacheTTLMinutes * 60 * 1000;
    
    for (const [key, entry] of this.aiAnalysisCache.entries()) {
      if (now - entry.timestamp > maxAge) {
        this.aiAnalysisCache.delete(key);
      }
    }
  }

  /**
   * Gets current Bedrock usage statistics
   */
  getBedrockUsageStats(): { monthlySpend: number; threshold: number; cacheSize: number; cacheHitRate?: number } {
    return {
      monthlySpend: this.monthlyBedrockSpend,
      threshold: this.bedrockConfig?.costThreshold || 0,
      cacheSize: this.aiAnalysisCache.size,
      // Note: Cache hit rate would need to be tracked separately for accurate reporting
    };
  }

  /**
   * Clears the AI analysis cache
   */
  clearAICache(): void {
    this.aiAnalysisCache.clear();
    this.logger.info('AI analysis cache cleared');
  }

  /**
   * Disables AI analysis temporarily (until next restart)
   */
  disableAIAnalysis(): void {
    if (this.bedrockConfig) {
      this.bedrockConfig.enabled = false;
      this.logger.warn('AI analysis disabled due to cost threshold or manual override');
    }
  }

  /**
   * Enhanced cost threshold monitoring with automatic disabling
   */
  private checkCostThresholdAndDisable(): boolean {
    if (!this.bedrockConfig) return false;

    // Reset monthly spend tracking if it's a new month
    const now = new Date();
    const lastResetDate = new Date(this.lastSpendReset);
    if (now.getMonth() !== lastResetDate.getMonth() || now.getFullYear() !== lastResetDate.getFullYear()) {
      this.monthlyBedrockSpend = 0;
      this.lastSpendReset = Date.now();
      this.logger.info('Monthly Bedrock spend tracking reset', {
        newMonth: now.getMonth() + 1,
        newYear: now.getFullYear()
      });
    }

    const remainingBudget = this.bedrockConfig.costThreshold - this.monthlyBedrockSpend;
    const usagePercentage = (this.monthlyBedrockSpend / this.bedrockConfig.costThreshold) * 100;

    // Automatic disabling when threshold is exceeded
    if (this.monthlyBedrockSpend >= this.bedrockConfig.costThreshold) {
      this.logger.error('Bedrock cost threshold exceeded, automatically disabling AI analysis', {
        monthlySpend: this.monthlyBedrockSpend,
        threshold: this.bedrockConfig.costThreshold,
        usagePercentage: usagePercentage.toFixed(1)
      });
      this.disableAIAnalysis();
      return false;
    }

    // Warning at 80% threshold
    if (usagePercentage >= 80 && usagePercentage < 90) {
      this.logger.warn('Bedrock cost usage at 80% threshold', {
        monthlySpend: this.monthlyBedrockSpend,
        threshold: this.bedrockConfig.costThreshold,
        remainingBudget,
        usagePercentage: usagePercentage.toFixed(1)
      });
    }

    // Critical warning at 90% threshold
    if (usagePercentage >= 90) {
      this.logger.error('Bedrock cost usage at 90% threshold - approaching limit', {
        monthlySpend: this.monthlyBedrockSpend,
        threshold: this.bedrockConfig.costThreshold,
        remainingBudget,
        usagePercentage: usagePercentage.toFixed(1)
      });
    }

    return true;
  }

  /**
   * Implements intelligent rate limiting based on cost and usage patterns
   */
  private async intelligentRateLimit(): Promise<void> {
    if (!this.bedrockConfig) return;

    const now = Date.now();
    const timeWindow = 60 * 1000; // 1 minute window

    // Reset rate limit counter if time window has passed
    if (now - this.lastSpendReset > timeWindow) {
      this.costThresholdTracker = 0;
    }

    // Calculate dynamic rate limit based on remaining budget
    const remainingBudget = this.bedrockConfig.costThreshold - this.monthlyBedrockSpend;
    const usagePercentage = (this.monthlyBedrockSpend / this.bedrockConfig.costThreshold) * 100;
    
    let dynamicRateLimit = this.bedrockConfig.rateLimitPerMinute;

    // Reduce rate limit as we approach the cost threshold
    if (usagePercentage >= 80) {
      dynamicRateLimit = Math.max(1, Math.floor(this.bedrockConfig.rateLimitPerMinute * 0.3)); // 30% of normal rate
    } else if (usagePercentage >= 60) {
      dynamicRateLimit = Math.max(2, Math.floor(this.bedrockConfig.rateLimitPerMinute * 0.5)); // 50% of normal rate
    } else if (usagePercentage >= 40) {
      dynamicRateLimit = Math.max(3, Math.floor(this.bedrockConfig.rateLimitPerMinute * 0.7)); // 70% of normal rate
    }

    // Check if we've exceeded the dynamic rate limit
    if (this.costThresholdTracker >= dynamicRateLimit) {
      const waitTime = timeWindow - (now - this.lastSpendReset);
      this.logger.warn('Dynamic rate limit exceeded, throttling AI requests', {
        currentRequests: this.costThresholdTracker,
        dynamicLimit: dynamicRateLimit,
        originalLimit: this.bedrockConfig.rateLimitPerMinute,
        usagePercentage: usagePercentage.toFixed(1),
        waitTime
      });

      if (waitTime > 0) {
        await this.sleep(waitTime);
        this.costThresholdTracker = 0;
        this.lastSpendReset = Date.now();
      }
    }

    this.costThresholdTracker++;
  }

  /**
   * Estimates the cost of an AI analysis request before execution
   */
  private estimateRequestCost(costAnalysis: CostAnalysis, includeAnomalies: boolean = true, includeRecommendations: boolean = true): number {
    // Base cost estimation based on data size and complexity
    const serviceCount = Object.keys(costAnalysis.serviceBreakdown).length;
    const dataComplexity = Math.min(serviceCount / 10, 1.0); // Normalize to 0-1 scale
    
    // Estimate tokens based on service count and cost values
    const estimatedInputTokens = 200 + (serviceCount * 50); // Base prompt + service data
    const estimatedOutputTokens = 150; // Typical response size
    
    // Titan Text pricing (approximate)
    const inputCostPerToken = 0.0008 / 1000;
    const outputCostPerToken = 0.0016 / 1000;
    
    let estimatedCost = (estimatedInputTokens * inputCostPerToken) + (estimatedOutputTokens * outputCostPerToken);
    
    // Multiply by number of AI operations requested
    let operationCount = 1; // Base analysis
    if (includeAnomalies) operationCount++;
    if (includeRecommendations) operationCount++;
    
    estimatedCost *= operationCount;
    
    // Add complexity multiplier
    estimatedCost *= (1 + dataComplexity * 0.5);
    
    return Math.round(estimatedCost * 100000) / 100000; // Round to 5 decimal places
  }

  /**
   * Checks if a request can be afforded within the remaining budget
   */
  private canAffordRequest(estimatedCost: number): boolean {
    if (!this.bedrockConfig) return false;
    
    const remainingBudget = this.bedrockConfig.costThreshold - this.monthlyBedrockSpend;
    return estimatedCost <= remainingBudget;
  }

  /**
   * Enhanced version of enhanceWithAIAnalysis with advanced cost control
   */
  async enhanceWithAIAnalysisAdvanced(
    costAnalysis: CostAnalysis, 
    historicalData?: CostAnalysis[],
    options: {
      includeAnomalies?: boolean;
      includeRecommendations?: boolean;
      forceExecution?: boolean;
    } = {}
  ): Promise<EnhancedCostAnalysis> {
    const { includeAnomalies = true, includeRecommendations = true, forceExecution = false } = options;

    // Return basic analysis if Bedrock is not configured or disabled
    if (!this.bedrockConfig?.enabled || !this.bedrockTool) {
      this.logger.info('Bedrock AI analysis is disabled, returning basic cost analysis');
      return {
        ...costAnalysis,
        fallbackUsed: true
      };
    }

    // Check cost threshold and auto-disable if exceeded
    if (!forceExecution && !this.checkCostThresholdAndDisable()) {
      return {
        ...costAnalysis,
        fallbackUsed: true
      };
    }

    // Estimate request cost
    const estimatedCost = this.estimateRequestCost(costAnalysis, includeAnomalies, includeRecommendations);
    
    // Check if we can afford this request
    if (!forceExecution && !this.canAffordRequest(estimatedCost)) {
      this.logger.warn('Cannot afford AI analysis request within budget', {
        estimatedCost,
        remainingBudget: this.bedrockConfig.costThreshold - this.monthlyBedrockSpend,
        monthlySpend: this.monthlyBedrockSpend
      });
      return {
        ...costAnalysis,
        fallbackUsed: true
      };
    }

    // Apply intelligent rate limiting
    if (!forceExecution) {
      await this.intelligentRateLimit();
    }

    // Check cache first if enabled
    if (this.bedrockConfig.cacheResults) {
      const cachedResult = this.getCachedAnalysis(costAnalysis);
      if (cachedResult) {
        this.logger.info('Using cached AI analysis result', {
          estimatedCostSaved: estimatedCost
        });
        return cachedResult;
      }
    }

    try {
      const startTime = Date.now();
      
      // Build array of AI operations to perform
      const aiOperations: Promise<any>[] = [
        this.bedrockTool.analyzeSpendingPatterns(costAnalysis)
      ];

      if (includeAnomalies) {
        aiOperations.push(this.bedrockTool.detectAnomalies(costAnalysis, historicalData));
      }

      if (includeRecommendations) {
        aiOperations.push(this.bedrockTool.generateOptimizationRecommendations(costAnalysis));
      }

      // Execute AI operations
      const results = await Promise.allSettled(aiOperations);
      const processingTime = Date.now() - startTime;

      // Build enhanced result
      const enhancedResult: EnhancedCostAnalysis = {
        ...costAnalysis,
        aiProcessingTime: processingTime,
        fallbackUsed: false
      };

      let actualCost = 0;

      // Process results
      if (results[0].status === 'fulfilled') {
        enhancedResult.aiAnalysis = results[0].value;
        actualCost += results[0].value.processingCost || 0;
      }

      if (includeAnomalies && results[1]?.status === 'fulfilled') {
        enhancedResult.anomalies = results[1].value;
      }

      if (includeRecommendations && results[includeAnomalies ? 2 : 1]?.status === 'fulfilled') {
        enhancedResult.recommendations = (results[includeAnomalies ? 2 : 1] as PromiseFulfilledResult<OptimizationRecommendation[]>).value;
      }

      // Track actual cost
      this.trackBedrockCost(actualCost || estimatedCost);

      // Cache the result if successful
      if (this.bedrockConfig.cacheResults && (enhancedResult.aiAnalysis || enhancedResult.anomalies || enhancedResult.recommendations)) {
        this.cacheAnalysisResult(costAnalysis, enhancedResult);
      }

      this.logger.info('Advanced AI-enhanced cost analysis completed', {
        processingTime,
        estimatedCost,
        actualCost: actualCost || estimatedCost,
        hasAIAnalysis: !!enhancedResult.aiAnalysis,
        hasAnomalies: !!enhancedResult.anomalies,
        hasRecommendations: !!enhancedResult.recommendations,
        monthlyBedrockSpend: this.monthlyBedrockSpend,
        remainingBudget: this.bedrockConfig.costThreshold - this.monthlyBedrockSpend
      });

      return enhancedResult;

    } catch (error) {
      this.logger.error('Advanced AI enhancement failed', { error, estimatedCost });
      
      if (this.bedrockConfig.fallbackOnError) {
        return {
          ...costAnalysis,
          fallbackUsed: true
        };
      }
      
      throw new Error(`Advanced AI enhancement failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Gets detailed cost control statistics
   */
  getCostControlStats(): {
    monthlySpend: number;
    threshold: number;
    remainingBudget: number;
    usagePercentage: number;
    requestsThisMinute: number;
    dynamicRateLimit: number;
    cacheSize: number;
    isEnabled: boolean;
  } {
    const remainingBudget = (this.bedrockConfig?.costThreshold || 0) - this.monthlyBedrockSpend;
    const usagePercentage = this.bedrockConfig?.costThreshold 
      ? (this.monthlyBedrockSpend / this.bedrockConfig.costThreshold) * 100 
      : 0;

    // Calculate current dynamic rate limit
    let dynamicRateLimit = this.bedrockConfig?.rateLimitPerMinute || 0;
    if (usagePercentage >= 80) {
      dynamicRateLimit = Math.max(1, Math.floor(dynamicRateLimit * 0.3));
    } else if (usagePercentage >= 60) {
      dynamicRateLimit = Math.max(2, Math.floor(dynamicRateLimit * 0.5));
    } else if (usagePercentage >= 40) {
      dynamicRateLimit = Math.max(3, Math.floor(dynamicRateLimit * 0.7));
    }

    return {
      monthlySpend: this.monthlyBedrockSpend,
      threshold: this.bedrockConfig?.costThreshold || 0,
      remainingBudget,
      usagePercentage: Math.round(usagePercentage * 100) / 100,
      requestsThisMinute: this.costThresholdTracker,
      dynamicRateLimit,
      cacheSize: this.aiAnalysisCache.size,
      isEnabled: this.bedrockConfig?.enabled || false
    };
  }

  /**
   * Resets monthly cost tracking (for testing or manual reset)
   */
  resetMonthlyCostTracking(): void {
    this.monthlyBedrockSpend = 0;
    this.lastSpendReset = Date.now();
    this.costThresholdTracker = 0;
    this.logger.info('Monthly Bedrock cost tracking manually reset');
  }

  /**
   * Sleep utility for rate limiting delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}