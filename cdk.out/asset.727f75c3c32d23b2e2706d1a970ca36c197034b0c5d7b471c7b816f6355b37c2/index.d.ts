import { SpendMonitorConfig } from './types';
/**
 * AWS Lambda handler for the Spend Monitor Agent
 *
 * This handler is triggered by EventBridge on a schedule and executes
 * the spend monitoring workflow with multi-channel alerting support.
 */
export declare const handler: (event: any, context: any) => Promise<{
    statusCode: number;
    body: string;
}>;
/**
 * Loads configuration from environment variables with iOS support
 */
declare function loadConfiguration(): SpendMonitorConfig;
/**
 * Validates required environment variables
 */
declare function validateEnvironmentVariables(): void;
/**
 * Gets runtime information for debugging
 */
declare function getRuntimeInfo(): {
    nodeVersion: string;
    platform: NodeJS.Platform;
    arch: NodeJS.Architecture;
    memoryUsage: NodeJS.MemoryUsage;
    uptime: number;
    env: {
        AWS_REGION: string | undefined;
        AWS_LAMBDA_FUNCTION_NAME: string | undefined;
        AWS_LAMBDA_FUNCTION_VERSION: string | undefined;
        AWS_LAMBDA_FUNCTION_MEMORY_SIZE: string | undefined;
    };
};
/**
 * Local testing function
 */
declare function runLocalTest(): Promise<{
    statusCode: number;
    body: string;
}>;
export { loadConfiguration, validateEnvironmentVariables, getRuntimeInfo, runLocalTest };
