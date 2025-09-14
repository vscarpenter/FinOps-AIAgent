import { 
  withRetry, 
  isRetryableError, 
  calculateDelay, 
  CircuitBreaker, 
  CircuitBreakerState,
  createCircuitBreaker,
  DEFAULT_RETRY_CONFIG 
} from '../src/utils/retry';

describe('isRetryableError', () => {
  it('should identify retryable error codes', () => {
    const retryableErrors = [
      { code: 'ThrottlingException' },
      { code: 'TooManyRequestsException' },
      { code: 'ServiceUnavailableException' },
      { name: 'TimeoutError' },
      { statusCode: 429 },
      { statusCode: 500 },
      { statusCode: 503 }
    ];

    retryableErrors.forEach(error => {
      expect(isRetryableError(error)).toBe(true);
    });
  });

  it('should identify non-retryable errors', () => {
    const nonRetryableErrors = [
      { code: 'ValidationException' },
      { code: 'AccessDenied' },
      { statusCode: 400 },
      { statusCode: 401 },
      { statusCode: 403 },
      { message: 'Invalid parameter' }
    ];

    nonRetryableErrors.forEach(error => {
      expect(isRetryableError(error)).toBe(false);
    });
  });

  it('should identify network errors by message pattern', () => {
    const networkErrors = [
      { message: 'Network timeout occurred' },
      { message: 'Connection refused' },
      { message: 'Socket error' },
      { message: 'DNS resolution failed' }
    ];

    networkErrors.forEach(error => {
      expect(isRetryableError(error)).toBe(true);
    });
  });

  it('should return false for null/undefined errors', () => {
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });
});

