/**
 * Configuration Validation Utilities
 *
 * This module provides comprehensive validation for AWS Spend Monitor configuration
 * including iOS push notification settings, AWS service configurations, and
 * deployment prerequisites.
 */
export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    info: string[];
}
export interface ConfigValidationOptions {
    skipAwsValidation?: boolean;
    skipNetworkTests?: boolean;
    region?: string;
}
export interface SpendMonitorConfigValidation {
    spendThreshold: number;
    snsTopicArn: string;
    region: string;
    checkPeriodDays?: number;
    retryAttempts?: number;
    minServiceCostThreshold?: number;
    iosConfig?: iOSConfigValidation;
}
export interface iOSConfigValidation {
    platformApplicationArn: string;
    bundleId: string;
    sandbox?: boolean;
    apnsCertificatePath?: string;
    apnsPrivateKeyPath?: string;
}
export declare class ConfigValidator {
    private snsClient;
    private costExplorerClient;
    private lambdaClient;
    private region;
    constructor(region?: string);
    /**
     * Validates the complete spend monitor configuration
     */
    validateConfiguration(config: SpendMonitorConfigValidation, options?: ConfigValidationOptions): Promise<ValidationResult>;
    /**
     * Validates basic configuration parameters
     */
    private validateBasicConfig;
    /**
     * Validates iOS configuration parameters
     */
    private validateiOSConfig;
    /**
     * Validates AWS services accessibility and configuration
     */
    private validateAwsServices;
    /**
     * Validates SNS topic accessibility
     */
    private validateSnsTopicAccess;
    /**
     * Validates iOS platform application accessibility
     */
    private validatePlatformApplicationAccess;
    /**
     * Validates Cost Explorer accessibility
     */
    private validateCostExplorerAccess;
    /**
     * Validates device token format
     */
    static validateDeviceToken(token: string): ValidationResult;
    /**
     * Validates Lambda function configuration
     */
    validateLambdaFunction(functionName: string): Promise<ValidationResult>;
    /**
     * Validates SNS topic ARN format
     */
    private isValidSnsTopicArn;
    /**
     * Validates platform application ARN format
     */
    private isValidPlatformApplicationArn;
    /**
     * Validates iOS bundle ID format
     */
    private isValidBundleId;
    /**
     * Validates AWS region format
     */
    private isValidAwsRegion;
    /**
     * Generates a configuration validation report
     */
    static generateValidationReport(result: ValidationResult): string;
}
/**
 * Validates environment variables for the spend monitor
 */
export declare function validateEnvironmentVariables(): ValidationResult;
/**
 * Creates a sample configuration for testing
 */
export declare function createSampleConfig(): SpendMonitorConfigValidation;
