/**
 * Bedrock Configuration Examples
 * 
 * This file provides example configurations for different AWS Bedrock models
 * and use cases for the FinOps AI Agent.
 */

import { BedrockConfig } from '../src/types';

/**
 * Production configuration for Titan Text Express model
 * Balanced performance and cost for regular cost analysis
 */
export const titanTextExpressProduction: BedrockConfig = {
  enabled: true,
  modelId: 'amazon.titan-text-express-v1',
  region: 'us-east-1',
  maxTokens: 1000,
  temperature: 0.3,
  costThreshold: 100, // $100/month limit
  rateLimitPerMinute: 10,
  cacheResults: true,
  cacheTTLMinutes: 60,
  fallbackOnError: true
};

/**
 * Cost-optimized configuration for Titan Text Lite model
 * Lower cost option with reduced capabilities
 */
export const titanTextLiteCostOptimized: BedrockConfig = {
  enabled: true,
  modelId: 'amazon.titan-text-lite-v1',
  region: 'us-east-1',
  maxTokens: 800,
  temperature: 0.2,
  costThreshold: 25, // $25/month limit
  rateLimitPerMinute: 15,
  cacheResults: true,
  cacheTTLMinutes: 30,
  fallbackOnError: true
};

/**
 * High-performance configuration for Claude v2 model
 * Premium option for detailed analysis and insights
 */
export const claudeV2HighPerformance: BedrockConfig = {
  enabled: true,
  modelId: 'anthropic.claude-v2',
  region: 'us-east-1',
  maxTokens: 2000,
  temperature: 0.4,
  costThreshold: 200, // $200/month limit
  rateLimitPerMinute: 5,
  cacheResults: true,
  cacheTTLMinutes: 120,
  fallbackOnError: true
};

/**
 * Development/testing configuration
 * Conservative settings for development environments
 */
export const developmentConfig: BedrockConfig = {
  enabled: true,
  modelId: 'amazon.titan-text-express-v1',
  region: 'us-east-1',
  maxTokens: 500,
  temperature: 0.1,
  costThreshold: 10, // $10/month limit
  rateLimitPerMinute: 5,
  cacheResults: true,
  cacheTTLMinutes: 15,
  fallbackOnError: true
};

/**
 * Disabled configuration
 * Use when AI analysis is not needed
 */
export const disabledConfig: BedrockConfig = {
  enabled: false,
  modelId: 'amazon.titan-text-express-v1',
  region: 'us-east-1',
  maxTokens: 1000,
  temperature: 0.3,
  costThreshold: 50,
  rateLimitPerMinute: 10,
  cacheResults: false,
  cacheTTLMinutes: 60,
  fallbackOnError: true
};

/**
 * High-frequency analysis configuration
 * For environments requiring frequent cost analysis
 */
export const highFrequencyConfig: BedrockConfig = {
  enabled: true,
  modelId: 'amazon.titan-text-lite-v1',
  region: 'us-east-1',
  maxTokens: 600,
  temperature: 0.2,
  costThreshold: 150, // Higher threshold for frequent use
  rateLimitPerMinute: 20,
  cacheResults: true,
  cacheTTLMinutes: 10, // Shorter cache for fresh insights
  fallbackOnError: true
};

/**
 * Multi-region configuration examples
 */
export const multiRegionConfigs = {
  'us-east-1': {
    ...titanTextExpressProduction,
    region: 'us-east-1'
  },
  'us-west-2': {
    ...titanTextExpressProduction,
    region: 'us-west-2'
  },
  'eu-west-1': {
    ...titanTextExpressProduction,
    region: 'eu-west-1'
  },
  'ap-southeast-1': {
    ...titanTextExpressProduction,
    region: 'ap-southeast-1'
  }
};

/**
 * Configuration validation examples
 */
export const validationExamples = {
  valid: titanTextExpressProduction,
  
  invalidModelId: {
    ...titanTextExpressProduction,
    modelId: 'invalid-model-id'
  },
  
  invalidTemperature: {
    ...titanTextExpressProduction,
    temperature: 1.5 // Invalid: > 1.0
  },
  
  invalidMaxTokens: {
    ...titanTextExpressProduction,
    maxTokens: -100 // Invalid: negative
  },
  
  invalidCostThreshold: {
    ...titanTextExpressProduction,
    costThreshold: 0 // Invalid: must be positive
  },
  
  invalidRateLimit: {
    ...titanTextExpressProduction,
    rateLimitPerMinute: 0 // Invalid: must be positive
  }
};

/**
 * Environment-specific configurations
 */
export const environmentConfigs = {
  production: titanTextExpressProduction,
  staging: {
    ...titanTextExpressProduction,
    costThreshold: 50,
    rateLimitPerMinute: 5
  },
  development: developmentConfig,
  testing: {
    ...developmentConfig,
    costThreshold: 5,
    cacheTTLMinutes: 5
  }
};

/**
 * Cost tier configurations based on usage patterns
 */
export const costTierConfigs = {
  basic: {
    ...titanTextLiteCostOptimized,
    costThreshold: 10,
    rateLimitPerMinute: 5
  },
  standard: titanTextExpressProduction,
  premium: claudeV2HighPerformance,
  enterprise: {
    ...claudeV2HighPerformance,
    costThreshold: 500,
    rateLimitPerMinute: 20,
    maxTokens: 3000
  }
};

/**
 * Helper function to create environment variable configuration
 */
export function createEnvironmentConfig(): BedrockConfig {
  return {
    enabled: process.env.BEDROCK_ENABLED === 'true',
    modelId: process.env.BEDROCK_MODEL_ID || 'amazon.titan-text-express-v1',
    region: process.env.BEDROCK_REGION || 'us-east-1',
    maxTokens: parseInt(process.env.BEDROCK_MAX_TOKENS || '1000'),
    temperature: parseFloat(process.env.BEDROCK_TEMPERATURE || '0.3'),
    costThreshold: parseFloat(process.env.BEDROCK_COST_THRESHOLD || '100'),
    rateLimitPerMinute: parseInt(process.env.BEDROCK_RATE_LIMIT_PER_MINUTE || '10'),
    cacheResults: process.env.BEDROCK_CACHE_RESULTS === 'true',
    cacheTTLMinutes: parseInt(process.env.BEDROCK_CACHE_TTL_MINUTES || '60'),
    fallbackOnError: process.env.BEDROCK_FALLBACK_ON_ERROR !== 'false'
  };
}

/**
 * Configuration recommendations based on use case
 */
export const useCaseRecommendations = {
  'small-startup': {
    config: titanTextLiteCostOptimized,
    description: 'Cost-effective option for small teams with basic AI insights'
  },
  'medium-enterprise': {
    config: titanTextExpressProduction,
    description: 'Balanced performance and cost for regular business use'
  },
  'large-enterprise': {
    config: claudeV2HighPerformance,
    description: 'Premium AI analysis for complex cost optimization needs'
  },
  'development-team': {
    config: developmentConfig,
    description: 'Conservative settings for development and testing'
  },
  'high-frequency-monitoring': {
    config: highFrequencyConfig,
    description: 'Optimized for frequent cost analysis with quick cache refresh'
  }
};