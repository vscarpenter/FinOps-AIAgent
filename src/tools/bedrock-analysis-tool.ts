import { Tool } from 'strands-agents';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { 
  CostAnalysis, 
  AIAnalysisResult, 
  AnomalyDetectionResult, 
  OptimizationRecommendation, 
  BedrockConfig,
  RetryConfig 
} from '../types';

/**
 * Tool for AI-enhanced cost analysis using AWS Bedrock and Titan models
 */
export class BedrockAnalysisTool extends Tool {
  private bedrockClient: BedrockRuntimeClient;
  private config: BedrockConfig;
  private retryConfig: RetryConfig;
  private requestCount: number = 0;
  private lastResetTime: number = Date.now();

  constructor(config: BedrockConfig, retryConfig?: Partial<RetryConfig>) {
    super();
    this.config = config;
    this.bedrockClient = new BedrockRuntimeClient({ region: config.region });
    this.retryConfig = {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
      ...retryConfig
    };
  }

  /**
   * Analyzes spending patterns using Titan Text model
   */
  async analyzeSpendingPatterns(costData: CostAnalysis): Promise<AIAnalysisResult> {
    if (!this.config.enabled) {
      throw new Error('Bedrock analysis is disabled');
    }

    await this.checkRateLimit();

    const prompt = this.formatPromptForTitan(costData, 'spending_analysis');
    
    try {
      const startTime = Date.now();
      const response = await this.executeWithRetry(() => this.invokeModel(prompt));
      const processingTime = Date.now() - startTime;

      const aiResult = this.parseAIResponse(response);
      
      this.logger.info('Bedrock spending analysis completed', {
        modelUsed: this.config.modelId,
        processingTime,
        confidenceScore: aiResult.confidenceScore
      });

      return {
        ...aiResult,
        analysisTimestamp: new Date().toISOString(),
        modelUsed: this.config.modelId,
        processingCost: this.estimateProcessingCost(prompt, response)
      };
    } catch (error) {
      this.logger.error('Bedrock spending analysis failed', { error });
      
      if (this.config.fallbackOnError) {
        return this.createFallbackAnalysis(costData);
      }
      
      throw new Error(`Bedrock analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Detects spending anomalies using AI analysis with enhanced confidence scoring
   */
  async detectAnomalies(costData: CostAnalysis, historicalData?: CostAnalysis[]): Promise<AnomalyDetectionResult> {
    if (!this.config.enabled) {
      throw new Error('Bedrock analysis is disabled');
    }

    await this.checkRateLimit();

    const prompt = this.formatAnomalyDetectionPrompt(costData, historicalData);
    
    try {
      const response = await this.executeWithRetry(() => this.invokeModel(prompt));
      const result = this.parseAnomalyResponse(response);
      
      // Enhance anomalies with confidence scoring based on data quality
      const enhancedResult = this.enhanceAnomalyConfidence(result, costData, historicalData);
      
      this.logger.info('Bedrock anomaly detection completed', {
        anomaliesDetected: enhancedResult.anomaliesDetected,
        anomalyCount: enhancedResult.anomalies.length,
        averageConfidence: enhancedResult.anomalies.length > 0 
          ? enhancedResult.anomalies.reduce((sum, a) => sum + a.confidenceScore, 0) / enhancedResult.anomalies.length 
          : 0
      });

      return enhancedResult;
    } catch (error) {
      this.logger.error('Bedrock anomaly detection failed', { error });
      
      if (this.config.fallbackOnError) {
        return this.createFallbackAnomalyResult(costData, historicalData);
      }
      
      throw new Error(`Anomaly detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generates cost optimization recommendations with enhanced scoring
   */
  async generateOptimizationRecommendations(costData: CostAnalysis): Promise<OptimizationRecommendation[]> {
    if (!this.config.enabled) {
      throw new Error('Bedrock analysis is disabled');
    }

    await this.checkRateLimit();

    const prompt = this.formatOptimizationPrompt(costData);
    
    try {
      const response = await this.executeWithRetry(() => this.invokeModel(prompt));
      const recommendations = this.parseOptimizationResponse(response);
      
      // Enhance recommendations with priority scoring and validation
      const enhancedRecommendations = this.enhanceOptimizationRecommendations(recommendations, costData);
      
      this.logger.info('Bedrock optimization recommendations generated', {
        recommendationCount: enhancedRecommendations.length,
        highPriorityCount: enhancedRecommendations.filter(r => r.priority === 'HIGH').length,
        totalEstimatedSavings: enhancedRecommendations.reduce((sum, r) => sum + (r.estimatedSavings || 0), 0)
      });

      return enhancedRecommendations;
    } catch (error) {
      this.logger.error('Bedrock optimization recommendations failed', { error });
      
      if (this.config.fallbackOnError) {
        return this.createFallbackOptimizationRecommendations(costData);
      }
      
      throw new Error(`Optimization recommendations failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validates Bedrock model access and configuration
   */
  async validateModelAccess(): Promise<boolean> {
    try {
      const testPrompt = 'Test prompt for model validation';
      await this.invokeModel(testPrompt);
      
      this.logger.info('Bedrock model access validated successfully', {
        modelId: this.config.modelId,
        region: this.config.region
      });
      
      return true;
    } catch (error) {
      this.logger.error('Bedrock model access validation failed', { 
        error,
        modelId: this.config.modelId,
        region: this.config.region
      });
      
      return false;
    }
  }

  /**
   * Formats cost data into structured prompt for Titan model
   */
  formatPromptForTitan(costData: CostAnalysis, analysisType: string): string {
    const topServices = Object.entries(costData.serviceBreakdown)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([service, cost]) => `${service}: $${cost.toFixed(2)}`)
      .join('\n');

    const prompt = `
Analyze the following AWS cost data and provide insights:

Current Month-to-Date Cost: $${costData.totalCost.toFixed(2)}
Projected Monthly Cost: $${costData.projectedMonthly.toFixed(2)}
Period: ${costData.period.start} to ${costData.period.end}

Top Services by Cost:
${topServices}

Please provide:
1. A concise summary of spending patterns (2-3 sentences)
2. Key insights about cost drivers and trends (3-5 bullet points)
3. Confidence score (0.0 to 1.0) for this analysis

Format your response as JSON:
{
  "summary": "Brief summary of spending patterns",
  "keyInsights": ["Insight 1", "Insight 2", "Insight 3"],
  "confidenceScore": 0.85
}

Ensure the response is valid JSON and confidence score is between 0.0 and 1.0.
`;

    return prompt.trim();
  }

  /**
   * Enhances anomaly detection results with confidence scoring based on data quality
   */
  private enhanceAnomalyConfidence(result: AnomalyDetectionResult, costData: CostAnalysis, historicalData?: CostAnalysis[]): AnomalyDetectionResult {
    if (!result.anomaliesDetected || result.anomalies.length === 0) {
      return result;
    }

    const enhancedAnomalies = result.anomalies.map(anomaly => {
      let confidenceAdjustment = 0;

      // Adjust confidence based on historical data availability
      if (historicalData && historicalData.length > 0) {
        confidenceAdjustment += 0.2; // More confidence with historical context
        
        // Check if anomaly is consistent across multiple periods
        const historicalAverage = historicalData.reduce((sum, data) => 
          sum + (data.serviceBreakdown[anomaly.service] || 0), 0) / historicalData.length;
        
        const currentCost = costData.serviceBreakdown[anomaly.service] || 0;
        const deviationRatio = Math.abs(currentCost - historicalAverage) / Math.max(historicalAverage, 1);
        
        if (deviationRatio > 2.0) {
          confidenceAdjustment += 0.3; // High deviation increases confidence
        } else if (deviationRatio > 1.0) {
          confidenceAdjustment += 0.1; // Moderate deviation
        }
      } else {
        confidenceAdjustment -= 0.2; // Lower confidence without historical data
      }

      // Adjust confidence based on service cost significance
      const serviceCost = costData.serviceBreakdown[anomaly.service] || 0;
      const costPercentage = serviceCost / costData.totalCost;
      
      if (costPercentage > 0.3) {
        confidenceAdjustment += 0.2; // High confidence for major cost drivers
      } else if (costPercentage > 0.1) {
        confidenceAdjustment += 0.1; // Moderate confidence for significant services
      } else if (costPercentage < 0.01) {
        confidenceAdjustment -= 0.3; // Lower confidence for minor services
      }

      // Adjust confidence based on severity level
      if (anomaly.severity === 'HIGH') {
        confidenceAdjustment += 0.1;
      } else if (anomaly.severity === 'LOW') {
        confidenceAdjustment -= 0.1;
      }

      // Apply confidence adjustment and clamp to valid range
      const adjustedConfidence = Math.max(0.0, Math.min(1.0, anomaly.confidenceScore + confidenceAdjustment));

      return {
        ...anomaly,
        confidenceScore: Math.round(adjustedConfidence * 100) / 100 // Round to 2 decimal places
      };
    });

    // Filter out low-confidence anomalies (below 0.3)
    const filteredAnomalies = enhancedAnomalies.filter(anomaly => anomaly.confidenceScore >= 0.3);

    return {
      anomaliesDetected: filteredAnomalies.length > 0,
      anomalies: filteredAnomalies
    };
  }

  /**
   * Enhances optimization recommendations with priority scoring and validation
   */
  private enhanceOptimizationRecommendations(recommendations: OptimizationRecommendation[], costData: CostAnalysis): OptimizationRecommendation[] {
    return recommendations.map(rec => {
      const serviceCost = costData.serviceBreakdown[rec.service] || 0;
      const costPercentage = serviceCost / costData.totalCost;

      // Enhance estimated savings if not provided or seems unrealistic
      let estimatedSavings = rec.estimatedSavings;
      if (!estimatedSavings || estimatedSavings <= 0) {
        estimatedSavings = this.estimateSavingsForRecommendation(rec, serviceCost);
      }

      // Validate and adjust estimated savings to be realistic
      const maxReasonableSavings = serviceCost * 0.8; // Max 80% savings
      if (estimatedSavings > maxReasonableSavings) {
        estimatedSavings = maxReasonableSavings;
      }

      // Adjust priority based on cost impact and savings potential
      let adjustedPriority = rec.priority;
      const savingsPercentage = estimatedSavings / costData.totalCost;

      if (savingsPercentage > 0.1 && costPercentage > 0.2) {
        adjustedPriority = 'HIGH'; // High impact recommendations
      } else if (savingsPercentage > 0.05 || costPercentage > 0.1) {
        adjustedPriority = adjustedPriority === 'LOW' ? 'MEDIUM' : adjustedPriority;
      } else if (savingsPercentage < 0.01 && costPercentage < 0.05) {
        adjustedPriority = 'LOW'; // Low impact recommendations
      }

      return {
        ...rec,
        estimatedSavings: Math.round(estimatedSavings * 100) / 100,
        priority: adjustedPriority
      };
    }).sort((a, b) => {
      // Sort by priority (HIGH > MEDIUM > LOW) then by estimated savings
      const priorityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      
      return (b.estimatedSavings || 0) - (a.estimatedSavings || 0);
    });
  }

  /**
   * Estimates savings for a recommendation based on category and service cost
   */
  private estimateSavingsForRecommendation(recommendation: OptimizationRecommendation, serviceCost: number): number {
    switch (recommendation.category) {
      case 'RIGHTSIZING':
        return serviceCost * 0.3; // Typical 30% savings from rightsizing
      case 'RESERVED_INSTANCES':
        return serviceCost * 0.4; // Up to 40% savings with RIs
      case 'SPOT_INSTANCES':
        return serviceCost * 0.6; // Up to 60% savings with Spot
      case 'STORAGE_OPTIMIZATION':
        return serviceCost * 0.25; // 25% savings from storage optimization
      default:
        return serviceCost * 0.15; // Conservative 15% for other optimizations
    }
  }

  /**
   * Creates fallback anomaly result when AI analysis fails
   */
  private createFallbackAnomalyResult(costData: CostAnalysis, historicalData?: CostAnalysis[]): AnomalyDetectionResult {
    const anomalies: AnomalyDetectionResult['anomalies'] = [];

    // Simple heuristic-based anomaly detection
    if (historicalData && historicalData.length > 0) {
      const historicalAverage = historicalData.reduce((sum, data) => sum + data.totalCost, 0) / historicalData.length;
      const currentCost = costData.totalCost;
      const deviationRatio = Math.abs(currentCost - historicalAverage) / Math.max(historicalAverage, 1);

      if (deviationRatio > 1.5) {
        anomalies.push({
          service: 'Overall Spending',
          severity: deviationRatio > 3.0 ? 'HIGH' : 'MEDIUM',
          description: `Current spending (${currentCost.toFixed(2)}) is ${(deviationRatio * 100).toFixed(0)}% different from historical average (${historicalAverage.toFixed(2)})`,
          confidenceScore: Math.min(0.7, deviationRatio / 5), // Lower confidence for fallback
          suggestedAction: 'Review recent changes in resource usage and configuration'
        });
      }

      // Check individual services for anomalies
      Object.entries(costData.serviceBreakdown).forEach(([service, cost]) => {
        const historicalServiceAverage = historicalData.reduce((sum, data) => 
          sum + (data.serviceBreakdown[service] || 0), 0) / historicalData.length;
        
        if (historicalServiceAverage > 0) {
          const serviceDeviationRatio = Math.abs(cost - historicalServiceAverage) / historicalServiceAverage;
          
          if (serviceDeviationRatio > 2.0 && cost > costData.totalCost * 0.05) { // Only flag significant services
            anomalies.push({
              service,
              severity: serviceDeviationRatio > 4.0 ? 'HIGH' : 'MEDIUM',
              description: `${service} cost (${cost.toFixed(2)}) is ${(serviceDeviationRatio * 100).toFixed(0)}% different from historical average (${historicalServiceAverage.toFixed(2)})`,
              confidenceScore: Math.min(0.6, serviceDeviationRatio / 6),
              suggestedAction: `Review ${service} usage patterns and recent configuration changes`
            });
          }
        }
      });
    }

    return {
      anomaliesDetected: anomalies.length > 0,
      anomalies: anomalies.slice(0, 5) // Limit to top 5 anomalies
    };
  }

  /**
   * Creates fallback optimization recommendations when AI analysis fails
   */
  private createFallbackOptimizationRecommendations(costData: CostAnalysis): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];

    // Generate basic recommendations for top cost services
    const topServices = Object.entries(costData.serviceBreakdown)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    topServices.forEach(([service, cost]) => {
      const costPercentage = cost / costData.totalCost;
      
      if (costPercentage > 0.1) { // Only recommend for services >10% of total cost
        // EC2 specific recommendations
        if (service.includes('EC2') || service.includes('Elastic Compute')) {
          recommendations.push({
            category: 'RIGHTSIZING',
            service,
            description: `Review EC2 instance types and sizes for potential rightsizing opportunities`,
            estimatedSavings: cost * 0.25,
            priority: costPercentage > 0.3 ? 'HIGH' : 'MEDIUM',
            implementationComplexity: 'MEDIUM'
          });

          if (cost > 50) { // Only suggest RIs for significant spend
            recommendations.push({
              category: 'RESERVED_INSTANCES',
              service,
              description: `Consider Reserved Instances for consistent ${service} workloads`,
              estimatedSavings: cost * 0.35,
              priority: 'MEDIUM',
              implementationComplexity: 'EASY'
            });
          }
        }

        // Storage specific recommendations
        if (service.includes('S3') || service.includes('EBS') || service.includes('Storage')) {
          recommendations.push({
            category: 'STORAGE_OPTIMIZATION',
            service,
            description: `Optimize storage classes and lifecycle policies for ${service}`,
            estimatedSavings: cost * 0.2,
            priority: costPercentage > 0.2 ? 'HIGH' : 'MEDIUM',
            implementationComplexity: 'EASY'
          });
        }

        // Database specific recommendations
        if (service.includes('RDS') || service.includes('DynamoDB') || service.includes('Database')) {
          recommendations.push({
            category: 'RIGHTSIZING',
            service,
            description: `Review database instance sizes and performance requirements for ${service}`,
            estimatedSavings: cost * 0.3,
            priority: 'MEDIUM',
            implementationComplexity: 'MEDIUM'
          });
        }
      }
    });

    return recommendations.slice(0, 8); // Limit to top 8 recommendations
  }

  /**
   * Formats prompt for anomaly detection
   */
  private formatAnomalyDetectionPrompt(costData: CostAnalysis, historicalData?: CostAnalysis[]): string {
    let prompt = `
Analyze the following AWS cost data for anomalies:

Current Cost: $${costData.totalCost.toFixed(2)}
Projected Monthly: $${costData.projectedMonthly.toFixed(2)}

Service Breakdown:
${Object.entries(costData.serviceBreakdown)
  .sort(([, a], [, b]) => b - a)
  .map(([service, cost]) => `${service}: $${cost.toFixed(2)}`)
  .join('\n')}
`;

    if (historicalData && historicalData.length > 0) {
      prompt += `\n\nHistorical Data for Comparison:`;
      historicalData.forEach((data, index) => {
        prompt += `\nPeriod ${index + 1}: $${data.totalCost.toFixed(2)}`;
      });
    }

    prompt += `

Identify any spending anomalies and respond in JSON format:
{
  "anomaliesDetected": true/false,
  "anomalies": [
    {
      "service": "Service Name",
      "severity": "LOW/MEDIUM/HIGH",
      "description": "Description of anomaly",
      "confidenceScore": 0.85,
      "suggestedAction": "Recommended action"
    }
  ]
}
`;

    return prompt.trim();
  }

  /**
   * Formats prompt for optimization recommendations
   */
  private formatOptimizationPrompt(costData: CostAnalysis): string {
    const prompt = `
Analyze the following AWS cost data and provide optimization recommendations:

Total Cost: $${costData.totalCost.toFixed(2)}
Projected Monthly: $${costData.projectedMonthly.toFixed(2)}

Service Costs:
${Object.entries(costData.serviceBreakdown)
  .sort(([, a], [, b]) => b - a)
  .map(([service, cost]) => `${service}: $${cost.toFixed(2)}`)
  .join('\n')}

Provide cost optimization recommendations in JSON format:
{
  "recommendations": [
    {
      "category": "RIGHTSIZING/RESERVED_INSTANCES/SPOT_INSTANCES/STORAGE_OPTIMIZATION/OTHER",
      "service": "Service Name",
      "description": "Detailed recommendation",
      "estimatedSavings": 100.50,
      "priority": "LOW/MEDIUM/HIGH",
      "implementationComplexity": "EASY/MEDIUM/COMPLEX"
    }
  ]
}
`;

    return prompt.trim();
  }

  /**
   * Invokes Bedrock model with the given prompt
   */
  private async invokeModel(prompt: string): Promise<string> {
    const payload = {
      inputText: prompt,
      textGenerationConfig: {
        maxTokenCount: this.config.maxTokens,
        temperature: this.config.temperature,
        topP: 0.9
      }
    };

    const command = new InvokeModelCommand({
      modelId: this.config.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload)
    });

    const response = await this.bedrockClient.send(command);
    
    if (!response.body) {
      throw new Error('Empty response from Bedrock model');
    }

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    
    if (!responseBody.results || !responseBody.results[0] || !responseBody.results[0].outputText) {
      throw new Error('Invalid response format from Bedrock model');
    }

    return responseBody.results[0].outputText;
  }

  /**
   * Parses AI response into structured format
   */
  parseAIResponse(response: string): AIAnalysisResult {
    try {
      // Clean the response - remove any markdown formatting or extra text
      const cleanResponse = response.trim();
      let jsonStr = cleanResponse;

      // Try to extract JSON if it's wrapped in other text
      const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const parsed = JSON.parse(jsonStr);

      // Validate required fields
      if (!parsed.summary || !Array.isArray(parsed.keyInsights) || typeof parsed.confidenceScore !== 'number') {
        throw new Error('Invalid AI response structure');
      }

      // Ensure confidence score is within valid range
      const confidenceScore = Math.max(0, Math.min(1, parsed.confidenceScore));

      return {
        summary: parsed.summary,
        keyInsights: parsed.keyInsights,
        confidenceScore,
        analysisTimestamp: new Date().toISOString(),
        modelUsed: this.config.modelId
      };
    } catch (error) {
      this.logger.error('Failed to parse AI response', { error, response });
      
      // Return fallback response
      return {
        summary: 'AI analysis parsing failed - using fallback response',
        keyInsights: ['Unable to parse AI insights'],
        confidenceScore: 0.1,
        analysisTimestamp: new Date().toISOString(),
        modelUsed: this.config.modelId
      };
    }
  }

  /**
   * Parses anomaly detection response
   */
  private parseAnomalyResponse(response: string): AnomalyDetectionResult {
    try {
      const cleanResponse = response.trim();
      let jsonStr = cleanResponse;

      const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const parsed = JSON.parse(jsonStr);

      return {
        anomaliesDetected: Boolean(parsed.anomaliesDetected),
        anomalies: Array.isArray(parsed.anomalies) ? parsed.anomalies : []
      };
    } catch (error) {
      this.logger.error('Failed to parse anomaly response', { error, response });
      return { anomaliesDetected: false, anomalies: [] };
    }
  }

  /**
   * Parses optimization recommendations response
   */
  private parseOptimizationResponse(response: string): OptimizationRecommendation[] {
    try {
      const cleanResponse = response.trim();
      let jsonStr = cleanResponse;

      const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const parsed = JSON.parse(jsonStr);

      return Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
    } catch (error) {
      this.logger.error('Failed to parse optimization response', { error, response });
      return [];
    }
  }

  /**
   * Creates fallback analysis when AI fails
   */
  private createFallbackAnalysis(costData: CostAnalysis): AIAnalysisResult {
    const topService = Object.entries(costData.serviceBreakdown)
      .sort(([, a], [, b]) => b - a)[0];

    return {
      summary: `Current AWS spending is $${costData.totalCost.toFixed(2)} with projected monthly cost of $${costData.projectedMonthly.toFixed(2)}.`,
      keyInsights: [
        `Top cost driver: ${topService ? topService[0] : 'Unknown'} ($${topService ? topService[1].toFixed(2) : '0.00'})`,
        'AI analysis unavailable - using basic cost breakdown',
        'Consider reviewing high-cost services for optimization opportunities'
      ],
      confidenceScore: 0.3,
      analysisTimestamp: new Date().toISOString(),
      modelUsed: 'fallback'
    };
  }

  /**
   * Estimates processing cost for Bedrock API call
   */
  private estimateProcessingCost(prompt: string, response: string): number {
    // Rough estimation based on token count
    // Titan Text pricing is approximately $0.0008 per 1K input tokens and $0.0016 per 1K output tokens
    const inputTokens = Math.ceil(prompt.length / 4); // Rough token estimation
    const outputTokens = Math.ceil(response.length / 4);
    
    const inputCost = (inputTokens / 1000) * 0.0008;
    const outputCost = (outputTokens / 1000) * 0.0016;
    
    return Math.round((inputCost + outputCost) * 100000) / 100000; // Round to 5 decimal places
  }

  /**
   * Checks rate limiting to prevent excessive API calls
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const timeWindow = 60 * 1000; // 1 minute

    // Reset counter if time window has passed
    if (now - this.lastResetTime > timeWindow) {
      this.requestCount = 0;
      this.lastResetTime = now;
    }

    if (this.requestCount >= this.config.rateLimitPerMinute) {
      const waitTime = timeWindow - (now - this.lastResetTime);
      this.logger.warn(`Rate limit exceeded, waiting ${waitTime}ms`, {
        requestCount: this.requestCount,
        rateLimit: this.config.rateLimitPerMinute
      });
      
      await this.sleep(waitTime);
      this.requestCount = 0;
      this.lastResetTime = Date.now();
    }

    this.requestCount++;
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

        if (!this.isRetryableError(error)) {
          throw lastError;
        }

        const delay = Math.min(
          this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt - 1),
          this.retryConfig.maxDelay
        );

        this.logger.warn(`Bedrock API call failed, retrying in ${delay}ms`, {
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

    const retryableErrorCodes = [
      'ThrottlingException',
      'ServiceUnavailable',
      'InternalServerError',
      'ModelTimeoutException',
      'TooManyRequestsException'
    ];

    if (error.name && retryableErrorCodes.includes(error.name)) {
      return true;
    }

    if (error.$metadata?.httpStatusCode) {
      const statusCode = error.$metadata.httpStatusCode;
      return statusCode >= 500 || statusCode === 429;
    }

    return false;
  }

  /**
   * Sleep utility for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}