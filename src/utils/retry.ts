import { createLogger } from './logger';

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  jitter: true
};

/**
 * Error types that should be retried
 */
export const RETRYABLE_ERROR_CODES = [
  'ThrottlingException',
  'TooManyRequestsException',
  'ServiceUnavailableException',
  'InternalServerErrorException',
  'TimeoutError',
  'NetworkingError',
  'ECONNRESET',
  'ENOTFOUND',
  'ECONNREFUSED',
  'ETIMEDOUT'
];

/**
 * Determines if an error should be retried
 */
export function isRetryableError(error: any): boolean {
  if (!error) return false;

  // Check error code
  if (error.code && RETRYABLE_ERROR_CODES.includes(error.code)) {
    return true;
  }

  // Check error name
  if (error.name && RETRYABLE_ERROR_CODES.includes(error.name)) {
    return true;
  }

  // Check HTTP status codes
  if (error.statusCode) {
    const retryableStatusCodes = [429, 500, 502, 503, 504];
    return retryableStatusCodes.includes(error.statusCode);
  }

  // Check for network errors
  if (error.message) {
    const networkErrorPatterns = [
      /network/i,
      /timeout/i,
      /connection/i,
      /socket/i,
      /dns/i
    ];
    return networkErrorPatterns.some(pattern => pattern.test(error.message));
  }

  return false;
}

/**
 * Calculates delay for exponential backoff with optional jitter
 */
export function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelay);
  
  if (config.jitter) {
    // Add random jitter (±25%)
    const jitterRange = cappedDelay * 0.25;
    const jitter = (Math.random() - 0.5) * 2 * jitterRange;
    return Math.max(0, cappedDelay + jitter);
  }
  
  return cappedDelay;
}

/**
 * Executes a function with exponential backoff retry logic
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  operationName: string = 'operation'
): Promise<T> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  const logger = createLogger('RetryHandler');
  
  let lastError: Error = new Error('Unknown error');
  
  for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
    try {
      logger.debug(`Executing ${operationName}`, { attempt, maxAttempts: finalConfig.maxAttempts });
      
      const result = await operation();
      
      if (attempt > 1) {
        logger.info(`${operationName} succeeded after retry`, { 
          attempt, 
          totalAttempts: attempt 
        });
      }
      
      return result;
      
    } catch (error) {
      lastError = error as Error;
      
      logger.warn(`${operationName} failed on attempt ${attempt}`, {
        attempt,
        maxAttempts: finalConfig.maxAttempts,
        errorName: lastError.name,
        errorMessage: lastError.message,
        isRetryable: isRetryableError(lastError)
      });
      
      // Don't retry if it's the last attempt or error is not retryable
      if (attempt === finalConfig.maxAttempts || !isRetryableError(lastError)) {
        break;
      }
      
      // Calculate and apply delay
      const delay = calculateDelay(attempt, finalConfig);
      logger.debug(`Waiting ${delay}ms before retry`, { attempt, delay });
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  logger.error(`${operationName} failed after all retry attempts`, lastError, {
    totalAttempts: finalConfig.maxAttempts,
    finalError: lastError.message
  });
  
  throw lastError;
}

/**
 * Circuit breaker states
 */
export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringPeriod: number;
  halfOpenMaxCalls: number;
}

/**
 * Default circuit breaker configuration
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryTimeout: 60000, // 1 minute
  monitoringPeriod: 10000, // 10 seconds
  halfOpenMaxCalls: 3
};

/**
 * Circuit breaker implementation for external service failures
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private halfOpenCalls: number = 0;
  private logger = createLogger('CircuitBreaker');

  constructor(
    private name: string,
    private config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG
  ) {}

  /**
   * Executes operation with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitBreakerState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitBreakerState.HALF_OPEN;
        this.halfOpenCalls = 0;
        this.logger.info(`Circuit breaker transitioning to HALF_OPEN`, { 
          name: this.name 
        });
      } else {
        const error = new Error(`Circuit breaker is OPEN for ${this.name}`);
        this.logger.warn('Circuit breaker rejected call', { 
          name: this.name, 
          state: this.state 
        });
        throw error;
      }
    }

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      if (this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
        const error = new Error(`Circuit breaker HALF_OPEN limit exceeded for ${this.name}`);
        this.logger.warn('Circuit breaker half-open limit exceeded', { 
          name: this.name, 
          halfOpenCalls: this.halfOpenCalls 
        });
        throw error;
      }
      this.halfOpenCalls++;
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handles successful operation
   */
  private onSuccess(): void {
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.state = CircuitBreakerState.CLOSED;
      this.logger.info(`Circuit breaker reset to CLOSED`, { 
        name: this.name 
      });
    }
    this.failureCount = 0;
  }

  /**
   * Handles failed operation
   */
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.state = CircuitBreakerState.OPEN;
      this.logger.warn(`Circuit breaker opened from HALF_OPEN`, { 
        name: this.name, 
        failureCount: this.failureCount 
      });
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitBreakerState.OPEN;
      this.logger.warn(`Circuit breaker opened due to failure threshold`, { 
        name: this.name, 
        failureCount: this.failureCount, 
        threshold: this.config.failureThreshold 
      });
    }
  }

  /**
   * Checks if circuit breaker should attempt reset
   */
  private shouldAttemptReset(): boolean {
    return Date.now() - this.lastFailureTime >= this.config.recoveryTimeout;
  }

  /**
   * Gets current circuit breaker status
   */
  getStatus(): {
    state: CircuitBreakerState;
    failureCount: number;
    lastFailureTime: number;
    halfOpenCalls: number;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      halfOpenCalls: this.halfOpenCalls
    };
  }

  /**
   * Manually resets the circuit breaker
   */
  reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.halfOpenCalls = 0;
    this.logger.info(`Circuit breaker manually reset`, { name: this.name });
  }
}

/**
 * Creates a circuit breaker instance
 */
export function createCircuitBreaker(
  name: string, 
  config?: Partial<CircuitBreakerConfig>
): CircuitBreaker {
  const finalConfig = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  return new CircuitBreaker(name, finalConfig);
}