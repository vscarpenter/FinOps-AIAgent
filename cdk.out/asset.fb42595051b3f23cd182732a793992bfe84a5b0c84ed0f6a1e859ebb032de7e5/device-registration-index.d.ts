/**
 * Lambda entry point for iOS Device Registration API
 *
 * This is a separate Lambda function from the main spend monitor agent
 * that handles device registration, updates, and management for iOS push notifications.
 */
import { APIGatewayEvent, APIGatewayResponse } from './types';
/**
 * AWS Lambda handler for API Gateway events
 *
 * This function is deployed as a separate Lambda function and handles
 * all device registration API requests through API Gateway.
 */
export declare const handler: (event: APIGatewayEvent) => Promise<APIGatewayResponse>;
