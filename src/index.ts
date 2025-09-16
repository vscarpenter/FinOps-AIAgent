import { SpendMonitorAgent } from './agent';
import { SpendMonitorConfig, iOSPushConfig, BedrockCostInsightsConfig } from './types';
import { createDefaultConfig } from './validation';

/**
 * AWS Lambda handler for the Spend Monitor Agent
 * 
 * This handler is triggered by EventBridge on a schedule and executes
 * the spend monitoring workflow with multi-channel alerting support.
 */
export const handler = async (event: any, context: any) => {
  const executionId = context.awsRequestId || `local-${Date.now()}`;
  
  console.log(`Spend Monitor Agent execution started: ${executionId}`);
  console.log('Event:', JSON.stringify(event, null, 2));
  console.log('Context:', JSON.stringify({
    functionName: context.functionName,
    functionVersion: context.functionVersion,
    memoryLimitInMB: context.memoryLimitInMB,
    remainingTimeInMillis: context.getRemainingTimeInMillis?.()
  }, null, 2));

  const startTime = Date.now();

  try {
    // Load configuration from environment variables
    const config = loadConfiguration();
    
    console.log('Configuration loaded:', {
      spendThreshold: config.spendThreshold,
      region: config.region,
      checkPeriodDays: config.checkPeriodDays,
      iosEnabled: !!config.iosConfig,
      retryAttempts: config.retryAttempts
    });

    // Initialize and execute the agent
    const agent = new SpendMonitorAgent(config);
    await agent.initialize();
    
    console.log('Agent initialized successfully');
    
    // Perform health check before execution
    const healthCheck = await agent.healthCheck();
    console.log('Health check result:', healthCheck);
    
    if (healthCheck.overall === 'unhealthy') {
      throw new Error(`Agent health check failed: ${healthCheck.errors.join(', ')}`);
    }

    // Execute the monitoring workflow
    await agent.execute();
    
    const executionTime = Date.now() - startTime;
    const agentStatus = agent.getStatus();
    
    console.log(`Spend monitoring completed successfully in ${executionTime}ms`);
    console.log('Agent status:', agentStatus);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Spend monitoring completed successfully',
        executionId,
        executionTime,
        timestamp: new Date().toISOString(),
        agentStatus,
        healthCheck: healthCheck.overall
      })
    };

  } catch (error) {
    const executionTime = Date.now() - startTime;
    
    console.error(`Agent execution failed after ${executionTime}ms:`, error);
    
    // Log additional context for debugging
    if (error instanceof Error) {
      console.error('Error stack:', error.stack);
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        message: 'Spend monitoring failed',
        executionId,
        executionTime,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
        timestamp: new Date().toISOString()
      })
    };
  }
};

/**
 * Loads configuration from environment variables with iOS support
 */
