/**
 * Lambda entry point for iOS Device Registration API
 * 
 * This is a separate Lambda function from the main spend monitor agent
 * that handles device registration, updates, and management for iOS push notifications.
 */

import { handler as deviceRegistrationHandler } from './device-registration-handler';
import { APIGatewayEvent, APIGatewayResponse } from './types';

/**
 * AWS Lambda handler for API Gateway events
 * 
 * This function is deployed as a separate Lambda function and handles
 * all device registration API requests through API Gateway.
 */
export const handler = async (event: APIGatewayEvent): Promise<APIGatewayResponse> => {
  console.log('Device Registration API Lambda invoked:', {
    method: event.httpMethod,
    path: event.path,
    requestId: event.requestContext.requestId,
    sourceIp: event.requestContext.identity.sourceIp
  });

  try {
    // Call the device registration handler
    const response = await deviceRegistrationHandler(event);

    console.log('Device Registration API response:', {
      statusCode: response.statusCode,
      requestId: event.requestContext.requestId
    });

    return response;

  } catch (error) {
    console.error('Unhandled error in Device Registration API:', error);

    // Return a generic error response
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
        requestId: event.requestContext.requestId
      })
    };
  }
};