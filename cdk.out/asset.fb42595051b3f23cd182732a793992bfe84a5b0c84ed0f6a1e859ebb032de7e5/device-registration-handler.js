"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = exports.DeviceRegistrationHandler = void 0;
const client_sns_1 = require("@aws-sdk/client-sns");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const util_dynamodb_1 = require("@aws-sdk/util-dynamodb");
/**
 * Device Registration API Handler
 *
 * Handles iOS device token registration, updates, and management
 * for AWS Spend Monitor push notifications
 */
class DeviceRegistrationHandler {
    constructor() {
        const region = process.env.AWS_REGION || 'us-east-1';
        this.sns = new client_sns_1.SNSClient({ region });
        this.dynamodb = new client_dynamodb_1.DynamoDBClient({ region });
        this.platformApplicationArn = process.env.IOS_PLATFORM_APP_ARN || '';
        this.deviceTableName = process.env.DEVICE_TOKEN_TABLE_NAME || '';
        this.bundleId = process.env.IOS_BUNDLE_ID || 'com.example.spendmonitor';
        if (!this.platformApplicationArn) {
            throw new Error('IOS_PLATFORM_APP_ARN environment variable is required');
        }
        if (!this.deviceTableName) {
            throw new Error('DEVICE_TOKEN_TABLE_NAME environment variable is required');
        }
    }
    /**
     * Main Lambda handler for API Gateway events
     */
    async handleRequest(event) {
        console.log('Device Registration API request:', {
            method: event.httpMethod,
            path: event.path,
            requestId: event.requestContext.requestId
        });
        try {
            // Add CORS headers
            const corsHeaders = {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
                'Content-Type': 'application/json'
            };
            // Handle preflight OPTIONS requests
            if (event.httpMethod === 'OPTIONS') {
                return {
                    statusCode: 200,
                    headers: corsHeaders,
                    body: ''
                };
            }
            // Route requests based on path and method
            const path = event.path;
            const method = event.httpMethod;
            if (path === '/devices' && method === 'POST') {
                return await this.registerDevice(event, corsHeaders);
            }
            else if (path === '/devices' && method === 'PUT') {
                return await this.updateDevice(event, corsHeaders);
            }
            else if (path === '/devices' && method === 'GET') {
                return await this.listDevices(event, corsHeaders);
            }
            else if (path.startsWith('/devices/') && method === 'DELETE') {
                return await this.deleteDevice(event, corsHeaders);
            }
            else {
                return {
                    statusCode: 404,
                    headers: corsHeaders,
                    body: JSON.stringify({ error: 'Not Found' })
                };
            }
        }
        catch (error) {
            console.error('Error handling device registration request:', error);
            return {
                statusCode: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    error: 'Internal Server Error',
                    message: error instanceof Error ? error.message : 'Unknown error'
                })
            };
        }
    }
    /**
     * Register a new iOS device for push notifications
     */
    async registerDevice(event, headers) {
        try {
            if (!event.body) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Request body is required' })
                };
            }
            const request = JSON.parse(event.body);
            // Validate request
            const validation = this.validateDeviceRegistrationRequest(request);
            if (!validation.valid) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: validation.error })
                };
            }
            // Check if device is already registered
            const existingDevice = await this.getDeviceRegistration(request.deviceToken);
            if (existingDevice) {
                console.log('Device already registered, updating registration');
                return await this.updateExistingDevice(existingDevice, request, headers);
            }
            // Create SNS platform endpoint
            const endpointArn = await this.createPlatformEndpoint(request.deviceToken);
            // Store device registration in DynamoDB
            const registration = {
                deviceToken: request.deviceToken,
                platformEndpointArn: endpointArn,
                userId: request.userId,
                registrationDate: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
                active: true
            };
            await this.storeDeviceRegistration(registration);
            const response = {
                success: true,
                platformEndpointArn: endpointArn,
                registrationDate: registration.registrationDate
            };
            console.log('Device registered successfully:', request.deviceToken);
            return {
                statusCode: 201,
                headers,
                body: JSON.stringify(response)
            };
        }
        catch (error) {
            console.error('Error registering device:', error);
            const response = {
                success: false,
                error: error instanceof Error ? error.message : 'Registration failed',
                registrationDate: new Date().toISOString()
            };
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify(response)
            };
        }
    }
    /**
     * Update an existing device token
     */
    async updateDevice(event, headers) {
        try {
            if (!event.body) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Request body is required' })
                };
            }
            const request = JSON.parse(event.body);
            // Validate request
            if (!this.isValidDeviceToken(request.currentToken) || !this.isValidDeviceToken(request.newToken)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Invalid device token format' })
                };
            }
            // Get existing device registration
            const existingDevice = await this.getDeviceRegistration(request.currentToken);
            if (!existingDevice) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: 'Device not found' })
                };
            }
            // Update SNS endpoint with new token
            await this.updatePlatformEndpoint(existingDevice.platformEndpointArn, request.newToken);
            // Delete old device registration
            await this.deleteDeviceRegistration(request.currentToken);
            // Create new device registration with updated token
            const updatedRegistration = {
                ...existingDevice,
                deviceToken: request.newToken,
                userId: request.userId || existingDevice.userId,
                lastUpdated: new Date().toISOString()
            };
            await this.storeDeviceRegistration(updatedRegistration);
            const response = {
                success: true,
                platformEndpointArn: existingDevice.platformEndpointArn,
                lastUpdated: updatedRegistration.lastUpdated
            };
            console.log('Device token updated successfully:', request.currentToken, '->', request.newToken);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify(response)
            };
        }
        catch (error) {
            console.error('Error updating device:', error);
            const response = {
                success: false,
                error: error instanceof Error ? error.message : 'Update failed',
                lastUpdated: new Date().toISOString()
            };
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify(response)
            };
        }
    }
    /**
     * List devices for a user
     */
    async listDevices(event, headers) {
        try {
            const userId = event.queryStringParameters?.userId;
            if (!userId) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'userId query parameter is required' })
                };
            }
            const limit = parseInt(event.queryStringParameters?.limit || '10');
            const nextToken = event.queryStringParameters?.nextToken;
            const devices = await this.getUserDevices(userId, limit, nextToken);
            const response = {
                success: true,
                devices: devices.devices,
                nextToken: devices.nextToken
            };
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify(response)
            };
        }
        catch (error) {
            console.error('Error listing devices:', error);
            const response = {
                success: false,
                error: error instanceof Error ? error.message : 'List failed'
            };
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify(response)
            };
        }
    }
    /**
     * Delete a device registration
     */
    async deleteDevice(event, headers) {
        try {
            const deviceToken = event.pathParameters?.deviceToken;
            if (!deviceToken) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Device token path parameter is required' })
                };
            }
            // Decode URL-encoded device token
            const decodedToken = decodeURIComponent(deviceToken);
            if (!this.isValidDeviceToken(decodedToken)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Invalid device token format' })
                };
            }
            // Get existing device registration
            const existingDevice = await this.getDeviceRegistration(decodedToken);
            if (!existingDevice) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: 'Device not found' })
                };
            }
            // Delete SNS platform endpoint
            await this.deletePlatformEndpoint(existingDevice.platformEndpointArn);
            // Delete device registration from DynamoDB
            await this.deleteDeviceRegistration(decodedToken);
            const response = {
                success: true,
                deletedAt: new Date().toISOString()
            };
            console.log('Device deleted successfully:', decodedToken);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify(response)
            };
        }
        catch (error) {
            console.error('Error deleting device:', error);
            const response = {
                success: false,
                error: error instanceof Error ? error.message : 'Delete failed',
                deletedAt: new Date().toISOString()
            };
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify(response)
            };
        }
    }
    /**
     * Validate device registration request
     */
    validateDeviceRegistrationRequest(request) {
        if (!request.deviceToken) {
            return { valid: false, error: 'Device token is required' };
        }
        if (!this.isValidDeviceToken(request.deviceToken)) {
            return { valid: false, error: 'Invalid device token format (must be 64-character hex string)' };
        }
        if (request.bundleId && request.bundleId !== this.bundleId) {
            return { valid: false, error: `Invalid bundle ID. Expected: ${this.bundleId}` };
        }
        return { valid: true };
    }
    /**
     * Validate device token format (64-character hex string)
     */
    isValidDeviceToken(token) {
        return /^[0-9a-fA-F]{64}$/.test(token);
    }
    /**
     * Create SNS platform endpoint for device
     */
    async createPlatformEndpoint(deviceToken) {
        const command = new client_sns_1.CreatePlatformEndpointCommand({
            PlatformApplicationArn: this.platformApplicationArn,
            Token: deviceToken,
            CustomUserData: JSON.stringify({
                bundleId: this.bundleId,
                registeredAt: new Date().toISOString()
            })
        });
        const response = await this.sns.send(command);
        if (!response.EndpointArn) {
            throw new Error('Failed to create platform endpoint');
        }
        return response.EndpointArn;
    }
    /**
     * Update SNS platform endpoint with new token
     */
    async updatePlatformEndpoint(endpointArn, newToken) {
        const command = new client_sns_1.SetEndpointAttributesCommand({
            EndpointArn: endpointArn,
            Attributes: {
                Token: newToken,
                Enabled: 'true'
            }
        });
        await this.sns.send(command);
    }
    /**
     * Delete SNS platform endpoint
     */
    async deletePlatformEndpoint(endpointArn) {
        try {
            const command = new client_sns_1.DeleteEndpointCommand({
                EndpointArn: endpointArn
            });
            await this.sns.send(command);
        }
        catch (error) {
            // Log error but don't fail the operation if endpoint doesn't exist
            console.warn('Failed to delete platform endpoint:', endpointArn, error);
        }
    }
    /**
     * Store device registration in DynamoDB
     */
    async storeDeviceRegistration(registration) {
        const command = new client_dynamodb_1.PutItemCommand({
            TableName: this.deviceTableName,
            Item: (0, util_dynamodb_1.marshall)(registration)
        });
        await this.dynamodb.send(command);
    }
    /**
     * Get device registration from DynamoDB
     */
    async getDeviceRegistration(deviceToken) {
        const command = new client_dynamodb_1.GetItemCommand({
            TableName: this.deviceTableName,
            Key: (0, util_dynamodb_1.marshall)({ deviceToken })
        });
        const response = await this.dynamodb.send(command);
        if (!response.Item) {
            return null;
        }
        return (0, util_dynamodb_1.unmarshall)(response.Item);
    }
    /**
     * Delete device registration from DynamoDB
     */
    async deleteDeviceRegistration(deviceToken) {
        const command = new client_dynamodb_1.DeleteItemCommand({
            TableName: this.deviceTableName,
            Key: (0, util_dynamodb_1.marshall)({ deviceToken })
        });
        await this.dynamodb.send(command);
    }
    /**
     * Get devices for a specific user
     */
    async getUserDevices(userId, limit = 10, nextToken) {
        const command = new client_dynamodb_1.ScanCommand({
            TableName: this.deviceTableName,
            FilterExpression: 'userId = :userId AND active = :active',
            ExpressionAttributeValues: (0, util_dynamodb_1.marshall)({
                ':userId': userId,
                ':active': true
            }),
            Limit: limit,
            ExclusiveStartKey: nextToken ? JSON.parse(Buffer.from(nextToken, 'base64').toString()) : undefined
        });
        const response = await this.dynamodb.send(command);
        const devices = response.Items?.map((item) => (0, util_dynamodb_1.unmarshall)(item)) || [];
        const responseNextToken = response.LastEvaluatedKey
            ? Buffer.from(JSON.stringify(response.LastEvaluatedKey)).toString('base64')
            : undefined;
        return {
            devices,
            nextToken: responseNextToken
        };
    }
    /**
     * Update existing device registration
     */
    async updateExistingDevice(existingDevice, request, headers) {
        // Update the existing registration
        const updatedRegistration = {
            ...existingDevice,
            userId: request.userId || existingDevice.userId,
            lastUpdated: new Date().toISOString(),
            active: true
        };
        await this.storeDeviceRegistration(updatedRegistration);
        const response = {
            success: true,
            platformEndpointArn: existingDevice.platformEndpointArn,
            registrationDate: updatedRegistration.lastUpdated
        };
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(response)
        };
    }
}
exports.DeviceRegistrationHandler = DeviceRegistrationHandler;
/**
 * Lambda handler function for API Gateway
 */
