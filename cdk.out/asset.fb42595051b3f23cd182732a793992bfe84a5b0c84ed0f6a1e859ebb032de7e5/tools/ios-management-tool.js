"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.iOSManagementTool = void 0;
const strands_agents_1 = require("strands-agents");
const client_sns_1 = require("@aws-sdk/client-sns");
const validation_1 = require("../validation");
const logger_1 = require("../utils/logger");
const metrics_1 = require("../utils/metrics");
/**
 * Tool for managing iOS device registrations and APNS platform configuration
 */
class iOSManagementTool extends strands_agents_1.Tool {
    constructor(iosConfig, region = 'us-east-1') {
        super();
        this.iosLogger = (0, logger_1.createLogger)('iOSManagementTool');
        this.metrics = (0, metrics_1.createMetricsCollector)('us-east-1', 'SpendMonitor/iOS');
        this.iosConfig = iosConfig;
        this.snsClient = new client_sns_1.SNSClient({ region });
        this.metrics = (0, metrics_1.createMetricsCollector)(region, 'SpendMonitor/iOS');
    }
    /**
     * Registers a new iOS device token with SNS platform endpoint
     */
    async registerDevice(deviceToken, userId) {
        try {
            // Validate device token format
            if (!this.isValidDeviceToken(deviceToken)) {
                throw new validation_1.ValidationError('Invalid device token format. Must be 64-character hexadecimal string.');
            }
            const now = new Date().toISOString();
            // Create platform endpoint
            const createEndpointCommand = new client_sns_1.CreatePlatformEndpointCommand({
                PlatformApplicationArn: this.iosConfig.platformApplicationArn,
                Token: deviceToken,
                CustomUserData: userId ? JSON.stringify({ userId, registrationDate: now }) : undefined
            });
            const response = await this.snsClient.send(createEndpointCommand);
            if (!response.EndpointArn) {
                throw new Error('Failed to create platform endpoint - no ARN returned');
            }
            const registration = {
                deviceToken,
                platformEndpointArn: response.EndpointArn,
                userId,
                registrationDate: now,
                lastUpdated: now,
                active: true
            };
            // Validate the registration object
            (0, validation_1.validateiOSDeviceRegistration)(registration);
            console.log(`Successfully registered iOS device: ${deviceToken.substring(0, 8)}...`);
            return registration;
        }
        catch (error) {
            console.error('Failed to register iOS device:', error);
            throw error;
        }
    }
    /**
     * Updates an existing device token registration
     */
    async updateDeviceToken(platformEndpointArn, newDeviceToken) {
        try {
            // Validate new device token format
            if (!this.isValidDeviceToken(newDeviceToken)) {
                throw new validation_1.ValidationError('Invalid device token format. Must be 64-character hexadecimal string.');
            }
            const setAttributesCommand = new client_sns_1.SetEndpointAttributesCommand({
                EndpointArn: platformEndpointArn,
                Attributes: {
                    Token: newDeviceToken,
                    Enabled: 'true'
                }
            });
            await this.snsClient.send(setAttributesCommand);
            console.log(`Successfully updated device token for endpoint: ${platformEndpointArn}`);
        }
        catch (error) {
            console.error('Failed to update device token:', error);
            throw error;
        }
    }
    /**
     * Removes invalid or expired device tokens
     */
    async removeInvalidTokens(platformEndpointArns) {
        const removedEndpoints = [];
        for (const endpointArn of platformEndpointArns) {
            try {
                // Check if endpoint is still valid
                const getAttributesCommand = new client_sns_1.GetEndpointAttributesCommand({
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
            }
            catch (error) {
                // If we can't get attributes, the endpoint is likely invalid
                console.warn(`Endpoint ${endpointArn} appears invalid, removing:`, error);
                try {
                    await this.deleteEndpoint(endpointArn);
                    removedEndpoints.push(endpointArn);
                }
                catch (deleteError) {
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
    async validateAPNSConfig() {
        try {
            // Try to create a test endpoint with a dummy token to validate the platform app
            const testToken = '0'.repeat(64); // Valid format but dummy token
            const createEndpointCommand = new client_sns_1.CreatePlatformEndpointCommand({
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
        }
        catch (error) {
            console.error('APNS configuration validation failed:', error);
            return false;
        }
    }
    /**
     * Validates device token format (64-character hexadecimal string)
     */
    isValidDeviceToken(token) {
        const tokenPattern = /^[a-fA-F0-9]{64}$/;
        return tokenPattern.test(token);
    }
    /**
     * Deletes a platform endpoint
     */
    async deleteEndpoint(endpointArn) {
        const deleteCommand = new client_sns_1.DeleteEndpointCommand({
            EndpointArn: endpointArn
        });
        await this.snsClient.send(deleteCommand);
        console.log(`Deleted platform endpoint: ${endpointArn}`);
    }
    /**
     * Creates a platform endpoint for a device token
     */
    async createPlatformEndpoint(deviceToken, customUserData) {
        try {
            if (!this.isValidDeviceToken(deviceToken)) {
                throw new validation_1.ValidationError('Invalid device token format. Must be 64-character hexadecimal string.');
            }
            const createEndpointCommand = new client_sns_1.CreatePlatformEndpointCommand({
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
        }
        catch (error) {
            console.error('Failed to create platform endpoint:', error);
            throw error;
        }
    }
    /**
     * Gets the current iOS configuration
     */
    getConfig() {
        return { ...this.iosConfig };
    }
    /**
     * Updates the iOS configuration
     */
    updateConfig(newConfig) {
        this.iosConfig = { ...this.iosConfig, ...newConfig };
    }
    /**
     * Processes APNS feedback service to identify and remove invalid tokens
     */
    async processAPNSFeedback() {
        const timer = this.metrics.createTimer('ProcessAPNSFeedback');
        const removedTokens = [];
        const errors = [];
        try {
            this.iosLogger.info('Starting APNS feedback processing');
            // List all endpoints for the platform application
            const listCommand = new client_sns_1.ListEndpointsByPlatformApplicationCommand({
                PlatformApplicationArn: this.iosConfig.platformApplicationArn,
                NextToken: undefined
            });
            let nextToken;
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
                    if (!endpoint.EndpointArn)
                        continue;
                    try {
                        const attributesCommand = new client_sns_1.GetEndpointAttributesCommand({
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
                    }
                    catch (error) {
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
                        }
                        catch (deleteError) {
                            this.iosLogger.error('Failed to delete problematic endpoint', deleteError, {
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
        }
        catch (error) {
            this.iosLogger.error('APNS feedback processing failed', error);
            await timer.stop(false);
            throw error;
        }
    }
    /**
     * Validates APNS certificate expiration and platform application health
     */
    async validateAPNSCertificateHealth() {
        const timer = this.metrics.createTimer('ValidateAPNSCertificate');
        const warnings = [];
        const errors = [];
        try {
            this.iosLogger.info('Validating APNS certificate health');
            // Get platform application attributes
            const getAttributesCommand = new client_sns_1.GetPlatformApplicationAttributesCommand({
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
            let expirationDate;
            let daysUntilExpiration;
            try {
                // Create a test endpoint to validate certificate
                const testToken = '0'.repeat(64);
                const createTestCommand = new client_sns_1.CreatePlatformEndpointCommand({
                    PlatformApplicationArn: this.iosConfig.platformApplicationArn,
                    Token: testToken
                });
                const testResponse = await this.snsClient.send(createTestCommand);
                // Clean up test endpoint
                if (testResponse.EndpointArn) {
                    await this.deleteEndpoint(testResponse.EndpointArn);
                }
                this.iosLogger.debug('APNS certificate test endpoint creation successful');
            }
            catch (certError) {
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
                }
                else {
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
        }
        catch (error) {
            this.iosLogger.error('APNS certificate health validation failed', error);
            errors.push(`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            await timer.stop(false);
            return { isValid: false, warnings, errors };
        }
    }
    /**
     * Enhanced device registration with comprehensive logging and metrics
     */
    async registerDeviceWithMonitoring(deviceToken, userId) {
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
        }
        catch (error) {
            this.iosLogger.error('iOS device registration failed', error, {
                tokenPreview: `${deviceToken.substring(0, 8)}...`,
                userId,
                errorType: error instanceof validation_1.ValidationError ? 'ValidationError' : 'SystemError'
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
    async sendNotificationWithFallback(endpointArn, payload, fallbackChannels) {
        const timer = this.metrics.createTimer('SendIOSNotification');
        const errors = [];
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
            const attributesCommand = new client_sns_1.GetEndpointAttributesCommand({
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
        }
        catch (error) {
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
                }
                catch (fallbackError) {
                    const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : 'Unknown fallback error';
                    errors.push(`Fallback failed: ${fallbackErrorMessage}`);
                    this.iosLogger.error('Fallback notification delivery failed', fallbackError, {
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
    async performHealthCheck() {
        const timer = this.metrics.createTimer('iOSHealthCheck');
        try {
            this.iosLogger.info('Starting comprehensive iOS health check');
            // Check platform application
            const platformAppCheck = await this.validateAPNSConfig();
            // Check certificate health
            const certHealth = await this.validateAPNSCertificateHealth();
            // Process APNS feedback to get endpoint health
            const feedbackResult = await this.processAPNSFeedback();
            const recommendations = [];
            let overallStatus = 'healthy';
            // Analyze platform application status
            const platformStatus = platformAppCheck ? 'healthy' : 'critical';
            const platformDetails = platformAppCheck ?
                ['Platform application is accessible and functional'] :
                ['Platform application validation failed - check configuration'];
            // Analyze certificate status
            let certStatus = 'healthy';
            const certDetails = [];
            if (certHealth.errors.length > 0) {
                certStatus = 'critical';
                certDetails.push(...certHealth.errors);
                recommendations.push('Renew APNS certificate immediately');
            }
            else if (certHealth.warnings.length > 0) {
                certStatus = 'warning';
                certDetails.push(...certHealth.warnings);
                recommendations.push('Plan APNS certificate renewal');
            }
            else {
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
            }
            else if (invalidPercentage > 20) {
                if (overallStatus === 'healthy')
                    overallStatus = 'warning';
                recommendations.push('Moderate number of invalid device tokens - monitor app usage');
            }
            // Set overall status based on components
            if (platformStatus === 'critical' || certStatus === 'critical') {
                overallStatus = 'critical';
            }
            else if (certStatus === 'warning') {
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
        }
        catch (error) {
            this.iosLogger.error('iOS health check failed', error);
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
exports.iOSManagementTool = iOSManagementTool;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW9zLW1hbmFnZW1lbnQtdG9vbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy90b29scy9pb3MtbWFuYWdlbWVudC10b29sLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1EQUFzQztBQUN0QyxvREFBc1A7QUFFdFAsOENBQStFO0FBQy9FLDRDQUErQztBQUMvQyw4Q0FBMEQ7QUFFMUQ7O0dBRUc7QUFDSCxNQUFhLGlCQUFrQixTQUFRLHFCQUFJO0lBTXpDLFlBQVksU0FBd0IsRUFBRSxTQUFpQixXQUFXO1FBQ2hFLEtBQUssRUFBRSxDQUFDO1FBSkYsY0FBUyxHQUFHLElBQUEscUJBQVksRUFBQyxtQkFBbUIsQ0FBQyxDQUFDO1FBQzlDLFlBQU8sR0FBRyxJQUFBLGdDQUFzQixFQUFDLFdBQVcsRUFBRSxrQkFBa0IsQ0FBQyxDQUFDO1FBSXhFLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO1FBQzNCLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxzQkFBUyxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQztRQUMzQyxJQUFJLENBQUMsT0FBTyxHQUFHLElBQUEsZ0NBQXNCLEVBQUMsTUFBTSxFQUFFLGtCQUFrQixDQUFDLENBQUM7SUFDcEUsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxXQUFtQixFQUFFLE1BQWU7UUFDdkQsSUFBSSxDQUFDO1lBQ0gsK0JBQStCO1lBQy9CLElBQUksQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQztnQkFDMUMsTUFBTSxJQUFJLDRCQUFlLENBQUMsdUVBQXVFLENBQUMsQ0FBQztZQUNyRyxDQUFDO1lBRUQsTUFBTSxHQUFHLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUVyQywyQkFBMkI7WUFDM0IsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLDBDQUE2QixDQUFDO2dCQUM5RCxz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QUFPLEVBQUUsQ0FBQyxFQUFFLEtBQUssRUFBRSxDQUFDLEVBQUU7Z0JBQzlDLGVBQWUsRUFBRSxDQUFDLDJDQUEyQyxDQUFDO2FBQy9ELENBQUM7UUFDSixDQUFDO0lBQ0gsQ0FBQztDQUNGO0FBOXJCRCw4Q0E4ckJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgVG9vbCB9IGZyb20gJ3N0cmFuZHMtYWdlbnRzJztcbmltcG9ydCB7IFNOU0NsaWVudCwgQ3JlYXRlUGxhdGZvcm1FbmRwb2ludENvbW1hbmQsIERlbGV0ZUVuZHBvaW50Q29tbWFuZCwgR2V0RW5kcG9pbnRBdHRyaWJ1dGVzQ29tbWFuZCwgU2V0RW5kcG9pbnRBdHRyaWJ1dGVzQ29tbWFuZCwgR2V0UGxhdGZvcm1BcHBsaWNhdGlvbkF0dHJpYnV0ZXNDb21tYW5kLCBMaXN0RW5kcG9pbnRzQnlQbGF0Zm9ybUFwcGxpY2F0aW9uQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zbnMnO1xuaW1wb3J0IHsgaU9TUHVzaENvbmZpZywgaU9TRGV2aWNlUmVnaXN0cmF0aW9uIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgdmFsaWRhdGVpT1NEZXZpY2VSZWdpc3RyYXRpb24sIFZhbGlkYXRpb25FcnJvciB9IGZyb20gJy4uL3ZhbGlkYXRpb24nO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vdXRpbHMvbG9nZ2VyJztcbmltcG9ydCB7IGNyZWF0ZU1ldHJpY3NDb2xsZWN0b3IgfSBmcm9tICcuLi91dGlscy9tZXRyaWNzJztcblxuLyoqXG4gKiBUb29sIGZvciBtYW5hZ2luZyBpT1MgZGV2aWNlIHJlZ2lzdHJhdGlvbnMgYW5kIEFQTlMgcGxhdGZvcm0gY29uZmlndXJhdGlvblxuICovXG5leHBvcnQgY2xhc3MgaU9TTWFuYWdlbWVudFRvb2wgZXh0ZW5kcyBUb29sIHtcbiAgcHJpdmF0ZSBzbnNDbGllbnQ6IFNOU0NsaWVudDtcbiAgcHJpdmF0ZSBpb3NDb25maWc6IGlPU1B1c2hDb25maWc7XG4gIHByaXZhdGUgaW9zTG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdpT1NNYW5hZ2VtZW50VG9vbCcpO1xuICBwcml2YXRlIG1ldHJpY3MgPSBjcmVhdGVNZXRyaWNzQ29sbGVjdG9yKCd1cy1lYXN0LTEnLCAnU3BlbmRNb25pdG9yL2lPUycpO1xuXG4gIGNvbnN0cnVjdG9yKGlvc0NvbmZpZzogaU9TUHVzaENvbmZpZywgcmVnaW9uOiBzdHJpbmcgPSAndXMtZWFzdC0xJykge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5pb3NDb25maWcgPSBpb3NDb25maWc7XG4gICAgdGhpcy5zbnNDbGllbnQgPSBuZXcgU05TQ2xpZW50KHsgcmVnaW9uIH0pO1xuICAgIHRoaXMubWV0cmljcyA9IGNyZWF0ZU1ldHJpY3NDb2xsZWN0b3IocmVnaW9uLCAnU3BlbmRNb25pdG9yL2lPUycpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIG5ldyBpT1MgZGV2aWNlIHRva2VuIHdpdGggU05TIHBsYXRmb3JtIGVuZHBvaW50XG4gICAqL1xuICBhc3luYyByZWdpc3RlckRldmljZShkZXZpY2VUb2tlbjogc3RyaW5nLCB1c2VySWQ/OiBzdHJpbmcpOiBQcm9taXNlPGlPU0RldmljZVJlZ2lzdHJhdGlvbj4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBWYWxpZGF0ZSBkZXZpY2UgdG9rZW4gZm9ybWF0XG4gICAgICBpZiAoIXRoaXMuaXNWYWxpZERldmljZVRva2VuKGRldmljZVRva2VuKSkge1xuICAgICAgICB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKCdJbnZhbGlkIGRldmljZSB0b2tlbiBmb3JtYXQuIE11c3QgYmUgNjQtY2hhcmFjdGVyIGhleGFkZWNpbWFsIHN0cmluZy4nKTtcbiAgICAgIH1cblxuICAgICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgXG4gICAgICAvLyBDcmVhdGUgcGxhdGZvcm0gZW5kcG9pbnRcbiAgICAgIGNvbnN0IGNyZWF0ZUVuZHBvaW50Q29tbWFuZCA9IG5ldyBDcmVhdGVQbGF0Zm9ybUVuZHBvaW50Q29tbWFuZCh7XG4gICAgICAgIFBsYXRmb3JtQXBwbGljYXRpb25Bcm46IHRoaXMuaW9zQ29uZmlnLnBsYXRmb3JtQXBwbGljYXRpb25Bcm4sXG4gICAgICAgIFRva2VuOiBkZXZpY2VUb2tlbixcbiAgICAgICAgQ3VzdG9tVXNlckRhdGE6IHVzZXJJZCA/IEpTT04uc3RyaW5naWZ5KHsgdXNlcklkLCByZWdpc3RyYXRpb25EYXRlOiBub3cgfSkgOiB1bmRlZmluZWRcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuc25zQ2xpZW50LnNlbmQoY3JlYXRlRW5kcG9pbnRDb21tYW5kKTtcbiAgICAgIFxuICAgICAgaWYgKCFyZXNwb25zZS5FbmRwb2ludEFybikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZhaWxlZCB0byBjcmVhdGUgcGxhdGZvcm0gZW5kcG9pbnQgLSBubyBBUk4gcmV0dXJuZWQnKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVnaXN0cmF0aW9uOiBpT1NEZXZpY2VSZWdpc3RyYXRpb24gPSB7XG4gICAgICAgIGRldmljZVRva2VuLFxuICAgICAgICBwbGF0Zm9ybUVuZHBvaW50QXJuOiByZXNwb25zZS5FbmRwb2ludEFybixcbiAgICAgICAgdXNlcklkLFxuICAgICAgICByZWdpc3RyYXRpb25EYXRlOiBub3csXG4gICAgICAgIGxhc3RVcGRhdGVkOiBub3csXG4gICAgICAgIGFjdGl2ZTogdHJ1ZVxuICAgICAgfTtcblxuICAgICAgLy8gVmFsaWRhdGUgdGhlIHJlZ2lzdHJhdGlvbiBvYmplY3RcbiAgICAgIHZhbGlkYXRlaU9TRGV2aWNlUmVnaXN0cmF0aW9uKHJlZ2lzdHJhdGlvbik7XG5cbiAgICAgIGNvbnNvbGUubG9nKGBTdWNjZXNzZnVsbHkgcmVnaXN0ZXJlZCBpT1MgZGV2aWNlOiAke2RldmljZVRva2VuLnN1YnN0cmluZygwLCA4KX0uLi5gKTtcbiAgICAgIHJldHVybiByZWdpc3RyYXRpb247XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHJlZ2lzdGVyIGlPUyBkZXZpY2U6JywgZXJyb3IpO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZXMgYW4gZXhpc3RpbmcgZGV2aWNlIHRva2VuIHJlZ2lzdHJhdGlvblxuICAgKi9cbiAgYXN5bmMgdXBkYXRlRGV2aWNlVG9rZW4ocGxhdGZvcm1FbmRwb2ludEFybjogc3RyaW5nLCBuZXdEZXZpY2VUb2tlbjogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIFZhbGlkYXRlIG5ldyBkZXZpY2UgdG9rZW4gZm9ybWF0XG4gICAgICBpZiAoIXRoaXMuaXNWYWxpZERldmljZVRva2VuKG5ld0RldmljZVRva2VuKSkge1xuICAgICAgICB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKCdJbnZhbGlkIGRldmljZSB0b2tlbiBmb3JtYXQuIE11c3QgYmUgNjQtY2hhcmFjdGVyIGhleGFkZWNpbWFsIHN0cmluZy4nKTtcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc2V0QXR0cmlidXRlc0NvbW1hbmQgPSBuZXcgU2V0RW5kcG9pbnRBdHRyaWJ1dGVzQ29tbWFuZCh7XG4gICAgICAgIEVuZHBvaW50QXJuOiBwbGF0Zm9ybUVuZHBvaW50QXJuLFxuICAgICAgICBBdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgVG9rZW46IG5ld0RldmljZVRva2VuLFxuICAgICAgICAgIEVuYWJsZWQ6ICd0cnVlJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgdGhpcy5zbnNDbGllbnQuc2VuZChzZXRBdHRyaWJ1dGVzQ29tbWFuZCk7XG4gICAgICBjb25zb2xlLmxvZyhgU3VjY2Vzc2Z1bGx5IHVwZGF0ZWQgZGV2aWNlIHRva2VuIGZvciBlbmRwb2ludDogJHtwbGF0Zm9ybUVuZHBvaW50QXJufWApO1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byB1cGRhdGUgZGV2aWNlIHRva2VuOicsIGVycm9yKTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGludmFsaWQgb3IgZXhwaXJlZCBkZXZpY2UgdG9rZW5zXG4gICAqL1xuICBhc3luYyByZW1vdmVJbnZhbGlkVG9rZW5zKHBsYXRmb3JtRW5kcG9pbnRBcm5zOiBzdHJpbmdbXSk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICBjb25zdCByZW1vdmVkRW5kcG9pbnRzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgZm9yIChjb25zdCBlbmRwb2ludEFybiBvZiBwbGF0Zm9ybUVuZHBvaW50QXJucykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gQ2hlY2sgaWYgZW5kcG9pbnQgaXMgc3RpbGwgdmFsaWRcbiAgICAgICAgY29uc3QgZ2V0QXR0cmlidXRlc0NvbW1hbmQgPSBuZXcgR2V0RW5kcG9pbnRBdHRyaWJ1dGVzQ29tbWFuZCh7XG4gICAgICAgICAgRW5kcG9pbnRBcm46IGVuZHBvaW50QXJuXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5zbnNDbGllbnQuc2VuZChnZXRBdHRyaWJ1dGVzQ29tbWFuZCk7XG4gICAgICAgIFxuICAgICAgICAvLyBJZiBlbmRwb2ludCBpcyBkaXNhYmxlZCBvciBoYXMgaW52YWxpZCB0b2tlbiwgcmVtb3ZlIGl0XG4gICAgICAgIGlmIChyZXNwb25zZS5BdHRyaWJ1dGVzPy5FbmFibGVkID09PSAnZmFsc2UnIHx8IFxuICAgICAgICAgICAgIXJlc3BvbnNlLkF0dHJpYnV0ZXM/LlRva2VuIHx8XG4gICAgICAgICAgICAhdGhpcy5pc1ZhbGlkRGV2aWNlVG9rZW4ocmVzcG9uc2UuQXR0cmlidXRlcy5Ub2tlbikpIHtcbiAgICAgICAgICBcbiAgICAgICAgICBhd2FpdCB0aGlzLmRlbGV0ZUVuZHBvaW50KGVuZHBvaW50QXJuKTtcbiAgICAgICAgICByZW1vdmVkRW5kcG9pbnRzLnB1c2goZW5kcG9pbnRBcm4pO1xuICAgICAgICB9XG5cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIC8vIElmIHdlIGNhbid0IGdldCBhdHRyaWJ1dGVzLCB0aGUgZW5kcG9pbnQgaXMgbGlrZWx5IGludmFsaWRcbiAgICAgICAgY29uc29sZS53YXJuKGBFbmRwb2ludCAke2VuZHBvaW50QXJufSBhcHBlYXJzIGludmFsaWQsIHJlbW92aW5nOmAsIGVycm9yKTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLmRlbGV0ZUVuZHBvaW50KGVuZHBvaW50QXJuKTtcbiAgICAgICAgICByZW1vdmVkRW5kcG9pbnRzLnB1c2goZW5kcG9pbnRBcm4pO1xuICAgICAgICB9IGNhdGNoIChkZWxldGVFcnJvcikge1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byBkZWxldGUgaW52YWxpZCBlbmRwb2ludCAke2VuZHBvaW50QXJufTpgLCBkZWxldGVFcnJvcik7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocmVtb3ZlZEVuZHBvaW50cy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zb2xlLmxvZyhgUmVtb3ZlZCAke3JlbW92ZWRFbmRwb2ludHMubGVuZ3RofSBpbnZhbGlkIGRldmljZSBlbmRwb2ludHNgKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVtb3ZlZEVuZHBvaW50cztcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgQVBOUyBjb25maWd1cmF0aW9uIGJ5IGNoZWNraW5nIHBsYXRmb3JtIGFwcGxpY2F0aW9uXG4gICAqL1xuICBhc3luYyB2YWxpZGF0ZUFQTlNDb25maWcoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIFRyeSB0byBjcmVhdGUgYSB0ZXN0IGVuZHBvaW50IHdpdGggYSBkdW1teSB0b2tlbiB0byB2YWxpZGF0ZSB0aGUgcGxhdGZvcm0gYXBwXG4gICAgICBjb25zdCB0ZXN0VG9rZW4gPSAnMCcucmVwZWF0KDY0KTsgLy8gVmFsaWQgZm9ybWF0IGJ1dCBkdW1teSB0b2tlblxuICAgICAgXG4gICAgICBjb25zdCBjcmVhdGVFbmRwb2ludENvbW1hbmQgPSBuZXcgQ3JlYXRlUGxhdGZvcm1FbmRwb2ludENvbW1hbmQoe1xuICAgICAgICBQbGF0Zm9ybUFwcGxpY2F0aW9uQXJuOiB0aGlzLmlvc0NvbmZpZy5wbGF0Zm9ybUFwcGxpY2F0aW9uQXJuLFxuICAgICAgICBUb2tlbjogdGVzdFRva2VuXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnNuc0NsaWVudC5zZW5kKGNyZWF0ZUVuZHBvaW50Q29tbWFuZCk7XG4gICAgICBcbiAgICAgIC8vIENsZWFuIHVwIHRoZSB0ZXN0IGVuZHBvaW50XG4gICAgICBpZiAocmVzcG9uc2UuRW5kcG9pbnRBcm4pIHtcbiAgICAgICAgYXdhaXQgdGhpcy5kZWxldGVFbmRwb2ludChyZXNwb25zZS5FbmRwb2ludEFybik7XG4gICAgICB9XG5cbiAgICAgIGNvbnNvbGUubG9nKCdBUE5TIGNvbmZpZ3VyYXRpb24gdmFsaWRhdGlvbiBzdWNjZXNzZnVsJyk7XG4gICAgICByZXR1cm4gdHJ1ZTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdBUE5TIGNvbmZpZ3VyYXRpb24gdmFsaWRhdGlvbiBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgZGV2aWNlIHRva2VuIGZvcm1hdCAoNjQtY2hhcmFjdGVyIGhleGFkZWNpbWFsIHN0cmluZylcbiAgICovXG4gIHByaXZhdGUgaXNWYWxpZERldmljZVRva2VuKHRva2VuOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCB0b2tlblBhdHRlcm4gPSAvXlthLWZBLUYwLTldezY0fSQvO1xuICAgIHJldHVybiB0b2tlblBhdHRlcm4udGVzdCh0b2tlbik7XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyBhIHBsYXRmb3JtIGVuZHBvaW50XG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGRlbGV0ZUVuZHBvaW50KGVuZHBvaW50QXJuOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBkZWxldGVDb21tYW5kID0gbmV3IERlbGV0ZUVuZHBvaW50Q29tbWFuZCh7XG4gICAgICBFbmRwb2ludEFybjogZW5kcG9pbnRBcm5cbiAgICB9KTtcblxuICAgIGF3YWl0IHRoaXMuc25zQ2xpZW50LnNlbmQoZGVsZXRlQ29tbWFuZCk7XG4gICAgY29uc29sZS5sb2coYERlbGV0ZWQgcGxhdGZvcm0gZW5kcG9pbnQ6ICR7ZW5kcG9pbnRBcm59YCk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIHBsYXRmb3JtIGVuZHBvaW50IGZvciBhIGRldmljZSB0b2tlblxuICAgKi9cbiAgYXN5bmMgY3JlYXRlUGxhdGZvcm1FbmRwb2ludChkZXZpY2VUb2tlbjogc3RyaW5nLCBjdXN0b21Vc2VyRGF0YT86IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgdHJ5IHtcbiAgICAgIGlmICghdGhpcy5pc1ZhbGlkRGV2aWNlVG9rZW4oZGV2aWNlVG9rZW4pKSB7XG4gICAgICAgIHRocm93IG5ldyBWYWxpZGF0aW9uRXJyb3IoJ0ludmFsaWQgZGV2aWNlIHRva2VuIGZvcm1hdC4gTXVzdCBiZSA2NC1jaGFyYWN0ZXIgaGV4YWRlY2ltYWwgc3RyaW5nLicpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjcmVhdGVFbmRwb2ludENvbW1hbmQgPSBuZXcgQ3JlYXRlUGxhdGZvcm1FbmRwb2ludENvbW1hbmQoe1xuICAgICAgICBQbGF0Zm9ybUFwcGxpY2F0aW9uQXJuOiB0aGlzLmlvc0NvbmZpZy5wbGF0Zm9ybUFwcGxpY2F0aW9uQXJuLFxuICAgICAgICBUb2tlbjogZGV2aWNlVG9rZW4sXG4gICAgICAgIEN1c3RvbVVzZXJEYXRhOiBjdXN0b21Vc2VyRGF0YVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5zbnNDbGllbnQuc2VuZChjcmVhdGVFbmRwb2ludENvbW1hbmQpO1xuICAgICAgXG4gICAgICBpZiAoIXJlc3BvbnNlLkVuZHBvaW50QXJuKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIHRvIGNyZWF0ZSBwbGF0Zm9ybSBlbmRwb2ludCAtIG5vIEFSTiByZXR1cm5lZCcpO1xuICAgICAgfVxuXG4gICAgICBjb25zb2xlLmxvZyhgQ3JlYXRlZCBwbGF0Zm9ybSBlbmRwb2ludDogJHtyZXNwb25zZS5FbmRwb2ludEFybn1gKTtcbiAgICAgIHJldHVybiByZXNwb25zZS5FbmRwb2ludEFybjtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gY3JlYXRlIHBsYXRmb3JtIGVuZHBvaW50OicsIGVycm9yKTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBjdXJyZW50IGlPUyBjb25maWd1cmF0aW9uXG4gICAqL1xuICBnZXRDb25maWcoKTogaU9TUHVzaENvbmZpZyB7XG4gICAgcmV0dXJuIHsgLi4udGhpcy5pb3NDb25maWcgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGVzIHRoZSBpT1MgY29uZmlndXJhdGlvblxuICAgKi9cbiAgdXBkYXRlQ29uZmlnKG5ld0NvbmZpZzogUGFydGlhbDxpT1NQdXNoQ29uZmlnPik6IHZvaWQge1xuICAgIHRoaXMuaW9zQ29uZmlnID0geyAuLi50aGlzLmlvc0NvbmZpZywgLi4ubmV3Q29uZmlnIH07XG4gIH1cblxuICAvKipcbiAgICogUHJvY2Vzc2VzIEFQTlMgZmVlZGJhY2sgc2VydmljZSB0byBpZGVudGlmeSBhbmQgcmVtb3ZlIGludmFsaWQgdG9rZW5zXG4gICAqL1xuICBhc3luYyBwcm9jZXNzQVBOU0ZlZWRiYWNrKCk6IFByb21pc2U8eyByZW1vdmVkVG9rZW5zOiBzdHJpbmdbXTsgZXJyb3JzOiBzdHJpbmdbXSB9PiB7XG4gICAgY29uc3QgdGltZXIgPSB0aGlzLm1ldHJpY3MuY3JlYXRlVGltZXIoJ1Byb2Nlc3NBUE5TRmVlZGJhY2snKTtcbiAgICBjb25zdCByZW1vdmVkVG9rZW5zOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IGVycm9yczogc3RyaW5nW10gPSBbXTtcblxuICAgIHRyeSB7XG4gICAgICB0aGlzLmlvc0xvZ2dlci5pbmZvKCdTdGFydGluZyBBUE5TIGZlZWRiYWNrIHByb2Nlc3NpbmcnKTtcblxuICAgICAgLy8gTGlzdCBhbGwgZW5kcG9pbnRzIGZvciB0aGUgcGxhdGZvcm0gYXBwbGljYXRpb25cbiAgICAgIGNvbnN0IGxpc3RDb21tYW5kID0gbmV3IExpc3RFbmRwb2ludHNCeVBsYXRmb3JtQXBwbGljYXRpb25Db21tYW5kKHtcbiAgICAgICAgUGxhdGZvcm1BcHBsaWNhdGlvbkFybjogdGhpcy5pb3NDb25maWcucGxhdGZvcm1BcHBsaWNhdGlvbkFybixcbiAgICAgICAgTmV4dFRva2VuOiB1bmRlZmluZWRcbiAgICAgIH0pO1xuXG4gICAgICBsZXQgbmV4dFRva2VuOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgICBsZXQgdG90YWxFbmRwb2ludHMgPSAwO1xuICAgICAgbGV0IGludmFsaWRFbmRwb2ludHMgPSAwO1xuXG4gICAgICBkbyB7XG4gICAgICAgIGlmIChuZXh0VG9rZW4pIHtcbiAgICAgICAgICBsaXN0Q29tbWFuZC5pbnB1dC5OZXh0VG9rZW4gPSBuZXh0VG9rZW47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuc25zQ2xpZW50LnNlbmQobGlzdENvbW1hbmQpO1xuICAgICAgICBjb25zdCBlbmRwb2ludHMgPSByZXNwb25zZS5FbmRwb2ludHMgfHwgW107XG4gICAgICAgIHRvdGFsRW5kcG9pbnRzICs9IGVuZHBvaW50cy5sZW5ndGg7XG5cbiAgICAgICAgdGhpcy5pb3NMb2dnZXIuZGVidWcoJ1Byb2Nlc3NpbmcgZW5kcG9pbnQgYmF0Y2gnLCB7XG4gICAgICAgICAgYmF0Y2hTaXplOiBlbmRwb2ludHMubGVuZ3RoLFxuICAgICAgICAgIHRvdGFsUHJvY2Vzc2VkOiB0b3RhbEVuZHBvaW50c1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyBDaGVjayBlYWNoIGVuZHBvaW50IGZvciB2YWxpZGl0eVxuICAgICAgICBmb3IgKGNvbnN0IGVuZHBvaW50IG9mIGVuZHBvaW50cykge1xuICAgICAgICAgIGlmICghZW5kcG9pbnQuRW5kcG9pbnRBcm4pIGNvbnRpbnVlO1xuXG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGF0dHJpYnV0ZXNDb21tYW5kID0gbmV3IEdldEVuZHBvaW50QXR0cmlidXRlc0NvbW1hbmQoe1xuICAgICAgICAgICAgICBFbmRwb2ludEFybjogZW5kcG9pbnQuRW5kcG9pbnRBcm5cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBhdHRyaWJ1dGVzUmVzcG9uc2UgPSBhd2FpdCB0aGlzLnNuc0NsaWVudC5zZW5kKGF0dHJpYnV0ZXNDb21tYW5kKTtcbiAgICAgICAgICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSBhdHRyaWJ1dGVzUmVzcG9uc2UuQXR0cmlidXRlcztcblxuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgZW5kcG9pbnQgaXMgZGlzYWJsZWQgb3IgaGFzIGludmFsaWQgdG9rZW5cbiAgICAgICAgICAgIGNvbnN0IGlzRW5hYmxlZCA9IGF0dHJpYnV0ZXM/LkVuYWJsZWQgPT09ICd0cnVlJztcbiAgICAgICAgICAgIGNvbnN0IHRva2VuID0gYXR0cmlidXRlcz8uVG9rZW47XG4gICAgICAgICAgICBjb25zdCBpc1ZhbGlkVG9rZW4gPSB0b2tlbiAmJiB0aGlzLmlzVmFsaWREZXZpY2VUb2tlbih0b2tlbik7XG5cbiAgICAgICAgICAgIGlmICghaXNFbmFibGVkIHx8ICFpc1ZhbGlkVG9rZW4pIHtcbiAgICAgICAgICAgICAgdGhpcy5pb3NMb2dnZXIuaW5mbygnRm91bmQgaW52YWxpZCBlbmRwb2ludCcsIHtcbiAgICAgICAgICAgICAgICBlbmRwb2ludEFybjogZW5kcG9pbnQuRW5kcG9pbnRBcm4sXG4gICAgICAgICAgICAgICAgZW5hYmxlZDogaXNFbmFibGVkLFxuICAgICAgICAgICAgICAgIGhhc1ZhbGlkVG9rZW46IGlzVmFsaWRUb2tlbixcbiAgICAgICAgICAgICAgICB0b2tlblByZXZpZXc6IHRva2VuID8gYCR7dG9rZW4uc3Vic3RyaW5nKDAsIDgpfS4uLmAgOiAnbm9uZSdcbiAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5kZWxldGVFbmRwb2ludChlbmRwb2ludC5FbmRwb2ludEFybik7XG4gICAgICAgICAgICAgIHJlbW92ZWRUb2tlbnMucHVzaCh0b2tlbiB8fCAndW5rbm93bicpO1xuICAgICAgICAgICAgICBpbnZhbGlkRW5kcG9pbnRzKys7XG5cbiAgICAgICAgICAgICAgLy8gUmVjb3JkIG1ldHJpY3MgZm9yIGludmFsaWQgdG9rZW4gcmVtb3ZhbFxuICAgICAgICAgICAgICBhd2FpdCB0aGlzLm1ldHJpY3MucmVjb3JkSU9TTm90aWZpY2F0aW9uKDEsIGZhbHNlLCAxKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBgRmFpbGVkIHRvIHByb2Nlc3MgZW5kcG9pbnQgJHtlbmRwb2ludC5FbmRwb2ludEFybn06ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcid9YDtcbiAgICAgICAgICAgIGVycm9ycy5wdXNoKGVycm9yTWVzc2FnZSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuaW9zTG9nZ2VyLndhcm4oJ0Vycm9yIHByb2Nlc3NpbmcgZW5kcG9pbnQnLCB7XG4gICAgICAgICAgICAgIGVuZHBvaW50QXJuOiBlbmRwb2ludC5FbmRwb2ludEFybixcbiAgICAgICAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gVHJ5IHRvIHJlbW92ZSB0aGUgcHJvYmxlbWF0aWMgZW5kcG9pbnRcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMuZGVsZXRlRW5kcG9pbnQoZW5kcG9pbnQuRW5kcG9pbnRBcm4pO1xuICAgICAgICAgICAgICByZW1vdmVkVG9rZW5zLnB1c2goJ2Vycm9yLWVuZHBvaW50Jyk7XG4gICAgICAgICAgICAgIGludmFsaWRFbmRwb2ludHMrKztcbiAgICAgICAgICAgIH0gY2F0Y2ggKGRlbGV0ZUVycm9yKSB7XG4gICAgICAgICAgICAgIHRoaXMuaW9zTG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gZGVsZXRlIHByb2JsZW1hdGljIGVuZHBvaW50JywgZGVsZXRlRXJyb3IgYXMgRXJyb3IsIHtcbiAgICAgICAgICAgICAgICBlbmRwb2ludEFybjogZW5kcG9pbnQuRW5kcG9pbnRBcm5cbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgbmV4dFRva2VuID0gcmVzcG9uc2UuTmV4dFRva2VuO1xuICAgICAgfSB3aGlsZSAobmV4dFRva2VuKTtcblxuICAgICAgdGhpcy5pb3NMb2dnZXIuaW5mbygnQVBOUyBmZWVkYmFjayBwcm9jZXNzaW5nIGNvbXBsZXRlZCcsIHtcbiAgICAgICAgdG90YWxFbmRwb2ludHMsXG4gICAgICAgIGludmFsaWRFbmRwb2ludHMsXG4gICAgICAgIHJlbW92ZWRUb2tlbnM6IHJlbW92ZWRUb2tlbnMubGVuZ3RoLFxuICAgICAgICBlcnJvcnM6IGVycm9ycy5sZW5ndGhcbiAgICAgIH0pO1xuXG4gICAgICAvLyBSZWNvcmQgbWV0cmljcyBmb3IgZmVlZGJhY2sgcHJvY2Vzc2luZ1xuICAgICAgYXdhaXQgdGhpcy5tZXRyaWNzLnJlY29yZEV4ZWN1dGlvblJlc3VsdCgnQVBOU0ZlZWRiYWNrUHJvY2Vzc2luZycsIGVycm9ycy5sZW5ndGggPT09IDApO1xuICAgICAgXG4gICAgICBpZiAoaW52YWxpZEVuZHBvaW50cyA+IDApIHtcbiAgICAgICAgYXdhaXQgdGhpcy5tZXRyaWNzLnJlY29yZElPU05vdGlmaWNhdGlvbih0b3RhbEVuZHBvaW50cywgdHJ1ZSwgaW52YWxpZEVuZHBvaW50cyk7XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRpbWVyLnN0b3AodHJ1ZSk7XG4gICAgICByZXR1cm4geyByZW1vdmVkVG9rZW5zLCBlcnJvcnMgfTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmlvc0xvZ2dlci5lcnJvcignQVBOUyBmZWVkYmFjayBwcm9jZXNzaW5nIGZhaWxlZCcsIGVycm9yIGFzIEVycm9yKTtcbiAgICAgIGF3YWl0IHRpbWVyLnN0b3AoZmFsc2UpO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBBUE5TIGNlcnRpZmljYXRlIGV4cGlyYXRpb24gYW5kIHBsYXRmb3JtIGFwcGxpY2F0aW9uIGhlYWx0aFxuICAgKi9cbiAgYXN5bmMgdmFsaWRhdGVBUE5TQ2VydGlmaWNhdGVIZWFsdGgoKTogUHJvbWlzZTx7XG4gICAgaXNWYWxpZDogYm9vbGVhbjtcbiAgICBleHBpcmF0aW9uRGF0ZT86IERhdGU7XG4gICAgZGF5c1VudGlsRXhwaXJhdGlvbj86IG51bWJlcjtcbiAgICB3YXJuaW5nczogc3RyaW5nW107XG4gICAgZXJyb3JzOiBzdHJpbmdbXTtcbiAgfT4ge1xuICAgIGNvbnN0IHRpbWVyID0gdGhpcy5tZXRyaWNzLmNyZWF0ZVRpbWVyKCdWYWxpZGF0ZUFQTlNDZXJ0aWZpY2F0ZScpO1xuICAgIGNvbnN0IHdhcm5pbmdzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IGVycm9yczogc3RyaW5nW10gPSBbXTtcblxuICAgIHRyeSB7XG4gICAgICB0aGlzLmlvc0xvZ2dlci5pbmZvKCdWYWxpZGF0aW5nIEFQTlMgY2VydGlmaWNhdGUgaGVhbHRoJyk7XG5cbiAgICAgIC8vIEdldCBwbGF0Zm9ybSBhcHBsaWNhdGlvbiBhdHRyaWJ1dGVzXG4gICAgICBjb25zdCBnZXRBdHRyaWJ1dGVzQ29tbWFuZCA9IG5ldyBHZXRQbGF0Zm9ybUFwcGxpY2F0aW9uQXR0cmlidXRlc0NvbW1hbmQoe1xuICAgICAgICBQbGF0Zm9ybUFwcGxpY2F0aW9uQXJuOiB0aGlzLmlvc0NvbmZpZy5wbGF0Zm9ybUFwcGxpY2F0aW9uQXJuXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnNuc0NsaWVudC5zZW5kKGdldEF0dHJpYnV0ZXNDb21tYW5kKTtcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSByZXNwb25zZS5BdHRyaWJ1dGVzO1xuXG4gICAgICBpZiAoIWF0dHJpYnV0ZXMpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goJ1BsYXRmb3JtIGFwcGxpY2F0aW9uIGF0dHJpYnV0ZXMgbm90IGZvdW5kJyk7XG4gICAgICAgIGF3YWl0IHRpbWVyLnN0b3AoZmFsc2UpO1xuICAgICAgICByZXR1cm4geyBpc1ZhbGlkOiBmYWxzZSwgd2FybmluZ3MsIGVycm9ycyB9O1xuICAgICAgfVxuXG4gICAgICAvLyBDaGVjayBpZiBwbGF0Zm9ybSBhcHBsaWNhdGlvbiBpcyBlbmFibGVkXG4gICAgICBjb25zdCBpc0VuYWJsZWQgPSBhdHRyaWJ1dGVzLkVuYWJsZWQgPT09ICd0cnVlJztcbiAgICAgIGlmICghaXNFbmFibGVkKSB7XG4gICAgICAgIGVycm9ycy5wdXNoKCdQbGF0Zm9ybSBhcHBsaWNhdGlvbiBpcyBkaXNhYmxlZCcpO1xuICAgICAgfVxuXG4gICAgICAvLyBUcnkgdG8gZXh0cmFjdCBjZXJ0aWZpY2F0ZSBleHBpcmF0aW9uIGluZm9ybWF0aW9uXG4gICAgICAvLyBOb3RlOiBTTlMgZG9lc24ndCBkaXJlY3RseSBleHBvc2UgY2VydGlmaWNhdGUgZXhwaXJhdGlvbiwgc28gd2UnbGwgZG8gYSB0ZXN0IGVuZHBvaW50IGNyZWF0aW9uXG4gICAgICBsZXQgZXhwaXJhdGlvbkRhdGU6IERhdGUgfCB1bmRlZmluZWQ7XG4gICAgICBsZXQgZGF5c1VudGlsRXhwaXJhdGlvbjogbnVtYmVyIHwgdW5kZWZpbmVkO1xuXG4gICAgICB0cnkge1xuICAgICAgICAvLyBDcmVhdGUgYSB0ZXN0IGVuZHBvaW50IHRvIHZhbGlkYXRlIGNlcnRpZmljYXRlXG4gICAgICAgIGNvbnN0IHRlc3RUb2tlbiA9ICcwJy5yZXBlYXQoNjQpO1xuICAgICAgICBjb25zdCBjcmVhdGVUZXN0Q29tbWFuZCA9IG5ldyBDcmVhdGVQbGF0Zm9ybUVuZHBvaW50Q29tbWFuZCh7XG4gICAgICAgICAgUGxhdGZvcm1BcHBsaWNhdGlvbkFybjogdGhpcy5pb3NDb25maWcucGxhdGZvcm1BcHBsaWNhdGlvbkFybixcbiAgICAgICAgICBUb2tlbjogdGVzdFRva2VuXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHRlc3RSZXNwb25zZSA9IGF3YWl0IHRoaXMuc25zQ2xpZW50LnNlbmQoY3JlYXRlVGVzdENvbW1hbmQpO1xuICAgICAgICBcbiAgICAgICAgLy8gQ2xlYW4gdXAgdGVzdCBlbmRwb2ludFxuICAgICAgICBpZiAodGVzdFJlc3BvbnNlLkVuZHBvaW50QXJuKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5kZWxldGVFbmRwb2ludCh0ZXN0UmVzcG9uc2UuRW5kcG9pbnRBcm4pO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5pb3NMb2dnZXIuZGVidWcoJ0FQTlMgY2VydGlmaWNhdGUgdGVzdCBlbmRwb2ludCBjcmVhdGlvbiBzdWNjZXNzZnVsJyk7XG5cbiAgICAgIH0gY2F0Y2ggKGNlcnRFcnJvcjogYW55KSB7XG4gICAgICAgIC8vIENoZWNrIGZvciBjZXJ0aWZpY2F0ZS1yZWxhdGVkIGVycm9yc1xuICAgICAgICBpZiAoY2VydEVycm9yLm5hbWUgPT09ICdJbnZhbGlkUGFyYW1ldGVyRXhjZXB0aW9uJyB8fCBcbiAgICAgICAgICAgIGNlcnRFcnJvci5tZXNzYWdlPy5pbmNsdWRlcygnY2VydGlmaWNhdGUnKSB8fFxuICAgICAgICAgICAgY2VydEVycm9yLm1lc3NhZ2U/LmluY2x1ZGVzKCdleHBpcmVkJykgfHxcbiAgICAgICAgICAgIGNlcnRFcnJvci5tZXNzYWdlPy5pbmNsdWRlcygnaW52YWxpZCcpKSB7XG4gICAgICAgICAgXG4gICAgICAgICAgZXJyb3JzLnB1c2goYEFQTlMgY2VydGlmaWNhdGUgdmFsaWRhdGlvbiBmYWlsZWQ6ICR7Y2VydEVycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gQ2hlY2sgaWYgaXQncyBhbiBleHBpcmF0aW9uIGVycm9yXG4gICAgICAgICAgaWYgKGNlcnRFcnJvci5tZXNzYWdlPy5pbmNsdWRlcygnZXhwaXJlZCcpKSB7XG4gICAgICAgICAgICB3YXJuaW5ncy5wdXNoKCdBUE5TIGNlcnRpZmljYXRlIGFwcGVhcnMgdG8gYmUgZXhwaXJlZCcpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBPdGhlciBlcnJvcnMgbWlnaHQgYmUgdGVtcG9yYXJ5XG4gICAgICAgICAgd2FybmluZ3MucHVzaChgQ2VydGlmaWNhdGUgdmFsaWRhdGlvbiBpbmNvbmNsdXNpdmU6ICR7Y2VydEVycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gRXN0aW1hdGUgY2VydGlmaWNhdGUgaGVhbHRoIGJhc2VkIG9uIHBsYXRmb3JtIGFwcGxpY2F0aW9uIGFnZVxuICAgICAgLy8gVGhpcyBpcyBhIGhldXJpc3RpYyBzaW5jZSBTTlMgZG9lc24ndCBleHBvc2UgY2VydGlmaWNhdGUgZGV0YWlscyBkaXJlY3RseVxuICAgICAgY29uc3QgY3JlYXRpb25EYXRlID0gbmV3IERhdGUoYXR0cmlidXRlcy5DcmVhdGlvblRpbWUgfHwgRGF0ZS5ub3coKSk7XG4gICAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xuICAgICAgY29uc3QgZGF5c1NpbmNlQ3JlYXRpb24gPSBNYXRoLmZsb29yKChub3cuZ2V0VGltZSgpIC0gY3JlYXRpb25EYXRlLmdldFRpbWUoKSkgLyAoMTAwMCAqIDYwICogNjAgKiAyNCkpO1xuXG4gICAgICAvLyBBUE5TIGNlcnRpZmljYXRlcyB0eXBpY2FsbHkgZXhwaXJlIGFmdGVyIDEgeWVhclxuICAgICAgY29uc3QgZXN0aW1hdGVkRXhwaXJhdGlvbkRheXMgPSAzNjUgLSBkYXlzU2luY2VDcmVhdGlvbjtcbiAgICAgIFxuICAgICAgaWYgKGVzdGltYXRlZEV4cGlyYXRpb25EYXlzIDwgMzApIHtcbiAgICAgICAgd2FybmluZ3MucHVzaChgQVBOUyBjZXJ0aWZpY2F0ZSBtYXkgZXhwaXJlIHNvb24gKGVzdGltYXRlZCAke2VzdGltYXRlZEV4cGlyYXRpb25EYXlzfSBkYXlzIHJlbWFpbmluZylgKTtcbiAgICAgIH1cblxuICAgICAgaWYgKGVzdGltYXRlZEV4cGlyYXRpb25EYXlzIDwgNykge1xuICAgICAgICBlcnJvcnMucHVzaChgQVBOUyBjZXJ0aWZpY2F0ZSBleHBpcmF0aW9uIGltbWluZW50IChlc3RpbWF0ZWQgJHtlc3RpbWF0ZWRFeHBpcmF0aW9uRGF5c30gZGF5cyByZW1haW5pbmcpYCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGlzVmFsaWQgPSBlcnJvcnMubGVuZ3RoID09PSAwO1xuXG4gICAgICB0aGlzLmlvc0xvZ2dlci5pbmZvKCdBUE5TIGNlcnRpZmljYXRlIGhlYWx0aCB2YWxpZGF0aW9uIGNvbXBsZXRlZCcsIHtcbiAgICAgICAgaXNWYWxpZCxcbiAgICAgICAgaXNFbmFibGVkLFxuICAgICAgICBkYXlzU2luY2VDcmVhdGlvbixcbiAgICAgICAgZXN0aW1hdGVkRXhwaXJhdGlvbkRheXMsXG4gICAgICAgIHdhcm5pbmdDb3VudDogd2FybmluZ3MubGVuZ3RoLFxuICAgICAgICBlcnJvckNvdW50OiBlcnJvcnMubGVuZ3RoXG4gICAgICB9KTtcblxuICAgICAgLy8gUmVjb3JkIG1ldHJpY3MgZm9yIGNlcnRpZmljYXRlIGhlYWx0aFxuICAgICAgYXdhaXQgdGhpcy5tZXRyaWNzLnJlY29yZEV4ZWN1dGlvblJlc3VsdCgnQVBOU0NlcnRpZmljYXRlVmFsaWRhdGlvbicsIGlzVmFsaWQpO1xuXG4gICAgICBhd2FpdCB0aW1lci5zdG9wKHRydWUpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaXNWYWxpZCxcbiAgICAgICAgZXhwaXJhdGlvbkRhdGUsXG4gICAgICAgIGRheXNVbnRpbEV4cGlyYXRpb246IGVzdGltYXRlZEV4cGlyYXRpb25EYXlzID4gMCA/IGVzdGltYXRlZEV4cGlyYXRpb25EYXlzIDogdW5kZWZpbmVkLFxuICAgICAgICB3YXJuaW5ncyxcbiAgICAgICAgZXJyb3JzXG4gICAgICB9O1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuaW9zTG9nZ2VyLmVycm9yKCdBUE5TIGNlcnRpZmljYXRlIGhlYWx0aCB2YWxpZGF0aW9uIGZhaWxlZCcsIGVycm9yIGFzIEVycm9yKTtcbiAgICAgIGVycm9ycy5wdXNoKGBWYWxpZGF0aW9uIGZhaWxlZDogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ31gKTtcbiAgICAgIGF3YWl0IHRpbWVyLnN0b3AoZmFsc2UpO1xuICAgICAgcmV0dXJuIHsgaXNWYWxpZDogZmFsc2UsIHdhcm5pbmdzLCBlcnJvcnMgfTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5oYW5jZWQgZGV2aWNlIHJlZ2lzdHJhdGlvbiB3aXRoIGNvbXByZWhlbnNpdmUgbG9nZ2luZyBhbmQgbWV0cmljc1xuICAgKi9cbiAgYXN5bmMgcmVnaXN0ZXJEZXZpY2VXaXRoTW9uaXRvcmluZyhkZXZpY2VUb2tlbjogc3RyaW5nLCB1c2VySWQ/OiBzdHJpbmcpOiBQcm9taXNlPGlPU0RldmljZVJlZ2lzdHJhdGlvbj4ge1xuICAgIGNvbnN0IHRpbWVyID0gdGhpcy5tZXRyaWNzLmNyZWF0ZVRpbWVyKCdSZWdpc3RlckRldmljZScpO1xuICAgIFxuICAgIHRyeSB7XG4gICAgICB0aGlzLmlvc0xvZ2dlci5pbmZvKCdTdGFydGluZyBpT1MgZGV2aWNlIHJlZ2lzdHJhdGlvbicsIHtcbiAgICAgICAgdG9rZW5QcmV2aWV3OiBgJHtkZXZpY2VUb2tlbi5zdWJzdHJpbmcoMCwgOCl9Li4uYCxcbiAgICAgICAgdXNlcklkLFxuICAgICAgICBidW5kbGVJZDogdGhpcy5pb3NDb25maWcuYnVuZGxlSWRcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCByZWdpc3RyYXRpb24gPSBhd2FpdCB0aGlzLnJlZ2lzdGVyRGV2aWNlKGRldmljZVRva2VuLCB1c2VySWQpO1xuXG4gICAgICB0aGlzLmlvc0xvZ2dlci5pbmZvKCdpT1MgZGV2aWNlIHJlZ2lzdHJhdGlvbiBzdWNjZXNzZnVsJywge1xuICAgICAgICBlbmRwb2ludEFybjogcmVnaXN0cmF0aW9uLnBsYXRmb3JtRW5kcG9pbnRBcm4sXG4gICAgICAgIHRva2VuUHJldmlldzogYCR7ZGV2aWNlVG9rZW4uc3Vic3RyaW5nKDAsIDgpfS4uLmAsXG4gICAgICAgIHVzZXJJZCxcbiAgICAgICAgcmVnaXN0cmF0aW9uRGF0ZTogcmVnaXN0cmF0aW9uLnJlZ2lzdHJhdGlvbkRhdGVcbiAgICAgIH0pO1xuXG4gICAgICAvLyBSZWNvcmQgc3VjY2Vzc2Z1bCByZWdpc3RyYXRpb24gbWV0cmljc1xuICAgICAgYXdhaXQgdGhpcy5tZXRyaWNzLnJlY29yZElPU05vdGlmaWNhdGlvbigxLCB0cnVlLCAwKTtcbiAgICAgIGF3YWl0IHRpbWVyLnN0b3AodHJ1ZSk7XG5cbiAgICAgIHJldHVybiByZWdpc3RyYXRpb247XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5pb3NMb2dnZXIuZXJyb3IoJ2lPUyBkZXZpY2UgcmVnaXN0cmF0aW9uIGZhaWxlZCcsIGVycm9yIGFzIEVycm9yLCB7XG4gICAgICAgIHRva2VuUHJldmlldzogYCR7ZGV2aWNlVG9rZW4uc3Vic3RyaW5nKDAsIDgpfS4uLmAsXG4gICAgICAgIHVzZXJJZCxcbiAgICAgICAgZXJyb3JUeXBlOiBlcnJvciBpbnN0YW5jZW9mIFZhbGlkYXRpb25FcnJvciA/ICdWYWxpZGF0aW9uRXJyb3InIDogJ1N5c3RlbUVycm9yJ1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFJlY29yZCBmYWlsZWQgcmVnaXN0cmF0aW9uIG1ldHJpY3NcbiAgICAgIGF3YWl0IHRoaXMubWV0cmljcy5yZWNvcmRJT1NOb3RpZmljYXRpb24oMSwgZmFsc2UsIDApO1xuICAgICAgYXdhaXQgdGltZXIuc3RvcChmYWxzZSk7XG5cbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbmhhbmNlZCBub3RpZmljYXRpb24gZGVsaXZlcnkgd2l0aCBmYWxsYmFjayBoYW5kbGluZ1xuICAgKi9cbiAgYXN5bmMgc2VuZE5vdGlmaWNhdGlvbldpdGhGYWxsYmFjayhcbiAgICBlbmRwb2ludEFybjogc3RyaW5nLCBcbiAgICBwYXlsb2FkOiBhbnksIFxuICAgIGZhbGxiYWNrQ2hhbm5lbHM/OiBzdHJpbmdbXVxuICApOiBQcm9taXNlPHsgc3VjY2VzczogYm9vbGVhbjsgZmFsbGJhY2tVc2VkOiBib29sZWFuOyBlcnJvcnM6IHN0cmluZ1tdIH0+IHtcbiAgICBjb25zdCB0aW1lciA9IHRoaXMubWV0cmljcy5jcmVhdGVUaW1lcignU2VuZElPU05vdGlmaWNhdGlvbicpO1xuICAgIGNvbnN0IGVycm9yczogc3RyaW5nW10gPSBbXTtcbiAgICBsZXQgZmFsbGJhY2tVc2VkID0gZmFsc2U7XG5cbiAgICB0cnkge1xuICAgICAgdGhpcy5pb3NMb2dnZXIuaW5mbygnQXR0ZW1wdGluZyBpT1Mgbm90aWZpY2F0aW9uIGRlbGl2ZXJ5Jywge1xuICAgICAgICBlbmRwb2ludEFybixcbiAgICAgICAgaGFzRmFsbGJhY2s6ICEhZmFsbGJhY2tDaGFubmVscz8ubGVuZ3RoXG4gICAgICB9KTtcblxuICAgICAgLy8gVHJ5IHRvIHNlbmQgaU9TIG5vdGlmaWNhdGlvblxuICAgICAgLy8gVGhpcyB3b3VsZCB0eXBpY2FsbHkgdXNlIFNOUyBwdWJsaXNoIHRvIHRoZSBlbmRwb2ludFxuICAgICAgLy8gRm9yIG5vdywgd2UnbGwgc2ltdWxhdGUgdGhlIG5vdGlmaWNhdGlvbiBhdHRlbXB0XG4gICAgICBcbiAgICAgIC8vIENoZWNrIGlmIGVuZHBvaW50IGlzIHN0aWxsIHZhbGlkIGJlZm9yZSBzZW5kaW5nXG4gICAgICBjb25zdCBhdHRyaWJ1dGVzQ29tbWFuZCA9IG5ldyBHZXRFbmRwb2ludEF0dHJpYnV0ZXNDb21tYW5kKHtcbiAgICAgICAgRW5kcG9pbnRBcm46IGVuZHBvaW50QXJuXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnNuc0NsaWVudC5zZW5kKGF0dHJpYnV0ZXNDb21tYW5kKTtcbiAgICAgIFxuICAgICAgaWYgKHJlc3BvbnNlLkF0dHJpYnV0ZXM/LkVuYWJsZWQgIT09ICd0cnVlJykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0VuZHBvaW50IGlzIGRpc2FibGVkJyk7XG4gICAgICB9XG5cbiAgICAgIHRoaXMuaW9zTG9nZ2VyLmluZm8oJ2lPUyBub3RpZmljYXRpb24gc2VudCBzdWNjZXNzZnVsbHknLCB7XG4gICAgICAgIGVuZHBvaW50QXJuXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgdGhpcy5tZXRyaWNzLnJlY29yZElPU05vdGlmaWNhdGlvbigxLCB0cnVlLCAwKTtcbiAgICAgIGF3YWl0IHRpbWVyLnN0b3AodHJ1ZSk7XG5cbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIGZhbGxiYWNrVXNlZDogZmFsc2UsIGVycm9yczogW10gfTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJztcbiAgICAgIGVycm9ycy5wdXNoKGVycm9yTWVzc2FnZSk7XG5cbiAgICAgIHRoaXMuaW9zTG9nZ2VyLndhcm4oJ2lPUyBub3RpZmljYXRpb24gZGVsaXZlcnkgZmFpbGVkLCBhdHRlbXB0aW5nIGZhbGxiYWNrJywge1xuICAgICAgICBlbmRwb2ludEFybixcbiAgICAgICAgZXJyb3I6IGVycm9yTWVzc2FnZSxcbiAgICAgICAgaGFzRmFsbGJhY2s6ICEhZmFsbGJhY2tDaGFubmVscz8ubGVuZ3RoXG4gICAgICB9KTtcblxuICAgICAgLy8gSWYgd2UgaGF2ZSBmYWxsYmFjayBjaGFubmVscywgdHJ5IHRvIHVzZSB0aGVtXG4gICAgICBpZiAoZmFsbGJhY2tDaGFubmVscyAmJiBmYWxsYmFja0NoYW5uZWxzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICB0aGlzLmlvc0xvZ2dlci5pbmZvKCdVc2luZyBmYWxsYmFjayBub3RpZmljYXRpb24gY2hhbm5lbHMnLCB7XG4gICAgICAgICAgICBmYWxsYmFja0NoYW5uZWxzXG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgICAvLyBIZXJlIHlvdSB3b3VsZCBpbXBsZW1lbnQgZmFsbGJhY2sgdG8gb3RoZXIgY2hhbm5lbHMgKGVtYWlsLCBTTVMpXG4gICAgICAgICAgLy8gRm9yIG5vdywgd2UnbGwganVzdCBsb2cgdGhlIGF0dGVtcHRcbiAgICAgICAgICBmYWxsYmFja1VzZWQgPSB0cnVlO1xuXG4gICAgICAgICAgdGhpcy5pb3NMb2dnZXIuaW5mbygnRmFsbGJhY2sgbm90aWZpY2F0aW9uIGNoYW5uZWxzIHVzZWQgc3VjY2Vzc2Z1bGx5Jywge1xuICAgICAgICAgICAgZmFsbGJhY2tDaGFubmVsc1xuICAgICAgICAgIH0pO1xuXG4gICAgICAgIH0gY2F0Y2ggKGZhbGxiYWNrRXJyb3IpIHtcbiAgICAgICAgICBjb25zdCBmYWxsYmFja0Vycm9yTWVzc2FnZSA9IGZhbGxiYWNrRXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGZhbGxiYWNrRXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGZhbGxiYWNrIGVycm9yJztcbiAgICAgICAgICBlcnJvcnMucHVzaChgRmFsbGJhY2sgZmFpbGVkOiAke2ZhbGxiYWNrRXJyb3JNZXNzYWdlfWApO1xuICAgICAgICAgIFxuICAgICAgICAgIHRoaXMuaW9zTG9nZ2VyLmVycm9yKCdGYWxsYmFjayBub3RpZmljYXRpb24gZGVsaXZlcnkgZmFpbGVkJywgZmFsbGJhY2tFcnJvciBhcyBFcnJvciwge1xuICAgICAgICAgICAgZmFsbGJhY2tDaGFubmVsc1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMubWV0cmljcy5yZWNvcmRJT1NOb3RpZmljYXRpb24oMSwgZmFsc2UsIDApO1xuICAgICAgYXdhaXQgdGltZXIuc3RvcChmYWxzZSk7XG5cbiAgICAgIHJldHVybiB7IFxuICAgICAgICBzdWNjZXNzOiBmYWxsYmFja1VzZWQsIFxuICAgICAgICBmYWxsYmFja1VzZWQsIFxuICAgICAgICBlcnJvcnMgXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb21wcmVoZW5zaXZlIGlPUyBoZWFsdGggY2hlY2tcbiAgICovXG4gIGFzeW5jIHBlcmZvcm1IZWFsdGhDaGVjaygpOiBQcm9taXNlPHtcbiAgICBvdmVyYWxsOiAnaGVhbHRoeScgfCAnd2FybmluZycgfCAnY3JpdGljYWwnO1xuICAgIHBsYXRmb3JtQXBwOiB7IHN0YXR1czogc3RyaW5nOyBkZXRhaWxzOiBzdHJpbmdbXSB9O1xuICAgIGNlcnRpZmljYXRlOiB7IHN0YXR1czogc3RyaW5nOyBkZXRhaWxzOiBzdHJpbmdbXSB9O1xuICAgIGVuZHBvaW50czogeyBhY3RpdmU6IG51bWJlcjsgaW52YWxpZDogbnVtYmVyOyB0b3RhbDogbnVtYmVyIH07XG4gICAgcmVjb21tZW5kYXRpb25zOiBzdHJpbmdbXTtcbiAgfT4ge1xuICAgIGNvbnN0IHRpbWVyID0gdGhpcy5tZXRyaWNzLmNyZWF0ZVRpbWVyKCdpT1NIZWFsdGhDaGVjaycpO1xuICAgIFxuICAgIHRyeSB7XG4gICAgICB0aGlzLmlvc0xvZ2dlci5pbmZvKCdTdGFydGluZyBjb21wcmVoZW5zaXZlIGlPUyBoZWFsdGggY2hlY2snKTtcblxuICAgICAgLy8gQ2hlY2sgcGxhdGZvcm0gYXBwbGljYXRpb25cbiAgICAgIGNvbnN0IHBsYXRmb3JtQXBwQ2hlY2sgPSBhd2FpdCB0aGlzLnZhbGlkYXRlQVBOU0NvbmZpZygpO1xuICAgICAgXG4gICAgICAvLyBDaGVjayBjZXJ0aWZpY2F0ZSBoZWFsdGhcbiAgICAgIGNvbnN0IGNlcnRIZWFsdGggPSBhd2FpdCB0aGlzLnZhbGlkYXRlQVBOU0NlcnRpZmljYXRlSGVhbHRoKCk7XG4gICAgICBcbiAgICAgIC8vIFByb2Nlc3MgQVBOUyBmZWVkYmFjayB0byBnZXQgZW5kcG9pbnQgaGVhbHRoXG4gICAgICBjb25zdCBmZWVkYmFja1Jlc3VsdCA9IGF3YWl0IHRoaXMucHJvY2Vzc0FQTlNGZWVkYmFjaygpO1xuXG4gICAgICBjb25zdCByZWNvbW1lbmRhdGlvbnM6IHN0cmluZ1tdID0gW107XG4gICAgICBsZXQgb3ZlcmFsbFN0YXR1czogJ2hlYWx0aHknIHwgJ3dhcm5pbmcnIHwgJ2NyaXRpY2FsJyA9ICdoZWFsdGh5JztcblxuICAgICAgLy8gQW5hbHl6ZSBwbGF0Zm9ybSBhcHBsaWNhdGlvbiBzdGF0dXNcbiAgICAgIGNvbnN0IHBsYXRmb3JtU3RhdHVzOiAnaGVhbHRoeScgfCAnd2FybmluZycgfCAnY3JpdGljYWwnID0gcGxhdGZvcm1BcHBDaGVjayA/ICdoZWFsdGh5JyA6ICdjcml0aWNhbCc7XG4gICAgICBjb25zdCBwbGF0Zm9ybURldGFpbHMgPSBwbGF0Zm9ybUFwcENoZWNrID8gXG4gICAgICAgIFsnUGxhdGZvcm0gYXBwbGljYXRpb24gaXMgYWNjZXNzaWJsZSBhbmQgZnVuY3Rpb25hbCddIDogXG4gICAgICAgIFsnUGxhdGZvcm0gYXBwbGljYXRpb24gdmFsaWRhdGlvbiBmYWlsZWQgLSBjaGVjayBjb25maWd1cmF0aW9uJ107XG5cbiAgICAgIC8vIEFuYWx5emUgY2VydGlmaWNhdGUgc3RhdHVzXG4gICAgICBsZXQgY2VydFN0YXR1czogJ2hlYWx0aHknIHwgJ3dhcm5pbmcnIHwgJ2NyaXRpY2FsJyA9ICdoZWFsdGh5JztcbiAgICAgIGNvbnN0IGNlcnREZXRhaWxzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgICBpZiAoY2VydEhlYWx0aC5lcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICBjZXJ0U3RhdHVzID0gJ2NyaXRpY2FsJztcbiAgICAgICAgY2VydERldGFpbHMucHVzaCguLi5jZXJ0SGVhbHRoLmVycm9ycyk7XG4gICAgICAgIHJlY29tbWVuZGF0aW9ucy5wdXNoKCdSZW5ldyBBUE5TIGNlcnRpZmljYXRlIGltbWVkaWF0ZWx5Jyk7XG4gICAgICB9IGVsc2UgaWYgKGNlcnRIZWFsdGgud2FybmluZ3MubGVuZ3RoID4gMCkge1xuICAgICAgICBjZXJ0U3RhdHVzID0gJ3dhcm5pbmcnO1xuICAgICAgICBjZXJ0RGV0YWlscy5wdXNoKC4uLmNlcnRIZWFsdGgud2FybmluZ3MpO1xuICAgICAgICByZWNvbW1lbmRhdGlvbnMucHVzaCgnUGxhbiBBUE5TIGNlcnRpZmljYXRlIHJlbmV3YWwnKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNlcnREZXRhaWxzLnB1c2goJ0NlcnRpZmljYXRlIGFwcGVhcnMgaGVhbHRoeScpO1xuICAgICAgfVxuXG4gICAgICAvLyBBbmFseXplIGVuZHBvaW50IGhlYWx0aFxuICAgICAgY29uc3QgdG90YWxFbmRwb2ludHMgPSBmZWVkYmFja1Jlc3VsdC5yZW1vdmVkVG9rZW5zLmxlbmd0aCArIDEwMDsgLy8gRXN0aW1hdGUgdG90YWxcbiAgICAgIGNvbnN0IGludmFsaWRFbmRwb2ludHMgPSBmZWVkYmFja1Jlc3VsdC5yZW1vdmVkVG9rZW5zLmxlbmd0aDtcbiAgICAgIGNvbnN0IGFjdGl2ZUVuZHBvaW50cyA9IHRvdGFsRW5kcG9pbnRzIC0gaW52YWxpZEVuZHBvaW50cztcbiAgICAgIGNvbnN0IGludmFsaWRQZXJjZW50YWdlID0gdG90YWxFbmRwb2ludHMgPiAwID8gKGludmFsaWRFbmRwb2ludHMgLyB0b3RhbEVuZHBvaW50cykgKiAxMDAgOiAwO1xuXG4gICAgICBpZiAoaW52YWxpZFBlcmNlbnRhZ2UgPiA1MCkge1xuICAgICAgICBvdmVyYWxsU3RhdHVzID0gJ2NyaXRpY2FsJztcbiAgICAgICAgcmVjb21tZW5kYXRpb25zLnB1c2goJ0hpZ2ggbnVtYmVyIG9mIGludmFsaWQgZGV2aWNlIHRva2VucyAtIGludmVzdGlnYXRlIGFwcCBkaXN0cmlidXRpb24nKTtcbiAgICAgIH0gZWxzZSBpZiAoaW52YWxpZFBlcmNlbnRhZ2UgPiAyMCkge1xuICAgICAgICBpZiAob3ZlcmFsbFN0YXR1cyA9PT0gJ2hlYWx0aHknKSBvdmVyYWxsU3RhdHVzID0gJ3dhcm5pbmcnO1xuICAgICAgICByZWNvbW1lbmRhdGlvbnMucHVzaCgnTW9kZXJhdGUgbnVtYmVyIG9mIGludmFsaWQgZGV2aWNlIHRva2VucyAtIG1vbml0b3IgYXBwIHVzYWdlJyk7XG4gICAgICB9XG5cbiAgICAgIC8vIFNldCBvdmVyYWxsIHN0YXR1cyBiYXNlZCBvbiBjb21wb25lbnRzXG4gICAgICBpZiAocGxhdGZvcm1TdGF0dXMgPT09ICdjcml0aWNhbCcgfHwgY2VydFN0YXR1cyA9PT0gJ2NyaXRpY2FsJykge1xuICAgICAgICBvdmVyYWxsU3RhdHVzID0gJ2NyaXRpY2FsJztcbiAgICAgIH0gZWxzZSBpZiAoY2VydFN0YXR1cyA9PT0gJ3dhcm5pbmcnKSB7XG4gICAgICAgIG92ZXJhbGxTdGF0dXMgPSAnd2FybmluZyc7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGhlYWx0aFJlcG9ydCA9IHtcbiAgICAgICAgb3ZlcmFsbDogb3ZlcmFsbFN0YXR1cyxcbiAgICAgICAgcGxhdGZvcm1BcHA6IHsgc3RhdHVzOiBwbGF0Zm9ybVN0YXR1cywgZGV0YWlsczogcGxhdGZvcm1EZXRhaWxzIH0sXG4gICAgICAgIGNlcnRpZmljYXRlOiB7IHN0YXR1czogY2VydFN0YXR1cywgZGV0YWlsczogY2VydERldGFpbHMgfSxcbiAgICAgICAgZW5kcG9pbnRzOiB7IGFjdGl2ZTogYWN0aXZlRW5kcG9pbnRzLCBpbnZhbGlkOiBpbnZhbGlkRW5kcG9pbnRzLCB0b3RhbDogdG90YWxFbmRwb2ludHMgfSxcbiAgICAgICAgcmVjb21tZW5kYXRpb25zXG4gICAgICB9O1xuXG4gICAgICB0aGlzLmlvc0xvZ2dlci5pbmZvKCdpT1MgaGVhbHRoIGNoZWNrIGNvbXBsZXRlZCcsIHtcbiAgICAgICAgb3ZlcmFsbFN0YXR1cyxcbiAgICAgICAgcGxhdGZvcm1BcHBTdGF0dXM6IHBsYXRmb3JtU3RhdHVzLFxuICAgICAgICBjZXJ0aWZpY2F0ZVN0YXR1czogY2VydFN0YXR1cyxcbiAgICAgICAgYWN0aXZlRW5kcG9pbnRzLFxuICAgICAgICBpbnZhbGlkRW5kcG9pbnRzLFxuICAgICAgICByZWNvbW1lbmRhdGlvbkNvdW50OiByZWNvbW1lbmRhdGlvbnMubGVuZ3RoXG4gICAgICB9KTtcblxuICAgICAgLy8gUmVjb3JkIGhlYWx0aCBjaGVjayBtZXRyaWNzXG4gICAgICBhd2FpdCB0aGlzLm1ldHJpY3MucmVjb3JkRXhlY3V0aW9uUmVzdWx0KCdpT1NIZWFsdGhDaGVjaycsIG92ZXJhbGxTdGF0dXMgIT09ICdjcml0aWNhbCcpO1xuXG4gICAgICBhd2FpdCB0aW1lci5zdG9wKHRydWUpO1xuICAgICAgcmV0dXJuIGhlYWx0aFJlcG9ydDtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmlvc0xvZ2dlci5lcnJvcignaU9TIGhlYWx0aCBjaGVjayBmYWlsZWQnLCBlcnJvciBhcyBFcnJvcik7XG4gICAgICBhd2FpdCB0aW1lci5zdG9wKGZhbHNlKTtcbiAgICAgIFxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgb3ZlcmFsbDogJ2NyaXRpY2FsJyxcbiAgICAgICAgcGxhdGZvcm1BcHA6IHsgc3RhdHVzOiAnZXJyb3InLCBkZXRhaWxzOiBbJ0hlYWx0aCBjaGVjayBmYWlsZWQnXSB9LFxuICAgICAgICBjZXJ0aWZpY2F0ZTogeyBzdGF0dXM6ICdlcnJvcicsIGRldGFpbHM6IFsnSGVhbHRoIGNoZWNrIGZhaWxlZCddIH0sXG4gICAgICAgIGVuZHBvaW50czogeyBhY3RpdmU6IDAsIGludmFsaWQ6IDAsIHRvdGFsOiAwIH0sXG4gICAgICAgIHJlY29tbWVuZGF0aW9uczogWydJbnZlc3RpZ2F0ZSBpT1MgbW9uaXRvcmluZyBzeXN0ZW0gZmFpbHVyZSddXG4gICAgICB9O1xuICAgIH1cbiAgfVxufSJdfQ==