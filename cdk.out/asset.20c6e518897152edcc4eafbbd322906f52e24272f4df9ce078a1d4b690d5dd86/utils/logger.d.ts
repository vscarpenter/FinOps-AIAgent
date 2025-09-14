/**
 * Structured logger with correlation ID support for CloudWatch
 */
export declare class Logger {
    private correlationId;
    private context;
    constructor(context: string, correlationId?: string);
    /**
     * Creates a child logger with the same correlation ID
     */
    child(context: string): Logger;
    /**
     * Gets the current correlation ID
     */
    getCorrelationId(): string;
    /**
     * Logs info level message with structured format
     */
    info(message: string, metadata?: Record<string, any>): void;
    /**
     * Logs warning level message with structured format
     */
    warn(message: string, metadata?: Record<string, any>): void;
    /**
     * Logs error level message with structured format
     */
    error(message: string, error?: Error, metadata?: Record<string, any>): void;
    /**
     * Logs debug level message with structured format
     */
    debug(message: string, metadata?: Record<string, any>): void;
    /**
     * Logs execution duration for performance monitoring
     */
    logDuration(operation: string, startTime: number, metadata?: Record<string, any>): void;
    /**
     * Logs cost analysis results
     */
    logCostAnalysis(costAnalysis: any): void;
    /**
     * Logs alert delivery status
     */
    logAlertDelivery(success: boolean, channels: string[], metadata?: Record<string, any>): void;
    /**
     * Core logging method with structured JSON format
     */
    private log;
}
/**
 * Creates a logger instance for the given context
 */
export declare function createLogger(context: string, correlationId?: string): Logger;
