import {
  SpendMonitorError,
  ConfigurationError,
  CostExplorerError,
  NotificationError,
  IOSNotificationError,
  TaskExecutionError,
  AgentInitializationError,
  ValidationError,
  ExternalServiceError,
  ErrorHandler,
  errorHandler,
  safeExecute,
  withGracefulDegradation
} from '../src/utils/errors';

describe('SpendMonitorError classes', () => {
  describe('ConfigurationError', () => {
    it('should create configuration error with correct properties', () => {
      const context = { field: 'spendThreshold', value: -1 };
      const error = new ConfigurationError('Invalid threshold value', context);
      
      expect(error.name).toBe('ConfigurationError');
      expect(error.code).toBe('CONFIGURATION_ERROR');
      expect(error.retryable).toBe(false);
      expect(error.message).toBe('Configuration error: Invalid threshold value');
      expect(error.context).toEqual(context);
    });

    it('should serialize to JSON correctly', () => {
      const error = new ConfigurationError('Test error');
      const json = error.toJSON();
      
      expect(json.name).toBe('ConfigurationError');
      expect(json.code).toBe('CONFIGURATION_ERROR');
      expect(json.retryable).toBe(false);
      expect(json.message).toBe('Configuration error: Test error');
    });
  });

  describe('CostExplorerError', () => {
    it('should create retryable cost explorer error by default', () => {
      const error = new CostExplorerError('API rate limit exceeded');
      
      expect(error.code).toBe('COST_EXPLORER_ERROR');
      expect(error.retryable).toBe(true);
      expect(error.message).toBe('Cost Explorer error: API rate limit exceeded');
    });

    it('should create non-retryable cost explorer error when specified', () => {
      const error = new CostExplorerError('Invalid permissions', false);
      
      expect(error.retryable).toBe(false);
    });
  });

  describe('NotificationError', () => {
    it('should create notification error with correct properties', () => {
      const context = { channel: 'email', topicArn: 'arn:aws:sns:us-east-1:123456789012:test' };
      const error = new NotificationError('SNS delivery failed', true, context);
      
      expect(error.code).toBe('NOTIFICATION_ERROR');
      expect(error.retryable).toBe(true);
      expect(error.context).toEqual(context);
    });
  });

  describe('IOSNotificationError', () => {
    it('should create iOS notification error', () => {
      const error = new IOSNotificationError('Invalid device token');
      
      expect(error.code).toBe('IOS_NOTIFICATION_ERROR');
      expect(error.message).toBe('iOS notification error: Invalid device token');
    });
  });

  describe('TaskExecutionError', () => {
    it('should create non-retryable task execution error', () => {
      const error = new TaskExecutionError('Task validation failed');
      
      expect(error.code).toBe('TASK_EXECUTION_ERROR');
      expect(error.retryable).toBe(false);
    });
  });

  describe('AgentInitializationError', () => {
    it('should create non-retryable agent initialization error', () => {
      const error = new AgentInitializationError('Failed to register tools');
      
      expect(error.code).toBe('AGENT_INITIALIZATION_ERROR');
      expect(error.retryable).toBe(false);
    });
  });

  describe('ValidationError', () => {
    it('should create non-retryable validation error', () => {
      const error = new ValidationError('Invalid input format');
      
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.retryable).toBe(false);
    });
  });

  describe('ExternalServiceError', () => {
    it('should create external service error with service name', () => {
      const error = new ExternalServiceError('AWS', 'Service unavailable', true);
      
      expect(error.code).toBe('EXTERNAL_SERVICE_ERROR');
      expect(error.message).toBe('AWS service error: Service unavailable');
      expect(error.retryable).toBe(true);
    });
  });
});

