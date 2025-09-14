import { Tool } from 'strands-agents';
import { iOSPushConfig, iOSDeviceRegistration } from '../types';
/**
 * Tool for managing iOS device registrations and APNS platform configuration
 */
export declare class iOSManagementTool extends Tool {
    private snsClient;
    private iosConfig;
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
}
