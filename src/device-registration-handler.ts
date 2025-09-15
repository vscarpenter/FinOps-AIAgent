import { SNSClient, CreatePlatformEndpointCommand, DeleteEndpointCommand, GetEndpointAttributesCommand, SetEndpointAttributesCommand } from '@aws-sdk/client-sns';
import { DynamoDBClient, PutItemCommand, GetItemCommand, UpdateItemCommand, DeleteItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  APIGatewayEvent,
  APIGatewayResponse,
  DeviceRegistrationRequest,
  DeviceRegistrationResponse,
  DeviceUpdateRequest,
  DeviceUpdateResponse,
  DeviceListRequest,
  DeviceListResponse,
  DeviceDeleteRequest,
  DeviceDeleteResponse,
  iOSDeviceRegistration
} from './types';

/**
 * Device Registration API Handler
 * 
 * Handles iOS device token registration, updates, and management
 * for AWS Spend Monitor push notifications
 */
export class DeviceRegistrationHandler {
  private sns: SNSClient;
  private dynamodb: DynamoDBClient;
  private platformApplicationArn: string;
  private deviceTableName: string;
  private bundleId: string;

  constructor() {
    const region = process.env.AWS_REGION || 'us-east-1';
    this.sns = new SNSClient({ region });
    this.dynamodb = new DynamoDBClient({ region });
    
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
  async handleRequest(event: APIGatewayEvent): Promise<APIGatewayResponse> {
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
      } else if (path === '/devices' && method === 'PUT') {
        return await this.updateDevice(event, corsHeaders);
      } else if (path === '/devices' && method === 'GET') {
        return await this.listDevices(event, corsHeaders);
      } else if (path.startsWith('/devices/') && method === 'DELETE') {
        return await this.deleteDevice(event, corsHeaders);
      } else {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Not Found' })
        };
      }

    } catch (error) {
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
  private async registerDevice(event: APIGatewayEvent, headers: { [key: string]: string }): Promise<APIGatewayResponse> {
    try {
      if (!event.body) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Request body is required' })
        };
      }

      const request: DeviceRegistrationRequest = JSON.parse(event.body);
      
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
      const registration: iOSDeviceRegistration = {
        deviceToken: request.deviceToken,
        platformEndpointArn: endpointArn,
        userId: request.userId,
        registrationDate: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        active: true
      };

      await this.storeDeviceRegistration(registration);

      const response: DeviceRegistrationResponse = {
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

    } catch (error) {
      console.error('Error registering device:', error);
      
      const response: DeviceRegistrationResponse = {
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
  private async updateDevice(event: APIGatewayEvent, headers: { [key: string]: string }): Promise<APIGatewayResponse> {
    try {
      if (!event.body) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Request body is required' })
        };
      }

      const request: DeviceUpdateRequest = JSON.parse(event.body);
      
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
      const updatedRegistration: iOSDeviceRegistration = {
        ...existingDevice,
        deviceToken: request.newToken,
        userId: request.userId || existingDevice.userId,
        lastUpdated: new Date().toISOString()
      };

      await this.storeDeviceRegistration(updatedRegistration);

      const response: DeviceUpdateResponse = {
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

    } catch (error) {
      console.error('Error updating device:', error);
      
      const response: DeviceUpdateResponse = {
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
  private async listDevices(event: APIGatewayEvent, headers: { [key: string]: string }): Promise<APIGatewayResponse> {
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

      const response: DeviceListResponse = {
        success: true,
        devices: devices.devices,
        nextToken: devices.nextToken
      };

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(response)
      };

    } catch (error) {
      console.error('Error listing devices:', error);
      
      const response: DeviceListResponse = {
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
  private async deleteDevice(event: APIGatewayEvent, headers: { [key: string]: string }): Promise<APIGatewayResponse> {
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

      const response: DeviceDeleteResponse = {
        success: true,
        deletedAt: new Date().toISOString()
      };

      console.log('Device deleted successfully:', decodedToken);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(response)
      };

    } catch (error) {
      console.error('Error deleting device:', error);
      
      const response: DeviceDeleteResponse = {
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
  private validateDeviceRegistrationRequest(request: DeviceRegistrationRequest): { valid: boolean; error?: string } {
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
  private isValidDeviceToken(token: string): boolean {
    return /^[0-9a-fA-F]{64}$/.test(token);
  }

  /**
   * Create SNS platform endpoint for device
   */
  private async createPlatformEndpoint(deviceToken: string): Promise<string> {
    const command = new CreatePlatformEndpointCommand({
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
  private async updatePlatformEndpoint(endpointArn: string, newToken: string): Promise<void> {
    const command = new SetEndpointAttributesCommand({
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
  private async deletePlatformEndpoint(endpointArn: string): Promise<void> {
    try {
      const command = new DeleteEndpointCommand({
        EndpointArn: endpointArn
      });

      await this.sns.send(command);
    } catch (error) {
      // Log error but don't fail the operation if endpoint doesn't exist
      console.warn('Failed to delete platform endpoint:', endpointArn, error);
    }
  }

  /**
   * Store device registration in DynamoDB
   */
  private async storeDeviceRegistration(registration: iOSDeviceRegistration): Promise<void> {
    const command = new PutItemCommand({
      TableName: this.deviceTableName,
      Item: marshall(registration)
    });

    await this.dynamodb.send(command);
  }

  /**
   * Get device registration from DynamoDB
   */
  private async getDeviceRegistration(deviceToken: string): Promise<iOSDeviceRegistration | null> {
    const command = new GetItemCommand({
      TableName: this.deviceTableName,
      Key: marshall({ deviceToken })
    });

    const response = await this.dynamodb.send(command);
    
    if (!response.Item) {
      return null;
    }

    return unmarshall(response.Item) as iOSDeviceRegistration;
  }

  /**
   * Delete device registration from DynamoDB
   */
  private async deleteDeviceRegistration(deviceToken: string): Promise<void> {
    const command = new DeleteItemCommand({
      TableName: this.deviceTableName,
      Key: marshall({ deviceToken })
    });

    await this.dynamodb.send(command);
  }

  /**
   * Get devices for a specific user
   */
  private async getUserDevices(userId: string, limit: number = 10, nextToken?: string): Promise<{ devices: iOSDeviceRegistration[]; nextToken?: string }> {
    const command = new ScanCommand({
      TableName: this.deviceTableName,
      FilterExpression: 'userId = :userId AND active = :active',
      ExpressionAttributeValues: marshall({
        ':userId': userId,
        ':active': true
      }),
      Limit: limit,
      ExclusiveStartKey: nextToken ? JSON.parse(Buffer.from(nextToken, 'base64').toString()) : undefined
    });

    const response = await this.dynamodb.send(command);
    
    const devices = response.Items?.map((item: any) => unmarshall(item) as iOSDeviceRegistration) || [];
    
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
  private async updateExistingDevice(
    existingDevice: iOSDeviceRegistration, 
    request: DeviceRegistrationRequest, 
    headers: { [key: string]: string }
  ): Promise<APIGatewayResponse> {
    // Update the existing registration
    const updatedRegistration: iOSDeviceRegistration = {
      ...existingDevice,
      userId: request.userId || existingDevice.userId,
      lastUpdated: new Date().toISOString(),
      active: true
    };

    await this.storeDeviceRegistration(updatedRegistration);

    const response: DeviceRegistrationResponse = {
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

/**
 * Lambda handler function for API Gateway
 */
export const handler = async (event: APIGatewayEvent): Promise<APIGatewayResponse> => {
  const deviceHandler = new DeviceRegistrationHandler();
  return await deviceHandler.handleRequest(event);
};