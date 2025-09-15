import { Tool } from 'strands-agents';
import { CostAnalysis, AlertContext, ServiceCost, APNSPayload, RetryConfig } from '../types';
/**
 * Tool for sending multi-channel alerts via AWS SNS
 */
export declare class AlertTool extends Tool {
    private snsClient;
    private retryConfig;
    private alertLogger;
    private metrics;
    constructor(region?: string, retryConfig?: Partial<RetryConfig>);
    /**
     * Sends spend alert to all configured notification channels
     */
    sendSpendAlert(costAnalysis: CostAnalysis, alertContext: AlertContext, topicArn: string, iosConfig?: {
        platformApplicationArn: string;
        bundleId: string;
    }): Promise<void>;
    /**
     * Formats alert message for email and general display
     */
    formatAlertMessage(costAnalysis: CostAnalysis, alertContext: AlertContext): string;
    /**
     * Formats a shorter message for SMS delivery
     */
    formatSMSMessage(costAnalysis: CostAnalysis, alertContext: AlertContext): string;
    /**
     * Formats iOS push notification payload
     */
    formatIOSPayload(costAnalysis: CostAnalysis, alertContext: AlertContext): APNSPayload;
    /**
     * Creates alert context from cost analysis and threshold
     */
    createAlertContext(costAnalysis: CostAnalysis, threshold: number, topServices: ServiceCost[]): AlertContext;
    /**
     * Validates notification channels and topic configuration
     */
    validateChannels(topicArn: string): Promise<{
        email: boolean;
        sms: boolean;
        ios: boolean;
    }>;
    /**
     * Formats date range for display
     */
    private formatDateRange;
    /**
     * Validates SNS topic ARN format
     */
    private isValidSNSTopicArn;
    /**
     * Executes SNS operations with retry logic
     */
    private executeWithRetry;
    /**
     * Determines if an SNS error is retryable
     */
    private isRetryableError;
    /**
     * Sleep utility for retry delays
     */
    private sleep;
    /**
     * Sends a test alert to verify notification setup
     */
    sendTestAlert(topicArn: string, iosConfig?: {
        platformApplicationArn: string;
        bundleId: string;
    }): Promise<void>;
    /**
     * Determines if an error is related to iOS/APNS delivery
     */
    private isIOSRelatedError;
    /**
     * Enhanced alert delivery with comprehensive iOS monitoring
     */
    sendSpendAlertWithIOSMonitoring(costAnalysis: CostAnalysis, alertContext: AlertContext, topicArn: string, iosConfig?: {
        platformApplicationArn: string;
        bundleId: string;
    }): Promise<{
        success: boolean;
        channels: string[];
        iosDelivered: boolean;
        fallbackUsed: boolean;
        errors: string[];
        metrics: {
            deliveryTime: number;
            retryCount: number;
            payloadSize: number;
        };
    }>;
    /**
     * Enhanced retry execution with metrics tracking
     */
    private executeWithRetryWithMetrics;
}
