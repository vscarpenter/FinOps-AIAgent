import { createLogger } from './logger';

/**
 * Base error class for spend monitor errors
 */
export abstract class SpendMonitorError extends Error {
  abstract readonly code: string;
  abstract readonly retryable: boolean;
  
  constructor(
    message: string,
    public readonly context?: Record<string, any>
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): Record<string, any> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      context: this.context,
      stack: this.stack
    };
  }
}

/**
 * Configuration validation errors
 */
export class ConfigurationError extends SpendMonitorError {
  readonly code = 'CONFIGURATION_ERROR';
  readonly retryable = false;

  constructor(message: string, context?: Record<string, any>) {
    super(`Configuration error: ${message}`, context);
  }
}

/**
 * Cost Explorer API errors
 */
export class CostExplorerError extends SpendMonitorError {
  readonly code = 'COST_EXPLORER_ERROR';
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean = true, context?: Record<string, any>) {
    super(`Cost Explorer error: ${message}`, context);
    this.retryable = retryable;
  }
}

/**
 * SNS notification errors
 */
export class NotificationError extends SpendMonitorError {
  readonly code = 'NOTIFICATION_ERROR';
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean = true, context?: Record<string, any>) {
    super(`Notification error: ${message}`, context);
    this.retryable = retryable;
  }
}

/**
 * iOS push notification specific errors
 */
export class IOSNotificationError extends SpendMonitorError {
  readonly code = 'IOS_NOTIFICATION_ERROR';
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean = true, context?: Record<string, any>) {
    super(`iOS notification error: ${message}`, context);
    this.retryable = retryable;
  }
}

/**
 * Task execution errors
 */
export class TaskExecutionError extends SpendMonitorError {
  readonly code = 'TASK_EXECUTION_ERROR';
  readonly retryable = false;

  constructor(message: string, context?: Record<string, any>) {
    super(`Task execution error: ${message}`, context);
  }
}

/**
 * Agent initialization errors
 */
export class AgentInitializationError extends SpendMonitorError {
  readonly code = 'AGENT_INITIALIZATION_ERROR';
  readonly retryable = false;

  constructor(message: string, context?: Record<string, any>) {
    super(`Agent initialization error: ${message}`, context);
  }
}

/**
 * Validation errors
 */
export class ValidationError extends SpendMonitorError {
  readonly code = 'VALIDATION_ERROR';
  readonly retryable = false;

  constructor(message: string, context?: Record<string, any>) {
    super(`Validation error: ${message}`, context);
  }
}

/**
 * External service errors
 */
export class ExternalServiceError extends SpendMonitorError {
  readonly code = 'EXTERNAL_SERVICE_ERROR';
  readonly retryable: boolean;

  constructor(
    service: string, 
    message: string, 
    retryable: boolean = true, 
    context?: Record<string, any>
  ) {
    super(`${service} service error: ${message}`, context);
    this.retryable = retryable;
  }
}

/**
 * Error handler utility class
 */
export class ErrorHandler {
  private logger = createLogger('ErrorHandler');

  /**
   * Handles and categorizes errors
   */
  handleError(error: any, operation: string, context?: Record<string, any>): SpendMonitorError {
    const errorContext = {
      operation,
      originalError: error?.message || String(error),
      ...context
    };

    // If it's already a SpendMonitorError, just log and return
    if (error instanceof SpendMonitorError) {
      this.logger.error(`${operation} failed with known error`, error, errorContext);
      return error;
    }

    // Handle AWS SDK errors
    if (error?.name?.includes('Cost') || error?.code?.includes('Cost')) {
      const costError = new CostExplorerError(
        error.message || 'Unknown Cost Explorer error',
        this.isRetryableAWSError(error),
        { ...errorContext, awsError: error }
      );
      this.logger.error(`${operation} failed with Cost Explorer error`, error, errorContext);
      return costError;
    }

    if (error?.name?.includes('SNS') || error?.code?.includes('SNS')) {
      const snsError = new NotificationError(
        error.message || 'Unknown SNS error',
        this.isRetryableAWSError(error),
        { ...errorContext, awsError: error }
      );
      this.logger.error(`${operation} failed with SNS error`, error, errorContext);
      return snsError;
    }

    // Handle APNS/iOS specific errors
    if (error?.message?.includes('APNS') || error?.message?.includes('iOS') || 
        error?.code?.includes('InvalidParameter') && context?.channel === 'ios') {
      const iosError = new IOSNotificationError(
        error.message || 'Unknown iOS notification error',
        false, // Most iOS errors are not retryable
        { ...errorContext, iosError: error }
      );
      this.logger.error(`${operation} failed with iOS error`, error, errorContext);
      return iosError;
    }

    // Handle validation errors
    if (error?.name === 'ValidationError' || error?.message?.includes('validation')) {
      const validationError = new ValidationError(
        error.message || 'Validation failed',
        errorContext
      );
      this.logger.error(`${operation} failed with validation error`, error, errorContext);
      return validationError;
    }

    // Handle network/timeout errors
    if (this.isNetworkError(error)) {
      const networkError = new ExternalServiceError(
        'Network',
        error.message || 'Network error occurred',
        true,
        errorContext
      );
      this.logger.error(`${operation} failed with network error`, error, errorContext);
      return networkError;
    }

    // Default to external service error
    const genericError = new ExternalServiceError(
      'Unknown',
      error?.message || 'Unknown error occurred',
      false,
      errorContext
    );
    this.logger.error(`${operation} failed with unknown error`, error, errorContext);
    return genericError;
  }

