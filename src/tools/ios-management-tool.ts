import { Tool } from 'strands-agents';
import { SNSClient, CreatePlatformEndpointCommand, DeleteEndpointCommand, GetEndpointAttributesCommand, SetEndpointAttributesCommand } from '@aws-sdk/client-sns';
import { iOSPushConfig, iOSDeviceRegistration } from '../types';
import { validateiOSDeviceRegistration, ValidationError } from '../validation';

/**
 * Tool for managing iOS device registrations and APNS platform configuration
 */
export class iOSManagementTool extends Tool {
  private snsClient: SNSClient;
  private iosConfig: iOSPushConfig;

  constructor(iosConfig: iOSPushConfig, region: string = 'us-east-1') {
    super();
    this.iosConfig = iosConfig;
    this.snsClient = new SNSClient({ region });
  }

  /**
   * Registers a new iOS device token with SNS platform endpoint
   */
  async registerDevice(deviceToken: string, userId?: string): Promise<iOSDeviceRegistration> {
    try {
      // Validate device token format
      if (!this.isValidDeviceToken(deviceToken)) {
        throw new ValidationError('Invalid device token format. Must be 64-character hexadecimal string.');
      }

      const now = new Date().toISOString();
      
      // Create platform endpoint
      const createEndpointCommand = new CreatePlatformEndpointCommand({
        PlatformApplicationArn: this.iosConfig.platformApplicationArn,
        Token: deviceToken,
        CustomUserData: userId ? JSON.stringify({ userId, registrationDate: now }) : undefined
      });

      const response = await this.snsClient.send(createEndpointCommand);
      
      if (!response.EndpointArn) {
        throw new Error('Failed to create platform endpoint - no ARN returned');
      }

      const registration: iOSDeviceRegistration = {
        deviceToken,
        platformEndpointArn: response.EndpointArn,
        userId,
        registrationDate: now,
        lastUpdated: now,
        active: true
      };

      // Validate the registration object
      validateiOSDeviceRegistration(registration);

      console.log(`Successfully registered iOS device: ${deviceToken.substring(0, 8)}...`);
      return registration;

    } catch (error) {
      console.error('Failed to register iOS device:', error);
      throw error;
    }
  }

  /**
   * Updates an existing device token registration
   */
  async updateDeviceToken(platformEndpointArn: string, newDeviceToken: string): Promise<void> {
    try {
      // Validate new device token format
      if (!this.isValidDeviceToken(newDeviceToken)) {
        throw new ValidationError('Invalid device token format. Must be 64-character hexadecimal string.');
      }

      const setAttributesCommand = new SetEndpointAttributesCommand({
        EndpointArn: platformEndpointArn,
        Attributes: {
          Token: newDeviceToken,
          Enabled: 'true'
        }
      });

      await this.snsClient.send(setAttributesCommand);
      console.log(`Successfully updated device token for endpoint: ${platformEndpointArn}`);

    } catch (error) {
      console.error('Failed to update device token:', error);
      throw error;
    }
  }

  /**
   * Removes invalid or expired device tokens
   */
  async removeInvalidTokens(platformEndpointArns: string[]): Promise<string[]> {
    const removedEndpoints: string[] = [];

    for (const endpointArn of platformEndpointArns) {
      try {
        // Check if endpoint is still valid
        const getAttributesCommand = new GetEndpointAttributesCommand({
          EndpointArn: endpointArn
        });

        const response = await this.snsClient.send(getAttributesCommand);
        
        // If endpoint is disabled or has invalid token, remove it
        if (response.Attributes?.Enabled === 'false' || 
            !response.Attributes?.Token ||
            !this.isValidDeviceToken(response.Attributes.Token)) {
          
          await this.deleteEndpoint(endpointArn);
          removedEndpoints.push(endpointArn);
        }

      } catch (error) {
        // If we can't get attributes, the endpoint is likely invalid
        console.warn(`Endpoint ${endpointArn} appears invalid, removing:`, error);
        try {
          await this.deleteEndpoint(endpointArn);
          removedEndpoints.push(endpointArn);
        } catch (deleteError) {
          console.error(`Failed to delete invalid endpoint ${endpointArn}:`, deleteError);
        }
      }
    }

    if (removedEndpoints.length > 0) {
      console.log(`Removed ${removedEndpoints.length} invalid device endpoints`);
    }

    return removedEndpoints;
  }

  /**
   * Validates APNS configuration by checking platform application
   */
  async validateAPNSConfig(): Promise<boolean> {
    try {
      // Try to create a test endpoint with a dummy token to validate the platform app
      const testToken = '0'.repeat(64); // Valid format but dummy token
      
      const createEndpointCommand = new CreatePlatformEndpointCommand({
        PlatformApplicationArn: this.iosConfig.platformApplicationArn,
        Token: testToken
      });

      const response = await this.snsClient.send(createEndpointCommand);
      
      // Clean up the test endpoint
      if (response.EndpointArn) {
        await this.deleteEndpoint(response.EndpointArn);
      }

      console.log('APNS configuration validation successful');
      return true;

    } catch (error) {
      console.error('APNS configuration validation failed:', error);
      return false;
    }
  }

  /**
   * Validates device token format (64-character hexadecimal string)
   */
  private isValidDeviceToken(token: string): boolean {
    const tokenPattern = /^[a-fA-F0-9]{64}$/;
    return tokenPattern.test(token);
  }

  /**
   * Deletes a platform endpoint
   */
  private async deleteEndpoint(endpointArn: string): Promise<void> {
    const deleteCommand = new DeleteEndpointCommand({
      EndpointArn: endpointArn
    });

    await this.snsClient.send(deleteCommand);
    console.log(`Deleted platform endpoint: ${endpointArn}`);
  }

  /**
   * Creates a platform endpoint for a device token
   */
  async createPlatformEndpoint(deviceToken: string, customUserData?: string): Promise<string> {
    try {
      if (!this.isValidDeviceToken(deviceToken)) {
        throw new ValidationError('Invalid device token format. Must be 64-character hexadecimal string.');
      }

      const createEndpointCommand = new CreatePlatformEndpointCommand({
        PlatformApplicationArn: this.iosConfig.platformApplicationArn,
        Token: deviceToken,
        CustomUserData: customUserData
      });

      const response = await this.snsClient.send(createEndpointCommand);
      
      if (!response.EndpointArn) {
        throw new Error('Failed to create platform endpoint - no ARN returned');
      }

      console.log(`Created platform endpoint: ${response.EndpointArn}`);
      return response.EndpointArn;

    } catch (error) {
      console.error('Failed to create platform endpoint:', error);
      throw error;
    }
  }

  /**
   * Gets the current iOS configuration
   */
  getConfig(): iOSPushConfig {
    return { ...this.iosConfig };
  }

  /**
   * Updates the iOS configuration
   */
  updateConfig(newConfig: Partial<iOSPushConfig>): void {
    this.iosConfig = { ...this.iosConfig, ...newConfig };
  }
}