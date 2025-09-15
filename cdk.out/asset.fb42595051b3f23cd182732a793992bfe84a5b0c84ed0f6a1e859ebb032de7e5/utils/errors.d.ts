/**
 * Base error class for spend monitor errors
 */
export declare abstract class SpendMonitorError extends Error {
    readonly context?: Record<string, any> | undefined;
    abstract readonly code: string;
    abstract readonly retryable: boolean;
    constructor(message: string, context?: Record<string, any> | undefined);
    toJSON(): Record<string, any>;
}
/**
 * Configuration validation errors
 */
export declare class ConfigurationError extends SpendMonitorError {
    readonly code = "CONFIGURATION_ERROR";
    readonly retryable = false;
    constructor(message: string, context?: Record<string, any>);
}
/**
 * Cost Explorer API errors
 */
export declare class CostExplorerError extends SpendMonitorError {
    readonly code = "COST_EXPLORER_ERROR";
    readonly retryable: boolean;
    constructor(message: string, retryable?: boolean, context?: Record<string, any>);
}
/**
 * SNS notification errors
 */
export declare class NotificationError extends SpendMonitorError {
    readonly code = "NOTIFICATION_ERROR";
    readonly retryable: boolean;
    constructor(message: string, retryable?: boolean, context?: Record<string, any>);
}
/**
 * iOS push notification specific errors
 */
export declare class IOSNotificationError extends SpendMonitorError {
    readonly code = "IOS_NOTIFICATION_ERROR";
    readonly retryable: boolean;
    constructor(message: string, retryable?: boolean, context?: Record<string, any>);
}
/**
 * Task execution errors
 */
export declare class TaskExecutionError extends SpendMonitorError {
    readonly code = "TASK_EXECUTION_ERROR";
    readonly retryable = false;
    constructor(message: string, context?: Record<string, any>);
}
/**
 * Agent initialization errors
 */
export declare class AgentInitializationError extends SpendMonitorError {
    readonly code = "AGENT_INITIALIZATION_ERROR";
    readonly retryable = false;
    constructor(message: string, context?: Record<string, any>);
}
/**
 * Validation errors
 */
export declare class ValidationError extends SpendMonitorError {
    readonly code = "VALIDATION_ERROR";
    readonly retryable = false;
    constructor(message: string, context?: Record<string, any>);
}
/**
 * External service errors
 */
export declare class ExternalServiceError extends SpendMonitorError {
    readonly code = "EXTERNAL_SERVICE_ERROR";
    readonly retryable: boolean;
    constructor(service: string, message: string, retryable?: boolean, context?: Record<string, any>);
}
/**
 * Error handler utility class
 */
export declare class ErrorHandler {
    private logger;
    /**
     * Handles and categorizes errors
     */
    handleError(error: any, operation: string, context?: Record<string, any>): SpendMonitorError;
    /**
     * Determines if an AWS error is retryable
     */
    private isRetryableAWSError;
    /**
     * Determines if an error is network-related
     */
    private isNetworkError;
    /**
     * Creates appropriate error for configuration issues
     */
    createConfigurationError(field: string, value: any, requirement: string): ConfigurationError;
    /**
     * Creates appropriate error for missing required configuration
     */
    createMissingConfigError(field: string): ConfigurationError;
    /**
     * Handles graceful degradation scenarios
     */
    handleGracefulDegradation(primaryError: Error, fallbackOperation: string, context?: Record<string, any>): void;
    /**
     * Logs error recovery
     */
    logRecovery(operation: string, attempt: number, context?: Record<string, any>): void;
}
/**
 * Global error handler instance
 */
export declare const errorHandler: ErrorHandler;
/**
 * Utility function to safely execute operations with error handling
 */
export declare function safeExecute<T>(operation: () => Promise<T>, operationName: string, context?: Record<string, any>): Promise<T>;
/**
 * Utility function for graceful degradation
 */
export declare function withGracefulDegradation<T>(primaryOperation: () => Promise<T>, fallbackOperation: () => Promise<T>, operationName: string, context?: Record<string, any>): Promise<T>;
