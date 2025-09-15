"use strict";
/**
 * Configuration Validation Utilities
 *
 * This module provides comprehensive validation for AWS Spend Monitor configuration
 * including iOS push notification settings, AWS service configurations, and
 * deployment prerequisites.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigValidator = void 0;
exports.validateEnvironmentVariables = validateEnvironmentVariables;
exports.createSampleConfig = createSampleConfig;
const client_sns_1 = require("@aws-sdk/client-sns");
const client_cost_explorer_1 = require("@aws-sdk/client-cost-explorer");
const client_lambda_1 = require("@aws-sdk/client-lambda");
class ConfigValidator {
    constructor(region = 'us-east-1') {
        this.region = region;
        this.snsClient = new client_sns_1.SNSClient({ region });
        this.costExplorerClient = new client_cost_explorer_1.CostExplorerClient({ region });
        this.lambdaClient = new client_lambda_1.LambdaClient({ region });
    }
    /**
     * Validates the complete spend monitor configuration
     */
    async validateConfiguration(config, options = {}) {
        const result = {
            isValid: true,
            errors: [],
            warnings: [],
            info: []
        };
        // Validate basic configuration
        this.validateBasicConfig(config, result);
        // Validate iOS configuration if present
        if (config.iosConfig) {
            this.validateiOSConfig(config.iosConfig, result);
        }
        // Validate AWS services if not skipped
        if (!options.skipAwsValidation) {
            await this.validateAwsServices(config, result);
        }
        // Set overall validity
        result.isValid = result.errors.length === 0;
        return result;
    }
    /**
     * Validates basic configuration parameters
     */
    validateBasicConfig(config, result) {
        // Validate spend threshold
        if (typeof config.spendThreshold !== 'number' || config.spendThreshold <= 0) {
            result.errors.push('Spend threshold must be a positive number');
        }
        else if (config.spendThreshold < 1) {
            result.warnings.push('Spend threshold is very low (< $1), may generate frequent alerts');
        }
        else if (config.spendThreshold > 10000) {
            result.warnings.push('Spend threshold is very high (> $10,000), may miss cost overruns');
        }
        else {
            result.info.push(`Spend threshold: $${config.spendThreshold}`);
        }
        // Validate SNS topic ARN
        if (!config.snsTopicArn) {
            result.errors.push('SNS topic ARN is required');
        }
        else if (!this.isValidSnsTopicArn(config.snsTopicArn)) {
            result.errors.push('SNS topic ARN format is invalid');
        }
        else {
            result.info.push(`SNS topic ARN: ${config.snsTopicArn}`);
        }
        // Validate region
        if (!config.region) {
            result.errors.push('AWS region is required');
        }
        else if (!this.isValidAwsRegion(config.region)) {
            result.warnings.push(`AWS region may be invalid: ${config.region}`);
        }
        else {
            result.info.push(`AWS region: ${config.region}`);
        }
        // Validate optional parameters
        if (config.checkPeriodDays !== undefined) {
            if (config.checkPeriodDays < 1 || config.checkPeriodDays > 30) {
                result.warnings.push('Check period should be between 1 and 30 days');
            }
        }
        if (config.retryAttempts !== undefined) {
            if (config.retryAttempts < 1 || config.retryAttempts > 10) {
                result.warnings.push('Retry attempts should be between 1 and 10');
            }
        }
        if (config.minServiceCostThreshold !== undefined) {
            if (config.minServiceCostThreshold < 0) {
                result.errors.push('Minimum service cost threshold cannot be negative');
            }
        }
    }
    /**
     * Validates iOS configuration parameters
     */
    validateiOSConfig(iosConfig, result) {
        // Validate platform application ARN
        if (!iosConfig.platformApplicationArn) {
            result.errors.push('iOS platform application ARN is required');
        }
        else if (!this.isValidPlatformApplicationArn(iosConfig.platformApplicationArn)) {
            result.errors.push('iOS platform application ARN format is invalid');
        }
        else {
            result.info.push(`iOS platform application ARN: ${iosConfig.platformApplicationArn}`);
        }
        // Validate bundle ID
        if (!iosConfig.bundleId) {
            result.errors.push('iOS bundle ID is required');
        }
        else if (!this.isValidBundleId(iosConfig.bundleId)) {
            result.errors.push('iOS bundle ID format is invalid');
        }
        else {
            result.info.push(`iOS bundle ID: ${iosConfig.bundleId}`);
        }
        // Validate sandbox setting
        if (iosConfig.sandbox !== undefined) {
            result.info.push(`APNS sandbox mode: ${iosConfig.sandbox}`);
        }
        else {
            result.warnings.push('APNS sandbox mode not specified, defaulting to production');
        }
        // Validate certificate paths if provided
        if (iosConfig.apnsCertificatePath) {
            if (!iosConfig.apnsCertificatePath.endsWith('.pem')) {
                result.warnings.push('APNS certificate should be a .pem file');
            }
        }
        if (iosConfig.apnsPrivateKeyPath) {
            if (!iosConfig.apnsPrivateKeyPath.endsWith('.pem')) {
                result.warnings.push('APNS private key should be a .pem file');
            }
        }
    }
    /**
     * Validates AWS services accessibility and configuration
     */
    async validateAwsServices(config, result) {
        try {
            // Validate SNS topic
            await this.validateSnsTopicAccess(config.snsTopicArn, result);
            // Validate iOS platform application if configured
            if (config.iosConfig?.platformApplicationArn) {
                await this.validatePlatformApplicationAccess(config.iosConfig.platformApplicationArn, result);
            }
            // Validate Cost Explorer access
            await this.validateCostExplorerAccess(result);
        }
        catch (error) {
            result.errors.push(`AWS service validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    /**
     * Validates SNS topic accessibility
     */
    async validateSnsTopicAccess(topicArn, result) {
        try {
            const command = new client_sns_1.GetTopicAttributesCommand({ TopicArn: topicArn });
            const response = await this.snsClient.send(command);
            if (response.Attributes) {
                result.info.push('SNS topic is accessible');
                // Check topic attributes
                const displayName = response.Attributes.DisplayName;
                if (displayName) {
                    result.info.push(`SNS topic display name: ${displayName}`);
                }
                const subscriptionsConfirmed = response.Attributes.SubscriptionsConfirmed;
                if (subscriptionsConfirmed && parseInt(subscriptionsConfirmed) === 0) {
                    result.warnings.push('SNS topic has no confirmed subscriptions');
                }
                else if (subscriptionsConfirmed) {
                    result.info.push(`SNS topic has ${subscriptionsConfirmed} confirmed subscription(s)`);
                }
            }
        }
        catch (error) {
            result.errors.push(`Cannot access SNS topic: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    /**
     * Validates iOS platform application accessibility
     */
    async validatePlatformApplicationAccess(platformArn, result) {
        try {
            const command = new client_sns_1.GetPlatformApplicationAttributesCommand({ PlatformApplicationArn: platformArn });
            const response = await this.snsClient.send(command);
            if (response.Attributes) {
                result.info.push('iOS platform application is accessible');
                // Check if enabled
                const enabled = response.Attributes.Enabled;
                if (enabled === 'false') {
                    result.errors.push('iOS platform application is disabled');
                }
                else {
                    result.info.push('iOS platform application is enabled');
                }
                // Check platform type
                const platform = response.Attributes.Platform;
                if (platform && platform !== 'APNS' && platform !== 'APNS_SANDBOX') {
                    result.warnings.push(`Unexpected platform type: ${platform}`);
                }
                else if (platform) {
                    result.info.push(`Platform type: ${platform}`);
                }
                // Check feedback roles
                const successRole = response.Attributes.SuccessFeedbackRoleArn;
                const failureRole = response.Attributes.FailureFeedbackRoleArn;
                if (!successRole && !failureRole) {
                    result.warnings.push('No feedback roles configured for iOS platform application');
                }
            }
        }
        catch (error) {
            result.errors.push(`Cannot access iOS platform application: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    /**
     * Validates Cost Explorer accessibility
     */
    async validateCostExplorerAccess(result) {
        try {
            // Test with a minimal query for the last 2 days
            const endDate = new Date();
            const startDate = new Date(endDate);
            startDate.setDate(startDate.getDate() - 2);
            const command = new client_cost_explorer_1.GetCostAndUsageCommand({
                TimePeriod: {
                    Start: startDate.toISOString().split('T')[0],
                    End: endDate.toISOString().split('T')[0]
                },
                Granularity: 'DAILY',
                Metrics: ['BlendedCost']
            });
            await this.costExplorerClient.send(command);
            result.info.push('Cost Explorer API is accessible');
        }
        catch (error) {
            result.errors.push(`Cannot access Cost Explorer API: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    /**
     * Validates device token format
     */
    static validateDeviceToken(token) {
        const result = {
            isValid: true,
            errors: [],
            warnings: [],
            info: []
        };
        if (!token) {
            result.errors.push('Device token is required');
        }
        else if (token.length !== 64) {
            result.errors.push(`Device token must be 64 characters long (got ${token.length})`);
        }
        else if (!/^[0-9a-fA-F]+$/.test(token)) {
            result.errors.push('Device token must contain only hexadecimal characters');
        }
        else {
            result.info.push('Device token format is valid');
        }
        result.isValid = result.errors.length === 0;
        return result;
    }
    /**
     * Validates Lambda function configuration
     */
    async validateLambdaFunction(functionName) {
        const result = {
            isValid: true,
            errors: [],
            warnings: [],
            info: []
        };
        try {
            const command = new client_lambda_1.GetFunctionConfigurationCommand({ FunctionName: functionName });
            const response = await this.lambdaClient.send(command);
            result.info.push(`Lambda function found: ${functionName}`);
            // Check runtime
            if (response.Runtime && !response.Runtime.startsWith('nodejs')) {
                result.warnings.push(`Unexpected runtime: ${response.Runtime}`);
            }
            else if (response.Runtime) {
                result.info.push(`Runtime: ${response.Runtime}`);
            }
            // Check memory
            if (response.MemorySize && response.MemorySize < 512) {
                result.warnings.push(`Memory allocation may be low: ${response.MemorySize}MB (recommended: 512MB+)`);
            }
            else if (response.MemorySize) {
                result.info.push(`Memory: ${response.MemorySize}MB`);
            }
            // Check timeout
            if (response.Timeout && response.Timeout < 60) {
                result.warnings.push(`Timeout may be low: ${response.Timeout}s (recommended: 60s+)`);
            }
            else if (response.Timeout) {
                result.info.push(`Timeout: ${response.Timeout}s`);
            }
            // Check environment variables
            const envVars = response.Environment?.Variables || {};
            const requiredVars = ['SPEND_THRESHOLD', 'SNS_TOPIC_ARN'];
            const iosVars = ['IOS_PLATFORM_APP_ARN', 'IOS_BUNDLE_ID'];
            for (const varName of requiredVars) {
                if (!envVars[varName]) {
                    result.errors.push(`Required environment variable missing: ${varName}`);
                }
                else {
                    result.info.push(`Environment variable set: ${varName}`);
                }
            }
            for (const varName of iosVars) {
                if (!envVars[varName]) {
                    result.warnings.push(`iOS environment variable not set: ${varName}`);
                }
                else {
                    result.info.push(`iOS environment variable set: ${varName}`);
                }
            }
        }
        catch (error) {
            result.errors.push(`Cannot access Lambda function: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        result.isValid = result.errors.length === 0;
        return result;
    }
    /**
     * Validates SNS topic ARN format
     */
    isValidSnsTopicArn(arn) {
        const arnPattern = /^arn:aws:sns:[a-z0-9-]+:\d{12}:[a-zA-Z0-9_-]+$/;
        return arnPattern.test(arn);
    }
    /**
     * Validates platform application ARN format
     */
    isValidPlatformApplicationArn(arn) {
        const arnPattern = /^arn:aws:sns:[a-z0-9-]+:\d{12}:app\/APNS[_SANDBOX]*\/[a-zA-Z0-9_-]+$/;
        return arnPattern.test(arn);
    }
    /**
     * Validates iOS bundle ID format
     */
    isValidBundleId(bundleId) {
        const bundleIdPattern = /^[a-zA-Z0-9.-]+\.[a-zA-Z0-9.-]+$/;
        return bundleIdPattern.test(bundleId);
    }
    /**
     * Validates AWS region format
     */
    isValidAwsRegion(region) {
        const regionPattern = /^[a-z]{2}-[a-z]+-\d+$/;
        return regionPattern.test(region);
    }
    /**
     * Generates a configuration validation report
     */
    static generateValidationReport(result) {
        const lines = [];
        lines.push('Configuration Validation Report');
        lines.push('================================');
        lines.push('');
        if (result.isValid) {
            lines.push('✓ Configuration is valid');
        }
        else {
            lines.push('✗ Configuration has errors');
        }
        lines.push('');
        lines.push(`Errors: ${result.errors.length}`);
        lines.push(`Warnings: ${result.warnings.length}`);
        lines.push(`Info: ${result.info.length}`);
        lines.push('');
        if (result.errors.length > 0) {
            lines.push('Errors:');
            result.errors.forEach(error => lines.push(`  ✗ ${error}`));
            lines.push('');
        }
        if (result.warnings.length > 0) {
            lines.push('Warnings:');
            result.warnings.forEach(warning => lines.push(`  ⚠ ${warning}`));
            lines.push('');
        }
        if (result.info.length > 0) {
            lines.push('Information:');
            result.info.forEach(info => lines.push(`  ℹ ${info}`));
            lines.push('');
        }
        return lines.join('\n');
    }
}
exports.ConfigValidator = ConfigValidator;
/**
 * Validates environment variables for the spend monitor
 */
function validateEnvironmentVariables() {
    const result = {
        isValid: true,
        errors: [],
        warnings: [],
        info: []
    };
    const requiredVars = [
        'SPEND_THRESHOLD',
        'SNS_TOPIC_ARN',
        'AWS_REGION'
    ];
    const optionalVars = [
        'CHECK_PERIOD_DAYS',
        'RETRY_ATTEMPTS',
        'MIN_SERVICE_COST_THRESHOLD'
    ];
    const iosVars = [
        'IOS_PLATFORM_APP_ARN',
        'IOS_BUNDLE_ID',
        'APNS_SANDBOX'
    ];
    // Check required variables
    for (const varName of requiredVars) {
        const value = process.env[varName];
        if (!value) {
            result.errors.push(`Required environment variable missing: ${varName}`);
        }
        else {
            result.info.push(`Environment variable set: ${varName}`);
        }
    }
    // Check optional variables
    for (const varName of optionalVars) {
        const value = process.env[varName];
        if (value) {
            result.info.push(`Optional environment variable set: ${varName}`);
        }
    }
    // Check iOS variables
    let iosConfigured = false;
    for (const varName of iosVars) {
        const value = process.env[varName];
        if (value) {
            result.info.push(`iOS environment variable set: ${varName}`);
            iosConfigured = true;
        }
    }
    if (!iosConfigured) {
        result.warnings.push('No iOS environment variables configured - iOS notifications will be disabled');
    }
    result.isValid = result.errors.length === 0;
    return result;
}
/**
 * Creates a sample configuration for testing
 */
function createSampleConfig() {
    return {
        spendThreshold: 10,
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-monitor-alerts',
        region: 'us-east-1',
        checkPeriodDays: 1,
        retryAttempts: 3,
        minServiceCostThreshold: 1,
        iosConfig: {
            platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/SpendMonitorApp',
            bundleId: 'com.example.spendmonitor',
            sandbox: true
        }
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlnLXZhbGlkYXRvci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy91dGlscy9jb25maWctdmFsaWRhdG9yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7OztBQWtkSCxvRUE0REM7QUFLRCxnREFjQztBQS9oQkQsb0RBQW9IO0FBQ3BILHdFQUEyRjtBQUMzRiwwREFBdUY7QUFpQ3ZGLE1BQWEsZUFBZTtJQU0xQixZQUFZLFNBQWlCLFdBQVc7UUFDdEMsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7UUFDckIsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLHNCQUFTLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxDQUFDO1FBQzNDLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxJQUFJLHlDQUFrQixDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQztRQUM3RCxJQUFJLENBQUMsWUFBWSxHQUFHLElBQUksNEJBQVksQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDLENBQUM7SUFDbkQsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLHFCQUFxQixDQUN6QixNQUFvQyxFQUNwQyxVQUFtQyxFQUFFO1FBRXJDLE1BQU0sTUFBTSxHQUFxQjtZQUMvQixPQUFPLEVBQUUsSUFBSTtZQUNiLE1BQU0sRUFBRSxFQUFFO1lBQ1YsUUFBUSxFQUFFLEVBQUU7WUFDWixJQUFJLEVBQUUsRUFBRTtTQUNULENBQUM7UUFFRiwrQkFBK0I7UUFDL0IsSUFBSSxDQUFDLG1CQUFtQixDQUFDLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQztRQUV6Qyx3Q0FBd0M7UUFDeEMsSUFBSSxNQUFNLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDckIsSUFBSSxDQUFDLGlCQUFpQixDQUFDLE1BQU0sQ0FBQyxTQUFTLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFDbkQsQ0FBQztRQUVELHVDQUF1QztRQUN2QyxJQUFJLENBQUMsT0FBTyxD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QUMsQ0FBQztRQUNwRSxDQUFDO0lBQ0gsQ0FBQztJQUVELHNCQUFzQjtJQUN0QixJQUFJLGFBQWEsR0FBRyxLQUFLLENBQUM7SUFDMUIsS0FBSyxNQUFNLE9BQU8sSUFBSSxPQUFPLEVBQUUsQ0FBQztRQUM5QixNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ25DLElBQUksS0FBSyxFQUFFLENBQUM7WUFDVixNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxpQ0FBaUMsT0FBTyxFQUFFLENBQUMsQ0FBQztZQUM3RCxhQUFhLEdBQUcsSUFBSSxDQUFDO1FBQ3ZCLENBQUM7SUFDSCxDQUFDO0lBRUQsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBQ25CLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLDhFQUE4RSxDQUFDLENBQUM7SUFDdkcsQ0FBQztJQUVELE1BQU0sQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEtBQUssQ0FBQyxDQUFDO0lBQzVDLE9BQU8sTUFBTSxDQUFDO0FBQ2hCLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLGtCQUFrQjtJQUNoQyxPQUFPO1FBQ0wsY0FBYyxFQUFFLEVBQUU7UUFDbEIsV0FBVyxFQUFFLHlEQUF5RDtRQUN0RSxNQUFNLEVBQUUsV0FBVztRQUNuQixlQUFlLEVBQUUsQ0FBQztRQUNsQixhQUFhLEVBQUUsQ0FBQztRQUNoQix1QkFBdUIsRUFBRSxDQUFDO1FBQzFCLFNBQVMsRUFBRTtZQUNULHNCQUFzQixFQUFFLDZEQUE2RDtZQUNyRixRQUFRLEVBQUUsMEJBQTBCO1lBQ3BDLE9BQU8sRUFBRSxJQUFJO1NBQ2Q7S0FDRixDQUFDO0FBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQ29uZmlndXJhdGlvbiBWYWxpZGF0aW9uIFV0aWxpdGllc1xuICogXG4gKiBUaGlzIG1vZHVsZSBwcm92aWRlcyBjb21wcmVoZW5zaXZlIHZhbGlkYXRpb24gZm9yIEFXUyBTcGVuZCBNb25pdG9yIGNvbmZpZ3VyYXRpb25cbiAqIGluY2x1ZGluZyBpT1MgcHVzaCBub3RpZmljYXRpb24gc2V0dGluZ3MsIEFXUyBzZXJ2aWNlIGNvbmZpZ3VyYXRpb25zLCBhbmRcbiAqIGRlcGxveW1lbnQgcHJlcmVxdWlzaXRlcy5cbiAqL1xuXG5pbXBvcnQgeyBTTlNDbGllbnQsIEdldFRvcGljQXR0cmlidXRlc0NvbW1hbmQsIEdldFBsYXRmb3JtQXBwbGljYXRpb25BdHRyaWJ1dGVzQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zbnMnO1xuaW1wb3J0IHsgQ29zdEV4cGxvcmVyQ2xpZW50LCBHZXRDb3N0QW5kVXNhZ2VDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWNvc3QtZXhwbG9yZXInO1xuaW1wb3J0IHsgTGFtYmRhQ2xpZW50LCBHZXRGdW5jdGlvbkNvbmZpZ3VyYXRpb25Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWxhbWJkYSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVmFsaWRhdGlvblJlc3VsdCB7XG4gIGlzVmFsaWQ6IGJvb2xlYW47XG4gIGVycm9yczogc3RyaW5nW107XG4gIHdhcm5pbmdzOiBzdHJpbmdbXTtcbiAgaW5mbzogc3RyaW5nW107XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29uZmlnVmFsaWRhdGlvbk9wdGlvbnMge1xuICBza2lwQXdzVmFsaWRhdGlvbj86IGJvb2xlYW47XG4gIHNraXBOZXR3b3JrVGVzdHM/OiBib29sZWFuO1xuICByZWdpb24/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3BlbmRNb25pdG9yQ29uZmlnVmFsaWRhdGlvbiB7XG4gIHNwZW5kVGhyZXNob2xkOiBudW1iZXI7XG4gIHNuc1RvcGljQXJuOiBzdHJpbmc7XG4gIHJlZ2lvbjogc3RyaW5nO1xuICBjaGVja1BlcmlvZERheXM/OiBudW1iZXI7XG4gIHJldHJ5QXR0ZW1wdHM/OiBudW1iZXI7XG4gIG1pblNlcnZpY2VDb3N0VGhyZXNob2xkPzogbnVtYmVyO1xuICBpb3NDb25maWc/OiBpT1NDb25maWdWYWxpZGF0aW9uO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIGlPU0NvbmZpZ1ZhbGlkYXRpb24ge1xuICBwbGF0Zm9ybUFwcGxpY2F0aW9uQXJuOiBzdHJpbmc7XG4gIGJ1bmRsZUlkOiBzdHJpbmc7XG4gIHNhbmRib3g/OiBib29sZWFuO1xuICBhcG5zQ2VydGlmaWNhdGVQYXRoPzogc3RyaW5nO1xuICBhcG5zUHJpdmF0ZUtleVBhdGg/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBDb25maWdWYWxpZGF0b3Ige1xuICBwcml2YXRlIHNuc0NsaWVudDogU05TQ2xpZW50O1xuICBwcml2YXRlIGNvc3RFeHBsb3JlckNsaWVudDogQ29zdEV4cGxvcmVyQ2xpZW50O1xuICBwcml2YXRlIGxhbWJkYUNsaWVudDogTGFtYmRhQ2xpZW50O1xuICBwcml2YXRlIHJlZ2lvbjogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKHJlZ2lvbjogc3RyaW5nID0gJ3VzLWVhc3QtMScpIHtcbiAgICB0aGlzLnJlZ2lvbiA9IHJlZ2lvbjtcbiAgICB0aGlzLnNuc0NsaWVudCA9IG5ldyBTTlNDbGllbnQoeyByZWdpb24gfSk7XG4gICAgdGhpcy5jb3N0RXhwbG9yZXJDbGllbnQgPSBuZXcgQ29zdEV4cGxvcmVyQ2xpZW50KHsgcmVnaW9uIH0pO1xuICAgIHRoaXMubGFtYmRhQ2xpZW50ID0gbmV3IExhbWJkYUNsaWVudCh7IHJlZ2lvbiB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgdGhlIGNvbXBsZXRlIHNwZW5kIG1vbml0b3IgY29uZmlndXJhdGlvblxuICAgKi9cbiAgYXN5bmMgdmFsaWRhdGVDb25maWd1cmF0aW9uKFxuICAgIGNvbmZpZzogU3BlbmRNb25pdG9yQ29uZmlnVmFsaWRhdGlvbixcbiAgICBvcHRpb25zOiBDb25maWdWYWxpZGF0aW9uT3B0aW9ucyA9IHt9XG4gICk6IFByb21pc2U8VmFsaWRhdGlvblJlc3VsdD4ge1xuICAgIGNvbnN0IHJlc3VsdDogVmFsaWRhdGlvblJlc3VsdCA9IHtcbiAgICAgIGlzVmFsaWQ6IHRydWUsXG4gICAgICBlcnJvcnM6IFtdLFxuICAgICAgd2FybmluZ3M6IFtdLFxuICAgICAgaW5mbzogW11cbiAgICB9O1xuXG4gICAgLy8gVmFsaWRhdGUgYmFzaWMgY29uZmlndXJhdGlvblxuICAgIHRoaXMudmFsaWRhdGVCYXNpY0NvbmZpZyhjb25maWcsIHJlc3VsdCk7XG5cbiAgICAvLyBWYWxpZGF0ZSBpT1MgY29uZmlndXJhdGlvbiBpZiBwcmVzZW50XG4gICAgaWYgKGNvbmZpZy5pb3NDb25maWcpIHtcbiAgICAgIHRoaXMudmFsaWRhdGVpT1NDb25maWcoY29uZmlnLmlvc0NvbmZpZywgcmVzdWx0KTtcbiAgICB9XG5cbiAgICAvLyBWYWxpZGF0ZSBBV1Mgc2VydmljZXMgaWYgbm90IHNraXBwZWRcbiAgICBpZiAoIW9wdGlvbnMuc2tpcEF3c1ZhbGlkYXRpb24pIHtcbiAgICAgIGF3YWl0IHRoaXMudmFsaWRhdGVBd3NTZXJ2aWNlcyhjb25maWcsIHJlc3VsdCk7XG4gICAgfVxuXG4gICAgLy8gU2V0IG92ZXJhbGwgdmFsaWRpdHlcbiAgICByZXN1bHQuaXNWYWxpZCA9IHJlc3VsdC5lcnJvcnMubGVuZ3RoID09PSAwO1xuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgYmFzaWMgY29uZmlndXJhdGlvbiBwYXJhbWV0ZXJzXG4gICAqL1xuICBwcml2YXRlIHZhbGlkYXRlQmFzaWNDb25maWcoY29uZmlnOiBTcGVuZE1vbml0b3JDb25maWdWYWxpZGF0aW9uLCByZXN1bHQ6IFZhbGlkYXRpb25SZXN1bHQpOiB2b2lkIHtcbiAgICAvLyBWYWxpZGF0ZSBzcGVuZCB0aHJlc2hvbGRcbiAgICBpZiAodHlwZW9mIGNvbmZpZy5zcGVuZFRocmVzaG9sZCAhPT0gJ251bWJlcicgfHwgY29uZmlnLnNwZW5kVGhyZXNob2xkIDw9IDApIHtcbiAgICAgIHJlc3VsdC5lcnJvcnMucHVzaCgnU3BlbmQgdGhyZXNob2xkIG11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXInKTtcbiAgICB9IGVsc2UgaWYgKGNvbmZpZy5zcGVuZFRocmVzaG9sZCA8IDEpIHtcbiAgICAgIHJlc3VsdC53YXJuaW5ncy5wdXNoKCdTcGVuZCB0aHJlc2hvbGQgaXMgdmVyeSBsb3cgKDwgJDEpLCBtYXkgZ2VuZXJhdGUgZnJlcXVlbnQgYWxlcnRzJyk7XG4gICAgfSBlbHNlIGlmIChjb25maWcuc3BlbmRUaHJlc2hvbGQgPiAxMDAwMCkge1xuICAgICAgcmVzdWx0Lndhcm5pbmdzLnB1c2goJ1NwZW5kIHRocmVzaG9sZCBpcyB2ZXJ5IGhpZ2ggKD4gJDEwLDAwMCksIG1heSBtaXNzIGNvc3Qgb3ZlcnJ1bnMnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzdWx0LmluZm8ucHVzaChgU3BlbmQgdGhyZXNob2xkOiAkJHtjb25maWcuc3BlbmRUaHJlc2hvbGR9YCk7XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgU05TIHRvcGljIEFSTlxuICAgIGlmICghY29uZmlnLnNuc1RvcGljQXJuKSB7XG4gICAgICByZXN1bHQuZXJyb3JzLnB1c2goJ1NOUyB0b3BpYyBBUk4gaXMgcmVxdWlyZWQnKTtcbiAgICB9IGVsc2UgaWYgKCF0aGlzLmlzVmFsaWRTbnNUb3BpY0Fybihjb25maWcuc25zVG9waWNBcm4pKSB7XG4gICAgICByZXN1bHQuZXJyb3JzLnB1c2goJ1NOUyB0b3BpYyBBUk4gZm9ybWF0IGlzIGludmFsaWQnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzdWx0LmluZm8ucHVzaChgU05TIHRvcGljIEFSTjogJHtjb25maWcuc25zVG9waWNBcm59YCk7XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgcmVnaW9uXG4gICAgaWYgKCFjb25maWcucmVnaW9uKSB7XG4gICAgICByZXN1bHQuZXJyb3JzLnB1c2goJ0FXUyByZWdpb24gaXMgcmVxdWlyZWQnKTtcbiAgICB9IGVsc2UgaWYgKCF0aGlzLmlzVmFsaWRBd3NSZWdpb24oY29uZmlnLnJlZ2lvbikpIHtcbiAgICAgIHJlc3VsdC53YXJuaW5ncy5wdXNoKGBBV1MgcmVnaW9uIG1heSBiZSBpbnZhbGlkOiAke2NvbmZpZy5yZWdpb259YCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdC5pbmZvLnB1c2goYEFXUyByZWdpb246ICR7Y29uZmlnLnJlZ2lvbn1gKTtcbiAgICB9XG5cbiAgICAvLyBWYWxpZGF0ZSBvcHRpb25hbCBwYXJhbWV0ZXJzXG4gICAgaWYgKGNvbmZpZy5jaGVja1BlcmlvZERheXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKGNvbmZpZy5jaGVja1BlcmlvZERheXMgPCAxIHx8IGNvbmZpZy5jaGVja1BlcmlvZERheXMgPiAzMCkge1xuICAgICAgICByZXN1bHQud2FybmluZ3MucHVzaCgnQ2hlY2sgcGVyaW9kIHNob3VsZCBiZSBiZXR3ZWVuIDEgYW5kIDMwIGRheXMnKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY29uZmlnLnJldHJ5QXR0ZW1wdHMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKGNvbmZpZy5yZXRyeUF0dGVtcHRzIDwgMSB8fCBjb25maWcucmV0cnlBdHRlbXB0cyA+IDEwKSB7XG4gICAgICAgIHJlc3VsdC53YXJuaW5ncy5wdXNoKCdSZXRyeSBhdHRlbXB0cyBzaG91bGQgYmUgYmV0d2VlbiAxIGFuZCAxMCcpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjb25maWcubWluU2VydmljZUNvc3RUaHJlc2hvbGQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKGNvbmZpZy5taW5TZXJ2aWNlQ29zdFRocmVzaG9sZCA8IDApIHtcbiAgICAgICAgcmVzdWx0LmVycm9ycy5wdXNoKCdNaW5pbXVtIHNlcnZpY2UgY29zdCB0aHJlc2hvbGQgY2Fubm90IGJlIG5lZ2F0aXZlJyk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBpT1MgY29uZmlndXJhdGlvbiBwYXJhbWV0ZXJzXG4gICAqL1xuICBwcml2YXRlIHZhbGlkYXRlaU9TQ29uZmlnKGlvc0NvbmZpZzogaU9TQ29uZmlnVmFsaWRhdGlvbiwgcmVzdWx0OiBWYWxpZGF0aW9uUmVzdWx0KTogdm9pZCB7XG4gICAgLy8gVmFsaWRhdGUgcGxhdGZvcm0gYXBwbGljYXRpb24gQVJOXG4gICAgaWYgKCFpb3NDb25maWcucGxhdGZvcm1BcHBsaWNhdGlvbkFybikge1xuICAgICAgcmVzdWx0LmVycm9ycy5wdXNoKCdpT1MgcGxhdGZvcm0gYXBwbGljYXRpb24gQVJOIGlzIHJlcXVpcmVkJyk7XG4gICAgfSBlbHNlIGlmICghdGhpcy5pc1ZhbGlkUGxhdGZvcm1BcHBsaWNhdGlvbkFybihpb3NDb25maWcucGxhdGZvcm1BcHBsaWNhdGlvbkFybikpIHtcbiAgICAgIHJlc3VsdC5lcnJvcnMucHVzaCgnaU9TIHBsYXRmb3JtIGFwcGxpY2F0aW9uIEFSTiBmb3JtYXQgaXMgaW52YWxpZCcpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXN1bHQuaW5mby5wdXNoKGBpT1MgcGxhdGZvcm0gYXBwbGljYXRpb24gQVJOOiAke2lvc0NvbmZpZy5wbGF0Zm9ybUFwcGxpY2F0aW9uQXJufWApO1xuICAgIH1cblxuICAgIC8vIFZhbGlkYXRlIGJ1bmRsZSBJRFxuICAgIGlmICghaW9zQ29uZmlnLmJ1bmRsZUlkKSB7XG4gICAgICByZXN1bHQuZXJyb3JzLnB1c2goJ2lPUyBidW5kbGUgSUQgaXMgcmVxdWlyZWQnKTtcbiAgICB9IGVsc2UgaWYgKCF0aGlzLmlzVmFsaWRCdW5kbGVJZChpb3NDb25maWcuYnVuZGxlSWQpKSB7XG4gICAgICByZXN1bHQuZXJyb3JzLnB1c2goJ2lPUyBidW5kbGUgSUQgZm9ybWF0IGlzIGludmFsaWQnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzdWx0LmluZm8ucHVzaChgaU9TIGJ1bmRsZSBJRDogJHtpb3NDb25maWcuYnVuZGxlSWR9YCk7XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgc2FuZGJveCBzZXR0aW5nXG4gICAgaWYgKGlvc0NvbmZpZy5zYW5kYm94ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHJlc3VsdC5pbmZvLnB1c2goYEFQTlMgc2FuZGJveCBtb2RlOiAke2lvc0NvbmZpZy5zYW5kYm94fWApO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXN1bHQud2FybmluZ3MucHVzaCgnQVBOUyBzYW5kYm94IG1vZGUgbm90IHNwZWNpZmllZCwgZGVmYXVsdGluZyB0byBwcm9kdWN0aW9uJyk7XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgY2VydGlmaWNhdGUgcGF0aHMgaWYgcHJvdmlkZWRcbiAgICBpZiAoaW9zQ29uZmlnLmFwbnNDZXJ0aWZpY2F0ZVBhdGgpIHtcbiAgICAgIGlmICghaW9zQ29uZmlnLmFwbnNDZXJ0aWZpY2F0ZVBhdGguZW5kc1dpdGgoJy5wZW0nKSkge1xuICAgICAgICByZXN1bHQud2FybmluZ3MucHVzaCgnQVBOUyBjZXJ0aWZpY2F0ZSBzaG91bGQgYmUgYSAucGVtIGZpbGUnKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoaW9zQ29uZmlnLmFwbnNQcml2YXRlS2V5UGF0aCkge1xuICAgICAgaWYgKCFpb3NDb25maWcuYXBuc1ByaXZhdGVLZXlQYXRoLmVuZHNXaXRoKCcucGVtJykpIHtcbiAgICAgICAgcmVzdWx0Lndhcm5pbmdzLnB1c2goJ0FQTlMgcHJpdmF0ZSBrZXkgc2hvdWxkIGJlIGEgLnBlbSBmaWxlJyk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBBV1Mgc2VydmljZXMgYWNjZXNzaWJpbGl0eSBhbmQgY29uZmlndXJhdGlvblxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyB2YWxpZGF0ZUF3c1NlcnZpY2VzKGNvbmZpZzogU3BlbmRNb25pdG9yQ29uZmlnVmFsaWRhdGlvbiwgcmVzdWx0OiBWYWxpZGF0aW9uUmVzdWx0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIFZhbGlkYXRlIFNOUyB0b3BpY1xuICAgICAgYXdhaXQgdGhpcy52YWxpZGF0ZVNuc1RvcGljQWNjZXNzKGNvbmZpZy5zbnNUb3BpY0FybiwgcmVzdWx0KTtcblxuICAgICAgLy8gVmFsaWRhdGUgaU9TIHBsYXRmb3JtIGFwcGxpY2F0aW9uIGlmIGNvbmZpZ3VyZWRcbiAgICAgIGlmIChjb25maWcuaW9zQ29uZmlnPy5wbGF0Zm9ybUFwcGxpY2F0aW9uQXJuKSB7XG4gICAgICAgIGF3YWl0IHRoaXMudmFsaWRhdGVQbGF0Zm9ybUFwcGxpY2F0aW9uQWNjZXNzKGNvbmZpZy5pb3NDb25maWcucGxhdGZvcm1BcHBsaWNhdGlvbkFybiwgcmVzdWx0KTtcbiAgICAgIH1cblxuICAgICAgLy8gVmFsaWRhdGUgQ29zdCBFeHBsb3JlciBhY2Nlc3NcbiAgICAgIGF3YWl0IHRoaXMudmFsaWRhdGVDb3N0RXhwbG9yZXJBY2Nlc3MocmVzdWx0KTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZXN1bHQuZXJyb3JzLnB1c2goYEFXUyBzZXJ2aWNlIHZhbGlkYXRpb24gZmFpbGVkOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InfWApO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgU05TIHRvcGljIGFjY2Vzc2liaWxpdHlcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgdmFsaWRhdGVTbnNUb3BpY0FjY2Vzcyh0b3BpY0Fybjogc3RyaW5nLCByZXN1bHQ6IFZhbGlkYXRpb25SZXN1bHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBHZXRUb3BpY0F0dHJpYnV0ZXNDb21tYW5kKHsgVG9waWNBcm46IHRvcGljQXJuIH0pO1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnNuc0NsaWVudC5zZW5kKGNvbW1hbmQpO1xuICAgICAgXG4gICAgICBpZiAocmVzcG9uc2UuQXR0cmlidXRlcykge1xuICAgICAgICByZXN1bHQuaW5mby5wdXNoKCdTTlMgdG9waWMgaXMgYWNjZXNzaWJsZScpO1xuICAgICAgICBcbiAgICAgICAgLy8gQ2hlY2sgdG9waWMgYXR0cmlidXRlc1xuICAgICAgICBjb25zdCBkaXNwbGF5TmFtZSA9IHJlc3BvbnNlLkF0dHJpYnV0ZXMuRGlzcGxheU5hbWU7XG4gICAgICAgIGlmIChkaXNwbGF5TmFtZSkge1xuICAgICAgICAgIHJlc3VsdC5pbmZvLnB1c2goYFNOUyB0b3BpYyBkaXNwbGF5IG5hbWU6ICR7ZGlzcGxheU5hbWV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzdWJzY3JpcHRpb25zQ29uZmlybWVkID0gcmVzcG9uc2UuQXR0cmlidXRlcy5TdWJzY3JpcHRpb25zQ29uZmlybWVkO1xuICAgICAgICBpZiAoc3Vic2NyaXB0aW9uc0NvbmZpcm1lZCAmJiBwYXJzZUludChzdWJzY3JpcHRpb25zQ29uZmlybWVkKSA9PT0gMCkge1xuICAgICAgICAgIHJlc3VsdC53YXJuaW5ncy5wdXNoKCdTTlMgdG9waWMgaGFzIG5vIGNvbmZpcm1lZCBzdWJzY3JpcHRpb25zJyk7XG4gICAgICAgIH0gZWxzZSBpZiAoc3Vic2NyaXB0aW9uc0NvbmZpcm1lZCkge1xuICAgICAgICAgIHJlc3VsdC5pbmZvLnB1c2goYFNOUyB0b3BpYyBoYXMgJHtzdWJzY3JpcHRpb25zQ29uZmlybWVkfSBjb25maXJtZWQgc3Vic2NyaXB0aW9uKHMpYCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmVzdWx0LmVycm9ycy5wdXNoKGBDYW5ub3QgYWNjZXNzIFNOUyB0b3BpYzogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ31gKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIGlPUyBwbGF0Zm9ybSBhcHBsaWNhdGlvbiBhY2Nlc3NpYmlsaXR5XG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHZhbGlkYXRlUGxhdGZvcm1BcHBsaWNhdGlvbkFjY2VzcyhwbGF0Zm9ybUFybjogc3RyaW5nLCByZXN1bHQ6IFZhbGlkYXRpb25SZXN1bHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBHZXRQbGF0Zm9ybUFwcGxpY2F0aW9uQXR0cmlidXRlc0NvbW1hbmQoeyBQbGF0Zm9ybUFwcGxpY2F0aW9uQXJuOiBwbGF0Zm9ybUFybiB9KTtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5zbnNDbGllbnQuc2VuZChjb21tYW5kKTtcbiAgICAgIFxuICAgICAgaWYgKHJlc3BvbnNlLkF0dHJpYnV0ZXMpIHtcbiAgICAgICAgcmVzdWx0LmluZm8ucHVzaCgnaU9TIHBsYXRmb3JtIGFwcGxpY2F0aW9uIGlzIGFjY2Vzc2libGUnKTtcbiAgICAgICAgXG4gICAgICAgIC8vIENoZWNrIGlmIGVuYWJsZWRcbiAgICAgICAgY29uc3QgZW5hYmxlZCA9IHJlc3BvbnNlLkF0dHJpYnV0ZXMuRW5hYmxlZDtcbiAgICAgICAgaWYgKGVuYWJsZWQgPT09ICdmYWxzZScpIHtcbiAgICAgICAgICByZXN1bHQuZXJyb3JzLnB1c2goJ2lPUyBwbGF0Zm9ybSBhcHBsaWNhdGlvbiBpcyBkaXNhYmxlZCcpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlc3VsdC5pbmZvLnB1c2goJ2lPUyBwbGF0Zm9ybSBhcHBsaWNhdGlvbiBpcyBlbmFibGVkJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayBwbGF0Zm9ybSB0eXBlXG4gICAgICAgIGNvbnN0IHBsYXRmb3JtID0gcmVzcG9uc2UuQXR0cmlidXRlcy5QbGF0Zm9ybTtcbiAgICAgICAgaWYgKHBsYXRmb3JtICYmIHBsYXRmb3JtICE9PSAnQVBOUycgJiYgcGxhdGZvcm0gIT09ICdBUE5TX1NBTkRCT1gnKSB7XG4gICAgICAgICAgcmVzdWx0Lndhcm5pbmdzLnB1c2goYFVuZXhwZWN0ZWQgcGxhdGZvcm0gdHlwZTogJHtwbGF0Zm9ybX1gKTtcbiAgICAgICAgfSBlbHNlIGlmIChwbGF0Zm9ybSkge1xuICAgICAgICAgIHJlc3VsdC5pbmZvLnB1c2goYFBsYXRmb3JtIHR5cGU6ICR7cGxhdGZvcm19YCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayBmZWVkYmFjayByb2xlc1xuICAgICAgICBjb25zdCBzdWNjZXNzUm9sZSA9IHJlc3BvbnNlLkF0dHJpYnV0ZXMuU3VjY2Vzc0ZlZWRiYWNrUm9sZUFybjtcbiAgICAgICAgY29uc3QgZmFpbHVyZVJvbGUgPSByZXNwb25zZS5BdHRyaWJ1dGVzLkZhaWx1cmVGZWVkYmFja1JvbGVBcm47XG4gICAgICAgIFxuICAgICAgICBpZiAoIXN1Y2Nlc3NSb2xlICYmICFmYWlsdXJlUm9sZSkge1xuICAgICAgICAgIHJlc3VsdC53YXJuaW5ncy5wdXNoKCdObyBmZWVkYmFjayByb2xlcyBjb25maWd1cmVkIGZvciBpT1MgcGxhdGZvcm0gYXBwbGljYXRpb24nKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZXN1bHQuZXJyb3JzLnB1c2goYENhbm5vdCBhY2Nlc3MgaU9TIHBsYXRmb3JtIGFwcGxpY2F0aW9uOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InfWApO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgQ29zdCBFeHBsb3JlciBhY2Nlc3NpYmlsaXR5XG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHZhbGlkYXRlQ29zdEV4cGxvcmVyQWNjZXNzKHJlc3VsdDogVmFsaWRhdGlvblJlc3VsdCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBUZXN0IHdpdGggYSBtaW5pbWFsIHF1ZXJ5IGZvciB0aGUgbGFzdCAyIGRheXNcbiAgICAgIGNvbnN0IGVuZERhdGUgPSBuZXcgRGF0ZSgpO1xuICAgICAgY29uc3Qgc3RhcnREYXRlID0gbmV3IERhdGUoZW5kRGF0ZSk7XG4gICAgICBzdGFydERhdGUuc2V0RGF0ZShzdGFydERhdGUuZ2V0RGF0ZSgpIC0gMik7XG5cbiAgICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgR2V0Q29zdEFuZFVzYWdlQ29tbWFuZCh7XG4gICAgICAgIFRpbWVQZXJpb2Q6IHtcbiAgICAgICAgICBTdGFydDogc3RhcnREYXRlLnRvSVNPU3RyaW5nKCkuc3BsaXQoJ1QnKVswXSxcbiAgICAgICAgICBFbmQ6IGVuZERhdGUudG9JU09TdHJpbmcoKS5zcGxpdCgnVCcpWzBdXG4gICAgICAgIH0sXG4gICAgICAgIEdyYW51bGFyaXR5OiAnREFJTFknLFxuICAgICAgICBNZXRyaWNzOiBbJ0JsZW5kZWRDb3N0J11cbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCB0aGlzLmNvc3RFeHBsb3JlckNsaWVudC5zZW5kKGNvbW1hbmQpO1xuICAgICAgcmVzdWx0LmluZm8ucHVzaCgnQ29zdCBFeHBsb3JlciBBUEkgaXMgYWNjZXNzaWJsZScpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZXN1bHQuZXJyb3JzLnB1c2goYENhbm5vdCBhY2Nlc3MgQ29zdCBFeHBsb3JlciBBUEk6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcid9YCk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBkZXZpY2UgdG9rZW4gZm9ybWF0XG4gICAqL1xuICBzdGF0aWMgdmFsaWRhdGVEZXZpY2VUb2tlbih0b2tlbjogc3RyaW5nKTogVmFsaWRhdGlvblJlc3VsdCB7XG4gICAgY29uc3QgcmVzdWx0OiBWYWxpZGF0aW9uUmVzdWx0ID0ge1xuICAgICAgaXNWYWxpZDogdHJ1ZSxcbiAgICAgIGVycm9yczogW10sXG4gICAgICB3YXJuaW5nczogW10sXG4gICAgICBpbmZvOiBbXVxuICAgIH07XG5cbiAgICBpZiAoIXRva2VuKSB7XG4gICAgICByZXN1bHQuZXJyb3JzLnB1c2goJ0RldmljZSB0b2tlbiBpcyByZXF1aXJlZCcpO1xuICAgIH0gZWxzZSBpZiAodG9rZW4ubGVuZ3RoICE9PSA2NCkge1xuICAgICAgcmVzdWx0LmVycm9ycy5wdXNoKGBEZXZpY2UgdG9rZW4gbXVzdCBiZSA2NCBjaGFyYWN0ZXJzIGxvbmcgKGdvdCAke3Rva2VuLmxlbmd0aH0pYCk7XG4gICAgfSBlbHNlIGlmICghL15bMC05YS1mQS1GXSskLy50ZXN0KHRva2VuKSkge1xuICAgICAgcmVzdWx0LmVycm9ycy5wdXNoKCdEZXZpY2UgdG9rZW4gbXVzdCBjb250YWluIG9ubHkgaGV4YWRlY2ltYWwgY2hhcmFjdGVycycpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXN1bHQuaW5mby5wdXNoKCdEZXZpY2UgdG9rZW4gZm9ybWF0IGlzIHZhbGlkJyk7XG4gICAgfVxuXG4gICAgcmVzdWx0LmlzVmFsaWQgPSByZXN1bHQuZXJyb3JzLmxlbmd0aCA9PT0gMDtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBMYW1iZGEgZnVuY3Rpb24gY29uZmlndXJhdGlvblxuICAgKi9cbiAgYXN5bmMgdmFsaWRhdGVMYW1iZGFGdW5jdGlvbihmdW5jdGlvbk5hbWU6IHN0cmluZyk6IFByb21pc2U8VmFsaWRhdGlvblJlc3VsdD4ge1xuICAgIGNvbnN0IHJlc3VsdDogVmFsaWRhdGlvblJlc3VsdCA9IHtcbiAgICAgIGlzVmFsaWQ6IHRydWUsXG4gICAgICBlcnJvcnM6IFtdLFxuICAgICAgd2FybmluZ3M6IFtdLFxuICAgICAgaW5mbzogW11cbiAgICB9O1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgR2V0RnVuY3Rpb25Db25maWd1cmF0aW9uQ29tbWFuZCh7IEZ1bmN0aW9uTmFtZTogZnVuY3Rpb25OYW1lIH0pO1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmxhbWJkYUNsaWVudC5zZW5kKGNvbW1hbmQpO1xuXG4gICAgICByZXN1bHQuaW5mby5wdXNoKGBMYW1iZGEgZnVuY3Rpb24gZm91bmQ6ICR7ZnVuY3Rpb25OYW1lfWApO1xuXG4gICAgICAvLyBDaGVjayBydW50aW1lXG4gICAgICBpZiAocmVzcG9uc2UuUnVudGltZSAmJiAhcmVzcG9uc2UuUnVudGltZS5zdGFydHNXaXRoKCdub2RlanMnKSkge1xuICAgICAgICByZXN1bHQud2FybmluZ3MucHVzaChgVW5leHBlY3RlZCBydW50aW1lOiAke3Jlc3BvbnNlLlJ1bnRpbWV9YCk7XG4gICAgICB9IGVsc2UgaWYgKHJlc3BvbnNlLlJ1bnRpbWUpIHtcbiAgICAgICAgcmVzdWx0LmluZm8ucHVzaChgUnVudGltZTogJHtyZXNwb25zZS5SdW50aW1lfWApO1xuICAgICAgfVxuXG4gICAgICAvLyBDaGVjayBtZW1vcnlcbiAgICAgIGlmIChyZXNwb25zZS5NZW1vcnlTaXplICYmIHJlc3BvbnNlLk1lbW9yeVNpemUgPCA1MTIpIHtcbiAgICAgICAgcmVzdWx0Lndhcm5pbmdzLnB1c2goYE1lbW9yeSBhbGxvY2F0aW9uIG1heSBiZSBsb3c6ICR7cmVzcG9uc2UuTWVtb3J5U2l6ZX1NQiAocmVjb21tZW5kZWQ6IDUxMk1CKylgKTtcbiAgICAgIH0gZWxzZSBpZiAocmVzcG9uc2UuTWVtb3J5U2l6ZSkge1xuICAgICAgICByZXN1bHQuaW5mby5wdXNoKGBNZW1vcnk6ICR7cmVzcG9uc2UuTWVtb3J5U2l6ZX1NQmApO1xuICAgICAgfVxuXG4gICAgICAvLyBDaGVjayB0aW1lb3V0XG4gICAgICBpZiAocmVzcG9uc2UuVGltZW91dCAmJiByZXNwb25zZS5UaW1lb3V0IDwgNjApIHtcbiAgICAgICAgcmVzdWx0Lndhcm5pbmdzLnB1c2goYFRpbWVvdXQgbWF5IGJlIGxvdzogJHtyZXNwb25zZS5UaW1lb3V0fXMgKHJlY29tbWVuZGVkOiA2MHMrKWApO1xuICAgICAgfSBlbHNlIGlmIChyZXNwb25zZS5UaW1lb3V0KSB7XG4gICAgICAgIHJlc3VsdC5pbmZvLnB1c2goYFRpbWVvdXQ6ICR7cmVzcG9uc2UuVGltZW91dH1zYCk7XG4gICAgICB9XG5cbiAgICAgIC8vIENoZWNrIGVudmlyb25tZW50IHZhcmlhYmxlc1xuICAgICAgY29uc3QgZW52VmFycyA9IHJlc3BvbnNlLkVudmlyb25tZW50Py5WYXJpYWJsZXMgfHwge307XG4gICAgICBjb25zdCByZXF1aXJlZFZhcnMgPSBbJ1NQRU5EX1RIUkVTSE9MRCcsICdTTlNfVE9QSUNfQVJOJ107XG4gICAgICBjb25zdCBpb3NWYXJzID0gWydJT1NfUExBVEZPUk1fQVBQX0FSTicsICdJT1NfQlVORExFX0lEJ107XG5cbiAgICAgIGZvciAoY29uc3QgdmFyTmFtZSBvZiByZXF1aXJlZFZhcnMpIHtcbiAgICAgICAgaWYgKCFlbnZWYXJzW3Zhck5hbWVdKSB7XG4gICAgICAgICAgcmVzdWx0LmVycm9ycy5wdXNoKGBSZXF1aXJlZCBlbnZpcm9ubWVudCB2YXJpYWJsZSBtaXNzaW5nOiAke3Zhck5hbWV9YCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVzdWx0LmluZm8ucHVzaChgRW52aXJvbm1lbnQgdmFyaWFibGUgc2V0OiAke3Zhck5hbWV9YCk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCB2YXJOYW1lIG9mIGlvc1ZhcnMpIHtcbiAgICAgICAgaWYgKCFlbnZWYXJzW3Zhck5hbWVdKSB7XG4gICAgICAgICAgcmVzdWx0Lndhcm5pbmdzLnB1c2goYGlPUyBlbnZpcm9ubWVudCB2YXJpYWJsZSBub3Qgc2V0OiAke3Zhck5hbWV9YCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVzdWx0LmluZm8ucHVzaChgaU9TIGVudmlyb25tZW50IHZhcmlhYmxlIHNldDogJHt2YXJOYW1lfWApO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmVzdWx0LmVycm9ycy5wdXNoKGBDYW5ub3QgYWNjZXNzIExhbWJkYSBmdW5jdGlvbjogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ31gKTtcbiAgICB9XG5cbiAgICByZXN1bHQuaXNWYWxpZCA9IHJlc3VsdC5lcnJvcnMubGVuZ3RoID09PSAwO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIFNOUyB0b3BpYyBBUk4gZm9ybWF0XG4gICAqL1xuICBwcml2YXRlIGlzVmFsaWRTbnNUb3BpY0Fybihhcm46IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IGFyblBhdHRlcm4gPSAvXmFybjphd3M6c25zOlthLXowLTktXSs6XFxkezEyfTpbYS16QS1aMC05Xy1dKyQvO1xuICAgIHJldHVybiBhcm5QYXR0ZXJuLnRlc3QoYXJuKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgcGxhdGZvcm0gYXBwbGljYXRpb24gQVJOIGZvcm1hdFxuICAgKi9cbiAgcHJpdmF0ZSBpc1ZhbGlkUGxhdGZvcm1BcHBsaWNhdGlvbkFybihhcm46IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IGFyblBhdHRlcm4gPSAvXmFybjphd3M6c25zOlthLXowLTktXSs6XFxkezEyfTphcHBcXC9BUE5TW19TQU5EQk9YXSpcXC9bYS16QS1aMC05Xy1dKyQvO1xuICAgIHJldHVybiBhcm5QYXR0ZXJuLnRlc3QoYXJuKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgaU9TIGJ1bmRsZSBJRCBmb3JtYXRcbiAgICovXG4gIHByaXZhdGUgaXNWYWxpZEJ1bmRsZUlkKGJ1bmRsZUlkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCBidW5kbGVJZFBhdHRlcm4gPSAvXlthLXpBLVowLTkuLV0rXFwuW2EtekEtWjAtOS4tXSskLztcbiAgICByZXR1cm4gYnVuZGxlSWRQYXR0ZXJuLnRlc3QoYnVuZGxlSWQpO1xuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBBV1MgcmVnaW9uIGZvcm1hdFxuICAgKi9cbiAgcHJpdmF0ZSBpc1ZhbGlkQXdzUmVnaW9uKHJlZ2lvbjogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgY29uc3QgcmVnaW9uUGF0dGVybiA9IC9eW2Etel17Mn0tW2Etel0rLVxcZCskLztcbiAgICByZXR1cm4gcmVnaW9uUGF0dGVybi50ZXN0KHJlZ2lvbik7XG4gIH1cblxuICAvKipcbiAgICogR2VuZXJhdGVzIGEgY29uZmlndXJhdGlvbiB2YWxpZGF0aW9uIHJlcG9ydFxuICAgKi9cbiAgc3RhdGljIGdlbmVyYXRlVmFsaWRhdGlvblJlcG9ydChyZXN1bHQ6IFZhbGlkYXRpb25SZXN1bHQpOiBzdHJpbmcge1xuICAgIGNvbnN0IGxpbmVzOiBzdHJpbmdbXSA9IFtdO1xuICAgIFxuICAgIGxpbmVzLnB1c2goJ0NvbmZpZ3VyYXRpb24gVmFsaWRhdGlvbiBSZXBvcnQnKTtcbiAgICBsaW5lcy5wdXNoKCc9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PScpO1xuICAgIGxpbmVzLnB1c2goJycpO1xuXG4gICAgaWYgKHJlc3VsdC5pc1ZhbGlkKSB7XG4gICAgICBsaW5lcy5wdXNoKCfinJMgQ29uZmlndXJhdGlvbiBpcyB2YWxpZCcpO1xuICAgIH0gZWxzZSB7XG4gICAgICBsaW5lcy5wdXNoKCfinJcgQ29uZmlndXJhdGlvbiBoYXMgZXJyb3JzJyk7XG4gICAgfVxuXG4gICAgbGluZXMucHVzaCgnJyk7XG4gICAgbGluZXMucHVzaChgRXJyb3JzOiAke3Jlc3VsdC5lcnJvcnMubGVuZ3RofWApO1xuICAgIGxpbmVzLnB1c2goYFdhcm5pbmdzOiAke3Jlc3VsdC53YXJuaW5ncy5sZW5ndGh9YCk7XG4gICAgbGluZXMucHVzaChgSW5mbzogJHtyZXN1bHQuaW5mby5sZW5ndGh9YCk7XG4gICAgbGluZXMucHVzaCgnJyk7XG5cbiAgICBpZiAocmVzdWx0LmVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICBsaW5lcy5wdXNoKCdFcnJvcnM6Jyk7XG4gICAgICByZXN1bHQuZXJyb3JzLmZvckVhY2goZXJyb3IgPT4gbGluZXMucHVzaChgICDinJcgJHtlcnJvcn1gKSk7XG4gICAgICBsaW5lcy5wdXNoKCcnKTtcbiAgICB9XG5cbiAgICBpZiAocmVzdWx0Lndhcm5pbmdzLmxlbmd0aCA+IDApIHtcbiAgICAgIGxpbmVzLnB1c2goJ1dhcm5pbmdzOicpO1xuICAgICAgcmVzdWx0Lndhcm5pbmdzLmZvckVhY2god2FybmluZyA9PiBsaW5lcy5wdXNoKGAgIOKaoCAke3dhcm5pbmd9YCkpO1xuICAgICAgbGluZXMucHVzaCgnJyk7XG4gICAgfVxuXG4gICAgaWYgKHJlc3VsdC5pbmZvLmxlbmd0aCA+IDApIHtcbiAgICAgIGxpbmVzLnB1c2goJ0luZm9ybWF0aW9uOicpO1xuICAgICAgcmVzdWx0LmluZm8uZm9yRWFjaChpbmZvID0+IGxpbmVzLnB1c2goYCAg4oS5ICR7aW5mb31gKSk7XG4gICAgICBsaW5lcy5wdXNoKCcnKTtcbiAgICB9XG5cbiAgICByZXR1cm4gbGluZXMuam9pbignXFxuJyk7XG4gIH1cbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgZW52aXJvbm1lbnQgdmFyaWFibGVzIGZvciB0aGUgc3BlbmQgbW9uaXRvclxuICovXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVFbnZpcm9ubWVudFZhcmlhYmxlcygpOiBWYWxpZGF0aW9uUmVzdWx0IHtcbiAgY29uc3QgcmVzdWx0OiBWYWxpZGF0aW9uUmVzdWx0ID0ge1xuICAgIGlzVmFsaWQ6IHRydWUsXG4gICAgZXJyb3JzOiBbXSxcbiAgICB3YXJuaW5nczogW10sXG4gICAgaW5mbzogW11cbiAgfTtcblxuICBjb25zdCByZXF1aXJlZFZhcnMgPSBbXG4gICAgJ1NQRU5EX1RIUkVTSE9MRCcsXG4gICAgJ1NOU19UT1BJQ19BUk4nLFxuICAgICdBV1NfUkVHSU9OJ1xuICBdO1xuXG4gIGNvbnN0IG9wdGlvbmFsVmFycyA9IFtcbiAgICAnQ0hFQ0tfUEVSSU9EX0RBWVMnLFxuICAgICdSRVRSWV9BVFRFTVBUUycsXG4gICAgJ01JTl9TRVJWSUNFX0NPU1RfVEhSRVNIT0xEJ1xuICBdO1xuXG4gIGNvbnN0IGlvc1ZhcnMgPSBbXG4gICAgJ0lPU19QTEFURk9STV9BUFBfQVJOJyxcbiAgICAnSU9TX0JVTkRMRV9JRCcsXG4gICAgJ0FQTlNfU0FOREJPWCdcbiAgXTtcblxuICAvLyBDaGVjayByZXF1aXJlZCB2YXJpYWJsZXNcbiAgZm9yIChjb25zdCB2YXJOYW1lIG9mIHJlcXVpcmVkVmFycykge1xuICAgIGNvbnN0IHZhbHVlID0gcHJvY2Vzcy5lbnZbdmFyTmFtZV07XG4gICAgaWYgKCF2YWx1ZSkge1xuICAgICAgcmVzdWx0LmVycm9ycy5wdXNoKGBSZXF1aXJlZCBlbnZpcm9ubWVudCB2YXJpYWJsZSBtaXNzaW5nOiAke3Zhck5hbWV9YCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdC5pbmZvLnB1c2goYEVudmlyb25tZW50IHZhcmlhYmxlIHNldDogJHt2YXJOYW1lfWApO1xuICAgIH1cbiAgfVxuXG4gIC8vIENoZWNrIG9wdGlvbmFsIHZhcmlhYmxlc1xuICBmb3IgKGNvbnN0IHZhck5hbWUgb2Ygb3B0aW9uYWxWYXJzKSB7XG4gICAgY29uc3QgdmFsdWUgPSBwcm9jZXNzLmVudlt2YXJOYW1lXTtcbiAgICBpZiAodmFsdWUpIHtcbiAgICAgIHJlc3VsdC5pbmZvLnB1c2goYE9wdGlvbmFsIGVudmlyb25tZW50IHZhcmlhYmxlIHNldDogJHt2YXJOYW1lfWApO1xuICAgIH1cbiAgfVxuXG4gIC8vIENoZWNrIGlPUyB2YXJpYWJsZXNcbiAgbGV0IGlvc0NvbmZpZ3VyZWQgPSBmYWxzZTtcbiAgZm9yIChjb25zdCB2YXJOYW1lIG9mIGlvc1ZhcnMpIHtcbiAgICBjb25zdCB2YWx1ZSA9IHByb2Nlc3MuZW52W3Zhck5hbWVdO1xuICAgIGlmICh2YWx1ZSkge1xuICAgICAgcmVzdWx0LmluZm8ucHVzaChgaU9TIGVudmlyb25tZW50IHZhcmlhYmxlIHNldDogJHt2YXJOYW1lfWApO1xuICAgICAgaW9zQ29uZmlndXJlZCA9IHRydWU7XG4gICAgfVxuICB9XG5cbiAgaWYgKCFpb3NDb25maWd1cmVkKSB7XG4gICAgcmVzdWx0Lndhcm5pbmdzLnB1c2goJ05vIGlPUyBlbnZpcm9ubWVudCB2YXJpYWJsZXMgY29uZmlndXJlZCAtIGlPUyBub3RpZmljYXRpb25zIHdpbGwgYmUgZGlzYWJsZWQnKTtcbiAgfVxuXG4gIHJlc3VsdC5pc1ZhbGlkID0gcmVzdWx0LmVycm9ycy5sZW5ndGggPT09IDA7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIHNhbXBsZSBjb25maWd1cmF0aW9uIGZvciB0ZXN0aW5nXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVTYW1wbGVDb25maWcoKTogU3BlbmRNb25pdG9yQ29uZmlnVmFsaWRhdGlvbiB7XG4gIHJldHVybiB7XG4gICAgc3BlbmRUaHJlc2hvbGQ6IDEwLFxuICAgIHNuc1RvcGljQXJuOiAnYXJuOmF3czpzbnM6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjpzcGVuZC1tb25pdG9yLWFsZXJ0cycsXG4gICAgcmVnaW9uOiAndXMtZWFzdC0xJyxcbiAgICBjaGVja1BlcmlvZERheXM6IDEsXG4gICAgcmV0cnlBdHRlbXB0czogMyxcbiAgICBtaW5TZXJ2aWNlQ29zdFRocmVzaG9sZDogMSxcbiAgICBpb3NDb25maWc6IHtcbiAgICAgIHBsYXRmb3JtQXBwbGljYXRpb25Bcm46ICdhcm46YXdzOnNuczp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOmFwcC9BUE5TL1NwZW5kTW9uaXRvckFwcCcsXG4gICAgICBidW5kbGVJZDogJ2NvbS5leGFtcGxlLnNwZW5kbW9uaXRvcicsXG4gICAgICBzYW5kYm94OiB0cnVlXG4gICAgfVxuICB9O1xufSJdfQ==