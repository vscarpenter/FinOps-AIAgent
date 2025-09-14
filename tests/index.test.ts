import { handler, loadConfiguration, validateEnvironmentVariables, getRuntimeInfo } from '../src/index';
import { SpendMonitorAgent } from '../src/agent';
import { ValidationError } from '../src/validation';

// Mock the agent and validation
jest.mock('../src/agent');
jest.mock('../src/validation');

const mockCreateDefaultConfig = require('../src/validation').createDefaultConfig;

describe('Lambda Handler', () => {
  let mockAgent: jest.Mocked<SpendMonitorAgent>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Save original environment
    originalEnv = { ...process.env };

    // Set up default environment variables
    process.env.SNS_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:spend-alerts';
    process.env.SPEND_THRESHOLD = '10';
    process.env.AWS_REGION = 'us-east-1';
    process.env.CHECK_PERIOD_DAYS = '1';
    process.env.RETRY_ATTEMPTS = '3';
    process.env.MIN_SERVICE_COST_THRESHOLD = '1';

    // Mock agent
    mockAgent = {
      initialize: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn().mockResolvedValue(undefined),
      healthCheck: jest.fn().mockResolvedValue({
        overall: 'healthy',
        components: {
          costAnalysis: 'healthy',
          alerts: 'healthy',
          tasks: 'healthy'
        },
        errors: []
      }),
      getStatus: jest.fn().mockReturnValue({
        initialized: true,
        toolsRegistered: 2,
        tasksRegistered: 1,
        iosEnabled: false
      })
    } as any;

    (SpendMonitorAgent as jest.Mock).mockImplementation(() => mockAgent);

    // Mock validation
    mockCreateDefaultConfig.mockImplementation((config: any) => config);
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('handler', () => {
    const mockEvent = {
      source: 'aws.events',
      'detail-type': 'Scheduled Event',
      detail: {}
    };

    const mockContext = {
      awsRequestId: 'test-request-id',
      functionName: 'spend-monitor-agent',
      functionVersion: '$LATEST',
      memoryLimitInMB: 512,
      getRemainingTimeInMillis: () => 300000
    };

    it('should execute successfully with valid configuration', async () => {
      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({
        success: true,
        message: 'Spend monitoring completed successfully',
        executionId: 'test-request-id',
        executionTime: expect.any(Number),
        timestamp: expect.any(String),
        agentStatus: expect.any(Object),
        healthCheck: 'healthy'
      });

      expect(SpendMonitorAgent).toHaveBeenCalledWith(expect.objectContaining({
        spendThreshold: 10,
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-alerts',
        region: 'us-east-1'
      }));

      expect(mockAgent.initialize).toHaveBeenCalled();
      expect(mockAgent.healthCheck).toHaveBeenCalled();
      expect(mockAgent.execute).toHaveBeenCalled();
    });

    it('should execute successfully with iOS configuration', async () => {
      process.env.IOS_PLATFORM_APP_ARN = 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp';
      process.env.IOS_BUNDLE_ID = 'com.example.spendmonitor';
      process.env.APNS_SANDBOX = 'true';

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(200);
      expect(mockCreateDefaultConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          iosConfig: {
            platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp',
            bundleId: 'com.example.spendmonitor',
            sandbox: true,
            apnsCertificatePath: undefined,
            apnsPrivateKeyPath: undefined
          }
        })
      );
    });

    it('should handle agent initialization failure', async () => {
      mockAgent.initialize.mockRejectedValue(new Error('Initialization failed'));

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toEqual({
        success: false,
        message: 'Spend monitoring failed',
        executionId: 'test-request-id',
        executionTime: expect.any(Number),
        error: 'Initialization failed',
        errorType: 'Error',
        timestamp: expect.any(String)
      });
    });

    it('should handle agent execution failure', async () => {
      mockAgent.execute.mockRejectedValue(new Error('Execution failed'));

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toBe('Execution failed');
    });

    it('should handle health check failure', async () => {
      mockAgent.healthCheck.mockResolvedValue({
        overall: 'unhealthy',
        components: {
          costAnalysis: 'unhealthy',
          alerts: 'healthy',
          tasks: 'healthy'
        },
        errors: ['Cost Analysis Tool not initialized']
      });

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toContain('Agent health check failed');
    });

    it('should handle configuration loading failure', async () => {
      mockCreateDefaultConfig.mockImplementation(() => {
        throw new ValidationError('Invalid configuration');
      });

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toContain('Configuration loading failed');
    });

    it('should handle missing context gracefully', async () => {
      const contextWithoutRequestId = {
        functionName: 'spend-monitor-agent',
        functionVersion: '$LATEST',
        memoryLimitInMB: 512
      };

      const result = await handler(mockEvent, contextWithoutRequestId);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.executionId).toMatch(/^local-\d+$/);
    });

    it('should include execution time in response', async () => {
      const result = await handler(mockEvent, mockContext);

      const body = JSON.parse(result.body);
      expect(body.executionTime).toBeGreaterThan(0);
      expect(typeof body.executionTime).toBe('number');
    });

    it('should handle non-Error exceptions', async () => {
      mockAgent.execute.mockRejectedValue('String error');

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Unknown error');
      expect(body.errorType).toBe('UnknownError');
    });
  });

  describe('loadConfiguration', () => {
    it('should load basic configuration from environment variables', () => {
      const config = loadConfiguration();

      expect(config).toEqual({
        spendThreshold: 10,
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-alerts',
        checkPeriodDays: 1,
        region: 'us-east-1',
        retryAttempts: 3,
        minServiceCostThreshold: 1,
        iosConfig: undefined
      });
    });

    it('should load iOS configuration when provided', () => {
      process.env.IOS_PLATFORM_APP_ARN = 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp';
      process.env.IOS_BUNDLE_ID = 'com.example.spendmonitor';
      process.env.APNS_SANDBOX = 'true';
      process.env.APNS_CERTIFICATE_PATH = '/path/to/cert.pem';
      process.env.APNS_PRIVATE_KEY_PATH = '/path/to/key.pem';

      const config = loadConfiguration();

      expect(config.iosConfig).toEqual({
        platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp',
        bundleId: 'com.example.spendmonitor',
        sandbox: true,
        apnsCertificatePath: '/path/to/cert.pem',
        apnsPrivateKeyPath: '/path/to/key.pem'
      });
    });

    it('should use default values for missing environment variables', () => {
      delete process.env.SPEND_THRESHOLD;
      delete process.env.CHECK_PERIOD_DAYS;
      delete process.env.AWS_REGION;
      delete process.env.RETRY_ATTEMPTS;
      delete process.env.MIN_SERVICE_COST_THRESHOLD;

      const config = loadConfiguration();

      expect(config.spendThreshold).toBe(10);
      expect(config.checkPeriodDays).toBe(1);
      expect(config.region).toBe('us-east-1');
      expect(config.retryAttempts).toBe(3);
      expect(config.minServiceCostThreshold).toBe(1);
    });

    it('should use default iOS bundle ID when not provided', () => {
      process.env.IOS_PLATFORM_APP_ARN = 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp';
      delete process.env.IOS_BUNDLE_ID;

      const config = loadConfiguration();

      expect(config.iosConfig?.bundleId).toBe('com.example.spendmonitor');
    });

    it('should handle APNS_SANDBOX as false when not "true"', () => {
      process.env.IOS_PLATFORM_APP_ARN = 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp';
      process.env.APNS_SANDBOX = 'false';

      const config = loadConfiguration();

      expect(config.iosConfig?.sandbox).toBe(false);
    });

    it('should throw error when validation fails', () => {
      mockCreateDefaultConfig.mockImplementation(() => {
        throw new ValidationError('Invalid SNS topic ARN');
      });

      expect(() => loadConfiguration()).toThrow('Configuration loading failed: Invalid SNS topic ARN');
    });

    it('should parse numeric environment variables correctly', () => {
      process.env.SPEND_THRESHOLD = '25.50';
      process.env.CHECK_PERIOD_DAYS = '7';
      process.env.RETRY_ATTEMPTS = '5';
      process.env.MIN_SERVICE_COST_THRESHOLD = '2.5';

      const config = loadConfiguration();

      expect(config.spendThreshold).toBe(25.50);
      expect(config.checkPeriodDays).toBe(7);
      expect(config.retryAttempts).toBe(5);
      expect(config.minServiceCostThreshold).toBe(2.5);
    });
  });

  describe('validateEnvironmentVariables', () => {
    it('should pass validation with required variables', () => {
      expect(() => validateEnvironmentVariables()).not.toThrow();
    });

    it('should throw error for missing SNS_TOPIC_ARN', () => {
      delete process.env.SNS_TOPIC_ARN;

      expect(() => validateEnvironmentVariables()).toThrow('Missing required environment variables: SNS_TOPIC_ARN');
    });

    it('should warn about missing iOS variables when iOS is enabled', () => {
      process.env.IOS_PLATFORM_APP_ARN = 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp';
      delete process.env.IOS_BUNDLE_ID;

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      validateEnvironmentVariables();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Missing iOS environment variables')
      );

      consoleSpy.mockRestore();
    });

    it('should not warn about iOS variables when iOS is not enabled', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      validateEnvironmentVariables();

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('getRuntimeInfo', () => {
    it('should return runtime information', () => {
      const info = getRuntimeInfo();

      expect(info).toEqual({
        nodeVersion: expect.any(String),
        platform: expect.any(String),
        arch: expect.any(String),
        memoryUsage: expect.any(Object),
        uptime: expect.any(Number),
        env: {
          AWS_REGION: process.env.AWS_REGION,
          AWS_LAMBDA_FUNCTION_NAME: process.env.AWS_LAMBDA_FUNCTION_NAME,
          AWS_LAMBDA_FUNCTION_VERSION: process.env.AWS_LAMBDA_FUNCTION_VERSION,
          AWS_LAMBDA_FUNCTION_MEMORY_SIZE: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE
        }
      });
    });

    it('should include memory usage details', () => {
      const info = getRuntimeInfo();

      expect(info.memoryUsage).toHaveProperty('rss');
      expect(info.memoryUsage).toHaveProperty('heapTotal');
      expect(info.memoryUsage).toHaveProperty('heapUsed');
      expect(info.memoryUsage).toHaveProperty('external');
    });
  });

  describe('error handling', () => {
    const mockEvent = { source: 'aws.events' };
    const mockContext = { awsRequestId: 'test-id' };

    it('should handle agent creation failure', async () => {
      (SpendMonitorAgent as jest.Mock).mockImplementation(() => {
        throw new Error('Agent creation failed');
      });

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toBe('Agent creation failed');
    });

    it('should handle health check exception', async () => {
      mockAgent.healthCheck.mockRejectedValue(new Error('Health check failed'));

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toBe('Health check failed');
    });

    it('should include error stack in logs for debugging', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:1:1';

      mockAgent.execute.mockRejectedValue(error);

      await handler(mockEvent, mockContext);

      expect(consoleSpy).toHaveBeenCalledWith('Error stack:', error.stack);

      consoleSpy.mockRestore();
    });
  });

  describe('logging', () => {
    const mockEvent = { source: 'aws.events', detail: { test: 'data' } };
    const mockContext = {
      awsRequestId: 'test-id',
      functionName: 'test-function',
      functionVersion: '1',
      memoryLimitInMB: 256,
      getRemainingTimeInMillis: () => 30000
    };

    it('should log execution details', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await handler(mockEvent, mockContext);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Spend Monitor Agent execution started: test-id')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        'Event:', JSON.stringify(mockEvent, null, 2)
      );

      consoleSpy.mockRestore();
    });

    it('should log configuration details', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await handler(mockEvent, mockContext);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Configuration loaded:', expect.objectContaining({
          spendThreshold: 10,
          region: 'us-east-1',
          iosEnabled: false
        })
      );

      consoleSpy.mockRestore();
    });

    it('should log iOS configuration when enabled', async () => {
      process.env.IOS_PLATFORM_APP_ARN = 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp';
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await handler(mockEvent, mockContext);

      expect(consoleSpy).toHaveBeenCalledWith(
        'iOS push notifications enabled - loading APNS configuration'
      );

      consoleSpy.mockRestore();
    });
  });
});