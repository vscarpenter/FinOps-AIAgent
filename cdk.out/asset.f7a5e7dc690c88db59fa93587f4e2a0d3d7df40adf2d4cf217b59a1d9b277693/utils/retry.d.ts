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
export declare const DEFAULT_RETRY_CONFIG: RetryConfig;
/**
 * Error types that should be retried
 */
export declare const RETRYABLE_ERROR_CODES: string[];
/**
 * Determines if an error should be retried
 */
export declare function isRetryableError(error: any): boolean;
/**
 * Calculates delay for exponential backoff with optional jitter
 */
export declare function calculateDelay(attempt: number, config: RetryConfig): number;
/**
 * Executes a function with exponential backoff retry logic
 */
export declare function withRetry<T>(operation: () => Promise<T>, config?: Partial<RetryConfig>, operationName?: string): Promise<T>;
/**
 * Circuit breaker states
 */
export declare enum CircuitBreakerState {
    CLOSED = "CLOSED",
    OPEN = "OPEN",
    HALF_OPEN = "HALF_OPEN"
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
export declare const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig;
/**
 * Circuit breaker implementation for external service failures
 */
export declare class CircuitBreaker {
    private name;
    private config;
    private state;
    private failureCount;
    private lastFailureTime;
    private halfOpenCalls;
    private logger;
    constructor(name: string, config?: CircuitBreakerConfig);
    /**
     * Executes operation with circuit breaker protection
     */
    execute<T>(operation: () => Promise<T>): Promise<T>;
    /**
     * Handles successful operation
     */
    private onSuccess;
    /**
     * Handles failed operation
     */
    private onFailure;
    /**
     * Checks if circuit breaker should attempt reset
     */
    private shouldAttemptReset;
    /**
     * Gets current circuit breaker status
     */
    getStatus(): {
        state: CircuitBreakerState;
        failureCount: number;
        lastFailureTime: number;
        halfOpenCalls: number;
    };
    /**
     * Manually resets the circuit breaker
     */
    reset(): void;
}
/**
 * Creates a circuit breaker instance
 */
export declare function createCircuitBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker;
