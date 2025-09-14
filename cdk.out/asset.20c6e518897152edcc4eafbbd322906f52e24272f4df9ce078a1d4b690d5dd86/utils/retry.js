"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CircuitBreaker = exports.DEFAULT_CIRCUIT_BREAKER_CONFIG = exports.CircuitBreakerState = exports.RETRYABLE_ERROR_CODES = exports.DEFAULT_RETRY_CONFIG = void 0;
exports.isRetryableError = isRetryableError;
exports.calculateDelay = calculateDelay;
exports.withRetry = withRetry;
exports.createCircuitBreaker = createCircuitBreaker;
const logger_1 = require("./logger");
/**
 * Default retry configuration
 */
exports.DEFAULT_RETRY_CONFIG = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    jitter: true
};
/**
 * Error types that should be retried
 */
exports.RETRYABLE_ERROR_CODES = [
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
function isRetryableError(error) {
    if (!error)
        return false;
    // Check error code
    if (error.code && exports.RETRYABLE_ERROR_CODES.includes(error.code)) {
        return true;
    }
    // Check error name
    if (error.name && exports.RETRYABLE_ERROR_CODES.includes(error.name)) {
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
function calculateDelay(attempt, config) {
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
async function withRetry(operation, config = {}, operationName = 'operation') {
    const finalConfig = { ...exports.DEFAULT_RETRY_CONFIG, ...config };
    const logger = (0, logger_1.createLogger)('RetryHandler');
    let lastError = new Error('Unknown error');
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
        }
        catch (error) {
            lastError = error;
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
var CircuitBreakerState;
(function (CircuitBreakerState) {
    CircuitBreakerState["CLOSED"] = "CLOSED";
    CircuitBreakerState["OPEN"] = "OPEN";
    CircuitBreakerState["HALF_OPEN"] = "HALF_OPEN";
})(CircuitBreakerState || (exports.CircuitBreakerState = CircuitBreakerState = {}));
/**
 * Default circuit breaker configuration
 */
exports.DEFAULT_CIRCUIT_BREAKER_CONFIG = {
    failureThreshold: 5,
    recoveryTimeout: 60000, // 1 minute
    monitoringPeriod: 10000, // 10 seconds
    halfOpenMaxCalls: 3
};
/**
 * Circuit breaker implementation for external service failures
 */
class CircuitBreaker {
    constructor(name, config = exports.DEFAULT_CIRCUIT_BREAKER_CONFIG) {
        this.name = name;
        this.config = config;
        this.state = CircuitBreakerState.CLOSED;
        this.failureCount = 0;
        this.lastFailureTime = 0;
        this.halfOpenCalls = 0;
        this.logger = (0, logger_1.createLogger)('CircuitBreaker');
    }
    /**
     * Executes operation with circuit breaker protection
     */
    async execute(operation) {
        if (this.state === CircuitBreakerState.OPEN) {
            if (this.shouldAttemptReset()) {
                this.state = CircuitBreakerState.HALF_OPEN;
                this.halfOpenCalls = 0;
                this.logger.info(`Circuit breaker transitioning to HALF_OPEN`, {
                    name: this.name
                });
            }
            else {
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
        }
        catch (error) {
            this.onFailure();
            throw error;
        }
    }
    /**
     * Handles successful operation
     */
    onSuccess() {
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
    onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.state === CircuitBreakerState.HALF_OPEN) {
            this.state = CircuitBreakerState.OPEN;
            this.logger.warn(`Circuit breaker opened from HALF_OPEN`, {
                name: this.name,
                failureCount: this.failureCount
            });
        }
        else if (this.failureCount >= this.config.failureThreshold) {
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
    shouldAttemptReset() {
        return Date.now() - this.lastFailureTime >= this.config.recoveryTimeout;
    }
    /**
     * Gets current circuit breaker status
     */
    getStatus() {
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
    reset() {
        this.state = CircuitBreakerState.CLOSED;
        this.failureCount = 0;
        this.lastFailureTime = 0;
        this.halfOpenCalls = 0;
        this.logger.info(`Circuit breaker manually reset`, { name: this.name });
    }
}
exports.CircuitBreaker = CircuitBreaker;
/**
 * Creates a circuit breaker instance
 */
function createCircuitBreaker(name, config) {
    const finalConfig = { ...exports.DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
    return new CircuitBreaker(name, finalConfig);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmV0cnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvdXRpbHMvcmV0cnkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBMkNBLDRDQWdDQztBQUtELHdDQVlDO0FBS0QsOEJBdURDO0FBb0tELG9EQU1DO0FBbFVELHFDQUF3QztBQWF4Qzs7R0FFRztBQUNVLFFBQUEsb0JBQW9CLEdBQWdCO0lBQy9DLFdBQVcsRUFBRSxDQUFDO0lBQ2QsU0FBUyxFQUFFLElBQUk7SUFDZixRQUFRLEVBQUUsS0FBSztJQUNmLGlCQUFpQixFQUFFLENBQUM7SUFDcEIsTUFBTSxFQUFFLElBQUk7Q0FDYixDQUFDO0FBRUY7O0dBRUc7QUFDVSxRQUFBLHFCQUFxQixHQUFHO0lBQ25DLHFCQUFxQjtJQUNyQiwwQkFBMEI7SUFDMUIsNkJBQTZCO0lBQzdCLDhCQUE4QjtJQUM5QixjQUFjO0lBQ2QsaUJBQWlCO0lBQ2pCLFlBQVk7SUFDWixXQUFXO0lBQ1gsY0FBYztJQUNkLFdBQVc7Q0FDWixDQUFDO0FBRUY7O0dBRUc7QUFDSCxTQUFnQixnQkFBZ0IsQ0FBQyxLQUFVO0lBQ3pDLElBQUksQ0FBQyxLQUFLO1FBQUUsT0FBTyxLQUFLLENBQUM7SUFFekIsbUJBQW1CO0lBQ25CLElBQUksS0FBSyxDQUFDLElBQUksSUFBSSw2QkFBcUIsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7UUFDN0QsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQsbUJBQW1CO0lBQ25CLElBQUksS0FBSyxDQUFDLElBQUksSUFBSSw2QkFBcUIsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7UUFDN0QsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQsMEJBQTBCO0lBQzFCLElBQUksS0FBSyxDQUFDLFVBQVUsRUFBRSxDQUFDO1FBQ3JCLE1BQU0sb0JBQW9CLEdBQUcsQ0FBQyxHQUFHLEVBQUUs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QUVHO0lBQ0gsS0FBSztRQUNILElBQUksQ0FBQyxLQUFLLEdBQUcsbUJBQW1CLENBQUMsTUFBTSxDQUFDO1FBQ3hDLElBQUksQ0FBQyxZQUFZLEdBQUcsQ0FBQyxDQUFDO1FBQ3RCLElBQUksQ0FBQyxlQUFlLEdBQUcsQ0FBQyxDQUFDO1FBQ3pCLElBQUksQ0FBQyxhQUFhLEdBQUcsQ0FBQyxDQUFDO1FBQ3ZCLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGdDQUFnQyxFQUFFLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO0lBQzFFLENBQUM7Q0FDRjtBQTdIRCx3Q0E2SEM7QUFFRDs7R0FFRztBQUNILFNBQWdCLG9CQUFvQixDQUNsQyxJQUFZLEVBQ1osTUFBc0M7SUFFdEMsTUFBTSxXQUFXLEdBQUcsRUFBRSxHQUFHLHNDQUE4QixFQUFFLEdBQUcsTUFBTSxFQUFFLENBQUM7SUFDckUsT0FBTyxJQUFJLGNBQWMsQ0FBQyxJQUFJLEVBQUUsV0FBVyxDQUFDLENBQUM7QUFDL0MsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4vbG9nZ2VyJztcblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciByZXRyeSBiZWhhdmlvclxuICovXG5leHBvcnQgaW50ZXJmYWNlIFJldHJ5Q29uZmlnIHtcbiAgbWF4QXR0ZW1wdHM6IG51bWJlcjtcbiAgYmFzZURlbGF5OiBudW1iZXI7XG4gIG1heERlbGF5OiBudW1iZXI7XG4gIGJhY2tvZmZNdWx0aXBsaWVyOiBudW1iZXI7XG4gIGppdHRlcjogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBEZWZhdWx0IHJldHJ5IGNvbmZpZ3VyYXRpb25cbiAqL1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfUkVUUllfQ09ORklHOiBSZXRyeUNvbmZpZyA9IHtcbiAgbWF4QXR0ZW1wdHM6IDMsXG4gIGJhc2VEZWxheTogMTAwMCxcbiAgbWF4RGVsYXk6IDMwMDAwLFxuICBiYWNrb2ZmTXVsdGlwbGllcjogMixcbiAgaml0dGVyOiB0cnVlXG59O1xuXG4vKipcbiAqIEVycm9yIHR5cGVzIHRoYXQgc2hvdWxkIGJlIHJldHJpZWRcbiAqL1xuZXhwb3J0IGNvbnN0IFJFVFJZQUJMRV9FUlJPUl9DT0RFUyA9IFtcbiAgJ1Rocm90dGxpbmdFeGNlcHRpb24nLFxuICAnVG9vTWFueVJlcXVlc3RzRXhjZXB0aW9uJyxcbiAgJ1NlcnZpY2VVbmF2YWlsYWJsZUV4Y2VwdGlvbicsXG4gICdJbnRlcm5hbFNlcnZlckVycm9yRXhjZXB0aW9uJyxcbiAgJ1RpbWVvdXRFcnJvcicsXG4gICdOZXR3b3JraW5nRXJyb3InLFxuICAnRUNPTk5SRVNFVCcsXG4gICdFTk9URk9VTkQnLFxuICAnRUNPTk5SRUZVU0VEJyxcbiAgJ0VUSU1FRE9VVCdcbl07XG5cbi8qKlxuICogRGV0ZXJtaW5lcyBpZiBhbiBlcnJvciBzaG91bGQgYmUgcmV0cmllZFxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNSZXRyeWFibGVFcnJvcihlcnJvcjogYW55KTogYm9vbGVhbiB7XG4gIGlmICghZXJyb3IpIHJldHVybiBmYWxzZTtcblxuICAvLyBDaGVjayBlcnJvciBjb2RlXG4gIGlmIChlcnJvci5jb2RlICYmIFJFVFJZQUJMRV9FUlJPUl9DT0RFUy5pbmNsdWRlcyhlcnJvci5jb2RlKSkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLy8gQ2hlY2sgZXJyb3IgbmFtZVxuICBpZiAoZXJyb3IubmFtZSAmJiBSRVRSWUFCTEVfRVJST1JfQ09ERVMuaW5jbHVkZXMoZXJyb3IubmFtZSkpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8vIENoZWNrIEhUVFAgc3RhdHVzIGNvZGVzXG4gIGlmIChlcnJvci5zdGF0dXNDb2RlKSB7XG4gICAgY29uc3QgcmV0cnlhYmxlU3RhdHVzQ29kZXMgPSBbNDI5LCA1MDAsIDUwMiwgNTAzLCA1MDRdO1xuICAgIHJldHVybiByZXRyeWFibGVTdGF0dXNDb2Rlcy5pbmNsdWRlcyhlcnJvci5zdGF0dXNDb2RlKTtcbiAgfVxuXG4gIC8vIENoZWNrIGZvciBuZXR3b3JrIGVycm9yc1xuICBpZiAoZXJyb3IubWVzc2FnZSkge1xuICAgIGNvbnN0IG5ldHdvcmtFcnJvclBhdHRlcm5zID0gW1xuICAgICAgL25ldHdvcmsvaSxcbiAgICAgIC90aW1lb3V0L2ksXG4gICAgICAvY29ubmVjdGlvbi9pLFxuICAgICAgL3NvY2tldC9pLFxuICAgICAgL2Rucy9pXG4gICAgXTtcbiAgICByZXR1cm4gbmV0d29ya0Vycm9yUGF0dGVybnMuc29tZShwYXR0ZXJuID0+IHBhdHRlcm4udGVzdChlcnJvci5tZXNzYWdlKSk7XG4gIH1cblxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogQ2FsY3VsYXRlcyBkZWxheSBmb3IgZXhwb25lbnRpYWwgYmFja29mZiB3aXRoIG9wdGlvbmFsIGppdHRlclxuICovXG5leHBvcnQgZnVuY3Rpb24gY2FsY3VsYXRlRGVsYXkoYXR0ZW1wdDogbnVtYmVyLCBjb25maWc6IFJldHJ5Q29uZmlnKTogbnVtYmVyIHtcbiAgY29uc3QgZXhwb25lbnRpYWxEZWxheSA9IGNvbmZpZy5iYXNlRGVsYXkgKiBNYXRoLnBvdyhjb25maWcuYmFja29mZk11bHRpcGxpZXIsIGF0dGVtcHQgLSAxKTtcbiAgY29uc3QgY2FwcGVkRGVsYXkgPSBNYXRoLm1pbihleHBvbmVudGlhbERlbGF5LCBjb25maWcubWF4RGVsYXkpO1xuICBcbiAgaWYgKGNvbmZpZy5qaXR0ZXIpIHtcbiAgICAvLyBBZGQgcmFuZG9tIGppdHRlciAowrEyNSUpXG4gICAgY29uc3Qgaml0dGVyUmFuZ2UgPSBjYXBwZWREZWxheSAqIDAuMjU7XG4gICAgY29uc3Qgaml0dGVyID0gKE1hdGgucmFuZG9tKCkgLSAwLjUpICogMiAqIGppdHRlclJhbmdlO1xuICAgIHJldHVybiBNYXRoLm1heCgwLCBjYXBwZWREZWxheSArIGppdHRlcik7XG4gIH1cbiAgXG4gIHJldHVybiBjYXBwZWREZWxheTtcbn1cblxuLyoqXG4gKiBFeGVjdXRlcyBhIGZ1bmN0aW9uIHdpdGggZXhwb25lbnRpYWwgYmFja29mZiByZXRyeSBsb2dpY1xuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd2l0aFJldHJ5PFQ+KFxuICBvcGVyYXRpb246ICgpID0+IFByb21pc2U8VD4sXG4gIGNvbmZpZzogUGFydGlhbDxSZXRyeUNvbmZpZz4gPSB7fSxcbiAgb3BlcmF0aW9uTmFtZTogc3RyaW5nID0gJ29wZXJhdGlvbidcbik6IFByb21pc2U8VD4ge1xuICBjb25zdCBmaW5hbENvbmZpZyA9IHsgLi4uREVGQVVMVF9SRVRSWV9DT05GSUcsIC4uLmNvbmZpZyB9O1xuICBjb25zdCBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ1JldHJ5SGFuZGxlcicpO1xuICBcbiAgbGV0IGxhc3RFcnJvcjogRXJyb3IgPSBuZXcgRXJyb3IoJ1Vua25vd24gZXJyb3InKTtcbiAgXG4gIGZvciAobGV0IGF0dGVtcHQgPSAxOyBhdHRlbXB0IDw9IGZpbmFsQ29uZmlnLm1heEF0dGVtcHRzOyBhdHRlbXB0KyspIHtcbiAgICB0cnkge1xuICAgICAgbG9nZ2VyLmRlYnVnKGBFeGVjdXRpbmcgJHtvcGVyYXRpb25OYW1lfWAsIHsgYXR0ZW1wdCwgbWF4QXR0ZW1wdHM6IGZpbmFsQ29uZmlnLm1heEF0dGVtcHRzIH0pO1xuICAgICAgXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBvcGVyYXRpb24oKTtcbiAgICAgIFxuICAgICAgaWYgKGF0dGVtcHQgPiAxKSB7XG4gICAgICAgIGxvZ2dlci5pbmZvKGAke29wZXJhdGlvbk5hbWV9IHN1Y2NlZWRlZCBhZnRlciByZXRyeWAsIHsgXG4gICAgICAgICAgYXR0ZW1wdCwgXG4gICAgICAgICAgdG90YWxBdHRlbXB0czogYXR0ZW1wdCBcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBcbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICBcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbGFzdEVycm9yID0gZXJyb3IgYXMgRXJyb3I7XG4gICAgICBcbiAgICAgIGxvZ2dlci53YXJuKGAke29wZXJhdGlvbk5hbWV9IGZhaWxlZCBvbiBhdHRlbXB0ICR7YXR0ZW1wdH1gLCB7XG4gICAgICAgIGF0dGVtcHQsXG4gICAgICAgIG1heEF0dGVtcHRzOiBmaW5hbENvbmZpZy5tYXhBdHRlbXB0cyxcbiAgICAgICAgZXJyb3JOYW1lOiBsYXN0RXJyb3IubmFtZSxcbiAgICAgICAgZXJyb3JNZXNzYWdlOiBsYXN0RXJyb3IubWVzc2FnZSxcbiAgICAgICAgaXNSZXRyeWFibGU6IGlzUmV0cnlhYmxlRXJyb3IobGFzdEVycm9yKVxuICAgICAgfSk7XG4gICAgICBcbiAgICAgIC8vIERvbid0IHJldHJ5IGlmIGl0J3MgdGhlIGxhc3QgYXR0ZW1wdCBvciBlcnJvciBpcyBub3QgcmV0cnlhYmxlXG4gICAgICBpZiAoYXR0ZW1wdCA9PT0gZmluYWxDb25maWcubWF4QXR0ZW1wdHMgfHwgIWlzUmV0cnlhYmxlRXJyb3IobGFzdEVycm9yKSkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gQ2FsY3VsYXRlIGFuZCBhcHBseSBkZWxheVxuICAgICAgY29uc3QgZGVsYXkgPSBjYWxjdWxhdGVEZWxheShhdHRlbXB0LCBmaW5hbENvbmZpZyk7XG4gICAgICBsb2dnZXIuZGVidWcoYFdhaXRpbmcgJHtkZWxheX1tcyBiZWZvcmUgcmV0cnlgLCB7IGF0dGVtcHQsIGRlbGF5IH0pO1xuICAgICAgXG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgZGVsYXkpKTtcbiAgICB9XG4gIH1cbiAgXG4gIGxvZ2dlci5lcnJvcihgJHtvcGVyYXRpb25OYW1lfSBmYWlsZWQgYWZ0ZXIgYWxsIHJldHJ5IGF0dGVtcHRzYCwgbGFzdEVycm9yLCB7XG4gICAgdG90YWxBdHRlbXB0czogZmluYWxDb25maWcubWF4QXR0ZW1wdHMsXG4gICAgZmluYWxFcnJvcjogbGFzdEVycm9yLm1lc3NhZ2VcbiAgfSk7XG4gIFxuICB0aHJvdyBsYXN0RXJyb3I7XG59XG5cbi8qKlxuICogQ2lyY3VpdCBicmVha2VyIHN0YXRlc1xuICovXG5leHBvcnQgZW51bSBDaXJjdWl0QnJlYWtlclN0YXRlIHtcbiAgQ0xPU0VEID0gJ0NMT1NFRCcsXG4gIE9QRU4gPSAnT1BFTicsXG4gIEhBTEZfT1BFTiA9ICdIQUxGX09QRU4nXG59XG5cbi8qKlxuICogQ2lyY3VpdCBicmVha2VyIGNvbmZpZ3VyYXRpb25cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDaXJjdWl0QnJlYWtlckNvbmZpZyB7XG4gIGZhaWx1cmVUaHJlc2hvbGQ6IG51bWJlcjtcbiAgcmVjb3ZlcnlUaW1lb3V0OiBudW1iZXI7XG4gIG1vbml0b3JpbmdQZXJpb2Q6IG51bWJlcjtcbiAgaGFsZk9wZW5NYXhDYWxsczogbnVtYmVyO1xufVxuXG4vKipcbiAqIERlZmF1bHQgY2lyY3VpdCBicmVha2VyIGNvbmZpZ3VyYXRpb25cbiAqL1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfQ0lSQ1VJVF9CUkVBS0VSX0NPTkZJRzogQ2lyY3VpdEJyZWFrZXJDb25maWcgPSB7XG4gIGZhaWx1cmVUaHJlc2hvbGQ6IDUsXG4gIHJlY292ZXJ5VGltZW91dDogNjAwMDAsIC8vIDEgbWludXRlXG4gIG1vbml0b3JpbmdQZXJpb2Q6IDEwMDAwLCAvLyAxMCBzZWNvbmRzXG4gIGhhbGZPcGVuTWF4Q2FsbHM6IDNcbn07XG5cbi8qKlxuICogQ2lyY3VpdCBicmVha2VyIGltcGxlbWVudGF0aW9uIGZvciBleHRlcm5hbCBzZXJ2aWNlIGZhaWx1cmVzXG4gKi9cbmV4cG9ydCBjbGFzcyBDaXJjdWl0QnJlYWtlciB7XG4gIHByaXZhdGUgc3RhdGU6IENpcmN1aXRCcmVha2VyU3RhdGUgPSBDaXJjdWl0QnJlYWtlclN0YXRlLkNMT1NFRDtcbiAgcHJpdmF0ZSBmYWlsdXJlQ291bnQ6IG51bWJlciA9IDA7XG4gIHByaXZhdGUgbGFzdEZhaWx1cmVUaW1lOiBudW1iZXIgPSAwO1xuICBwcml2YXRlIGhhbGZPcGVuQ2FsbHM6IG51bWJlciA9IDA7XG4gIHByaXZhdGUgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDaXJjdWl0QnJlYWtlcicpO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgbmFtZTogc3RyaW5nLFxuICAgIHByaXZhdGUgY29uZmlnOiBDaXJjdWl0QnJlYWtlckNvbmZpZyA9IERFRkFVTFRfQ0lSQ1VJVF9CUkVBS0VSX0NPTkZJR1xuICApIHt9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIG9wZXJhdGlvbiB3aXRoIGNpcmN1aXQgYnJlYWtlciBwcm90ZWN0aW9uXG4gICAqL1xuICBhc3luYyBleGVjdXRlPFQ+KG9wZXJhdGlvbjogKCkgPT4gUHJvbWlzZTxUPik6IFByb21pc2U8VD4ge1xuICAgIGlmICh0aGlzLnN0YXRlID09PSBDaXJjdWl0QnJlYWtlclN0YXRlLk9QRU4pIHtcbiAgICAgIGlmICh0aGlzLnNob3VsZEF0dGVtcHRSZXNldCgpKSB7XG4gICAgICAgIHRoaXMuc3RhdGUgPSBDaXJjdWl0QnJlYWtlclN0YXRlLkhBTEZfT1BFTjtcbiAgICAgICAgdGhpcy5oYWxmT3BlbkNhbGxzID0gMDtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ2lyY3VpdCBicmVha2VyIHRyYW5zaXRpb25pbmcgdG8gSEFMRl9PUEVOYCwgeyBcbiAgICAgICAgICBuYW1lOiB0aGlzLm5hbWUgXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoYENpcmN1aXQgYnJlYWtlciBpcyBPUEVOIGZvciAke3RoaXMubmFtZX1gKTtcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybignQ2lyY3VpdCBicmVha2VyIHJlamVjdGVkIGNhbGwnLCB7IFxuICAgICAgICAgIG5hbWU6IHRoaXMubmFtZSwgXG4gICAgICAgICAgc3RhdGU6IHRoaXMuc3RhdGUgXG4gICAgICAgIH0pO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodGhpcy5zdGF0ZSA9PT0gQ2lyY3VpdEJyZWFrZXJTdGF0ZS5IQUxGX09QRU4pIHtcbiAgICAgIGlmICh0aGlzLmhhbGZPcGVuQ2FsbHMgPj0gdGhpcy5jb25maWcuaGFsZk9wZW5NYXhDYWxscykge1xuICAgICAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcihgQ2lyY3VpdCBicmVha2VyIEhBTEZfT1BFTiBsaW1pdCBleGNlZWRlZCBmb3IgJHt0aGlzLm5hbWV9YCk7XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ0NpcmN1aXQgYnJlYWtlciBoYWxmLW9wZW4gbGltaXQgZXhjZWVkZWQnLCB7IFxuICAgICAgICAgIG5hbWU6IHRoaXMubmFtZSwgXG4gICAgICAgICAgaGFsZk9wZW5DYWxsczogdGhpcy5oYWxmT3BlbkNhbGxzIFxuICAgICAgICB9KTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9XG4gICAgICB0aGlzLmhhbGZPcGVuQ2FsbHMrKztcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgb3BlcmF0aW9uKCk7XG4gICAgICB0aGlzLm9uU3VjY2VzcygpO1xuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5vbkZhaWx1cmUoKTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIHN1Y2Nlc3NmdWwgb3BlcmF0aW9uXG4gICAqL1xuICBwcml2YXRlIG9uU3VjY2VzcygpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5zdGF0ZSA9PT0gQ2lyY3VpdEJyZWFrZXJTdGF0ZS5IQUxGX09QRU4pIHtcbiAgICAgIHRoaXMuc3RhdGUgPSBDaXJjdWl0QnJlYWtlclN0YXRlLkNMT1NFRDtcbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENpcmN1aXQgYnJlYWtlciByZXNldCB0byBDTE9TRURgLCB7IFxuICAgICAgICBuYW1lOiB0aGlzLm5hbWUgXG4gICAgICB9KTtcbiAgICB9XG4gICAgdGhpcy5mYWlsdXJlQ291bnQgPSAwO1xuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgZmFpbGVkIG9wZXJhdGlvblxuICAgKi9cbiAgcHJpdmF0ZSBvbkZhaWx1cmUoKTogdm9pZCB7XG4gICAgdGhpcy5mYWlsdXJlQ291bnQrKztcbiAgICB0aGlzLmxhc3RGYWlsdXJlVGltZSA9IERhdGUubm93KCk7XG5cbiAgICBpZiAodGhpcy5zdGF0ZSA9PT0gQ2lyY3VpdEJyZWFrZXJTdGF0ZS5IQUxGX09QRU4pIHtcbiAgICAgIHRoaXMuc3RhdGUgPSBDaXJjdWl0QnJlYWtlclN0YXRlLk9QRU47XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKGBDaXJjdWl0IGJyZWFrZXIgb3BlbmVkIGZyb20gSEFMRl9PUEVOYCwgeyBcbiAgICAgICAgbmFtZTogdGhpcy5uYW1lLCBcbiAgICAgICAgZmFpbHVyZUNvdW50OiB0aGlzLmZhaWx1cmVDb3VudCBcbiAgICAgIH0pO1xuICAgIH0gZWxzZSBpZiAodGhpcy5mYWlsdXJlQ291bnQgPj0gdGhpcy5jb25maWcuZmFpbHVyZVRocmVzaG9sZCkge1xuICAgICAgdGhpcy5zdGF0ZSA9IENpcmN1aXRCcmVha2VyU3RhdGUuT1BFTjtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oYENpcmN1aXQgYnJlYWtlciBvcGVuZWQgZHVlIHRvIGZhaWx1cmUgdGhyZXNob2xkYCwgeyBcbiAgICAgICAgbmFtZTogdGhpcy5uYW1lLCBcbiAgICAgICAgZmFpbHVyZUNvdW50OiB0aGlzLmZhaWx1cmVDb3VudCwgXG4gICAgICAgIHRocmVzaG9sZDogdGhpcy5jb25maWcuZmFpbHVyZVRocmVzaG9sZCBcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgaWYgY2lyY3VpdCBicmVha2VyIHNob3VsZCBhdHRlbXB0IHJlc2V0XG4gICAqL1xuICBwcml2YXRlIHNob3VsZEF0dGVtcHRSZXNldCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gRGF0ZS5ub3coKSAtIHRoaXMubGFzdEZhaWx1cmVUaW1lID49IHRoaXMuY29uZmlnLnJlY292ZXJ5VGltZW91dDtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIGN1cnJlbnQgY2lyY3VpdCBicmVha2VyIHN0YXR1c1xuICAgKi9cbiAgZ2V0U3RhdHVzKCk6IHtcbiAgICBzdGF0ZTogQ2lyY3VpdEJyZWFrZXJTdGF0ZTtcbiAgICBmYWlsdXJlQ291bnQ6IG51bWJlcjtcbiAgICBsYXN0RmFpbHVyZVRpbWU6IG51bWJlcjtcbiAgICBoYWxmT3BlbkNhbGxzOiBudW1iZXI7XG4gIH0ge1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZTogdGhpcy5zdGF0ZSxcbiAgICAgIGZhaWx1cmVDb3VudDogdGhpcy5mYWlsdXJlQ291bnQsXG4gICAgICBsYXN0RmFpbHVyZVRpbWU6IHRoaXMubGFzdEZhaWx1cmVUaW1lLFxuICAgICAgaGFsZk9wZW5DYWxsczogdGhpcy5oYWxmT3BlbkNhbGxzXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBNYW51YWxseSByZXNldHMgdGhlIGNpcmN1aXQgYnJlYWtlclxuICAgKi9cbiAgcmVzZXQoKTogdm9pZCB7XG4gICAgdGhpcy5zdGF0ZSA9IENpcmN1aXRCcmVha2VyU3RhdGUuQ0xPU0VEO1xuICAgIHRoaXMuZmFpbHVyZUNvdW50ID0gMDtcbiAgICB0aGlzLmxhc3RGYWlsdXJlVGltZSA9IDA7XG4gICAgdGhpcy5oYWxmT3BlbkNhbGxzID0gMDtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKGBDaXJjdWl0IGJyZWFrZXIgbWFudWFsbHkgcmVzZXRgLCB7IG5hbWU6IHRoaXMubmFtZSB9KTtcbiAgfVxufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBjaXJjdWl0IGJyZWFrZXIgaW5zdGFuY2VcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUNpcmN1aXRCcmVha2VyKFxuICBuYW1lOiBzdHJpbmcsIFxuICBjb25maWc/OiBQYXJ0aWFsPENpcmN1aXRCcmVha2VyQ29uZmlnPlxuKTogQ2lyY3VpdEJyZWFrZXIge1xuICBjb25zdCBmaW5hbENvbmZpZyA9IHsgLi4uREVGQVVMVF9DSVJDVUlUX0JSRUFLRVJfQ09ORklHLCAuLi5jb25maWcgfTtcbiAgcmV0dXJuIG5ldyBDaXJjdWl0QnJlYWtlcihuYW1lLCBmaW5hbENvbmZpZyk7XG59Il19