function loadConfiguration(): SpendMonitorConfig {
  try {
    console.log('Loading configuration from environment variables...');

    // Load iOS configuration if provided
    let iosConfig: iOSPushConfig | undefined;
    let bedrockConfig: BedrockCostInsightsConfig | undefined;
    
    if (process.env.IOS_PLATFORM_APP_ARN) {
      console.log('iOS push notifications enabled - loading APNS configuration');
      
      iosConfig = {
        platformApplicationArn: process.env.IOS_PLATFORM_APP_ARN,
        bundleId: process.env.IOS_BUNDLE_ID || 'com.example.spendmonitor',
        sandbox: process.env.APNS_SANDBOX === 'true',
        apnsCertificatePath: process.env.APNS_CERTIFICATE_PATH,
        apnsPrivateKeyPath: process.env.APNS_PRIVATE_KEY_PATH
      };

      console.log('iOS configuration loaded:', {
        platformApplicationArn: iosConfig.platformApplicationArn,
        bundleId: iosConfig.bundleId,
        sandbox: iosConfig.sandbox,
        hasCertificatePath: !!iosConfig.apnsCertificatePath,
        hasPrivateKeyPath: !!iosConfig.apnsPrivateKeyPath
      });
    }

    if (process.env.BEDROCK_MODEL_ID) {
      console.log('Bedrock cost insights enabled - loading configuration');
      bedrockConfig = {
        modelId: process.env.BEDROCK_MODEL_ID,
        region: process.env.BEDROCK_REGION,
        maxOutputTokens: parseOptionalNumber(process.env.BEDROCK_MAX_TOKENS),
        temperature: parseOptionalFloatInRange(process.env.BEDROCK_TEMPERATURE),
        topP: parseOptionalFloatInRange(process.env.BEDROCK_TOP_P)
      };

      console.log('Bedrock configuration loaded:', {
        modelId: bedrockConfig.modelId,
        region: bedrockConfig.region || process.env.AWS_REGION || 'us-east-1',
        maxOutputTokens: bedrockConfig.maxOutputTokens,
        temperature: bedrockConfig.temperature,
        topP: bedrockConfig.topP
      });
    }

    // Create configuration with validation
    const config = createDefaultConfig({
      spendThreshold: parseFloat(process.env.SPEND_THRESHOLD || '10'),
      snsTopicArn: process.env.SNS_TOPIC_ARN || '',
      checkPeriodDays: parseInt(process.env.CHECK_PERIOD_DAYS || '1'),
      region: process.env.AWS_REGION || 'us-east-1',
      retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3'),
      minServiceCostThreshold: parseFloat(process.env.MIN_SERVICE_COST_THRESHOLD || '1'),
      iosConfig,
      bedrockConfig
    });

    console.log('Configuration validation completed');
    return config;

  } catch (error) {
    console.error('Failed to load configuration:', error);
    throw new Error(`Configuration loading failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function parseOptionalNumber(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalFloatInRange(value?: string): number | undefined {
  const parsed = parseOptionalNumber(value);
  if (parsed === undefined) {
    return undefined;
  }

  if (parsed >= 0 && parsed <= 1) {
    return parsed;
  }

  console.warn(`Ignoring Bedrock parameter outside accepted range (0-1): ${value}`);
  return undefined;
}

/**
 * Validates required environment variables
 */
function validateEnvironmentVariables(): void {
  const requiredVars = ['SNS_TOPIC_ARN'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  // Validate iOS-specific variables if iOS is enabled
  if (process.env.IOS_PLATFORM_APP_ARN) {
    const iosRequiredVars = ['IOS_BUNDLE_ID'];
    const missingIosVars = iosRequiredVars.filter(varName => !process.env[varName]);

    if (missingIosVars.length > 0) {
      console.warn(`Missing iOS environment variables (using defaults): ${missingIosVars.join(', ')}`);
    }
  }
}

/**
 * Gets runtime information for debugging
 */
function getRuntimeInfo() {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime(),
    env: {
      AWS_REGION: process.env.AWS_REGION,
      AWS_LAMBDA_FUNCTION_NAME: process.env.AWS_LAMBDA_FUNCTION_NAME,
      AWS_LAMBDA_FUNCTION_VERSION: process.env.AWS_LAMBDA_FUNCTION_VERSION,
      AWS_LAMBDA_FUNCTION_MEMORY_SIZE: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE
    }
  };
}

/**
 * Local testing function
 */
async function runLocalTest() {
  console.log('Running local test...');
  console.log('Runtime info:', getRuntimeInfo());

  try {
    validateEnvironmentVariables();
  } catch (error) {
    console.warn('Environment validation warning:', error);
  }

  const mockEvent = {
    source: 'aws.events',
    'detail-type': 'Scheduled Event',
    detail: {},
    time: new Date().toISOString()
  };

  const mockContext = {
    awsRequestId: `local-test-${Date.now()}`,
    functionName: 'spend-monitor-agent-local',
    functionVersion: '$LATEST',
    memoryLimitInMB: 512,
    getRemainingTimeInMillis: () => 300000 // 5 minutes
  };

  const result = await handler(mockEvent, mockContext);
  console.log('Local test result:', JSON.stringify(result, null, 2));
  
  return result;
}

// For local testing
if (require.main === module) {
  runLocalTest()
    .then(result => {
      console.log('Local test completed successfully');
      process.exit(result.statusCode === 200 ? 0 : 1);
    })
    .catch(error => {
      console.error('Local test failed:', error);
      process.exit(1);
    });
}

// Export additional functions for testing
export {
  loadConfiguration,
  validateEnvironmentVariables,
  getRuntimeInfo,
  runLocalTest
};
