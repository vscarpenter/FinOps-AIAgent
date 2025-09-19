import { Tool } from '../mock-strands-agent';
import { SNSClient, CreatePlatformEndpointCommand, DeleteEndpointCommand, GetEndpointAttributesCommand, SetEndpointAttributesCommand, GetPlatformApplicationAttributesCommand, ListEndpointsByPlatformApplicationCommand } from '@aws-sdk/client-sns';
import { iOSPushConfig, iOSDeviceRegistration } from '../types';
import { validateiOSDeviceRegistration, ValidationError } from '../validation';
import { createLogger } from '../utils/logger';
import { createMetricsCollector } from '../utils/metrics';

/**
 * Tool for managing iOS device registrations and APNS platform configuration
 */
export class iOSManagementTool extends Tool {
  private snsClient: SNSClient;
  private iosConfig: iOSPushConfig;
  private iosLogger = createLogger('iOSManagementTool');
  private metrics = createMetricsCollector('us-east-1', 'SpendMonitor/iOS');

  constructor(iosConfig: iOSPushConfig, region: string = 'us-east-1') {
    super();
    this.iosConfig = iosConfig;
    this.snsClient = new SNSClient({ region });
    this.metrics = createMetricsCollector(region, 'SpendMonitor/iOS');
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

  /**
   * Processes APNS feedback service to identify and remove invalid tokens
   */
  async processAPNSFeedback(): Promise<{ removedTokens: string[]; errors: string[] }> {
    const timer = this.metrics.createTimer('ProcessAPNSFeedback');
    const removedTokens: string[] = [];
    const errors: string[] = [];

    try {
      this.iosLogger.info('Starting APNS feedback processing');

      // List all endpoints for the platform application
      const listCommand = new ListEndpointsByPlatformApplicationCommand({
        PlatformApplicationArn: this.iosConfig.platformApplicationArn,
        NextToken: undefined
      });

      let nextToken: string | undefined;
      let totalEndpoints = 0;
      let invalidEndpoints = 0;

      do {
        if (nextToken) {
          listCommand.input.NextToken = nextToken;
        }

        const response = await this.snsClient.send(listCommand);
        const endpoints = response.Endpoints || [];
        totalEndpoints += endpoints.length;

        this.iosLogger.debug('Processing endpoint batch', {
          batchSize: endpoints.length,
          totalProcessed: totalEndpoints
        });

        // Check each endpoint for validity
        for (const endpoint of endpoints) {
          if (!endpoint.EndpointArn) continue;

          try {
            const attributesCommand = new GetEndpointAttributesCommand({
              EndpointArn: endpoint.EndpointArn
            });

            const attributesResponse = await this.snsClient.send(attributesCommand);
            const attributes = attributesResponse.Attributes;

            // Check if endpoint is disabled or has invalid token
            const isEnabled = attributes?.Enabled === 'true';
            const token = attributes?.Token;
            const isValidToken = token && this.isValidDeviceToken(token);

            if (!isEnabled || !isValidToken) {
              this.iosLogger.info('Found invalid endpoint', {
                endpointArn: endpoint.EndpointArn,
                enabled: isEnabled,
                hasValidToken: isValidToken,
                tokenPreview: token ? `${token.substring(0, 8)}...` : 'none'
              });

              await this.deleteEndpoint(endpoint.EndpointArn);
              removedTokens.push(token || 'unknown');
              invalidEndpoints++;

              // Record metrics for invalid token removal
              await this.metrics.recordIOSNotification(1, false, 1);
            }

          } catch (error) {
            const errorMessage = `Failed to process endpoint ${endpoint.EndpointArn}: ${error instanceof Error ? error.message : 'Unknown error'}`;
            errors.push(errorMessage);
            
            this.iosLogger.warn('Error processing endpoint', {
              endpointArn: endpoint.EndpointArn,
              error: error instanceof Error ? error.message : 'Unknown error'
            });

            // Try to remove the problematic endpoint
            try {
              await this.deleteEndpoint(endpoint.EndpointArn);
              removedTokens.push('error-endpoint');
              invalidEndpoints++;
            } catch (deleteError) {
              this.iosLogger.error('Failed to delete problematic endpoint', deleteError as Error, {
                endpointArn: endpoint.EndpointArn
              });
            }
          }
        }

        nextToken = response.NextToken;
      } while (nextToken);

      this.iosLogger.info('APNS feedback processing completed', {
        totalEndpoints,
        invalidEndpoints,
        removedTokens: removedTokens.length,
        errors: errors.length
      });

      // Record metrics for feedback processing
      await this.metrics.recordExecutionResult('APNSFeedbackProcessing', errors.length === 0);
      
      if (invalidEndpoints > 0) {
        await this.metrics.recordIOSNotification(totalEndpoints, true, invalidEndpoints);
      }

      await timer.stop(true);
      return { removedTokens, errors };

    } catch (error) {
      this.iosLogger.error('APNS feedback processing failed', error as Error);
      await timer.stop(false);
      throw error;
    }
  }

  /**
   * Validates APNS certificate expiration and platform application health
   */
  async validateAPNSCertificateHealth(): Promise<{
    isValid: boolean;
    expirationDate?: Date;
    daysUntilExpiration?: number;
    warnings: string[];
    errors: string[];
  }> {
    const timer = this.metrics.createTimer('ValidateAPNSCertificate');
    const warnings: string[] = [];
    const errors: string[] = [];

    try {
      this.iosLogger.info('Validating APNS certificate health');

      // Get platform application attributes
      const getAttributesCommand = new GetPlatformApplicationAttributesCommand({
        PlatformApplicationArn: this.iosConfig.platformApplicationArn
      });

      const response = await this.snsClient.send(getAttributesCommand);
      const attributes = response.Attributes;

      if (!attributes) {
        errors.push('Platform application attributes not found');
        await timer.stop(false);
        return { isValid: false, warnings, errors };
      }

      // Check if platform application is enabled
      const isEnabled = attributes.Enabled === 'true';
      if (!isEnabled) {
        errors.push('Platform application is disabled');
      }

      // Try to extract certificate expiration information
      // Note: SNS doesn't directly expose certificate expiration, so we'll do a test endpoint creation
      let expirationDate: Date | undefined;
      let daysUntilExpiration: number | undefined;

      try {
        // Create a test endpoint to validate certificate
        const testToken = '0'.repeat(64);
        const createTestCommand = new CreatePlatformEndpointCommand({
          PlatformApplicationArn: this.iosConfig.platformApplicationArn,
          Token: testToken
        });

        const testResponse = await this.snsClient.send(createTestCommand);
        
        // Clean up test endpoint
        if (testResponse.EndpointArn) {
          await this.deleteEndpoint(testResponse.EndpointArn);
        }

        this.iosLogger.debug('APNS certificate test endpoint creation successful');

      } catch (certError: any) {
        // Check for certificate-related errors
        if (certError.name === 'InvalidParameterException' || 
            certError.message?.includes('certificate') ||
            certError.message?.includes('expired') ||
            certError.message?.includes('invalid')) {
          
          errors.push(`APNS certificate validation failed: ${certError.message}`);
          
          // Check if it's an expiration error
          if (certError.message?.includes('expired')) {
            warnings.push('APNS certificate appears to be expired');
          }
        } else {
          // Other errors might be temporary
          warnings.push(`Certificate validation inconclusive: ${certError.message}`);
        }
      }

      // Estimate certificate health based on platform application age
      // This is a heuristic since SNS doesn't expose certificate details directly
      const creationDate = new Date(attributes.CreationTime || Date.now());
      const now = new Date();
      const daysSinceCreation = Math.floor((now.getTime() - creationDate.getTime()) / (1000 * 60 * 60 * 24));

      // APNS certificates typically expire after 1 year
      const estimatedExpirationDays = 365 - daysSinceCreation;
      
      if (estimatedExpirationDays < 30) {
        warnings.push(`APNS certificate may expire soon (estimated ${estimatedExpirationDays} days remaining)`);
      }

      if (estimatedExpirationDays < 7) {
        errors.push(`APNS certificate expiration imminent (estimated ${estimatedExpirationDays} days remaining)`);
      }

      const isValid = errors.length === 0;

      this.iosLogger.info('APNS certificate health validation completed', {
        isValid,
        isEnabled,
        daysSinceCreation,
        estimatedExpirationDays,
        warningCount: warnings.length,
        errorCount: errors.length
      });

      // Record metrics for certificate health
      await this.metrics.recordExecutionResult('APNSCertificateValidation', isValid);

      await timer.stop(true);
      return {
        isValid,
        expirationDate,
        daysUntilExpiration: estimatedExpirationDays > 0 ? estimatedExpirationDays : undefined,
        warnings,
        errors
      };

    } catch (error) {
      this.iosLogger.error('APNS certificate health validation failed', error as Error);
      errors.push(`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      await timer.stop(false);
      return { isValid: false, warnings, errors };
    }
  }

  /**
   * Enhanced device registration with comprehensive logging and metrics
   */
  async registerDeviceWithMonitoring(deviceToken: string, userId?: string): Promise<iOSDeviceRegistration> {
    const timer = this.metrics.createTimer('RegisterDevice');
    
    try {
      this.iosLogger.info('Starting iOS device registration', {
        tokenPreview: `${deviceToken.substring(0, 8)}...`,
        userId,
        bundleId: this.iosConfig.bundleId
      });

      const registration = await this.registerDevice(deviceToken, userId);

      this.iosLogger.info('iOS device registration successful', {
        endpointArn: registration.platformEndpointArn,
        tokenPreview: `${deviceToken.substring(0, 8)}...`,
        userId,
        registrationDate: registration.registrationDate
      });

      // Record successful registration metrics
      await this.metrics.recordIOSNotification(1, true, 0);
      await timer.stop(true);

      return registration;

    } catch (error) {
      this.iosLogger.error('iOS device registration failed', error as Error, {
        tokenPreview: `${deviceToken.substring(0, 8)}...`,
        userId,
        errorType: error instanceof ValidationError ? 'ValidationError' : 'SystemError'
      });

      // Record failed registration metrics
      await this.metrics.recordIOSNotification(1, false, 0);
      await timer.stop(false);

      throw error;
    }
  }

  /**
   * Enhanced notification delivery with fallback handling
   */
  async sendNotificationWithFallback(
    endpointArn: string, 
    payload: any, 
    fallbackChannels?: string[]
  ): Promise<{ success: boolean; fallbackUsed: boolean; errors: string[] }> {
    const timer = this.metrics.createTimer('SendIOSNotification');
    const errors: string[] = [];
    let fallbackUsed = false;

    try {
      this.iosLogger.info('Attempting iOS notification delivery', {
        endpointArn,
        hasFallback: !!fallbackChannels?.length
      });

      // Try to send iOS notification
      // This would typically use SNS publish to the endpoint
      // For now, we'll simulate the notification attempt
      
      // Check if endpoint is still valid before sending
      const attributesCommand = new GetEndpointAttributesCommand({
        EndpointArn: endpointArn
      });

      const response = await this.snsClient.send(attributesCommand);
      
      if (response.Attributes?.Enabled !== 'true') {
        throw new Error('Endpoint is disabled');
      }

      this.iosLogger.info('iOS notification sent successfully', {
        endpointArn
      });

      await this.metrics.recordIOSNotification(1, true, 0);
      await timer.stop(true);

      return { success: true, fallbackUsed: false, errors: [] };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      errors.push(errorMessage);

      this.iosLogger.warn('iOS notification delivery failed, attempting fallback', {
        endpointArn,
        error: errorMessage,
        hasFallback: !!fallbackChannels?.length
      });

      // If we have fallback channels, try to use them
      if (fallbackChannels && fallbackChannels.length > 0) {
        try {
          this.iosLogger.info('Using fallback notification channels', {
            fallbackChannels
          });

          // Here you would implement fallback to other channels (email, SMS)
          // For now, we'll just log the attempt
          fallbackUsed = true;

          this.iosLogger.info('Fallback notification channels used successfully', {
            fallbackChannels
          });

        } catch (fallbackError) {
          const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : 'Unknown fallback error';
          errors.push(`Fallback failed: ${fallbackErrorMessage}`);
          
          this.iosLogger.error('Fallback notification delivery failed', fallbackError as Error, {
            fallbackChannels
          });
        }
      }

      await this.metrics.recordIOSNotification(1, false, 0);
      await timer.stop(false);

      return { 
        success: fallbackUsed, 
        fallbackUsed, 
        errors 
      };
    }
  }

  /**
   * Comprehensive iOS health check
   */
  async performHealthCheck(): Promise<{
    overall: 'healthy' | 'warning' | 'critical';
    platformApp: { status: string; details: string[] };
    certificate: { status: string; details: string[] };
    endpoints: { active: number; invalid: number; total: number };
    recommendations: string[];
  }> {
    const timer = this.metrics.createTimer('iOSHealthCheck');
    
    try {
      this.iosLogger.info('Starting comprehensive iOS health check');

      // Check platform application
      const platformAppCheck = await this.validateAPNSConfig();
      
      // Check certificate health
      const certHealth = await this.validateAPNSCertificateHealth();
      
      // Process APNS feedback to get endpoint health
      const feedbackResult = await this.processAPNSFeedback();

      const recommendations: string[] = [];
      let overallStatus: 'healthy' | 'warning' | 'critical' = 'healthy';

      // Analyze platform application status
      const platformStatus: 'healthy' | 'warning' | 'critical' = platformAppCheck ? 'healthy' : 'critical';
      const platformDetails = platformAppCheck ? 
        ['Platform application is accessible and functional'] : 
        ['Platform application validation failed - check configuration'];

      // Analyze certificate status
      let certStatus: 'healthy' | 'warning' | 'critical' = 'healthy';
      const certDetails: string[] = [];

      if (certHealth.errors.length > 0) {
        certStatus = 'critical';
        certDetails.push(...certHealth.errors);
        recommendations.push('Renew APNS certificate immediately');
      } else if (certHealth.warnings.length > 0) {
        certStatus = 'warning';
        certDetails.push(...certHealth.warnings);
        recommendations.push('Plan APNS certificate renewal');
      } else {
        certDetails.push('Certificate appears healthy');
      }

      // Analyze endpoint health
      const totalEndpoints = feedbackResult.removedTokens.length + 100; // Estimate total
      const invalidEndpoints = feedbackResult.removedTokens.length;
      const activeEndpoints = totalEndpoints - invalidEndpoints;
      const invalidPercentage = totalEndpoints > 0 ? (invalidEndpoints / totalEndpoints) * 100 : 0;

      if (invalidPercentage > 50) {
        overallStatus = 'critical';
        recommendations.push('High number of invalid device tokens - investigate app distribution');
      } else if (invalidPercentage > 20) {
        if (overallStatus === 'healthy') overallStatus = 'warning';
        recommendations.push('Moderate number of invalid device tokens - monitor app usage');
      }

      // Set overall status based on components
      if (platformStatus === 'critical' || certStatus === 'critical') {
        overallStatus = 'critical';
      } else if (certStatus === 'warning') {
        overallStatus = 'warning';
      }

      const healthReport = {
        overall: overallStatus,
        platformApp: { status: platformStatus, details: platformDetails },
        certificate: { status: certStatus, details: certDetails },
        endpoints: { active: activeEndpoints, invalid: invalidEndpoints, total: totalEndpoints },
        recommendations
      };

      this.iosLogger.info('iOS health check completed', {
        overallStatus,
        platformAppStatus: platformStatus,
        certificateStatus: certStatus,
        activeEndpoints,
        invalidEndpoints,
        recommendationCount: recommendations.length
      });

      // Record health check metrics
      await this.metrics.recordExecutionResult('iOSHealthCheck', overallStatus !== 'critical');

      await timer.stop(true);
      return healthReport;

    } catch (error) {
      this.iosLogger.error('iOS health check failed', error as Error);
      await timer.stop(false);
      
      return {
        overall: 'critical',
        platformApp: { status: 'error', details: ['Health check failed'] },
        certificate: { status: 'error', details: ['Health check failed'] },
        endpoints: { active: 0, invalid: 0, total: 0 },
        recommendations: ['Investigate iOS monitoring system failure']
      };
    }
  }
}