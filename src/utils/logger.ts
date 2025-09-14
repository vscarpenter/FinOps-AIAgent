import { randomUUID } from 'crypto';

/**
 * Structured logger with correlation ID support for CloudWatch
 */
export class Logger {
  private correlationId: string;
  private context: string;

  constructor(context: string, correlationId?: string) {
    this.context = context;
    this.correlationId = correlationId || randomUUID();
  }

  /**
   * Creates a child logger with the same correlation ID
   */
  child(context: string): Logger {
    return new Logger(context, this.correlationId);
  }

  /**
   * Gets the current correlation ID
   */
  getCorrelationId(): string {
    return this.correlationId;
  }

  /**
   * Logs info level message with structured format
   */
  info(message: string, metadata?: Record<string, any>): void {
    this.log('INFO', message, metadata);
  }

  /**
   * Logs warning level message with structured format
   */
  warn(message: string, metadata?: Record<string, any>): void {
    this.log('WARN', message, metadata);
  }

  /**
   * Logs error level message with structured format
   */
  error(message: string, error?: Error, metadata?: Record<string, any>): void {
    const errorMetadata = error ? {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
      ...metadata
    } : metadata;

    this.log('ERROR', message, errorMetadata);
  }

  /**
   * Logs debug level message with structured format
   */
  debug(message: string, metadata?: Record<string, any>): void {
    // Only log debug in development or when explicitly enabled
    if (process.env.LOG_LEVEL === 'DEBUG' || process.env.NODE_ENV === 'development') {
      this.log('DEBUG', message, metadata);
    }
  }

  /**
   * Logs execution duration for performance monitoring
   */
  logDuration(operation: string, startTime: number, metadata?: Record<string, any>): void {
    const duration = Date.now() - startTime;
    this.info(`${operation} completed`, {
      operation,
      durationMs: duration,
      ...metadata
    });
  }

  /**
   * Logs cost analysis results
   */
  logCostAnalysis(costAnalysis: any): void {
    this.info('Cost analysis completed', {
      totalCost: costAnalysis.totalCost,
      projectedMonthly: costAnalysis.projectedMonthly,
      serviceCount: Object.keys(costAnalysis.serviceBreakdown).length,
      period: costAnalysis.period,
      topServices: Object.entries(costAnalysis.serviceBreakdown)
        .sort(([,a], [,b]) => (b as number) - (a as number))
        .slice(0, 3)
        .map(([service, cost]) => ({ service, cost }))
    });
  }

  /**
   * Logs alert delivery status
   */
  logAlertDelivery(success: boolean, channels: string[], metadata?: Record<string, any>): void {
    if (success) {
      this.info('Alert delivered successfully', {
        channels,
        channelCount: channels.length,
        ...metadata
      });
    } else {
      this.error('Alert delivery failed', undefined, {
        channels,
        channelCount: channels.length,
        ...metadata
      });
    }
  }

  /**
   * Core logging method with structured JSON format
   */
  private log(level: string, message: string, metadata?: Record<string, any>): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      correlationId: this.correlationId,
      context: this.context,
      ...metadata
    };

    // Use console methods for CloudWatch compatibility
    switch (level) {
      case 'ERROR':
        console.error(JSON.stringify(logEntry));
        break;
      case 'WARN':
        console.warn(JSON.stringify(logEntry));
        break;
      case 'DEBUG':
        console.debug(JSON.stringify(logEntry));
        break;
      default:
        console.log(JSON.stringify(logEntry));
    }
  }
}

/**
 * Creates a logger instance for the given context
 */
export function createLogger(context: string, correlationId?: string): Logger {
  return new Logger(context, correlationId);
}