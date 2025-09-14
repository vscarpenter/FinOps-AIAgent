"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
exports.createLogger = createLogger;
const crypto_1 = require("crypto");
/**
 * Structured logger with correlation ID support for CloudWatch
 */
class Logger {
    constructor(context, correlationId) {
        this.context = context;
        this.correlationId = correlationId || (0, crypto_1.randomUUID)();
    }
    /**
     * Creates a child logger with the same correlation ID
     */
    child(context) {
        return new Logger(context, this.correlationId);
    }
    /**
     * Gets the current correlation ID
     */
    getCorrelationId() {
        return this.correlationId;
    }
    /**
     * Logs info level message with structured format
     */
    info(message, metadata) {
        this.log('INFO', message, metadata);
    }
    /**
     * Logs warning level message with structured format
     */
    warn(message, metadata) {
        this.log('WARN', message, metadata);
    }
    /**
     * Logs error level message with structured format
     */
    error(message, error, metadata) {
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
    debug(message, metadata) {
        // Only log debug in development or when explicitly enabled
        if (process.env.LOG_LEVEL === 'DEBUG' || process.env.NODE_ENV === 'development') {
            this.log('DEBUG', message, metadata);
        }
    }
    /**
     * Logs execution duration for performance monitoring
     */
    logDuration(operation, startTime, metadata) {
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
    logCostAnalysis(costAnalysis) {
        this.info('Cost analysis completed', {
            totalCost: costAnalysis.totalCost,
            projectedMonthly: costAnalysis.projectedMonthly,
            serviceCount: Object.keys(costAnalysis.serviceBreakdown).length,
            period: costAnalysis.period,
            topServices: Object.entries(costAnalysis.serviceBreakdown)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 3)
                .map(([service, cost]) => ({ service, cost }))
        });
    }
    /**
     * Logs alert delivery status
     */
    logAlertDelivery(success, channels, metadata) {
        if (success) {
            this.info('Alert delivered successfully', {
                channels,
                channelCount: channels.length,
                ...metadata
            });
        }
        else {
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
    log(level, message, metadata) {
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
exports.Logger = Logger;
/**
 * Creates a logger instance for the given context
 */
function createLogger(context, correlationId) {
    return new Logger(context, correlationId);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nZ2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3V0aWxzL2xvZ2dlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFrSkEsb0NBRUM7QUFwSkQsbUNBQW9DO0FBRXBDOztHQUVHO0FBQ0gsTUFBYSxNQUFNO0lBSWpCLFlBQVksT0FBZSxFQUFFLGFBQXNCO1FBQ2pELElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBQ3ZCLElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxJQUFJLElBQUEsbUJBQVUsR0FBRSxDQUFDO0lBQ3JELENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxPQUFlO1FBQ25CLE9BQU8sSUFBSSxNQUFNLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQztJQUNqRCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxnQkFBZ0I7UUFDZCxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUM7SUFDNUIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsSUFBSSxDQUFDLE9BQWUsRUFBRSxRQUE4QjtRQUNsRCxJQUFJLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsUUFBUSxDQUFDLENBQUM7SUFDdEMsQ0FBQztJQUVEOztPQUVHO0lBQ0gsSUFBSSxDQUFDLE9BQWUsRUFBRSxRQUE4QjtRQUNsRCxJQUFJLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsUUFBUSxDQUFDLENBQUM7SUFDdEMsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLE9BQWUsRUFBRSxLQUFhLEVBQUUsUUFBOEI7UUFDbEUsTUFBTSxhQUFhLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQztZQUM1QixTQUFTLEVBQUUsS0FBSyxDQUFDLElBQUk7WUFDckIsWUFBWSxFQUFFLEtBQUssQ0FBQyxPQUFPO1lBQzNCLFVBQVUsRUFBRSxLQUFLLENBQUMsS0FBSztZQUN2QixHQUFHLFFBQVE7U0FDWixD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LENBQUMsQ0FBQyxDQUFDO2dCQUN4QyxNQUFNO1lBQ1IsS0FBSyxNQUFNO2dCQUNULE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO2dCQUN2QyxNQUFNO1lBQ1IsS0FBSyxPQUFPO2dCQUNWLE9BQU8sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO2dCQUN4QyxNQUFNO1lBQ1I7Z0JBQ0UsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7UUFDMUMsQ0FBQztJQUNILENBQUM7Q0FDRjtBQXhJRCx3QkF3SUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLFlBQVksQ0FBQyxPQUFlLEVBQUUsYUFBc0I7SUFDbEUsT0FBTyxJQUFJLE1BQU0sQ0FBQyxPQUFPLEVBQUUsYUFBYSxDQUFDLENBQUM7QUFDNUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuXG4vKipcbiAqIFN0cnVjdHVyZWQgbG9nZ2VyIHdpdGggY29ycmVsYXRpb24gSUQgc3VwcG9ydCBmb3IgQ2xvdWRXYXRjaFxuICovXG5leHBvcnQgY2xhc3MgTG9nZ2VyIHtcbiAgcHJpdmF0ZSBjb3JyZWxhdGlvbklkOiBzdHJpbmc7XG4gIHByaXZhdGUgY29udGV4dDogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKGNvbnRleHQ6IHN0cmluZywgY29ycmVsYXRpb25JZD86IHN0cmluZykge1xuICAgIHRoaXMuY29udGV4dCA9IGNvbnRleHQ7XG4gICAgdGhpcy5jb3JyZWxhdGlvbklkID0gY29ycmVsYXRpb25JZCB8fCByYW5kb21VVUlEKCk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIGNoaWxkIGxvZ2dlciB3aXRoIHRoZSBzYW1lIGNvcnJlbGF0aW9uIElEXG4gICAqL1xuICBjaGlsZChjb250ZXh0OiBzdHJpbmcpOiBMb2dnZXIge1xuICAgIHJldHVybiBuZXcgTG9nZ2VyKGNvbnRleHQsIHRoaXMuY29ycmVsYXRpb25JZCk7XG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgY3VycmVudCBjb3JyZWxhdGlvbiBJRFxuICAgKi9cbiAgZ2V0Q29ycmVsYXRpb25JZCgpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLmNvcnJlbGF0aW9uSWQ7XG4gIH1cblxuICAvKipcbiAgICogTG9ncyBpbmZvIGxldmVsIG1lc3NhZ2Ugd2l0aCBzdHJ1Y3R1cmVkIGZvcm1hdFxuICAgKi9cbiAgaW5mbyhtZXNzYWdlOiBzdHJpbmcsIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgYW55Pik6IHZvaWQge1xuICAgIHRoaXMubG9nKCdJTkZPJywgbWVzc2FnZSwgbWV0YWRhdGEpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvZ3Mgd2FybmluZyBsZXZlbCBtZXNzYWdlIHdpdGggc3RydWN0dXJlZCBmb3JtYXRcbiAgICovXG4gIHdhcm4obWVzc2FnZTogc3RyaW5nLCBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIGFueT4pOiB2b2lkIHtcbiAgICB0aGlzLmxvZygnV0FSTicsIG1lc3NhZ2UsIG1ldGFkYXRhKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2dzIGVycm9yIGxldmVsIG1lc3NhZ2Ugd2l0aCBzdHJ1Y3R1cmVkIGZvcm1hdFxuICAgKi9cbiAgZXJyb3IobWVzc2FnZTogc3RyaW5nLCBlcnJvcj86IEVycm9yLCBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIGFueT4pOiB2b2lkIHtcbiAgICBjb25zdCBlcnJvck1ldGFkYXRhID0gZXJyb3IgPyB7XG4gICAgICBlcnJvck5hbWU6IGVycm9yLm5hbWUsXG4gICAgICBlcnJvck1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXG4gICAgICBlcnJvclN0YWNrOiBlcnJvci5zdGFjayxcbiAgICAgIC4uLm1ldGFkYXRhXG4gICAgfSA6IG1ldGFkYXRhO1xuXG4gICAgdGhpcy5sb2coJ0VSUk9SJywgbWVzc2FnZSwgZXJyb3JNZXRhZGF0YSk7XG4gIH1cblxuICAvKipcbiAgICogTG9ncyBkZWJ1ZyBsZXZlbCBtZXNzYWdlIHdpdGggc3RydWN0dXJlZCBmb3JtYXRcbiAgICovXG4gIGRlYnVnKG1lc3NhZ2U6IHN0cmluZywgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+KTogdm9pZCB7XG4gICAgLy8gT25seSBsb2cgZGVidWcgaW4gZGV2ZWxvcG1lbnQgb3Igd2hlbiBleHBsaWNpdGx5IGVuYWJsZWRcbiAgICBpZiAocHJvY2Vzcy5lbnYuTE9HX0xFVkVMID09PSAnREVCVUcnIHx8IHByb2Nlc3MuZW52Lk5PREVfRU5WID09PSAnZGV2ZWxvcG1lbnQnKSB7XG4gICAgICB0aGlzLmxvZygnREVCVUcnLCBtZXNzYWdlLCBtZXRhZGF0YSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIExvZ3MgZXhlY3V0aW9uIGR1cmF0aW9uIGZvciBwZXJmb3JtYW5jZSBtb25pdG9yaW5nXG4gICAqL1xuICBsb2dEdXJhdGlvbihvcGVyYXRpb246IHN0cmluZywgc3RhcnRUaW1lOiBudW1iZXIsIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgYW55Pik6IHZvaWQge1xuICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcbiAgICB0aGlzLmluZm8oYCR7b3BlcmF0aW9ufSBjb21wbGV0ZWRgLCB7XG4gICAgICBvcGVyYXRpb24sXG4gICAgICBkdXJhdGlvbk1zOiBkdXJhdGlvbixcbiAgICAgIC4uLm1ldGFkYXRhXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogTG9ncyBjb3N0IGFuYWx5c2lzIHJlc3VsdHNcbiAgICovXG4gIGxvZ0Nvc3RBbmFseXNpcyhjb3N0QW5hbHlzaXM6IGFueSk6IHZvaWQge1xuICAgIHRoaXMuaW5mbygnQ29zdCBhbmFseXNpcyBjb21wbGV0ZWQnLCB7XG4gICAgICB0b3RhbENvc3Q6IGNvc3RBbmFseXNpcy50b3RhbENvc3QsXG4gICAgICBwcm9qZWN0ZWRNb250aGx5OiBjb3N0QW5hbHlzaXMucHJvamVjdGVkTW9udGhseSxcbiAgICAgIHNlcnZpY2VDb3VudDogT2JqZWN0LmtleXMoY29zdEFuYWx5c2lzLnNlcnZpY2VCcmVha2Rvd24pLmxlbmd0aCxcbiAgICAgIHBlcmlvZDogY29zdEFuYWx5c2lzLnBlcmlvZCxcbiAgICAgIHRvcFNlcnZpY2VzOiBPYmplY3QuZW50cmllcyhjb3N0QW5hbHlzaXMuc2VydmljZUJyZWFrZG93bilcbiAgICAgICAgLnNvcnQoKFssYV0sIFssYl0pID0+IChiIGFzIG51bWJlcikgLSAoYSBhcyBudW1iZXIpKVxuICAgICAgICAuc2xpY2UoMCwgMylcbiAgICAgICAgLm1hcCgoW3NlcnZpY2UsIGNvc3RdKSA9PiAoeyBzZXJ2aWNlLCBjb3N0IH0pKVxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIExvZ3MgYWxlcnQgZGVsaXZlcnkgc3RhdHVzXG4gICAqL1xuICBsb2dBbGVydERlbGl2ZXJ5KHN1Y2Nlc3M6IGJvb2xlYW4sIGNoYW5uZWxzOiBzdHJpbmdbXSwgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+KTogdm9pZCB7XG4gICAgaWYgKHN1Y2Nlc3MpIHtcbiAgICAgIHRoaXMuaW5mbygnQWxlcnQgZGVsaXZlcmVkIHN1Y2Nlc3NmdWxseScsIHtcbiAgICAgICAgY2hhbm5lbHMsXG4gICAgICAgIGNoYW5uZWxDb3VudDogY2hhbm5lbHMubGVuZ3RoLFxuICAgICAgICAuLi5tZXRhZGF0YVxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZXJyb3IoJ0FsZXJ0IGRlbGl2ZXJ5IGZhaWxlZCcsIHVuZGVmaW5lZCwge1xuICAgICAgICBjaGFubmVscyxcbiAgICAgICAgY2hhbm5lbENvdW50OiBjaGFubmVscy5sZW5ndGgsXG4gICAgICAgIC4uLm1ldGFkYXRhXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ29yZSBsb2dnaW5nIG1ldGhvZCB3aXRoIHN0cnVjdHVyZWQgSlNPTiBmb3JtYXRcbiAgICovXG4gIHByaXZhdGUgbG9nKGxldmVsOiBzdHJpbmcsIG1lc3NhZ2U6IHN0cmluZywgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+KTogdm9pZCB7XG4gICAgY29uc3QgbG9nRW50cnkgPSB7XG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIGxldmVsLFxuICAgICAgbWVzc2FnZSxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IHRoaXMuY29ycmVsYXRpb25JZCxcbiAgICAgIGNvbnRleHQ6IHRoaXMuY29udGV4dCxcbiAgICAgIC4uLm1ldGFkYXRhXG4gICAgfTtcblxuICAgIC8vIFVzZSBjb25zb2xlIG1ldGhvZHMgZm9yIENsb3VkV2F0Y2ggY29tcGF0aWJpbGl0eVxuICAgIHN3aXRjaCAobGV2ZWwpIHtcbiAgICAgIGNhc2UgJ0VSUk9SJzpcbiAgICAgICAgY29uc29sZS5lcnJvcihKU09OLnN0cmluZ2lmeShsb2dFbnRyeSkpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ1dBUk4nOlxuICAgICAgICBjb25zb2xlLndhcm4oSlNPTi5zdHJpbmdpZnkobG9nRW50cnkpKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdERUJVRyc6XG4gICAgICAgIGNvbnNvbGUuZGVidWcoSlNPTi5zdHJpbmdpZnkobG9nRW50cnkpKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShsb2dFbnRyeSkpO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBsb2dnZXIgaW5zdGFuY2UgZm9yIHRoZSBnaXZlbiBjb250ZXh0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVMb2dnZXIoY29udGV4dDogc3RyaW5nLCBjb3JyZWxhdGlvbklkPzogc3RyaW5nKTogTG9nZ2VyIHtcbiAgcmV0dXJuIG5ldyBMb2dnZXIoY29udGV4dCwgY29ycmVsYXRpb25JZCk7XG59Il19