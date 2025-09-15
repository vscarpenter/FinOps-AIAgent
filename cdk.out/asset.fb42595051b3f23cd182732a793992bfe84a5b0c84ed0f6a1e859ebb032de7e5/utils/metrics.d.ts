/**
 * CloudWatch metrics utility for monitoring agent performance
 */
export declare class MetricsCollector {
    private cloudWatch;
    private namespace;
    private logger;
    constructor(region: string, namespace?: string);
    /**
     * Records execution duration metric
     */
    recordExecutionDuration(operation: string, durationMs: number, success: boolean): Promise<void>;
    /**
     * Records success/failure rate metrics
     */
    recordExecutionResult(operation: string, success: boolean): Promise<void>;
    /**
     * Records cost analysis metrics
     */
    recordCostAnalysis(totalCost: number, projectedCost: number, serviceCount: number): Promise<void>;
    /**
     * Records alert delivery metrics
     */
    recordAlertDelivery(channels: string[], success: boolean, retryCount?: number): Promise<void>;
    /**
     * Records threshold breach metrics
     */
    recordThresholdBreach(currentSpend: number, threshold: number, exceedAmount: number): Promise<void>;
    /**
     * Records iOS notification metrics
     */
    recordIOSNotification(deviceCount: number, success: boolean, invalidTokens?: number): Promise<void>;
    /**
     * Records iOS device registration metrics
     */
    recordIOSDeviceRegistration(success: boolean, errorType?: string): Promise<void>;
    /**
     * Records APNS certificate health metrics
     */
    recordAPNSCertificateHealth(isValid: boolean, daysUntilExpiration?: number, warningCount?: number, errorCount?: number): Promise<void>;
    /**
     * Records iOS notification payload metrics
     */
    recordIOSPayloadMetrics(payloadSize: number, deliveryTime: number, retryCount: number): Promise<void>;
    /**
     * Records iOS fallback usage metrics
     */
    recordIOSFallbackUsage(fallbackChannels: string[], success: boolean): Promise<void>;
    /**
     * Records API call metrics
     */
    recordAPICall(service: string, operation: string, durationMs: number, success: boolean): Promise<void>;
    /**
     * Sends metrics to CloudWatch
     */
    private putMetrics;
    /**
     * Creates a timer for measuring operation duration
     */
    createTimer(operation: string): {
        stop: (success: boolean) => Promise<void>;
    };
}
/**
 * Creates a metrics collector instance
 */
export declare function createMetricsCollector(region: string, namespace?: string): MetricsCollector;