const handler = async (event) => {
    const deviceHandler = new DeviceRegistrationHandler();
    return await deviceHandler.handleRequest(event);
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGV2aWNlLXJlZ2lzdHJhdGlvbi1oYW5kbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL2RldmljZS1yZWdpc3RyYXRpb24taGFuZGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxvREFBa0s7QUFDbEssOERBQTZJO0FBQzdJLDBEQUE4RDtBQWU5RDs7Ozs7R0FLRztBQUNILE1BQWEseUJBQXlCO0lBT3BDO1FBQ0UsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLElBQUksV0FBVyxDQUFDO1FBQ3JELElBQUksQ0FBQyxHQUFHLEdBQUcsSUFBSSxzQkFBUyxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQztRQUNyQyxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDLENBQUM7UUFFL0MsSUFBSSxDQUFDLHNCQUFzQixHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0JBQW9CLElBQUksRUFBRSxDQUFDO1FBQ3JFLElBQUksQ0FBQyxlQUFlLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyx1QkFBdUIsSUFBSSxFQUFFLENBQUM7UUFDakUsSUFBSSxDQUFDLFFBQVEsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsSUFBSSwwQkFBMEIsQ0FBQztRQUV4RSxJQUFJLENBQUMsSUFBSSxDQUFDLHNCQUFzQixFQUFFLENBQUM7WUFDakMsTUFBTSxJQUFJLEtBQUssQ0FBQyx1REFBdUQsQ0FBQyxDQUFDO1FBQzNFLENBQUM7UUFDRCxJQUFJLENBQUMsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO1lBQzFCLE1BQU0sSUFBSSxLQUFLLENBQUMsMERBQTBELENBQUMsQ0FBQztRQUM5RSxDQUFDO0lBQ0gsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLGFBQWEsQ0FBQyxLQUFzQjtRQUN4QyxPQUFPLENBQUMsR0FBRyxDQUFDLGtDQUFrQyxF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QzNDLE9BQU8sRUFBRSxJQUFJO1lBQ2IsbUJBQW1CLEVBQUUsY0FBYyxDQUFDLG1CQUFtQjtZQUN2RCxnQkFBZ0IsRUFBRSxtQkFBbUIsQ0FBQyxXQUFXO1NBQ2xELENBQUM7UUFFRixPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPO1lBQ1AsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDO1NBQy9CLENBQUM7SUFDSixDQUFDO0NBQ0Y7QUFqaUJELDhEQWlpQkM7QUFFRDs7R0FFRztBQUNJLE1BQU0sT0FBTyxHQUFHLEtBQUssRUFBRSxLQUFzQixFQUErQixFQUFFO0lBQ25GLE1BQU0sYUFBYSxHQUFHLElBQUkseUJBQXlCLEVBQUUsQ0FBQztJQUN0RCxPQUFPLE1BQU0sYUFBYSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUNsRCxDQUFDLENBQUM7QUFIVyxRQUFBLE9BQU8sV0FHbEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTTlNDbGllbnQsIENyZWF0ZVBsYXRmb3JtRW5kcG9pbnRDb21tYW5kLCBEZWxldGVFbmRwb2ludENvbW1hbmQsIEdldEVuZHBvaW50QXR0cmlidXRlc0NvbW1hbmQsIFNldEVuZHBvaW50QXR0cmlidXRlc0NvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtc25zJztcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50LCBQdXRJdGVtQ29tbWFuZCwgR2V0SXRlbUNvbW1hbmQsIFVwZGF0ZUl0ZW1Db21tYW5kLCBEZWxldGVJdGVtQ29tbWFuZCwgU2NhbkNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xuaW1wb3J0IHsgbWFyc2hhbGwsIHVubWFyc2hhbGwgfSBmcm9tICdAYXdzLXNkay91dGlsLWR5bmFtb2RiJztcbmltcG9ydCB7XG4gIEFQSUdhdGV3YXlFdmVudCxcbiAgQVBJR2F0ZXdheVJlc3BvbnNlLFxuICBEZXZpY2VSZWdpc3RyYXRpb25SZXF1ZXN0LFxuICBEZXZpY2VSZWdpc3RyYXRpb25SZXNwb25zZSxcbiAgRGV2aWNlVXBkYXRlUmVxdWVzdCxcbiAgRGV2aWNlVXBkYXRlUmVzcG9uc2UsXG4gIERldmljZUxpc3RSZXF1ZXN0LFxuICBEZXZpY2VMaXN0UmVzcG9uc2UsXG4gIERldmljZURlbGV0ZVJlcXVlc3QsXG4gIERldmljZURlbGV0ZVJlc3BvbnNlLFxuICBpT1NEZXZpY2VSZWdpc3RyYXRpb25cbn0gZnJvbSAnLi90eXBlcyc7XG5cbi8qKlxuICogRGV2aWNlIFJlZ2lzdHJhdGlvbiBBUEkgSGFuZGxlclxuICogXG4gKiBIYW5kbGVzIGlPUyBkZXZpY2UgdG9rZW4gcmVnaXN0cmF0aW9uLCB1cGRhdGVzLCBhbmQgbWFuYWdlbWVudFxuICogZm9yIEFXUyBTcGVuZCBNb25pdG9yIHB1c2ggbm90aWZpY2F0aW9uc1xuICovXG5leHBvcnQgY2xhc3MgRGV2aWNlUmVnaXN0cmF0aW9uSGFuZGxlciB7XG4gIHByaXZhdGUgc25zOiBTTlNDbGllbnQ7XG4gIHByaXZhdGUgZHluYW1vZGI6IER5bmFtb0RCQ2xpZW50O1xuICBwcml2YXRlIHBsYXRmb3JtQXBwbGljYXRpb25Bcm46IHN0cmluZztcbiAgcHJpdmF0ZSBkZXZpY2VUYWJsZU5hbWU6IHN0cmluZztcbiAgcHJpdmF0ZSBidW5kbGVJZDogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIGNvbnN0IHJlZ2lvbiA9IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMSc7XG4gICAgdGhpcy5zbnMgPSBuZXcgU05TQ2xpZW50KHsgcmVnaW9uIH0pO1xuICAgIHRoaXMuZHluYW1vZGIgPSBuZXcgRHluYW1vREJDbGllbnQoeyByZWdpb24gfSk7XG4gICAgXG4gICAgdGhpcy5wbGF0Zm9ybUFwcGxpY2F0aW9uQXJuID0gcHJvY2Vzcy5lbnYuSU9TX1BMQVRGT1JNX0FQUF9BUk4gfHwgJyc7XG4gICAgdGhpcy5kZXZpY2VUYWJsZU5hbWUgPSBwcm9jZXNzLmVudi5ERVZJQ0VfVE9LRU5fVEFCTEVfTkFNRSB8fCAnJztcbiAgICB0aGlzLmJ1bmRsZUlkID0gcHJvY2Vzcy5lbnYuSU9TX0JVTkRMRV9JRCB8fCAnY29tLmV4YW1wbGUuc3BlbmRtb25pdG9yJztcblxuICAgIGlmICghdGhpcy5wbGF0Zm9ybUFwcGxpY2F0aW9uQXJuKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0lPU19QTEFURk9STV9BUFBfQVJOIGVudmlyb25tZW50IHZhcmlhYmxlIGlzIHJlcXVpcmVkJyk7XG4gICAgfVxuICAgIGlmICghdGhpcy5kZXZpY2VUYWJsZU5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignREVWSUNFX1RPS0VOX1RBQkxFX05BTUUgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQnKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTWFpbiBMYW1iZGEgaGFuZGxlciBmb3IgQVBJIEdhdGV3YXkgZXZlbnRzXG4gICAqL1xuICBhc3luYyBoYW5kbGVSZXF1ZXN0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQpOiBQcm9taXNlPEFQSUdhdGV3YXlSZXNwb25zZT4ge1xuICAgIGNvbnNvbGUubG9nKCdEZXZpY2UgUmVnaXN0cmF0aW9uIEFQSSByZXF1ZXN0OicsIHtcbiAgICAgIG1ldGhvZDogZXZlbnQuaHR0cE1ldGhvZCxcbiAgICAgIHBhdGg6IGV2ZW50LnBhdGgsXG4gICAgICByZXF1ZXN0SWQ6IGV2ZW50LnJlcXVlc3RDb250ZXh0LnJlcXVlc3RJZFxuICAgIH0pO1xuXG4gICAgdHJ5IHtcbiAgICAgIC8vIEFkZCBDT1JTIGhlYWRlcnNcbiAgICAgIGNvbnN0IGNvcnNIZWFkZXJzID0ge1xuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICdDb250ZW50LVR5cGUsWC1BbXotRGF0ZSxBdXRob3JpemF0aW9uLFgtQXBpLUtleSxYLUFtei1TZWN1cml0eS1Ub2tlbicsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCxQT1NULFBVVCxERUxFVEUsT1BUSU9OUycsXG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgIH07XG5cbiAgICAgIC8vIEhhbmRsZSBwcmVmbGlnaHQgT1BUSU9OUyByZXF1ZXN0c1xuICAgICAgaWYgKGV2ZW50Lmh0dHBNZXRob2QgPT09ICdPUFRJT05TJykge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcbiAgICAgICAgICBib2R5OiAnJ1xuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICAvLyBSb3V0ZSByZXF1ZXN0cyBiYXNlZCBvbiBwYXRoIGFuZCBtZXRob2RcbiAgICAgIGNvbnN0IHBhdGggPSBldmVudC5wYXRoO1xuICAgICAgY29uc3QgbWV0aG9kID0gZXZlbnQuaHR0cE1ldGhvZDtcblxuICAgICAgaWYgKHBhdGggPT09ICcvZGV2aWNlcycgJiYgbWV0aG9kID09PSAnUE9TVCcpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucmVnaXN0ZXJEZXZpY2UoZXZlbnQsIGNvcnNIZWFkZXJzKTtcbiAgICAgIH0gZWxzZSBpZiAocGF0aCA9PT0gJy9kZXZpY2VzJyAmJiBtZXRob2QgPT09ICdQVVQnKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnVwZGF0ZURldmljZShldmVudCwgY29yc0hlYWRlcnMpO1xuICAgICAgfSBlbHNlIGlmIChwYXRoID09PSAnL2RldmljZXMnICYmIG1ldGhvZCA9PT0gJ0dFVCcpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMubGlzdERldmljZXMoZXZlbnQsIGNvcnNIZWFkZXJzKTtcbiAgICAgIH0gZWxzZSBpZiAocGF0aC5zdGFydHNXaXRoKCcvZGV2aWNlcy8nKSAmJiBtZXRob2QgPT09ICdERUxFVEUnKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmRlbGV0ZURldmljZShldmVudCwgY29yc0hlYWRlcnMpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdGF0dXNDb2RlOiA0MDQsXG4gICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ05vdCBGb3VuZCcgfSlcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBoYW5kbGluZyBkZXZpY2UgcmVnaXN0cmF0aW9uIHJlcXVlc3Q6JywgZXJyb3IpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogNTAwLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonXG4gICAgICAgIH0sXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBlcnJvcjogJ0ludGVybmFsIFNlcnZlciBFcnJvcicsXG4gICAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcidcbiAgICAgICAgfSlcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVyIGEgbmV3IGlPUyBkZXZpY2UgZm9yIHB1c2ggbm90aWZpY2F0aW9uc1xuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyByZWdpc3RlckRldmljZShldmVudDogQVBJR2F0ZXdheUV2ZW50LCBoZWFkZXJzOiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9KTogUHJvbWlzZTxBUElHYXRld2F5UmVzcG9uc2U+IHtcbiAgICB0cnkge1xuICAgICAgaWYgKCFldmVudC5ib2R5KSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxuICAgICAgICAgIGhlYWRlcnMsXG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1JlcXVlc3QgYm9keSBpcyByZXF1aXJlZCcgfSlcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVxdWVzdDogRGV2aWNlUmVnaXN0cmF0aW9uUmVxdWVzdCA9IEpTT04ucGFyc2UoZXZlbnQuYm9keSk7XG4gICAgICBcbiAgICAgIC8vIFZhbGlkYXRlIHJlcXVlc3RcbiAgICAgIGNvbnN0IHZhbGlkYXRpb24gPSB0aGlzLnZhbGlkYXRlRGV2aWNlUmVnaXN0cmF0aW9uUmVxdWVzdChyZXF1ZXN0KTtcbiAgICAgIGlmICghdmFsaWRhdGlvbi52YWxpZCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICAgICAgICBoZWFkZXJzLFxuICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IHZhbGlkYXRpb24uZXJyb3IgfSlcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgLy8gQ2hlY2sgaWYgZGV2aWNlIGlzIGFscmVhZHkgcmVnaXN0ZXJlZFxuICAgICAgY29uc3QgZXhpc3RpbmdEZXZpY2UgPSBhd2FpdCB0aGlzLmdldERldmljZVJlZ2lzdHJhdGlvbihyZXF1ZXN0LmRldmljZVRva2VuKTtcbiAgICAgIGlmIChleGlzdGluZ0RldmljZSkge1xuICAgICAgICBjb25zb2xlLmxvZygnRGV2aWNlIGFscmVhZHkgcmVnaXN0ZXJlZCwgdXBkYXRpbmcgcmVnaXN0cmF0aW9uJyk7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnVwZGF0ZUV4aXN0aW5nRGV2aWNlKGV4aXN0aW5nRGV2aWNlLCByZXF1ZXN0LCBoZWFkZXJzKTtcbiAgICAgIH1cblxuICAgICAgLy8gQ3JlYXRlIFNOUyBwbGF0Zm9ybSBlbmRwb2ludFxuICAgICAgY29uc3QgZW5kcG9pbnRBcm4gPSBhd2FpdCB0aGlzLmNyZWF0ZVBsYXRmb3JtRW5kcG9pbnQocmVxdWVzdC5kZXZpY2VUb2tlbik7XG5cbiAgICAgIC8vIFN0b3JlIGRldmljZSByZWdpc3RyYXRpb24gaW4gRHluYW1vREJcbiAgICAgIGNvbnN0IHJlZ2lzdHJhdGlvbjogaU9TRGV2aWNlUmVnaXN0cmF0aW9uID0ge1xuICAgICAgICBkZXZpY2VUb2tlbjogcmVxdWVzdC5kZXZpY2VUb2tlbixcbiAgICAgICAgcGxhdGZvcm1FbmRwb2ludEFybjogZW5kcG9pbnRBcm4sXG4gICAgICAgIHVzZXJJZDogcmVxdWVzdC51c2VySWQsXG4gICAgICAgIHJlZ2lzdHJhdGlvbkRhdGU6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgbGFzdFVwZGF0ZWQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgYWN0aXZlOiB0cnVlXG4gICAgICB9O1xuXG4gICAgICBhd2FpdCB0aGlzLnN0b3JlRGV2aWNlUmVnaXN0cmF0aW9uKHJlZ2lzdHJhdGlvbik7XG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlOiBEZXZpY2VSZWdpc3RyYXRpb25SZXNwb25zZSA9IHtcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgcGxhdGZvcm1FbmRwb2ludEFybjogZW5kcG9pbnRBcm4sXG4gICAgICAgIHJlZ2lzdHJhdGlvbkRhdGU6IHJlZ2lzdHJhdGlvbi5yZWdpc3RyYXRpb25EYXRlXG4gICAgICB9O1xuXG4gICAgICBjb25zb2xlLmxvZygnRGV2aWNlIHJlZ2lzdGVyZWQgc3VjY2Vzc2Z1bGx5OicsIHJlcXVlc3QuZGV2aWNlVG9rZW4pO1xuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiAyMDEsXG4gICAgICAgIGhlYWRlcnMsXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKVxuICAgICAgfTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciByZWdpc3RlcmluZyBkZXZpY2U6JywgZXJyb3IpO1xuICAgICAgXG4gICAgICBjb25zdCByZXNwb25zZTogRGV2aWNlUmVnaXN0cmF0aW9uUmVzcG9uc2UgPSB7XG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICBlcnJvcjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnUmVnaXN0cmF0aW9uIGZhaWxlZCcsXG4gICAgICAgIHJlZ2lzdHJhdGlvbkRhdGU6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgfTtcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogNTAwLFxuICAgICAgICBoZWFkZXJzLFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXNwb25zZSlcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSBhbiBleGlzdGluZyBkZXZpY2UgdG9rZW5cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgdXBkYXRlRGV2aWNlKGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGhlYWRlcnM6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH0pOiBQcm9taXNlPEFQSUdhdGV3YXlSZXNwb25zZT4ge1xuICAgIHRyeSB7XG4gICAgICBpZiAoIWV2ZW50LmJvZHkpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgICAgaGVhZGVycyxcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnUmVxdWVzdCBib2R5IGlzIHJlcXVpcmVkJyB9KVxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICBjb25zdCByZXF1ZXN0OiBEZXZpY2VVcGRhdGVSZXF1ZXN0ID0gSlNPTi5wYXJzZShldmVudC5ib2R5KTtcbiAgICAgIFxuICAgICAgLy8gVmFsaWRhdGUgcmVxdWVzdFxuICAgICAgaWYgKCF0aGlzLmlzVmFsaWREZXZpY2VUb2tlbihyZXF1ZXN0LmN1cnJlbnRUb2tlbikgfHwgIXRoaXMuaXNWYWxpZERldmljZVRva2VuKHJlcXVlc3QubmV3VG9rZW4pKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxuICAgICAgICAgIGhlYWRlcnMsXG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ0ludmFsaWQgZGV2aWNlIHRva2VuIGZvcm1hdCcgfSlcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgLy8gR2V0IGV4aXN0aW5nIGRldmljZSByZWdpc3RyYXRpb25cbiAgICAgIGNvbnN0IGV4aXN0aW5nRGV2aWNlID0gYXdhaXQgdGhpcy5nZXREZXZpY2VSZWdpc3RyYXRpb24ocmVxdWVzdC5jdXJyZW50VG9rZW4pO1xuICAgICAgaWYgKCFleGlzdGluZ0RldmljZSkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHN0YXR1c0NvZGU6IDQwNCxcbiAgICAgICAgICBoZWFkZXJzLFxuICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdEZXZpY2Ugbm90IGZvdW5kJyB9KVxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICAvLyBVcGRhdGUgU05TIGVuZHBvaW50IHdpdGggbmV3IHRva2VuXG4gICAgICBhd2FpdCB0aGlzLnVwZGF0ZVBsYXRmb3JtRW5kcG9pbnQoZXhpc3RpbmdEZXZpY2UucGxhdGZvcm1FbmRwb2ludEFybiwgcmVxdWVzdC5uZXdUb2tlbik7XG5cbiAgICAgIC8vIERlbGV0ZSBvbGQgZGV2aWNlIHJlZ2lzdHJhdGlvblxuICAgICAgYXdhaXQgdGhpcy5kZWxldGVEZXZpY2VSZWdpc3RyYXRpb24ocmVxdWVzdC5jdXJyZW50VG9rZW4pO1xuXG4gICAgICAvLyBDcmVhdGUgbmV3IGRldmljZSByZWdpc3RyYXRpb24gd2l0aCB1cGRhdGVkIHRva2VuXG4gICAgICBjb25zdCB1cGRhdGVkUmVnaXN0cmF0aW9uOiBpT1NEZXZpY2VSZWdpc3RyYXRpb24gPSB7XG4gICAgICAgIC4uLmV4aXN0aW5nRGV2aWNlLFxuICAgICAgICBkZXZpY2VUb2tlbjogcmVxdWVzdC5uZXdUb2tlbixcbiAgICAgICAgdXNlcklkOiByZXF1ZXN0LnVzZXJJZCB8fCBleGlzdGluZ0RldmljZS51c2VySWQsXG4gICAgICAgIGxhc3RVcGRhdGVkOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgIH07XG5cbiAgICAgIGF3YWl0IHRoaXMuc3RvcmVEZXZpY2VSZWdpc3RyYXRpb24odXBkYXRlZFJlZ2lzdHJhdGlvbik7XG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlOiBEZXZpY2VVcGRhdGVSZXNwb25zZSA9IHtcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgcGxhdGZvcm1FbmRwb2ludEFybjogZXhpc3RpbmdEZXZpY2UucGxhdGZvcm1FbmRwb2ludEFybixcbiAgICAgICAgbGFzdFVwZGF0ZWQ6IHVwZGF0ZWRSZWdpc3RyYXRpb24ubGFzdFVwZGF0ZWRcbiAgICAgIH07XG5cbiAgICAgIGNvbnNvbGUubG9nKCdEZXZpY2UgdG9rZW4gdXBkYXRlZCBzdWNjZXNzZnVsbHk6JywgcmVxdWVzdC5jdXJyZW50VG9rZW4sICctPicsIHJlcXVlc3QubmV3VG9rZW4pO1xuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgIGhlYWRlcnMsXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKVxuICAgICAgfTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciB1cGRhdGluZyBkZXZpY2U6JywgZXJyb3IpO1xuICAgICAgXG4gICAgICBjb25zdCByZXNwb25zZTogRGV2aWNlVXBkYXRlUmVzcG9uc2UgPSB7XG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICBlcnJvcjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVXBkYXRlIGZhaWxlZCcsXG4gICAgICAgIGxhc3RVcGRhdGVkOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgIH07XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1c0NvZGU6IDUwMCxcbiAgICAgICAgaGVhZGVycyxcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBMaXN0IGRldmljZXMgZm9yIGEgdXNlclxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBsaXN0RGV2aWNlcyhldmVudDogQVBJR2F0ZXdheUV2ZW50LCBoZWFkZXJzOiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9KTogUHJvbWlzZTxBUElHYXRld2F5UmVzcG9uc2U+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgdXNlcklkID0gZXZlbnQucXVlcnlTdHJpbmdQYXJhbWV0ZXJzPy51c2VySWQ7XG4gICAgICBpZiAoIXVzZXJJZCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICAgICAgICBoZWFkZXJzLFxuICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICd1c2VySWQgcXVlcnkgcGFyYW1ldGVyIGlzIHJlcXVpcmVkJyB9KVxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICBjb25zdCBsaW1pdCA9IHBhcnNlSW50KGV2ZW50LnF1ZXJ5U3RyaW5nUGFyYW1ldGVycz8ubGltaXQgfHwgJzEwJyk7XG4gICAgICBjb25zdCBuZXh0VG9rZW4gPSBldmVudC5xdWVyeVN0cmluZ1BhcmFtZXRlcnM/Lm5leHRUb2tlbjtcblxuICAgICAgY29uc3QgZGV2aWNlcyA9IGF3YWl0IHRoaXMuZ2V0VXNlckRldmljZXModXNlcklkLCBsaW1pdCwgbmV4dFRva2VuKTtcblxuICAgICAgY29uc3QgcmVzcG9uc2U6IERldmljZUxpc3RSZXNwb25zZSA9IHtcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgZGV2aWNlczogZGV2aWNlcy5kZXZpY2VzLFxuICAgICAgICBuZXh0VG9rZW46IGRldmljZXMubmV4dFRva2VuXG4gICAgICB9O1xuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgIGhlYWRlcnMsXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKVxuICAgICAgfTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBsaXN0aW5nIGRldmljZXM6JywgZXJyb3IpO1xuICAgICAgXG4gICAgICBjb25zdCByZXNwb25zZTogRGV2aWNlTGlzdFJlc3BvbnNlID0ge1xuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ0xpc3QgZmFpbGVkJ1xuICAgICAgfTtcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogNTAwLFxuICAgICAgICBoZWFkZXJzLFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXNwb25zZSlcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZSBhIGRldmljZSByZWdpc3RyYXRpb25cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgZGVsZXRlRGV2aWNlKGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGhlYWRlcnM6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH0pOiBQcm9taXNlPEFQSUdhdGV3YXlSZXNwb25zZT4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBkZXZpY2VUb2tlbiA9IGV2ZW50LnBhdGhQYXJhbWV0ZXJzPy5kZXZpY2VUb2tlbjtcbiAgICAgIGlmICghZGV2aWNlVG9rZW4pIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgICAgaGVhZGVycyxcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnRGV2aWNlIHRva2VuIHBhdGggcGFyYW1ldGVyIGlzIHJlcXVpcmVkJyB9KVxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICAvLyBEZWNvZGUgVVJMLWVuY29kZWQgZGV2aWNlIHRva2VuXG4gICAgICBjb25zdCBkZWNvZGVkVG9rZW4gPSBkZWNvZGVVUklDb21wb25lbnQoZGV2aWNlVG9rZW4pO1xuXG4gICAgICBpZiAoIXRoaXMuaXNWYWxpZERldmljZVRva2VuKGRlY29kZWRUb2tlbikpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgICAgaGVhZGVycyxcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnSW52YWxpZCBkZXZpY2UgdG9rZW4gZm9ybWF0JyB9KVxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICAvLyBHZXQgZXhpc3RpbmcgZGV2aWNlIHJlZ2lzdHJhdGlvblxuICAgICAgY29uc3QgZXhpc3RpbmdEZXZpY2UgPSBhd2FpdCB0aGlzLmdldERldmljZVJlZ2lzdHJhdGlvbihkZWNvZGVkVG9rZW4pO1xuICAgICAgaWYgKCFleGlzdGluZ0RldmljZSkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHN0YXR1c0NvZGU6IDQwNCxcbiAgICAgICAgICBoZWFkZXJzLFxuICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdEZXZpY2Ugbm90IGZvdW5kJyB9KVxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICAvLyBEZWxldGUgU05TIHBsYXRmb3JtIGVuZHBvaW50XG4gICAgICBhd2FpdCB0aGlzLmRlbGV0ZVBsYXRmb3JtRW5kcG9pbnQoZXhpc3RpbmdEZXZpY2UucGxhdGZvcm1FbmRwb2ludEFybik7XG5cbiAgICAgIC8vIERlbGV0ZSBkZXZpY2UgcmVnaXN0cmF0aW9uIGZyb20gRHluYW1vREJcbiAgICAgIGF3YWl0IHRoaXMuZGVsZXRlRGV2aWNlUmVnaXN0cmF0aW9uKGRlY29kZWRUb2tlbik7XG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlOiBEZXZpY2VEZWxldGVSZXNwb25zZSA9IHtcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgZGVsZXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgIH07XG5cbiAgICAgIGNvbnNvbGUubG9nKCdEZXZpY2UgZGVsZXRlZCBzdWNjZXNzZnVsbHk6JywgZGVjb2RlZFRva2VuKTtcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICAgICAgICBoZWFkZXJzLFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXNwb25zZSlcbiAgICAgIH07XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZGVsZXRpbmcgZGV2aWNlOicsIGVycm9yKTtcbiAgICAgIFxuICAgICAgY29uc3QgcmVzcG9uc2U6IERldmljZURlbGV0ZVJlc3BvbnNlID0ge1xuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ0RlbGV0ZSBmYWlsZWQnLFxuICAgICAgICBkZWxldGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgfTtcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogNTAwLFxuICAgICAgICBoZWFkZXJzLFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXNwb25zZSlcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlIGRldmljZSByZWdpc3RyYXRpb24gcmVxdWVzdFxuICAgKi9cbiAgcHJpdmF0ZSB2YWxpZGF0ZURldmljZVJlZ2lzdHJhdGlvblJlcXVlc3QocmVxdWVzdDogRGV2aWNlUmVnaXN0cmF0aW9uUmVxdWVzdCk6IHsgdmFsaWQ6IGJvb2xlYW47IGVycm9yPzogc3RyaW5nIH0ge1xuICAgIGlmICghcmVxdWVzdC5kZXZpY2VUb2tlbikge1xuICAgICAgcmV0dXJuIHsgdmFsaWQ6IGZhbHNlLCBlcnJvcjogJ0RldmljZSB0b2tlbiBpcyByZXF1aXJlZCcgfTtcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuaXNWYWxpZERldmljZVRva2VuKHJlcXVlc3QuZGV2aWNlVG9rZW4pKSB7XG4gICAgICByZXR1cm4geyB2YWxpZDogZmFsc2UsIGVycm9yOiAnSW52YWxpZCBkZXZpY2UgdG9rZW4gZm9ybWF0IChtdXN0IGJlIDY0LWNoYXJhY3RlciBoZXggc3RyaW5nKScgfTtcbiAgICB9XG5cbiAgICBpZiAocmVxdWVzdC5idW5kbGVJZCAmJiByZXF1ZXN0LmJ1bmRsZUlkICE9PSB0aGlzLmJ1bmRsZUlkKSB7XG4gICAgICByZXR1cm4geyB2YWxpZDogZmFsc2UsIGVycm9yOiBgSW52YWxpZCBidW5kbGUgSUQuIEV4cGVjdGVkOiAke3RoaXMuYnVuZGxlSWR9YCB9O1xuICAgIH1cblxuICAgIHJldHVybiB7IHZhbGlkOiB0cnVlIH07XG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGUgZGV2aWNlIHRva2VuIGZvcm1hdCAoNjQtY2hhcmFjdGVyIGhleCBzdHJpbmcpXG4gICAqL1xuICBwcml2YXRlIGlzVmFsaWREZXZpY2VUb2tlbih0b2tlbjogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIC9eWzAtOWEtZkEtRl17NjR9JC8udGVzdCh0b2tlbik7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIFNOUyBwbGF0Zm9ybSBlbmRwb2ludCBmb3IgZGV2aWNlXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGNyZWF0ZVBsYXRmb3JtRW5kcG9pbnQoZGV2aWNlVG9rZW46IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3QgY29tbWFuZCA9IG5ldyBDcmVhdGVQbGF0Zm9ybUVuZHBvaW50Q29tbWFuZCh7XG4gICAgICBQbGF0Zm9ybUFwcGxpY2F0aW9uQXJuOiB0aGlzLnBsYXRmb3JtQXBwbGljYXRpb25Bcm4sXG4gICAgICBUb2tlbjogZGV2aWNlVG9rZW4sXG4gICAgICBDdXN0b21Vc2VyRGF0YTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBidW5kbGVJZDogdGhpcy5idW5kbGVJZCxcbiAgICAgICAgcmVnaXN0ZXJlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgIH0pXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuc25zLnNlbmQoY29tbWFuZCk7XG4gICAgXG4gICAgaWYgKCFyZXNwb25zZS5FbmRwb2ludEFybikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdGYWlsZWQgdG8gY3JlYXRlIHBsYXRmb3JtIGVuZHBvaW50Jyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3BvbnNlLkVuZHBvaW50QXJuO1xuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSBTTlMgcGxhdGZvcm0gZW5kcG9pbnQgd2l0aCBuZXcgdG9rZW5cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgdXBkYXRlUGxhdGZvcm1FbmRwb2ludChlbmRwb2ludEFybjogc3RyaW5nLCBuZXdUb2tlbjogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY29tbWFuZCA9IG5ldyBTZXRFbmRwb2ludEF0dHJpYnV0ZXNDb21tYW5kKHtcbiAgICAgIEVuZHBvaW50QXJuOiBlbmRwb2ludEFybixcbiAgICAgIEF0dHJpYnV0ZXM6IHtcbiAgICAgICAgVG9rZW46IG5ld1Rva2VuLFxuICAgICAgICBFbmFibGVkOiAndHJ1ZSdcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGF3YWl0IHRoaXMuc25zLnNlbmQoY29tbWFuZCk7XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlIFNOUyBwbGF0Zm9ybSBlbmRwb2ludFxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBkZWxldGVQbGF0Zm9ybUVuZHBvaW50KGVuZHBvaW50QXJuOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBEZWxldGVFbmRwb2ludENvbW1hbmQoe1xuICAgICAgICBFbmRwb2ludEFybjogZW5kcG9pbnRBcm5cbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCB0aGlzLnNucy5zZW5kKGNvbW1hbmQpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBMb2cgZXJyb3IgYnV0IGRvbid0IGZhaWwgdGhlIG9wZXJhdGlvbiBpZiBlbmRwb2ludCBkb2Vzbid0IGV4aXN0XG4gICAgICBjb25zb2xlLndhcm4oJ0ZhaWxlZCB0byBkZWxldGUgcGxhdGZvcm0gZW5kcG9pbnQ6JywgZW5kcG9pbnRBcm4sIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU3RvcmUgZGV2aWNlIHJlZ2lzdHJhdGlvbiBpbiBEeW5hbW9EQlxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBzdG9yZURldmljZVJlZ2lzdHJhdGlvbihyZWdpc3RyYXRpb246IGlPU0RldmljZVJlZ2lzdHJhdGlvbik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgUHV0SXRlbUNvbW1hbmQoe1xuICAgICAgVGFibGVOYW1lOiB0aGlzLmRldmljZVRhYmxlTmFtZSxcbiAgICAgIEl0ZW06IG1hcnNoYWxsKHJlZ2lzdHJhdGlvbilcbiAgICB9KTtcblxuICAgIGF3YWl0IHRoaXMuZHluYW1vZGIuc2VuZChjb21tYW5kKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgZGV2aWNlIHJlZ2lzdHJhdGlvbiBmcm9tIER5bmFtb0RCXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGdldERldmljZVJlZ2lzdHJhdGlvbihkZXZpY2VUb2tlbjogc3RyaW5nKTogUHJvbWlzZTxpT1NEZXZpY2VSZWdpc3RyYXRpb24gfCBudWxsPiB7XG4gICAgY29uc3QgY29tbWFuZCA9IG5ldyBHZXRJdGVtQ29tbWFuZCh7XG4gICAgICBUYWJsZU5hbWU6IHRoaXMuZGV2aWNlVGFibGVOYW1lLFxuICAgICAgS2V5OiBtYXJzaGFsbCh7IGRldmljZVRva2VuIH0pXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuZHluYW1vZGIuc2VuZChjb21tYW5kKTtcbiAgICBcbiAgICBpZiAoIXJlc3BvbnNlLkl0ZW0pIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiB1bm1hcnNoYWxsKHJlc3BvbnNlLkl0ZW0pIGFzIGlPU0RldmljZVJlZ2lzdHJhdGlvbjtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGUgZGV2aWNlIHJlZ2lzdHJhdGlvbiBmcm9tIER5bmFtb0RCXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGRlbGV0ZURldmljZVJlZ2lzdHJhdGlvbihkZXZpY2VUb2tlbjogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY29tbWFuZCA9IG5ldyBEZWxldGVJdGVtQ29tbWFuZCh7XG4gICAgICBUYWJsZU5hbWU6IHRoaXMuZGV2aWNlVGFibGVOYW1lLFxuICAgICAgS2V5OiBtYXJzaGFsbCh7IGRldmljZVRva2VuIH0pXG4gICAgfSk7XG5cbiAgICBhd2FpdCB0aGlzLmR5bmFtb2RiLnNlbmQoY29tbWFuZCk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGRldmljZXMgZm9yIGEgc3BlY2lmaWMgdXNlclxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBnZXRVc2VyRGV2aWNlcyh1c2VySWQ6IHN0cmluZywgbGltaXQ6IG51bWJlciA9IDEwLCBuZXh0VG9rZW4/OiBzdHJpbmcpOiBQcm9taXNlPHsgZGV2aWNlczogaU9TRGV2aWNlUmVnaXN0cmF0aW9uW107IG5leHRUb2tlbj86IHN0cmluZyB9PiB7XG4gICAgY29uc3QgY29tbWFuZCA9IG5ldyBTY2FuQ29tbWFuZCh7XG4gICAgICBUYWJsZU5hbWU6IHRoaXMuZGV2aWNlVGFibGVOYW1lLFxuICAgICAgRmlsdGVyRXhwcmVzc2lvbjogJ3VzZXJJZCA9IDp1c2VySWQgQU5EIGFjdGl2ZSA9IDphY3RpdmUnLFxuICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczogbWFyc2hhbGwoe1xuICAgICAgICAnOnVzZXJJZCc6IHVzZXJJZCxcbiAgICAgICAgJzphY3RpdmUnOiB0cnVlXG4gICAgICB9KSxcbiAgICAgIExpbWl0OiBsaW1pdCxcbiAgICAgIEV4Y2x1c2l2ZVN0YXJ0S2V5OiBuZXh0VG9rZW4gPyBKU09OLnBhcnNlKEJ1ZmZlci5mcm9tKG5leHRUb2tlbiwgJ2Jhc2U2NCcpLnRvU3RyaW5nKCkpIDogdW5kZWZpbmVkXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuZHluYW1vZGIuc2VuZChjb21tYW5kKTtcbiAgICBcbiAgICBjb25zdCBkZXZpY2VzID0gcmVzcG9uc2UuSXRlbXM/Lm1hcCgoaXRlbTogYW55KSA9PiB1bm1hcnNoYWxsKGl0ZW0pIGFzIGlPU0RldmljZVJlZ2lzdHJhdGlvbikgfHwgW107XG4gICAgXG4gICAgY29uc3QgcmVzcG9uc2VOZXh0VG9rZW4gPSByZXNwb25zZS5MYXN0RXZhbHVhdGVkS2V5IFxuICAgICAgPyBCdWZmZXIuZnJvbShKU09OLnN0cmluZ2lmeShyZXNwb25zZS5MYXN0RXZhbHVhdGVkS2V5KSkudG9TdHJpbmcoJ2Jhc2U2NCcpXG4gICAgICA6IHVuZGVmaW5lZDtcblxuICAgIHJldHVybiB7XG4gICAgICBkZXZpY2VzLFxuICAgICAgbmV4dFRva2VuOiByZXNwb25zZU5leHRUb2tlblxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlIGV4aXN0aW5nIGRldmljZSByZWdpc3RyYXRpb25cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgdXBkYXRlRXhpc3RpbmdEZXZpY2UoXG4gICAgZXhpc3RpbmdEZXZpY2U6IGlPU0RldmljZVJlZ2lzdHJhdGlvbiwgXG4gICAgcmVxdWVzdDogRGV2aWNlUmVnaXN0cmF0aW9uUmVxdWVzdCwgXG4gICAgaGVhZGVyczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfVxuICApOiBQcm9taXNlPEFQSUdhdGV3YXlSZXNwb25zZT4ge1xuICAgIC8vIFVwZGF0ZSB0aGUgZXhpc3RpbmcgcmVnaXN0cmF0aW9uXG4gICAgY29uc3QgdXBkYXRlZFJlZ2lzdHJhdGlvbjogaU9TRGV2aWNlUmVnaXN0cmF0aW9uID0ge1xuICAgICAgLi4uZXhpc3RpbmdEZXZpY2UsXG4gICAgICB1c2VySWQ6IHJlcXVlc3QudXNlcklkIHx8IGV4aXN0aW5nRGV2aWNlLnVzZXJJZCxcbiAgICAgIGxhc3RVcGRhdGVkOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBhY3RpdmU6IHRydWVcbiAgICB9O1xuXG4gICAgYXdhaXQgdGhpcy5zdG9yZURldmljZVJlZ2lzdHJhdGlvbih1cGRhdGVkUmVnaXN0cmF0aW9uKTtcblxuICAgIGNvbnN0IHJlc3BvbnNlOiBEZXZpY2VSZWdpc3RyYXRpb25SZXNwb25zZSA9IHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBwbGF0Zm9ybUVuZHBvaW50QXJuOiBleGlzdGluZ0RldmljZS5wbGF0Zm9ybUVuZHBvaW50QXJuLFxuICAgICAgcmVnaXN0cmF0aW9uRGF0ZTogdXBkYXRlZFJlZ2lzdHJhdGlvbi5sYXN0VXBkYXRlZFxuICAgIH07XG5cbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICAgICAgaGVhZGVycyxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKVxuICAgIH07XG4gIH1cbn1cblxuLyoqXG4gKiBMYW1iZGEgaGFuZGxlciBmdW5jdGlvbiBmb3IgQVBJIEdhdGV3YXlcbiAqL1xuZXhwb3J0IGNvbnN0IGhhbmRsZXIgPSBhc3luYyAoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCk6IFByb21pc2U8QVBJR2F0ZXdheVJlc3BvbnNlPiA9PiB7XG4gIGNvbnN0IGRldmljZUhhbmRsZXIgPSBuZXcgRGV2aWNlUmVnaXN0cmF0aW9uSGFuZGxlcigpO1xuICByZXR1cm4gYXdhaXQgZGV2aWNlSGFuZGxlci5oYW5kbGVSZXF1ZXN0KGV2ZW50KTtcbn07Il19