import { iOSPushConfig } from '../types';
/**
 * Comprehensive iOS monitoring and error handling service
 */
export declare class iOSMonitoringService {
    private logger;
    private metrics;
    private iosManagementTool;
    private alertTool;
    private iosConfig;
    constructor(iosConfig: iOSPushConfig, region?: string);
    /**
     * Performs comprehensive iOS system health monitoring
     */
    performComprehensiveHealthCheck(): Promise<{
        overall: 'healthy' | 'warning' | 'critical';
        components: {
            platformApp: {
                status: string;
                details: string[];
            };
            certificate: {
                status: string;
                details: string[];
                daysUntilExpiration?: number;
            };
            endpoints: {
                active: number;
                invalid: number;
                total: number;
            };
            feedback: {
                processed: boolean;
                removedTokens: number;
                errors: string[];
            };
        };
        recommendations: string[];
        metrics: {
            healthCheckDuration: number;
            certificateValidationTime: number;
            feedbackProcessingTime: number;
        };
    }>;
    /**
     * Measures certificate validation performance
     */
    private measureCertificateValidation;
    /**
     * Measures feedback processing performance
     */
    private measureFeedbackProcessing;
    /**
     * Records comprehensive health check metrics
     */
    private recordHealthCheckMetrics;
    /**
     * Performs automated recovery actions based on health status
     */
    performAutomatedRecovery(healthStatus: any): Promise<{
        actionsPerformed: string[];
        success: boolean;
        errors: string[];
    }>;
    /**
     * Monitors iOS notification delivery with enhanced error handling
     */
    monitorNotificationDelivery(notificationAttempts: number, successfulDeliveries: number, failedDeliveries: number, fallbackUsed: boolean): Promise<void>;
    /**
     * Gets current iOS system status summary
     */
    getSystemStatusSummary(): Promise<{
        status: 'operational' | 'degraded' | 'outage';
        lastHealthCheck?: Date;
        certificateExpiration?: Date;
        activeDevices: number;
        recentErrors: number;
    }>;
}
/**
 * Creates an iOS monitoring service instance
 */
export declare function createiOSMonitoringService(iosConfig: iOSPushConfig, region?: string): iOSMonitoringService;
