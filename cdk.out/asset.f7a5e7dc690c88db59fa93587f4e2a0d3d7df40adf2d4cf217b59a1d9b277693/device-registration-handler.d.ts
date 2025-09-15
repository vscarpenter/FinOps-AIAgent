import { APIGatewayEvent, APIGatewayResponse } from './types';
/**
 * Device Registration API Handler
 *
 * Handles iOS device token registration, updates, and management
 * for AWS Spend Monitor push notifications
 */
export declare class DeviceRegistrationHandler {
    private sns;
    private dynamodb;
    private platformApplicationArn;
    private deviceTableName;
    private bundleId;
    constructor();
    /**
     * Main Lambda handler for API Gateway events
     */
    handleRequest(event: APIGatewayEvent): Promise<APIGatewayResponse>;
    /**
     * Register a new iOS device for push notifications
     */
    private registerDevice;
    /**
     * Update an existing device token
     */
    private updateDevice;
    /**
     * List devices for a user
     */
    private listDevices;
    /**
     * Delete a device registration
     */
    private deleteDevice;
    /**
     * Validate device registration request
     */
    private validateDeviceRegistrationRequest;
    /**
     * Validate device token format (64-character hex string)
     */
    private isValidDeviceToken;
    /**
     * Create SNS platform endpoint for device
     */
    private createPlatformEndpoint;
    /**
     * Update SNS platform endpoint with new token
     */
    private updatePlatformEndpoint;
    /**
     * Delete SNS platform endpoint
     */
    private deletePlatformEndpoint;
    /**
     * Store device registration in DynamoDB
     */
    private storeDeviceRegistration;
    /**
     * Get device registration from DynamoDB
     */
    private getDeviceRegistration;
    /**
     * Delete device registration from DynamoDB
     */
    private deleteDeviceRegistration;
    /**
     * Get devices for a specific user
     */
    private getUserDevices;
    /**
     * Update existing device registration
     */
    private updateExistingDevice;
}
/**
 * Lambda handler function for API Gateway
 */
export declare const handler: (event: APIGatewayEvent) => Promise<APIGatewayResponse>;
