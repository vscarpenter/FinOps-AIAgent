import { Tool } from 'strands-agents';
import { iOSPushConfig, iOSDeviceRegistration } from '../types';
/**
 * Tool for managing iOS device registrations and APNS platform configuration
 */
export declare class iOSManagementTool extends Tool {
    private snsClient;
    private iosConfig;
    private iosLogger;
    private metrics;
    constructor(iosConfig: iOSPushConfig, region?: string);
    /**
     * Registers a new iOS device token with SNS platform endpoint
     */
    registerDevice(deviceToken: string, userId?: string): Promise<iOSDeviceRegistration>;
    /**
     * Updates an existing device token registration
     */
    updateDeviceToken(platformEndpointArn: string, newDeviceToken: string): Promise<void>;
    /**
     * Removes invalid or expired device tokens
     */
    removeInvalidTokens(platformEndpointArns: string[]): Promise<string[]>;
    /**
     * Validates APNS configuration by checking platform application
     */
    validateAPNSConfig(): Promise<boolean>;
    /**
     * Validates device token format (64-character hexadecimal string)
     */
    private isValidDeviceToken;
    /**
     * Deletes a platform endpoint
     */
    private deleteEndpoint;
    /**
     * Creates a platform endpoint for a device token
     */
    createPlatformEndpoint(deviceToken: string, customUserData?: string): Promise<string>;
    /**
     * Gets the current iOS configuration
     */
    getConfig(): iOSPushConfig;
    /**
     * Updates the iOS configuration
     */
    updateConfig(newConfig: Partial<iOSPushConfig>): void;
    /**
     * Processes APNS feedback service to identify and remove invalid tokens
     */
    processAPNSFeedback(): Promise<{
        removedTokens: string[];
        errors: string[];
    }>;
    /**
     * Validates APNS certificate expiration and platform application health
     */
    validateAPNSCertificateHealth(): Promise<{
        isValid: boolean;
        expirationDate?: Date;
        daysUntilExpiration?: number;
        warnings: string[];
        errors: string[];
    }>;
    /**
     * Enhanced device registration with comprehensive logging and metrics
     */
    registerDeviceWithMonitoring(deviceToken: string, userId?: string): Promise<iOSDeviceRegistration>;
    /**
     * Enhanced notification delivery with fallback handling
     */
    sendNotificationWithFallback(endpointArn: string, payload: any, fallbackChannels?: string[]): Promise<{
        success: boolean;
        fallbackUsed: boolean;
        errors: string[];
    }>;
    /**
     * Comprehensive iOS health check
     */
    performHealthCheck(): Promise<{
        overall: 'healthy' | 'warning' | 'critical';
        platformApp: {
            status: string;
            details: string[];
        };
        certificate: {
            status: string;
            details: string[];
        };
        endpoints: {
            active: number;
            invalid: number;
            total: number;
        };
        recommendations: string[];
    }>;
}