describe('ErrorHandler', () => {
  let handler: ErrorHandler;

  beforeEach(() => {
    handler = new ErrorHandler();
  });

  describe('handleError', () => {
    it('should return SpendMonitorError as-is', () => {
      const originalError = new ConfigurationError('Test error');
      const result = handler.handleError(originalError, 'test-operation');
      
      expect(result).toBe(originalError);
    });

    it('should convert Cost Explorer errors', () => {
      const awsError = {
        name: 'CostExplorerException',
        message: 'Rate limit exceeded',
        code: 'ThrottlingException'
      };
      
      const result = handler.handleError(awsError, 'get-costs');
      
      expect(result).toBeInstanceOf(CostExplorerError);
      expect(result.retryable).toBe(true);
      expect(result.message).toBe('Cost Explorer error: Rate limit exceeded');
    });

    it('should convert SNS errors', () => {
      const awsError = {
        name: 'SNSException',
        message: 'Topic not found',
        code: 'NotFound'
      };
      
      const result = handler.handleError(awsError, 'send-notification');
      
      expect(result).toBeInstanceOf(NotificationError);
      expect(result.retryable).toBe(false);
    });

    it('should convert iOS/APNS errors', () => {
      const iosError = {
        message: 'APNS certificate expired',
        code: 'InvalidParameter'
      };
      
      const result = handler.handleError(iosError, 'send-ios-notification', { channel: 'ios' });
      
      expect(result).toBeInstanceOf(IOSNotificationError);
      expect(result.retryable).toBe(false);
    });

    it('should convert validation errors', () => {
      const validationError = {
        name: 'ValidationError',
        message: 'Invalid parameter format'
      };
      
      const result = handler.handleError(validationError, 'validate-config');
      
      expect(result).toBeInstanceOf(ValidationError);
      expect(result.retryable).toBe(false);
    });

    it('should convert network errors', () => {
      const networkError = {
        code: 'ECONNRESET',
        message: 'Connection reset by peer'
      };
      
      const result = handler.handleError(networkError, 'api-call');
      
      expect(result).toBeInstanceOf(ExternalServiceError);
      expect(result.retryable).toBe(true);
    });

    it('should handle unknown errors', () => {
      const unknownError = {
        message: 'Something went wrong'
      };
      
      const result = handler.handleError(unknownError, 'unknown-operation');
      
      expect(result).toBeInstanceOf(ExternalServiceError);
      expect(result.retryable).toBe(false);
    });

    it('should identify retryable AWS errors', () => {
      const retryableErrors = [
        { code: 'ThrottlingException' },
        { name: 'TooManyRequestsException' },
        { statusCode: 429 },
        { $metadata: { httpStatusCode: 503 } }
      ];

      retryableErrors.forEach(error => {
        const result = handler.handleError(error, 'test-operation');
        expect(result.retryable).toBe(true);
      });
    });

    it('should identify non-retryable AWS errors', () => {
      const nonRetryableErrors = [
        { code: 'ValidationException' },
        { name: 'AccessDenied' },
        { statusCode: 400 },
        { $metadata: { httpStatusCode: 403 } }
      ];

      nonRetryableErrors.forEach(error => {
        const result = handler.handleError(error, 'test-operation');
        expect(result.retryable).toBe(false);
      });
    });
  });

  describe('createConfigurationError', () => {
    it('should create configuration error with field details', () => {
      const error = handler.createConfigurationError('spendThreshold', -1, 'must be positive');
      
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(error.message).toBe('Configuration error: Invalid spendThreshold: must be positive');
      expect(error.context).toEqual({
        field: 'spendThreshold',
        value: -1,
        requirement: 'must be positive'
      });
    });
  });

  describe('createMissingConfigError', () => {
    it('should create missing configuration error', () => {
      const error = handler.createMissingConfigError('snsTopicArn');
      
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(error.message).toBe('Configuration error: Missing required configuration: snsTopicArn');
      expect(error.context).toEqual({
        field: 'snsTopicArn',
        required: true
      });
    });
  });
});

describe('safeExecute', () => {
  it('should execute operation successfully', async () => {
    const operation = jest.fn().mockResolvedValue('success');
    
    const result = await safeExecute(operation, 'test-operation');
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should convert errors to SpendMonitorError', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('Generic error'));
    
    await expect(safeExecute(operation, 'test-operation'))
      .rejects.toBeInstanceOf(ExternalServiceError);
  });

  it('should preserve SpendMonitorError', async () => {
    const originalError = new ConfigurationError('Config error');
    const operation = jest.fn().mockRejectedValue(originalError);
    
    await expect(safeExecute(operation, 'test-operation'))
      .rejects.toBe(originalError);
  });
});

describe('withGracefulDegradation', () => {
  it('should execute primary operation successfully', async () => {
    const primaryOp = jest.fn().mockResolvedValue('primary-success');
    const fallbackOp = jest.fn().mockResolvedValue('fallback-success');
    
    const result = await withGracefulDegradation(primaryOp, fallbackOp, 'test-operation');
    
    expect(result).toBe('primary-success');
    expect(primaryOp).toHaveBeenCalledTimes(1);
    expect(fallbackOp).not.toHaveBeenCalled();
  });

  it('should execute fallback on retryable error', async () => {
    const retryableError = new CostExplorerError('Rate limit exceeded', true);
    const primaryOp = jest.fn().mockRejectedValue(retryableError);
    const fallbackOp = jest.fn().mockResolvedValue('fallback-success');
    
    const result = await withGracefulDegradation(primaryOp, fallbackOp, 'test-operation');
    
    expect(result).toBe('fallback-success');
    expect(primaryOp).toHaveBeenCalledTimes(1);
    expect(fallbackOp).toHaveBeenCalledTimes(1);
  });

  it('should throw error on non-retryable error', async () => {
    const nonRetryableError = new ConfigurationError('Invalid config');
    const primaryOp = jest.fn().mockRejectedValue(nonRetryableError);
    const fallbackOp = jest.fn().mockResolvedValue('fallback-success');
    
    await expect(withGracefulDegradation(primaryOp, fallbackOp, 'test-operation'))
      .rejects.toBe(nonRetryableError);
    
    expect(primaryOp).toHaveBeenCalledTimes(1);
    expect(fallbackOp).not.toHaveBeenCalled();
  });

  it('should convert and handle generic errors', async () => {
    const genericError = new Error('Network timeout');
    const primaryOp = jest.fn().mockRejectedValue(genericError);
    const fallbackOp = jest.fn().mockResolvedValue('fallback-success');
    
    const result = await withGracefulDegradation(primaryOp, fallbackOp, 'test-operation');
    
    expect(result).toBe('fallback-success');
    expect(primaryOp).toHaveBeenCalledTimes(1);
    expect(fallbackOp).toHaveBeenCalledTimes(1);
  });
});

describe('global errorHandler', () => {
  it('should be an instance of ErrorHandler', () => {
    expect(errorHandler).toBeInstanceOf(ErrorHandler);
  });
});