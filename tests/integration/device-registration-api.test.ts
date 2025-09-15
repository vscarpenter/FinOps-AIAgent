import { SNSClient, CreatePlatformApplicationCommand, DeletePlatformApplicationCommand } from '@aws-sdk/client-sns';
import { DynamoDBClient, CreateTableCommand, DeleteTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { DeviceRegistrationHandler } from '../../src/device-registration-handler';
import {
  APIGatewayEvent,
  DeviceRegistrationRequest,
  DeviceUpdateRequest,
  DeviceRegistrationResponse,
  DeviceUpdateResponse,
  DeviceListResponse,
  DeviceDeleteResponse
} from '../../src/types';

/**
 * Integration tests for Device Registration API
 * 
 * These tests use real AWS services in a test environment
 * Requires AWS credentials and permissions for SNS and DynamoDB
 */
describe('Device Registration API Integration Tests', () => {
  let handler: DeviceRegistrationHandler;
  let snsClient: SNSClient;
  let dynamodbClient: DynamoDBClient;
  
  const testRegion = process.env.TEST_AWS_REGION || 'us-east-1';
  const testTableName = `test-device-tokens-${Date.now()}`;
  const testPlatformAppName = `test-spend-monitor-apns-${Date.now()}`;
  const testBundleId = 'com.test.spendmonitor';
  
  let testPlatformAppArn: string;
  let testDeviceToken: string;

  beforeAll(async () => {
    // Skip integration tests if not in test environment
    if (!process.env.RUN_INTEGRATION_TESTS) {
      console.log('Skipping integration tests - set RUN_INTEGRATION_TESTS=true to run');
      return;
    }

    snsClient = new SNSClient({ region: testRegion });
    dynamodbClient = new DynamoDBClient({ region: testRegion });

    // Generate test device token (64-character hex string)
    testDeviceToken = Array.from({ length: 64 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');

    try {
      // Create test SNS platform application
      // Note: This requires valid APNS certificate for real testing
      // For integration tests, we'll use a mock certificate
      const mockCertificate = 'mock-certificate-data';
      const mockPrivateKey = 'mock-private-key-data';

      const createPlatformAppCommand = new CreatePlatformApplicationCommand({
        Name: testPlatformAppName,
        Platform: 'APNS_SANDBOX',
        Attributes: {
          PlatformCredential: mockCertificate,
          PlatformPrincipal: mockPrivateKey
        }
      });

      const platformAppResponse = await snsClient.send(createPlatformAppCommand);
      testPlatformAppArn = platformAppResponse.PlatformApplicationArn!;

      // Create test DynamoDB table
      const createTableCommand = new CreateTableCommand({
        TableName: testTableName,
        KeySchema: [
          {
            AttributeName: 'deviceToken',
            KeyType: 'HASH'
          }
        ],
        AttributeDefinitions: [
          {
            AttributeName: 'deviceToken',
            AttributeType: 'S'
          }
        ],
        BillingMode: 'PAY_PER_REQUEST'
      });

      await dynamodbClient.send(createTableCommand);

      // Wait for table to be active
      let tableActive = false;
      let attempts = 0;
      while (!tableActive && attempts < 30) {
        try {
          const describeCommand = new DescribeTableCommand({ TableName: testTableName });
          const tableDescription = await dynamodbClient.send(describeCommand);
          tableActive = tableDescription.Table?.TableStatus === 'ACTIVE';
          if (!tableActive) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        attempts++;
      }

      if (!tableActive) {
        throw new Error('Test table did not become active within timeout');
      }

      // Set up environment variables for handler
      process.env.IOS_PLATFORM_APP_ARN = testPlatformAppArn;
      process.env.DEVICE_TOKEN_TABLE_NAME = testTableName;
      process.env.IOS_BUNDLE_ID = testBundleId;
      process.env.AWS_REGION = testRegion;

      handler = new DeviceRegistrationHandler();

    } catch (error) {
      console.error('Failed to set up integration test environment:', error);
      throw error;
    }
  }, 60000); // 60 second timeout for setup

  afterAll(async () => {
    if (!process.env.RUN_INTEGRATION_TESTS) {
      return;
    }

    try {
      // Clean up test resources
      if (testPlatformAppArn) {
        const deletePlatformAppCommand = new DeletePlatformApplicationCommand({
          PlatformApplicationArn: testPlatformAppArn
        });
        await snsClient.send(deletePlatformAppCommand);
      }

      if (testTableName) {
        const deleteTableCommand = new DeleteTableCommand({
          TableName: testTableName
        });
        await dynamodbClient.send(deleteTableCommand);
      }

      // Clean up environment variables
      delete process.env.IOS_PLATFORM_APP_ARN;
      delete process.env.DEVICE_TOKEN_TABLE_NAME;
      delete process.env.IOS_BUNDLE_ID;
      delete process.env.AWS_REGION;

    } catch (error) {
      console.error('Failed to clean up integration test environment:', error);
    }
  }, 30000); // 30 second timeout for cleanup

  const createMockEvent = (method: string, path: string, body?: any, pathParams?: any, queryParams?: any): APIGatewayEvent => ({
    httpMethod: method,
    path,
    pathParameters: pathParams || null,
    queryStringParameters: queryParams || null,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : null,
    requestContext: {
      requestId: `test-${Date.now()}`,
      identity: { sourceIp: '127.0.0.1' }
    }
  });

  describe('Device Registration Flow', () => {
    it('should complete full device lifecycle', async () => {
      if (!process.env.RUN_INTEGRATION_TESTS) {
        pending('Integration tests disabled');
        return;
      }

      const userId = 'integration-test-user';
      
      // 1. Register new device
      const registrationRequest: DeviceRegistrationRequest = {
        deviceToken: testDeviceToken,
        userId,
        bundleId: testBundleId
      };

      const registerEvent = createMockEvent('POST', '/devices', registrationRequest);
      const registerResponse = await handler.handleRequest(registerEvent);

      expect(registerResponse.statusCode).toBe(201);
      
      const registerBody: DeviceRegistrationResponse = JSON.parse(registerResponse.body);
      expect(registerBody.success).toBe(true);
      expect(registerBody.platformEndpointArn).toBeDefined();
      expect(registerBody.registrationDate).toBeDefined();

      const platformEndpointArn = registerBody.platformEndpointArn!;

      // 2. List user devices
      const listEvent = createMockEvent('GET', '/devices', null, null, { userId });
      const listResponse = await handler.handleRequest(listEvent);

      expect(listResponse.statusCode).toBe(200);
      
      const listBody: DeviceListResponse = JSON.parse(listResponse.body);
      expect(listBody.success).toBe(true);
      expect(listBody.devices).toHaveLength(1);
      expect(listBody.devices![0].deviceToken).toBe(testDeviceToken);
      expect(listBody.devices![0].userId).toBe(userId);

      // 3. Update device token
      const newDeviceToken = Array.from({ length: 64 }, () => 
        Math.floor(Math.random() * 16).toString(16)
      ).join('');

      const updateRequest: DeviceUpdateRequest = {
        currentToken: testDeviceToken,
        newToken: newDeviceToken,
        userId
      };

      const updateEvent = createMockEvent('PUT', '/devices', updateRequest);
      const updateResponse = await handler.handleRequest(updateEvent);

      expect(updateResponse.statusCode).toBe(200);
      
      const updateBody: DeviceUpdateResponse = JSON.parse(updateResponse.body);
      expect(updateBody.success).toBe(true);
      expect(updateBody.platformEndpointArn).toBe(platformEndpointArn);

      // 4. Verify device token was updated
      const listAfterUpdateEvent = createMockEvent('GET', '/devices', null, null, { userId });
      const listAfterUpdateResponse = await handler.handleRequest(listAfterUpdateEvent);

      expect(listAfterUpdateResponse.statusCode).toBe(200);
      
      const listAfterUpdateBody: DeviceListResponse = JSON.parse(listAfterUpdateResponse.body);
      expect(listAfterUpdateBody.success).toBe(true);
      expect(listAfterUpdateBody.devices).toHaveLength(1);
      expect(listAfterUpdateBody.devices![0].deviceToken).toBe(newDeviceToken);

      // 5. Delete device
      const deleteEvent = createMockEvent('DELETE', `/devices/${encodeURIComponent(newDeviceToken)}`, null, { deviceToken: newDeviceToken });
      const deleteResponse = await handler.handleRequest(deleteEvent);

      expect(deleteResponse.statusCode).toBe(200);
      
      const deleteBody: DeviceDeleteResponse = JSON.parse(deleteResponse.body);
      expect(deleteBody.success).toBe(true);
      expect(deleteBody.deletedAt).toBeDefined();

      // 6. Verify device was deleted
      const listAfterDeleteEvent = createMockEvent('GET', '/devices', null, null, { userId });
      const listAfterDeleteResponse = await handler.handleRequest(listAfterDeleteEvent);

      expect(listAfterDeleteResponse.statusCode).toBe(200);
      
      const listAfterDeleteBody: DeviceListResponse = JSON.parse(listAfterDeleteResponse.body);
      expect(listAfterDeleteBody.success).toBe(true);
      expect(listAfterDeleteBody.devices).toHaveLength(0);

    }, 30000); // 30 second timeout for full lifecycle test
  });

  describe('Error Scenarios', () => {
    it('should handle invalid device token format', async () => {
      if (!process.env.RUN_INTEGRATION_TESTS) {
        pending('Integration tests disabled');
        return;
      }

      const registrationRequest: DeviceRegistrationRequest = {
        deviceToken: 'invalid-token-format',
        userId: 'test-user',
        bundleId: testBundleId
      };

      const event = createMockEvent('POST', '/devices', registrationRequest);
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(400);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.error).toContain('Invalid device token format');
    });

    it('should handle non-existent device updates', async () => {
      if (!process.env.RUN_INTEGRATION_TESTS) {
        pending('Integration tests disabled');
        return;
      }

      const nonExistentToken = Array.from({ length: 64 }, () => 
        Math.floor(Math.random() * 16).toString(16)
      ).join('');

      const newToken = Array.from({ length: 64 }, () => 
        Math.floor(Math.random() * 16).toString(16)
      ).join('');

      const updateRequest: DeviceUpdateRequest = {
        currentToken: nonExistentToken,
        newToken: newToken,
        userId: 'test-user'
      };

      const event = createMockEvent('PUT', '/devices', updateRequest);
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(404);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.error).toContain('Device not found');
    });

    it('should handle non-existent device deletion', async () => {
      if (!process.env.RUN_INTEGRATION_TESTS) {
        pending('Integration tests disabled');
        return;
      }

      const nonExistentToken = Array.from({ length: 64 }, () => 
        Math.floor(Math.random() * 16).toString(16)
      ).join('');

      const event = createMockEvent('DELETE', `/devices/${nonExistentToken}`, null, { deviceToken: nonExistentToken });
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(404);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.error).toContain('Device not found');
    });

    it('should handle empty user device list', async () => {
      if (!process.env.RUN_INTEGRATION_TESTS) {
        pending('Integration tests disabled');
        return;
      }

      const event = createMockEvent('GET', '/devices', null, null, { userId: 'non-existent-user' });
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(200);
      
      const responseBody: DeviceListResponse = JSON.parse(response.body);
      expect(responseBody.success).toBe(true);
      expect(responseBody.devices).toHaveLength(0);
    });
  });

  describe('CORS and API Gateway Integration', () => {
    it('should handle OPTIONS preflight requests', async () => {
      if (!process.env.RUN_INTEGRATION_TESTS) {
        pending('Integration tests disabled');
        return;
      }

      const event = createMockEvent('OPTIONS', '/devices');
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(200);
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(response.headers['Access-Control-Allow-Methods']).toContain('POST');
      expect(response.headers['Access-Control-Allow-Headers']).toContain('Content-Type');
      expect(response.body).toBe('');
    });

    it('should include CORS headers in error responses', async () => {
      if (!process.env.RUN_INTEGRATION_TESTS) {
        pending('Integration tests disabled');
        return;
      }

      const event = createMockEvent('GET', '/unknown-path');
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(404);
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
    });
  });

  describe('Performance and Load', () => {
    it('should handle multiple concurrent registrations', async () => {
      if (!process.env.RUN_INTEGRATION_TESTS) {
        pending('Integration tests disabled');
        return;
      }

      const concurrentRequests = 5;
      const registrationPromises: Promise<any>[] = [];

      for (let i = 0; i < concurrentRequests; i++) {
        const deviceToken = Array.from({ length: 64 }, () => 
          Math.floor(Math.random() * 16).toString(16)
        ).join('');

        const registrationRequest: DeviceRegistrationRequest = {
          deviceToken,
          userId: `concurrent-user-${i}`,
          bundleId: testBundleId
        };

        const event = createMockEvent('POST', '/devices', registrationRequest);
        registrationPromises.push(handler.handleRequest(event));
      }

      const responses = await Promise.all(registrationPromises);

      // All registrations should succeed
      responses.forEach(response => {
        expect(response.statusCode).toBe(201);
        const responseBody: DeviceRegistrationResponse = JSON.parse(response.body);
        expect(responseBody.success).toBe(true);
      });

      // Clean up registered devices
      const cleanupPromises: Promise<any>[] = [];
      for (let i = 0; i < concurrentRequests; i++) {
        const listEvent = createMockEvent('GET', '/devices', null, null, { userId: `concurrent-user-${i}` });
        cleanupPromises.push(
          handler.handleRequest(listEvent).then(async (listResponse) => {
            const listBody: DeviceListResponse = JSON.parse(listResponse.body);
            if (listBody.devices && listBody.devices.length > 0) {
              const deviceToken = listBody.devices[0].deviceToken;
              const deleteEvent = createMockEvent('DELETE', `/devices/${encodeURIComponent(deviceToken)}`, null, { deviceToken });
              return handler.handleRequest(deleteEvent);
            }
          })
        );
      }

      await Promise.all(cleanupPromises);

    }, 60000); // 60 second timeout for concurrent test
  });
});