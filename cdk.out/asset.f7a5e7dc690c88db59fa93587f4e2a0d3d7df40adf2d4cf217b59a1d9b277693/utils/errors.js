"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = exports.ErrorHandler = exports.ExternalServiceError = exports.ValidationError = exports.AgentInitializationError = exports.TaskExecutionError = exports.IOSNotificationError = exports.NotificationError = exports.CostExplorerError = exports.ConfigurationError = exports.SpendMonitorError = void 0;
exports.safeExecute = safeExecute;
exports.withGracefulDegradation = withGracefulDegradation;
const logger_1 = require("./logger");
/**
 * Base error class for spend monitor errors
 */
class SpendMonitorError extends Error {
    constructor(message, context) {
        super(message);
        this.context = context;
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
    toJSON() {
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
exports.SpendMonitorError = SpendMonitorError;
/**
 * Configuration validation errors
 */
class ConfigurationError extends SpendMonitorError {
    constructor(message, context) {
        super(`Configuration error: ${message}`, context);
        this.code = 'CONFIGURATION_ERROR';
        this.retryable = false;
    }
}
exports.ConfigurationError = ConfigurationError;
/**
 * Cost Explorer API errors
 */
class CostExplorerError extends SpendMonitorError {
    constructor(message, retryable = true, context) {
        super(`Cost Explorer error: ${message}`, context);
        this.code = 'COST_EXPLORER_ERROR';
        this.retryable = retryable;
    }
}
exports.CostExplorerError = CostExplorerError;
/**
 * SNS notification errors
 */
class NotificationError extends SpendMonitorError {
    constructor(message, retryable = true, context) {
        super(`Notification error: ${message}`, context);
        this.code = 'NOTIFICATION_ERROR';
        this.retryable = retryable;
    }
}
exports.NotificationError = NotificationError;
/**
 * iOS push notification specific errors
 */
class IOSNotificationError extends SpendMonitorError {
    constructor(message, retryable = true, context) {
        super(`iOS notification error: ${message}`, context);
        this.code = 'IOS_NOTIFICATION_ERROR';
        this.retryable = retryable;
    }
}
exports.IOSNotificationError = IOSNotificationError;
/**
 * Task execution errors
 */
class TaskExecutionError extends SpendMonitorError {
    constructor(message, context) {
        super(`Task execution error: ${message}`, context);
        this.code = 'TASK_EXECUTION_ERROR';
        this.retryable = false;
    }
}
exports.TaskExecutionError = TaskExecutionError;
/**
 * Agent initialization errors
 */
class AgentInitializationError extends SpendMonitorError {
    constructor(message, context) {
        super(`Agent initialization error: ${message}`, context);
        this.code = 'AGENT_INITIALIZATION_ERROR';
        this.retryable = false;
    }
}
exports.AgentInitializationError = AgentInitializationError;
/**
 * Validation errors
 */
class ValidationError extends SpendMonitorError {
    constructor(message, context) {
        super(`Validation error: ${message}`, context);
        this.code = 'VALIDATION_ERROR';
        this.retryable = false;
    }
}
exports.ValidationError = ValidationError;
/**
 * External service errors
 */
class ExternalServiceError extends SpendMonitorError {
    constructor(service, message, retryable = true, context) {
        super(`${service} service error: ${message}`, context);
        this.code = 'EXTERNAL_SERVICE_ERROR';
        this.retryable = retryable;
    }
}
exports.ExternalServiceError = ExternalServiceError;
/**
 * Error handler utility class
 */
class ErrorHandler {
    constructor() {
        this.logger = (0, logger_1.createLogger)('ErrorHandler');
    }
    /**
     * Handles and categorizes errors
     */
    handleError(error, operation, context) {
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
            const costError = new CostExplorerError(error.message || 'Unknown Cost Explorer error', this.isRetryableAWSError(error), { ...errorContext, awsError: error });
            this.logger.error(`${operation} failed with Cost Explorer error`, error, errorContext);
            return costError;
        }
        if (error?.name?.includes('SNS') || error?.code?.includes('SNS')) {
            const snsError = new NotificationError(error.message || 'Unknown SNS error', this.isRetryableAWSError(error), { ...errorContext, awsError: error });
            this.logger.error(`${operation} failed with SNS error`, error, errorContext);
            return snsError;
        }
        // Handle APNS/iOS specific errors
        if (error?.message?.includes('APNS') || error?.message?.includes('iOS') ||
            error?.code?.includes('InvalidParameter') && context?.channel === 'ios') {
            const iosError = new IOSNotificationError(error.message || 'Unknown iOS notification error', false, // Most iOS errors are not retryable
            { ...errorContext, iosError: error });
            this.logger.error(`${operation} failed with iOS error`, error, errorContext);
            return iosError;
        }
        // Handle validation errors
        if (error?.name === 'ValidationError' || error?.message?.includes('validation')) {
            const validationError = new ValidationError(error.message || 'Validation failed', errorContext);
            this.logger.error(`${operation} failed with validation error`, error, errorContext);
            return validationError;
        }
        // Handle network/timeout errors
        if (this.isNetworkError(error)) {
            const networkError = new ExternalServiceError('Network', error.message || 'Network error occurred', true, errorContext);
            this.logger.error(`${operation} failed with network error`, error, errorContext);
            return networkError;
        }
        // Default to external service error
        const genericError = new ExternalServiceError('Unknown', error?.message || 'Unknown error occurred', false, errorContext);
        this.logger.error(`${operation} failed with unknown error`, error, errorContext);
        return genericError;
    }
    /**
     * Determines if an AWS error is retryable
     */
    isRetryableAWSError(error) {
        const retryableErrorCodes = [
            'ThrottlingException',
            'TooManyRequestsException',
            'ServiceUnavailableException',
            'InternalServerErrorException',
            'RequestTimeout',
            'RequestTimeoutException'
        ];
        const retryableStatusCodes = [429, 500, 502, 503, 504];
        return (retryableErrorCodes.includes(error?.code) ||
            retryableErrorCodes.includes(error?.name) ||
            retryableStatusCodes.includes(error?.statusCode) ||
            retryableStatusCodes.includes(error?.$metadata?.httpStatusCode));
    }
    /**
     * Determines if an error is network-related
     */
    isNetworkError(error) {
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
        return (networkErrorCodes.includes(error?.code) ||
            networkErrorCodes.includes(error?.name) ||
            (error?.message && networkErrorPatterns.some(pattern => pattern.test(error.message))));
    }
    /**
     * Creates appropriate error for configuration issues
     */
    createConfigurationError(field, value, requirement) {
        return new ConfigurationError(`Invalid ${field}: ${requirement}`, { field, value, requirement });
    }
    /**
     * Creates appropriate error for missing required configuration
     */
    createMissingConfigError(field) {
        return new ConfigurationError(`Missing required configuration: ${field}`, { field, required: true });
    }
    /**
     * Handles graceful degradation scenarios
     */
    handleGracefulDegradation(primaryError, fallbackOperation, context) {
        this.logger.warn('Graceful degradation triggered', {
            primaryError: primaryError.message,
            fallbackOperation,
            ...context
        });
    }
    /**
     * Logs error recovery
     */
    logRecovery(operation, attempt, context) {
        this.logger.info(`Error recovery successful`, {
            operation,
            recoveryAttempt: attempt,
            ...context
        });
    }
}
exports.ErrorHandler = ErrorHandler;
/**
 * Global error handler instance
 */
exports.errorHandler = new ErrorHandler();
/**
 * Utility function to safely execute operations with error handling
 */
async function safeExecute(operation, operationName, context) {
    try {
        return await operation();
    }
    catch (error) {
        throw exports.errorHandler.handleError(error, operationName, context);
    }
}
/**
 * Utility function for graceful degradation
 */
async function withGracefulDegradation(primaryOperation, fallbackOperation, operationName, context) {
    try {
        return await primaryOperation();
    }
    catch (error) {
        const handledError = exports.errorHandler.handleError(error, operationName, context);
        if (handledError.retryable) {
            exports.errorHandler.handleGracefulDegradation(handledError, `${operationName}_fallback`, context);
            return await fallbackOperation();
        }
        throw handledError;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXJyb3JzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3V0aWxzL2Vycm9ycy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUEwVUEsa0NBVUM7QUFLRCwwREFzQkM7QUEvV0QscUNBQXdDO0FBRXhDOztHQUVHO0FBQ0gsTUFBc0IsaUJBQWtCLFNBQVEsS0FBSztJQUluRCxZQUNFLE9BQWUsRUFDQyxPQUE2QjtRQUU3QyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUM7UUFGQyxZQUFPLEdBQVAsT0FBTyxDQUFzQjtRQUc3QyxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDO1FBQ2xDLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDO0lBQ2xELENBQUM7SUFFRCxNQUFNO1FBQ0osT0FBTztZQUNMLElBQUksRUFBRSxJQUFJLENBQUMsSUFBSTtZQUNmLElBQUksRUFBRSxJQUFJLENBQUMsSUFBSTtZQUNmLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTztZQUNyQixTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVM7WUFDekIsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPO1lBQ3JCLEtBQUssRUFBRSxJQUFJLENBQUMsS0FBSztTQUNsQixDQUFDO0lBQ0osQ0FBQztDQUNGO0FBdkJELDhDQXVCQztBQUVEOztHQUVHO0FBQ0gsTUFBYSxrQkFBbUIsU0FBUSxpQkFBaUI7SUFJdkQsWUFBWSxPQUFlLEVBQUUsT0FBNkI7UUFDeEQsS0FBSyxDQUFDLHdCQUF3QixPQUFPLEVBQUUsRUFBRSxPQUFPLENBQUMsQ0FBQztRQUozQyxTQUFJLEdBQUcscUJBQXFCLENBQUM7UUFDN0IsY0FBUyxHQUFHLEtBQUssQ0FBQztJQUkzQixDQUFDO0NBQ0Y7QUFQRCxnREFPQztBQUVEOztHQUVHO0FBQ0gsTUFBYSxpQkFBa0IsU0FBUSxpQkFBaUI7SUFJdEQsWUFBWSxP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QyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4vbG9nZ2VyJztcblxuLyoqXG4gKiBCYXNlIGVycm9yIGNsYXNzIGZvciBzcGVuZCBtb25pdG9yIGVycm9yc1xuICovXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgU3BlbmRNb25pdG9yRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGFic3RyYWN0IHJlYWRvbmx5IGNvZGU6IHN0cmluZztcbiAgYWJzdHJhY3QgcmVhZG9ubHkgcmV0cnlhYmxlOiBib29sZWFuO1xuICBcbiAgY29uc3RydWN0b3IoXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICAgIHB1YmxpYyByZWFkb25seSBjb250ZXh0PzogUmVjb3JkPHN0cmluZywgYW55PlxuICApIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgICB0aGlzLm5hbWUgPSB0aGlzLmNvbnN0cnVjdG9yLm5hbWU7XG4gICAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UodGhpcywgdGhpcy5jb25zdHJ1Y3Rvcik7XG4gIH1cblxuICB0b0pTT04oKTogUmVjb3JkPHN0cmluZywgYW55PiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG5hbWU6IHRoaXMubmFtZSxcbiAgICAgIGNvZGU6IHRoaXMuY29kZSxcbiAgICAgIG1lc3NhZ2U6IHRoaXMubWVzc2FnZSxcbiAgICAgIHJldHJ5YWJsZTogdGhpcy5yZXRyeWFibGUsXG4gICAgICBjb250ZXh0OiB0aGlzLmNvbnRleHQsXG4gICAgICBzdGFjazogdGhpcy5zdGFja1xuICAgIH07XG4gIH1cbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIHZhbGlkYXRpb24gZXJyb3JzXG4gKi9cbmV4cG9ydCBjbGFzcyBDb25maWd1cmF0aW9uRXJyb3IgZXh0ZW5kcyBTcGVuZE1vbml0b3JFcnJvciB7XG4gIHJlYWRvbmx5IGNvZGUgPSAnQ09ORklHVVJBVElPTl9FUlJPUic7XG4gIHJlYWRvbmx5IHJldHJ5YWJsZSA9IGZhbHNlO1xuXG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZywgY29udGV4dD86IFJlY29yZDxzdHJpbmcsIGFueT4pIHtcbiAgICBzdXBlcihgQ29uZmlndXJhdGlvbiBlcnJvcjogJHttZXNzYWdlfWAsIGNvbnRleHQpO1xuICB9XG59XG5cbi8qKlxuICogQ29zdCBFeHBsb3JlciBBUEkgZXJyb3JzXG4gKi9cbmV4cG9ydCBjbGFzcyBDb3N0RXhwbG9yZXJFcnJvciBleHRlbmRzIFNwZW5kTW9uaXRvckVycm9yIHtcbiAgcmVhZG9ubHkgY29kZSA9ICdDT1NUX0VYUExPUkVSX0VSUk9SJztcbiAgcmVhZG9ubHkgcmV0cnlhYmxlOiBib29sZWFuO1xuXG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZywgcmV0cnlhYmxlOiBib29sZWFuID0gdHJ1ZSwgY29udGV4dD86IFJlY29yZDxzdHJpbmcsIGFueT4pIHtcbiAgICBzdXBlcihgQ29zdCBFeHBsb3JlciBlcnJvcjogJHttZXNzYWdlfWAsIGNvbnRleHQpO1xuICAgIHRoaXMucmV0cnlhYmxlID0gcmV0cnlhYmxlO1xuICB9XG59XG5cbi8qKlxuICogU05TIG5vdGlmaWNhdGlvbiBlcnJvcnNcbiAqL1xuZXhwb3J0IGNsYXNzIE5vdGlmaWNhdGlvbkVycm9yIGV4dGVuZHMgU3BlbmRNb25pdG9yRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ05PVElGSUNBVElPTl9FUlJPUic7XG4gIHJlYWRvbmx5IHJldHJ5YWJsZTogYm9vbGVhbjtcblxuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcsIHJldHJ5YWJsZTogYm9vbGVhbiA9IHRydWUsIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+KSB7XG4gICAgc3VwZXIoYE5vdGlmaWNhdGlvbiBlcnJvcjogJHttZXNzYWdlfWAsIGNvbnRleHQpO1xuICAgIHRoaXMucmV0cnlhYmxlID0gcmV0cnlhYmxlO1xuICB9XG59XG5cbi8qKlxuICogaU9TIHB1c2ggbm90aWZpY2F0aW9uIHNwZWNpZmljIGVycm9yc1xuICovXG5leHBvcnQgY2xhc3MgSU9TTm90aWZpY2F0aW9uRXJyb3IgZXh0ZW5kcyBTcGVuZE1vbml0b3JFcnJvciB7XG4gIHJlYWRvbmx5IGNvZGUgPSAnSU9TX05PVElGSUNBVElPTl9FUlJPUic7XG4gIHJlYWRvbmx5IHJldHJ5YWJsZTogYm9vbGVhbjtcblxuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcsIHJldHJ5YWJsZTogYm9vbGVhbiA9IHRydWUsIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+KSB7XG4gICAgc3VwZXIoYGlPUyBub3RpZmljYXRpb24gZXJyb3I6ICR7bWVzc2FnZX1gLCBjb250ZXh0KTtcbiAgICB0aGlzLnJldHJ5YWJsZSA9IHJldHJ5YWJsZTtcbiAgfVxufVxuXG4vKipcbiAqIFRhc2sgZXhlY3V0aW9uIGVycm9yc1xuICovXG5leHBvcnQgY2xhc3MgVGFza0V4ZWN1dGlvbkVycm9yIGV4dGVuZHMgU3BlbmRNb25pdG9yRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ1RBU0tfRVhFQ1VUSU9OX0VSUk9SJztcbiAgcmVhZG9ubHkgcmV0cnlhYmxlID0gZmFsc2U7XG5cbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nLCBjb250ZXh0PzogUmVjb3JkPHN0cmluZywgYW55Pikge1xuICAgIHN1cGVyKGBUYXNrIGV4ZWN1dGlvbiBlcnJvcjogJHttZXNzYWdlfWAsIGNvbnRleHQpO1xuICB9XG59XG5cbi8qKlxuICogQWdlbnQgaW5pdGlhbGl6YXRpb24gZXJyb3JzXG4gKi9cbmV4cG9ydCBjbGFzcyBBZ2VudEluaXRpYWxpemF0aW9uRXJyb3IgZXh0ZW5kcyBTcGVuZE1vbml0b3JFcnJvciB7XG4gIHJlYWRvbmx5IGNvZGUgPSAnQUdFTlRfSU5JVElBTElaQVRJT05fRVJST1InO1xuICByZWFkb25seSByZXRyeWFibGUgPSBmYWxzZTtcblxuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcsIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+KSB7XG4gICAgc3VwZXIoYEFnZW50IGluaXRpYWxpemF0aW9uIGVycm9yOiAke21lc3NhZ2V9YCwgY29udGV4dCk7XG4gIH1cbn1cblxuLyoqXG4gKiBWYWxpZGF0aW9uIGVycm9yc1xuICovXG5leHBvcnQgY2xhc3MgVmFsaWRhdGlvbkVycm9yIGV4dGVuZHMgU3BlbmRNb25pdG9yRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ1ZBTElEQVRJT05fRVJST1InO1xuICByZWFkb25seSByZXRyeWFibGUgPSBmYWxzZTtcblxuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcsIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+KSB7XG4gICAgc3VwZXIoYFZhbGlkYXRpb24gZXJyb3I6ICR7bWVzc2FnZX1gLCBjb250ZXh0KTtcbiAgfVxufVxuXG4vKipcbiAqIEV4dGVybmFsIHNlcnZpY2UgZXJyb3JzXG4gKi9cbmV4cG9ydCBjbGFzcyBFeHRlcm5hbFNlcnZpY2VFcnJvciBleHRlbmRzIFNwZW5kTW9uaXRvckVycm9yIHtcbiAgcmVhZG9ubHkgY29kZSA9ICdFWFRFUk5BTF9TRVJWSUNFX0VSUk9SJztcbiAgcmVhZG9ubHkgcmV0cnlhYmxlOiBib29sZWFuO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHNlcnZpY2U6IHN0cmluZywgXG4gICAgbWVzc2FnZTogc3RyaW5nLCBcbiAgICByZXRyeWFibGU6IGJvb2xlYW4gPSB0cnVlLCBcbiAgICBjb250ZXh0PzogUmVjb3JkPHN0cmluZywgYW55PlxuICApIHtcbiAgICBzdXBlcihgJHtzZXJ2aWNlfSBzZXJ2aWNlIGVycm9yOiAke21lc3NhZ2V9YCwgY29udGV4dCk7XG4gICAgdGhpcy5yZXRyeWFibGUgPSByZXRyeWFibGU7XG4gIH1cbn1cblxuLyoqXG4gKiBFcnJvciBoYW5kbGVyIHV0aWxpdHkgY2xhc3NcbiAqL1xuZXhwb3J0IGNsYXNzIEVycm9ySGFuZGxlciB7XG4gIHByaXZhdGUgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdFcnJvckhhbmRsZXInKTtcblxuICAvKipcbiAgICogSGFuZGxlcyBhbmQgY2F0ZWdvcml6ZXMgZXJyb3JzXG4gICAqL1xuICBoYW5kbGVFcnJvcihlcnJvcjogYW55LCBvcGVyYXRpb246IHN0cmluZywgY29udGV4dD86IFJlY29yZDxzdHJpbmcsIGFueT4pOiBTcGVuZE1vbml0b3JFcnJvciB7XG4gICAgY29uc3QgZXJyb3JDb250ZXh0ID0ge1xuICAgICAgb3BlcmF0aW9uLFxuICAgICAgb3JpZ2luYWxFcnJvcjogZXJyb3I/Lm1lc3NhZ2UgfHwgU3RyaW5nKGVycm9yKSxcbiAgICAgIC4uLmNvbnRleHRcbiAgICB9O1xuXG4gICAgLy8gSWYgaXQncyBhbHJlYWR5IGEgU3BlbmRNb25pdG9yRXJyb3IsIGp1c3QgbG9nIGFuZCByZXR1cm5cbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBTcGVuZE1vbml0b3JFcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYCR7b3BlcmF0aW9ufSBmYWlsZWQgd2l0aCBrbm93biBlcnJvcmAsIGVycm9yLCBlcnJvckNvbnRleHQpO1xuICAgICAgcmV0dXJuIGVycm9yO1xuICAgIH1cblxuICAgIC8vIEhhbmRsZSBBV1MgU0RLIGVycm9yc1xuICAgIGlmIChlcnJvcj8ubmFtZT8uaW5jbHVkZXMoJ0Nvc3QnKSB8fCBlcnJvcj8uY29kZT8uaW5jbHVkZXMoJ0Nvc3QnKSkge1xuICAgICAgY29uc3QgY29zdEVycm9yID0gbmV3IENvc3RFeHBsb3JlckVycm9yKFxuICAgICAgICBlcnJvci5tZXNzYWdlIHx8ICdVbmtub3duIENvc3QgRXhwbG9yZXIgZXJyb3InLFxuICAgICAgICB0aGlzLmlzUmV0cnlhYmxlQVdTRXJyb3IoZXJyb3IpLFxuICAgICAgICB7IC4uLmVycm9yQ29udGV4dCwgYXdzRXJyb3I6IGVycm9yIH1cbiAgICAgICk7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcihgJHtvcGVyYXRpb259IGZhaWxlZCB3aXRoIENvc3QgRXhwbG9yZXIgZXJyb3JgLCBlcnJvciwgZXJyb3JDb250ZXh0KTtcbiAgICAgIHJldHVybiBjb3N0RXJyb3I7XG4gICAgfVxuXG4gICAgaWYgKGVycm9yPy5uYW1lPy5pbmNsdWRlcygnU05TJykgfHwgZXJyb3I/LmNvZGU/LmluY2x1ZGVzKCdTTlMnKSkge1xuICAgICAgY29uc3Qgc25zRXJyb3IgPSBuZXcgTm90aWZpY2F0aW9uRXJyb3IoXG4gICAgICAgIGVycm9yLm1lc3NhZ2UgfHwgJ1Vua25vd24gU05TIGVycm9yJyxcbiAgICAgICAgdGhpcy5pc1JldHJ5YWJsZUFXU0Vycm9yKGVycm9yKSxcbiAgICAgICAgeyAuLi5lcnJvckNvbnRleHQsIGF3c0Vycm9yOiBlcnJvciB9XG4gICAgICApO1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYCR7b3BlcmF0aW9ufSBmYWlsZWQgd2l0aCBTTlMgZXJyb3JgLCBlcnJvciwgZXJyb3JDb250ZXh0KTtcbiAgICAgIHJldHVybiBzbnNFcnJvcjtcbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgQVBOUy9pT1Mgc3BlY2lmaWMgZXJyb3JzXG4gICAgaWYgKGVycm9yPy5tZXNzYWdlPy5pbmNsdWRlcygnQVBOUycpIHx8IGVycm9yPy5tZXNzYWdlPy5pbmNsdWRlcygnaU9TJykgfHwgXG4gICAgICAgIGVycm9yPy5jb2RlPy5pbmNsdWRlcygnSW52YWxpZFBhcmFtZXRlcicpICYmIGNvbnRleHQ/LmNoYW5uZWwgPT09ICdpb3MnKSB7XG4gICAgICBjb25zdCBpb3NFcnJvciA9IG5ldyBJT1NOb3RpZmljYXRpb25FcnJvcihcbiAgICAgICAgZXJyb3IubWVzc2FnZSB8fCAnVW5rbm93biBpT1Mgbm90aWZpY2F0aW9uIGVycm9yJyxcbiAgICAgICAgZmFsc2UsIC8vIE1vc3QgaU9TIGVycm9ycyBhcmUgbm90IHJldHJ5YWJsZVxuICAgICAgICB7IC4uLmVycm9yQ29udGV4dCwgaW9zRXJyb3I6IGVycm9yIH1cbiAgICAgICk7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcihgJHtvcGVyYXRpb259IGZhaWxlZCB3aXRoIGlPUyBlcnJvcmAsIGVycm9yLCBlcnJvckNvbnRleHQpO1xuICAgICAgcmV0dXJuIGlvc0Vycm9yO1xuICAgIH1cblxuICAgIC8vIEhhbmRsZSB2YWxpZGF0aW9uIGVycm9yc1xuICAgIGlmIChlcnJvcj8ubmFtZSA9PT0gJ1ZhbGlkYXRpb25FcnJvcicgfHwgZXJyb3I/Lm1lc3NhZ2U/LmluY2x1ZGVzKCd2YWxpZGF0aW9uJykpIHtcbiAgICAgIGNvbnN0IHZhbGlkYXRpb25FcnJvciA9IG5ldyBWYWxpZGF0aW9uRXJyb3IoXG4gICAgICAgIGVycm9yLm1lc3NhZ2UgfHwgJ1ZhbGlkYXRpb24gZmFpbGVkJyxcbiAgICAgICAgZXJyb3JDb250ZXh0XG4gICAgICApO1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYCR7b3BlcmF0aW9ufSBmYWlsZWQgd2l0aCB2YWxpZGF0aW9uIGVycm9yYCwgZXJyb3IsIGVycm9yQ29udGV4dCk7XG4gICAgICByZXR1cm4gdmFsaWRhdGlvbkVycm9yO1xuICAgIH1cblxuICAgIC8vIEhhbmRsZSBuZXR3b3JrL3RpbWVvdXQgZXJyb3JzXG4gICAgaWYgKHRoaXMuaXNOZXR3b3JrRXJyb3IoZXJyb3IpKSB7XG4gICAgICBjb25zdCBuZXR3b3JrRXJyb3IgPSBuZXcgRXh0ZXJuYWxTZXJ2aWNlRXJyb3IoXG4gICAgICAgICdOZXR3b3JrJyxcbiAgICAgICAgZXJyb3IubWVzc2FnZSB8fCAnTmV0d29yayBlcnJvciBvY2N1cnJlZCcsXG4gICAgICAgIHRydWUsXG4gICAgICAgIGVycm9yQ29udGV4dFxuICAgICAgKTtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGAke29wZXJhdGlvbn0gZmFpbGVkIHdpdGggbmV0d29yayBlcnJvcmAsIGVycm9yLCBlcnJvckNvbnRleHQpO1xuICAgICAgcmV0dXJuIG5ldHdvcmtFcnJvcjtcbiAgICB9XG5cbiAgICAvLyBEZWZhdWx0IHRvIGV4dGVybmFsIHNlcnZpY2UgZXJyb3JcbiAgICBjb25zdCBnZW5lcmljRXJyb3IgPSBuZXcgRXh0ZXJuYWxTZXJ2aWNlRXJyb3IoXG4gICAgICAnVW5rbm93bicsXG4gICAgICBlcnJvcj8ubWVzc2FnZSB8fCAnVW5rbm93biBlcnJvciBvY2N1cnJlZCcsXG4gICAgICBmYWxzZSxcbiAgICAgIGVycm9yQ29udGV4dFxuICAgICk7XG4gICAgdGhpcy5sb2dnZXIuZXJyb3IoYCR7b3BlcmF0aW9ufSBmYWlsZWQgd2l0aCB1bmtub3duIGVycm9yYCwgZXJyb3IsIGVycm9yQ29udGV4dCk7XG4gICAgcmV0dXJuIGdlbmVyaWNFcnJvcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZXRlcm1pbmVzIGlmIGFuIEFXUyBlcnJvciBpcyByZXRyeWFibGVcbiAgICovXG4gIHByaXZhdGUgaXNSZXRyeWFibGVBV1NFcnJvcihlcnJvcjogYW55KTogYm9vbGVhbiB7XG4gICAgY29uc3QgcmV0cnlhYmxlRXJyb3JDb2RlcyA9IFtcbiAgICAgICdUaHJvdHRsaW5nRXhjZXB0aW9uJyxcbiAgICAgICdUb29NYW55UmVxdWVzdHNFeGNlcHRpb24nLFxuICAgICAgJ1NlcnZpY2VVbmF2YWlsYWJsZUV4Y2VwdGlvbicsXG4gICAgICAnSW50ZXJuYWxTZXJ2ZXJFcnJvckV4Y2VwdGlvbicsXG4gICAgICAnUmVxdWVzdFRpbWVvdXQnLFxuICAgICAgJ1JlcXVlc3RUaW1lb3V0RXhjZXB0aW9uJ1xuICAgIF07XG5cbiAgICBjb25zdCByZXRyeWFibGVTdGF0dXNDb2RlcyA9IFs0MjksIDUwMCwgNTAyLCA1MDMsIDUwNF07XG5cbiAgICByZXR1cm4gKFxuICAgICAgcmV0cnlhYmxlRXJyb3JDb2Rlcy5pbmNsdWRlcyhlcnJvcj8uY29kZSkgfHxcbiAgICAgIHJldHJ5YWJsZUVycm9yQ29kZXMuaW5jbHVkZXMoZXJyb3I/Lm5hbWUpIHx8XG4gICAgICByZXRyeWFibGVTdGF0dXNDb2Rlcy5pbmNsdWRlcyhlcnJvcj8uc3RhdHVzQ29kZSkgfHxcbiAgICAgIHJldHJ5YWJsZVN0YXR1c0NvZGVzLmluY2x1ZGVzKGVycm9yPy4kbWV0YWRhdGE/Lmh0dHBTdGF0dXNDb2RlKVxuICAgICk7XG4gIH1cblxuICAvKipcbiAgICogRGV0ZXJtaW5lcyBpZiBhbiBlcnJvciBpcyBuZXR3b3JrLXJlbGF0ZWRcbiAgICovXG4gIHByaXZhdGUgaXNOZXR3b3JrRXJyb3IoZXJyb3I6IGFueSk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IG5ldHdvcmtFcnJvckNvZGVzID0gW1xuICAgICAgJ0VDT05OUkVTRVQnLFxuICAgICAgJ0VOT1RGT1VORCcsXG4gICAgICAnRUNPTk5SRUZVU0VEJyxcbiAgICAgICdFVElNRURPVVQnLFxuICAgICAgJ05ldHdvcmtpbmdFcnJvcicsXG4gICAgICAnVGltZW91dEVycm9yJ1xuICAgIF07XG5cbiAgICBjb25zdCBuZXR3b3JrRXJyb3JQYXR0ZXJucyA9IFtcbiAgICAgIC9uZXR3b3JrL2ksXG4gICAgICAvdGltZW91dC9pLFxuICAgICAgL2Nvbm5lY3Rpb24vaSxcbiAgICAgIC9zb2NrZXQvaSxcbiAgICAgIC9kbnMvaSxcbiAgICAgIC91bnJlYWNoYWJsZS9pXG4gICAgXTtcblxuICAgIHJldHVybiAoXG4gICAgICBuZXR3b3JrRXJyb3JDb2Rlcy5pbmNsdWRlcyhlcnJvcj8uY29kZSkgfHxcbiAgICAgIG5ldHdvcmtFcnJvckNvZGVzLmluY2x1ZGVzKGVycm9yPy5uYW1lKSB8fFxuICAgICAgKGVycm9yPy5tZXNzYWdlICYmIG5ldHdvcmtFcnJvclBhdHRlcm5zLnNvbWUocGF0dGVybiA9PiBwYXR0ZXJuLnRlc3QoZXJyb3IubWVzc2FnZSkpKVxuICAgICk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhcHByb3ByaWF0ZSBlcnJvciBmb3IgY29uZmlndXJhdGlvbiBpc3N1ZXNcbiAgICovXG4gIGNyZWF0ZUNvbmZpZ3VyYXRpb25FcnJvcihmaWVsZDogc3RyaW5nLCB2YWx1ZTogYW55LCByZXF1aXJlbWVudDogc3RyaW5nKTogQ29uZmlndXJhdGlvbkVycm9yIHtcbiAgICByZXR1cm4gbmV3IENvbmZpZ3VyYXRpb25FcnJvcihcbiAgICAgIGBJbnZhbGlkICR7ZmllbGR9OiAke3JlcXVpcmVtZW50fWAsXG4gICAgICB7IGZpZWxkLCB2YWx1ZSwgcmVxdWlyZW1lbnQgfVxuICAgICk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhcHByb3ByaWF0ZSBlcnJvciBmb3IgbWlzc2luZyByZXF1aXJlZCBjb25maWd1cmF0aW9uXG4gICAqL1xuICBjcmVhdGVNaXNzaW5nQ29uZmlnRXJyb3IoZmllbGQ6IHN0cmluZyk6IENvbmZpZ3VyYXRpb25FcnJvciB7XG4gICAgcmV0dXJuIG5ldyBDb25maWd1cmF0aW9uRXJyb3IoXG4gICAgICBgTWlzc2luZyByZXF1aXJlZCBjb25maWd1cmF0aW9uOiAke2ZpZWxkfWAsXG4gICAgICB7IGZpZWxkLCByZXF1aXJlZDogdHJ1ZSB9XG4gICAgKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGdyYWNlZnVsIGRlZ3JhZGF0aW9uIHNjZW5hcmlvc1xuICAgKi9cbiAgaGFuZGxlR3JhY2VmdWxEZWdyYWRhdGlvbihcbiAgICBwcmltYXJ5RXJyb3I6IEVycm9yLFxuICAgIGZhbGxiYWNrT3BlcmF0aW9uOiBzdHJpbmcsXG4gICAgY29udGV4dD86IFJlY29yZDxzdHJpbmcsIGFueT5cbiAgKTogdm9pZCB7XG4gICAgdGhpcy5sb2dnZXIud2FybignR3JhY2VmdWwgZGVncmFkYXRpb24gdHJpZ2dlcmVkJywge1xuICAgICAgcHJpbWFyeUVycm9yOiBwcmltYXJ5RXJyb3IubWVzc2FnZSxcbiAgICAgIGZhbGxiYWNrT3BlcmF0aW9uLFxuICAgICAgLi4uY29udGV4dFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIExvZ3MgZXJyb3IgcmVjb3ZlcnlcbiAgICovXG4gIGxvZ1JlY292ZXJ5KG9wZXJhdGlvbjogc3RyaW5nLCBhdHRlbXB0OiBudW1iZXIsIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+KTogdm9pZCB7XG4gICAgdGhpcy5sb2dnZXIuaW5mbyhgRXJyb3IgcmVjb3Zlcnkgc3VjY2Vzc2Z1bGAsIHtcbiAgICAgIG9wZXJhdGlvbixcbiAgICAgIHJlY292ZXJ5QXR0ZW1wdDogYXR0ZW1wdCxcbiAgICAgIC4uLmNvbnRleHRcbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIEdsb2JhbCBlcnJvciBoYW5kbGVyIGluc3RhbmNlXG4gKi9cbmV4cG9ydCBjb25zdCBlcnJvckhhbmRsZXIgPSBuZXcgRXJyb3JIYW5kbGVyKCk7XG5cbi8qKlxuICogVXRpbGl0eSBmdW5jdGlvbiB0byBzYWZlbHkgZXhlY3V0ZSBvcGVyYXRpb25zIHdpdGggZXJyb3IgaGFuZGxpbmdcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNhZmVFeGVjdXRlPFQ+KFxuICBvcGVyYXRpb246ICgpID0+IFByb21pc2U8VD4sXG4gIG9wZXJhdGlvbk5hbWU6IHN0cmluZyxcbiAgY29udGV4dD86IFJlY29yZDxzdHJpbmcsIGFueT5cbik6IFByb21pc2U8VD4ge1xuICB0cnkge1xuICAgIHJldHVybiBhd2FpdCBvcGVyYXRpb24oKTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICB0aHJvdyBlcnJvckhhbmRsZXIuaGFuZGxlRXJyb3IoZXJyb3IsIG9wZXJhdGlvbk5hbWUsIGNvbnRleHQpO1xuICB9XG59XG5cbi8qKlxuICogVXRpbGl0eSBmdW5jdGlvbiBmb3IgZ3JhY2VmdWwgZGVncmFkYXRpb25cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHdpdGhHcmFjZWZ1bERlZ3JhZGF0aW9uPFQ+KFxuICBwcmltYXJ5T3BlcmF0aW9uOiAoKSA9PiBQcm9taXNlPFQ+LFxuICBmYWxsYmFja09wZXJhdGlvbjogKCkgPT4gUHJvbWlzZTxUPixcbiAgb3BlcmF0aW9uTmFtZTogc3RyaW5nLFxuICBjb250ZXh0PzogUmVjb3JkPHN0cmluZywgYW55PlxuKTogUHJvbWlzZTxUPiB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGF3YWl0IHByaW1hcnlPcGVyYXRpb24oKTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zdCBoYW5kbGVkRXJyb3IgPSBlcnJvckhhbmRsZXIuaGFuZGxlRXJyb3IoZXJyb3IsIG9wZXJhdGlvbk5hbWUsIGNvbnRleHQpO1xuICAgIFxuICAgIGlmIChoYW5kbGVkRXJyb3IucmV0cnlhYmxlKSB7XG4gICAgICBlcnJvckhhbmRsZXIuaGFuZGxlR3JhY2VmdWxEZWdyYWRhdGlvbihcbiAgICAgICAgaGFuZGxlZEVycm9yLFxuICAgICAgICBgJHtvcGVyYXRpb25OYW1lfV9mYWxsYmFja2AsXG4gICAgICAgIGNvbnRleHRcbiAgICAgICk7XG4gICAgICByZXR1cm4gYXdhaXQgZmFsbGJhY2tPcGVyYXRpb24oKTtcbiAgICB9XG4gICAgXG4gICAgdGhyb3cgaGFuZGxlZEVycm9yO1xuICB9XG59Il19