import { SpendMonitorConfig, iOSPushConfig, iOSDeviceRegistration } from './types';
/**
 * Validation error class for configuration issues
 */
export declare class ValidationError extends Error {
    field?: string | undefined;
    constructor(message: string, field?: string | undefined);
}
/**
 * Validates the spend monitor configuration
 */
export declare function validateSpendMonitorConfig(config: Partial<SpendMonitorConfig>): void;
/**
 * Validates iOS push notification configuration
 */
export declare function validateiOSPushConfig(config: iOSPushConfig, errors?: string[]): void;
/**
 * Validates iOS device registration data
 */
export declare function validateiOSDeviceRegistration(registration: Partial<iOSDeviceRegistration>): void;
/**
 * Creates a default spend monitor configuration with validation
 */
export declare function createDefaultConfig(overrides?: Partial<SpendMonitorConfig>): SpendMonitorConfig;