  /**
   * Determines if an AWS error is retryable
   */
  private isRetryableAWSError(error: any): boolean {
    const retryableErrorCodes = [
      'ThrottlingException',
      'TooManyRequestsException',
      'ServiceUnavailableException',
      'InternalServerErrorException',
      'RequestTimeout',
      'RequestTimeoutException'
    ];

    const retryableStatusCodes = [429, 500, 502, 503, 504];

    return (
      retryableErrorCodes.includes(error?.code) ||
      retryableErrorCodes.includes(error?.name) ||
      retryableStatusCodes.includes(error?.statusCode) ||
      retryableStatusCodes.includes(error?.$metadata?.httpStatusCode)
    );
  }

  /**
   * Determines if an error is network-related
   */
  private isNetworkError(error: any): boolean {
    const networkErrorCodes = [
      'ECONNRESET',
      'ENOTFOUND',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'NetworkingError',
      'TimeoutError'
    ];

    const networkErrorPatterns = [
      /network/i,
      /timeout/i,
      /connection/i,
      /socket/i,
      /dns/i,
      /unreachable/i
    ];

    return (
      networkErrorCodes.includes(error?.code) ||
      networkErrorCodes.includes(error?.name) ||
      (error?.message && networkErrorPatterns.some(pattern => pattern.test(error.message)))
    );
  }

  /**
   * Creates appropriate error for configuration issues
   */
  createConfigurationError(field: string, value: any, requirement: string): ConfigurationError {
    return new ConfigurationError(
      `Invalid ${field}: ${requirement}`,
      { field, value, requirement }
    );
  }

  /**
   * Creates appropriate error for missing required configuration
   */
  createMissingConfigError(field: string): ConfigurationError {
    return new ConfigurationError(
      `Missing required configuration: ${field}`,
      { field, required: true }
    );
  }

  /**
   * Handles graceful degradation scenarios
   */
  handleGracefulDegradation(
    primaryError: Error,
    fallbackOperation: string,
    context?: Record<string, any>
  ): void {
    this.logger.warn('Graceful degradation triggered', {
      primaryError: primaryError.message,
      fallbackOperation,
      ...context
    });
  }

  /**
   * Logs error recovery
   */
  logRecovery(operation: string, attempt: number, context?: Record<string, any>): void {
    this.logger.info(`Error recovery successful`, {
      operation,
      recoveryAttempt: attempt,
      ...context
    });
  }
}

/**
 * Global error handler instance
 */
export const errorHandler = new ErrorHandler();

/**
 * Utility function to safely execute operations with error handling
 */
export async function safeExecute<T>(
  operation: () => Promise<T>,
  operationName: string,
  context?: Record<string, any>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw errorHandler.handleError(error, operationName, context);
  }
}

/**
 * Utility function for graceful degradation
 */
export async function withGracefulDegradation<T>(
  primaryOperation: () => Promise<T>,
  fallbackOperation: () => Promise<T>,
  operationName: string,
  context?: Record<string, any>
): Promise<T> {
  try {
    return await primaryOperation();
  } catch (error) {
    const handledError = errorHandler.handleError(error, operationName, context);
    
    if (handledError.retryable) {
      errorHandler.handleGracefulDegradation(
        handledError,
        `${operationName}_fallback`,
        context
      );
      return await fallbackOperation();
    }
    
    throw handledError;
  }
}