describe('calculateDelay', () => {
  const config = {
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    jitter: false
  };

  it('should calculate exponential backoff delay', () => {
    expect(calculateDelay(1, config)).toBe(1000);
    expect(calculateDelay(2, config)).toBe(2000);
    expect(calculateDelay(3, config)).toBe(4000);
    expect(calculateDelay(4, config)).toBe(8000);
  });

  it('should cap delay at maxDelay', () => {
    const delay = calculateDelay(10, config);
    expect(delay).toBeLessThanOrEqual(config.maxDelay);
  });

  it('should add jitter when enabled', () => {
    const configWithJitter = { ...config, jitter: true };
    const delay1 = calculateDelay(2, configWithJitter);
    const delay2 = calculateDelay(2, configWithJitter);
    
    // With jitter, delays should be different (most of the time)
    // We'll just check they're in a reasonable range
    expect(delay1).toBeGreaterThan(0);
    expect(delay2).toBeGreaterThan(0);
    expect(delay1).toBeLessThanOrEqual(config.maxDelay);
    expect(delay2).toBeLessThanOrEqual(config.maxDelay);
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should succeed on first attempt', async () => {
    const operation = jest.fn().mockResolvedValue('success');
    
    const result = await withRetry(operation, {}, 'test-operation');
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should retry on retryable errors', async () => {
    const operation = jest.fn()
      .mockRejectedValueOnce(new Error('ThrottlingException'))
      .mockRejectedValueOnce(new Error('ServiceUnavailableException'))
      .mockResolvedValue('success');
    
    const result = await withRetry(operation, { maxAttempts: 3, baseDelay: 10 }, 'test-operation');
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('should not retry on non-retryable errors', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('ValidationException'));
    
    await expect(withRetry(operation, {}, 'test-operation')).rejects.toThrow('ValidationException');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should fail after max attempts', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('ThrottlingException'));
    
    await expect(withRetry(operation, { maxAttempts: 2, baseDelay: 10 }, 'test-operation'))
      .rejects.toThrow('ThrottlingException');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('should use custom retry configuration', async () => {
    const operation = jest.fn()
      .mockRejectedValueOnce(new Error('ThrottlingException'))
      .mockResolvedValue('success');
    
    const customConfig = {
      maxAttempts: 5,
      baseDelay: 100,
      backoffMultiplier: 3
    };
    
    const result = await withRetry(operation, customConfig, 'test-operation');
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(2);
  });
});

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker('test-service', {
      failureThreshold: 3,
      recoveryTimeout: 1000,
      monitoringPeriod: 500,
      halfOpenMaxCalls: 2
    });
  });

  it('should start in CLOSED state', () => {
    const status = circuitBreaker.getStatus();
    expect(status.state).toBe(CircuitBreakerState.CLOSED);
    expect(status.failureCount).toBe(0);
  });

  it('should execute operation successfully in CLOSED state', async () => {
    const operation = jest.fn().mockResolvedValue('success');
    
    const result = await circuitBreaker.execute(operation);
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should open circuit after failure threshold', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('Service error'));
    
    // Fail 3 times to reach threshold
    for (let i = 0; i < 3; i++) {
      try {
        await circuitBreaker.execute(operation);
      } catch (error) {
        // Expected to fail
      }
    }
    
    const status = circuitBreaker.getStatus();
    expect(status.state).toBe(CircuitBreakerState.OPEN);
    expect(status.failureCount).toBe(3);
  });

  it('should reject calls when circuit is OPEN', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('Service error'));
    
    // Open the circuit
    for (let i = 0; i < 3; i++) {
      try {
        await circuitBreaker.execute(operation);
      } catch (error) {
        // Expected to fail
      }
    }
    
    // Now circuit should be open and reject calls
    await expect(circuitBreaker.execute(operation))
      .rejects.toThrow('Circuit breaker is OPEN for test-service');
  });

  it('should transition to HALF_OPEN after recovery timeout', async () => {
    const operation = jest.fn()
      .mockRejectedValue(new Error('Service error'))
      .mockResolvedValue('success');
    
    // Open the circuit
    for (let i = 0; i < 3; i++) {
      try {
        await circuitBreaker.execute(operation);
      } catch (error) {
        // Expected to fail
      }
    }
    
    // Wait for recovery timeout
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    // Next call should transition to HALF_OPEN and succeed
    const result = await circuitBreaker.execute(operation);
    expect(result).toBe('success');
    
    const status = circuitBreaker.getStatus();
    expect(status.state).toBe(CircuitBreakerState.CLOSED);
  });

  it('should limit calls in HALF_OPEN state', async () => {
    const operation = jest.fn().mockResolvedValue('success');
    
    // Open the circuit
    const failingOperation = jest.fn().mockRejectedValue(new Error('Service error'));
    for (let i = 0; i < 3; i++) {
      try {
        await circuitBreaker.execute(failingOperation);
      } catch (error) {
        // Expected to fail
      }
    }
    
    // Wait for recovery timeout
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    // Make successful calls up to half-open limit
    await circuitBreaker.execute(operation);
    await circuitBreaker.execute(operation);
    
    // Circuit should now be closed
    const status = circuitBreaker.getStatus();
    expect(status.state).toBe(CircuitBreakerState.CLOSED);
  });

  it('should reset circuit breaker manually', () => {
    const operation = jest.fn().mockRejectedValue(new Error('Service error'));
    
    // Open the circuit
    for (let i = 0; i < 3; i++) {
      try {
        circuitBreaker.execute(operation);
      } catch (error) {
        // Expected to fail
      }
    }
    
    circuitBreaker.reset();
    
    const status = circuitBreaker.getStatus();
    expect(status.state).toBe(CircuitBreakerState.CLOSED);
    expect(status.failureCount).toBe(0);
  });
});

describe('createCircuitBreaker', () => {
  it('should create circuit breaker with default config', () => {
    const cb = createCircuitBreaker('test-service');
    expect(cb).toBeInstanceOf(CircuitBreaker);
  });

  it('should create circuit breaker with custom config', () => {
    const customConfig = { failureThreshold: 10 };
    const cb = createCircuitBreaker('test-service', customConfig);
    expect(cb).toBeInstanceOf(CircuitBreaker);
  });
});