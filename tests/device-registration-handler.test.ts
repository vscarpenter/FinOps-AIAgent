import { DeviceRegistrationHandler } from '../src/device-registration-handler';
import { SNSClient, CreatePlatformEndpointCommand, DeleteEndpointCommand, SetEndpointAttributesCommand } from '@aws-sdk/client-sns';
import { DynamoDBClient, PutItemCommand, GetItemCommand, DeleteItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import {
  APIGatewayEvent,
  DeviceRegistrationRequest,
  DeviceUpdateRequest,
  iOSDeviceRegistration
} from '../src/types';

// Mock AWS SDK clients
jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({
    send: jest.fn()
  })),
  CreatePlatformEndpointCommand: jest.fn(),
  DeleteEndpointCommand: jest.fn(),
  SetEndpointAttributesCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({
    send: jest.fn()
  })),
  PutItemCommand: jest.fn(),
  GetItemCommand: jest.fn(),
  DeleteItemCommand: jest.fn(),
  ScanCommand: jest.fn()
}));

jest.mock('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => obj)
}));

describe('DeviceRegistrationHandler', () => {
  let handler: DeviceRegistrationHandler;
  let mockSNSSend: jest.Mock;
  let mockDynamoDBSend: jest.Mock;

  const mockPlatformAppArn = 'arn:aws:sns:us-east-1:123456789012:app/APNS_SANDBOX/SpendMonitorAPNS';
  const mockTableName = 'spend-monitor-device-tokens';
  const mockBundleId = 'com.example.spendmonitor';
  const mockDeviceToken = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const mockEndpointArn = 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS_SANDBOX/SpendMonitorAPNS/12345678-1234-1234-1234-123456789012';

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up environment variables
    process.env.IOS_PLATFORM_APP_ARN = mockPlatformAppArn;
    process.env.DEVICE_TOKEN_TABLE_NAME = mockTableName;
    process.env.IOS_BUNDLE_ID = mockBundleId;
    process.env.AWS_REGION = 'us-east-1';

    // Mock SNS and DynamoDB send methods
    mockSNSSend = jest.fn();
    mockDynamoDBSend = jest.fn();

    // Mock the clients to return our mock send functions
    (SNSClient as jest.Mock).mockImplementation(() => ({
      send: mockSNSSend
    }));

    (DynamoDBClient as jest.Mock).mockImplementation(() => ({
      send: mockDynamoDBSend
    }));

    handler = new DeviceRegistrationHandler();
  });

  afterEach(() => {
    delete process.env.IOS_PLATFORM_APP_ARN;
    delete process.env.DEVICE_TOKEN_TABLE_NAME;
    delete process.env.IOS_BUNDLE_ID;
    delete process.env.AWS_REGION;
  });

  describe('Constructor', () => {
    it('should throw error if IOS_PLATFORM_APP_ARN is not set', () => {
      delete process.env.IOS_PLATFORM_APP_ARN;
      expect(() => new DeviceRegistrationHandler()).toThrow('IOS_PLATFORM_APP_ARN environment variable is required');
    });

    it('should throw error if DEVICE_TOKEN_TABLE_NAME is not set', () => {
      delete process.env.DEVICE_TOKEN_TABLE_NAME;
      expect(() => new DeviceRegistrationHandler()).toThrow('DEVICE_TOKEN_TABLE_NAME environment variable is required');
    });
  });

  describe('Device Registration', () => {
    const createMockEvent = (method: string, path: string, body?: any): APIGatewayEvent => ({
      httpMethod: method,
      path,
      pathParameters: null,
      queryStringParameters: null,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : null,
      requestContext: {
        requestId: 'test-request-id',
        identity: { sourceIp: '127.0.0.1' }
      }
    });

    it('should register a new device successfully', async () => {
      const registrationRequest: DeviceRegistrationRequest = {
        deviceToken: mockDeviceToken,
        userId: 'user123',
        bundleId: mockBundleId
      };

      // Mock DynamoDB get (device doesn't exist)
      mockDynamoDBSend.mockResolvedValueOnce({ Item: undefined });

      // Mock SNS create endpoint
      mockSNSSend.mockResolvedValueOnce({ EndpointArn: mockEndpointArn });

      // Mock DynamoDB put
      mockDynamoDBSend.mockResolvedValueOnce({});

      const event = createMockEvent('POST', '/devices', registrationRequest);
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(201);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.success).toBe(true);
      expect(responseBody.platformEndpointArn).toBe(mockEndpointArn);
      expect(responseBody.registrationDate).toBeDefined();

      // Verify SNS create endpoint was called
      expect(mockSNSSend).toHaveBeenCalledWith(
        expect.any(Object)
      );

      // Verify DynamoDB put was called
      expect(mockDynamoDBSend).toHaveBeenCalledWith(
        expect.any(Object)
      );
    });

    it('should update existing device registration', async () => {
      const registrationRequest: DeviceRegistrationRequest = {
        deviceToken: mockDeviceToken,
        userId: 'user123',
        bundleId: mockBundleId
      };

      const existingDevice: iOSDeviceRegistration = {
        deviceToken: mockDeviceToken,
        platformEndpointArn: mockEndpointArn,
        userId: 'user123',
        registrationDate: '2023-01-01T00:00:00.000Z',
        lastUpdated: '2023-01-01T00:00:00.000Z',
        active: true
      };

      // Mock DynamoDB get (device exists)
      mockDynamoDBSend.mockResolvedValueOnce({ 
        Item: marshall(existingDevice)
      });

      // Mock DynamoDB put (update)
      mockDynamoDBSend.mockResolvedValueOnce({});

      const event = createMockEvent('POST', '/devices', registrationRequest);
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.success).toBe(true);
      expect(responseBody.platformEndpointArn).toBe(mockEndpointArn);
    });

    it('should validate device token format', async () => {
      const registrationRequest: DeviceRegistrationRequest = {
        deviceToken: 'invalid-token',
        userId: 'user123',
        bundleId: mockBundleId
      };

      const event = createMockEvent('POST', '/devices', registrationRequest);
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(400);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.error).toContain('Invalid device token format');
    });

    it('should require device token', async () => {
      const registrationRequest = {
        userId: 'user123',
        bundleId: mockBundleId
      };

      const event = createMockEvent('POST', '/devices', registrationRequest);
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(400);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.error).toContain('Device token is required');
    });

    it('should validate bundle ID', async () => {
      const registrationRequest: DeviceRegistrationRequest = {
        deviceToken: mockDeviceToken,
        userId: 'user123',
        bundleId: 'com.wrong.bundle'
      };

      const event = createMockEvent('POST', '/devices', registrationRequest);
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(400);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.error).toContain('Invalid bundle ID');
    });

    it('should handle SNS errors gracefully', async () => {
      const registrationRequest: DeviceRegistrationRequest = {
        deviceToken: mockDeviceToken,
        userId: 'user123',
        bundleId: mockBundleId
      };

      // Mock DynamoDB get (device doesn't exist)
      mockDynamoDBSend.mockResolvedValueOnce({ Item: undefined });

      // Mock SNS create endpoint failure
      mockSNSSend.mockRejectedValueOnce(new Error('SNS service unavailable'));

      const event = createMockEvent('POST', '/devices', registrationRequest);
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(500);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.success).toBe(false);
      expect(responseBody.error).toContain('SNS service unavailable');
    });
  });

  describe('Device Update', () => {
    const createMockEvent = (method: string, path: string, body?: any): APIGatewayEvent => ({
      httpMethod: method,
      path,
      pathParameters: null,
      queryStringParameters: null,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : null,
      requestContext: {
        requestId: 'test-request-id',
        identity: { sourceIp: '127.0.0.1' }
      }
    });

    it('should update device token successfully', async () => {
      const newDeviceToken = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const updateRequest: DeviceUpdateRequest = {
        currentToken: mockDeviceToken,
        newToken: newDeviceToken,
        userId: 'user123'
      };

      const existingDevice: iOSDeviceRegistration = {
        deviceToken: mockDeviceToken,
        platformEndpointArn: mockEndpointArn,
        userId: 'user123',
        registrationDate: '2023-01-01T00:00:00.000Z',
        lastUpdated: '2023-01-01T00:00:00.000Z',
        active: true
      };

      // Mock DynamoDB get (existing device)
      mockDynamoDBSend.mockResolvedValueOnce({ 
        Item: marshall(existingDevice)
      });

      // Mock SNS update endpoint
      mockSNSSend.mockResolvedValueOnce({});

      // Mock DynamoDB delete (old token)
      mockDynamoDBSend.mockResolvedValueOnce({});

      // Mock DynamoDB put (new token)
      mockDynamoDBSend.mockResolvedValueOnce({});

      const event = createMockEvent('PUT', '/devices', updateRequest);
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.success).toBe(true);
      expect(responseBody.platformEndpointArn).toBe(mockEndpointArn);

      // Verify SNS update was called
      expect(mockSNSSend).toHaveBeenCalledWith(
        expect.any(Object)
      );
    });

    it('should return 404 for non-existent device', async () => {
      const updateRequest: DeviceUpdateRequest = {
        currentToken: mockDeviceToken,
        newToken: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        userId: 'user123'
      };

      // Mock DynamoDB get (device doesn't exist)
      mockDynamoDBSend.mockResolvedValueOnce({ Item: undefined });

      const event = createMockEvent('PUT', '/devices', updateRequest);
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(404);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.error).toContain('Device not found');
    });

    it('should validate new device token format', async () => {
      const updateRequest: DeviceUpdateRequest = {
        currentToken: mockDeviceToken,
        newToken: 'invalid-token',
        userId: 'user123'
      };

      const event = createMockEvent('PUT', '/devices', updateRequest);
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(400);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.error).toContain('Invalid device token format');
    });
  });

  describe('Device List', () => {
    const createMockEvent = (method: string, path: string, queryParams?: { [key: string]: string }): APIGatewayEvent => ({
      httpMethod: method,
      path,
      pathParameters: null,
      queryStringParameters: queryParams || null,
      headers: { 'Content-Type': 'application/json' },
      body: null,
      requestContext: {
        requestId: 'test-request-id',
        identity: { sourceIp: '127.0.0.1' }
      }
    });

    it('should list user devices successfully', async () => {
      const mockDevices: iOSDeviceRegistration[] = [
        {
          deviceToken: mockDeviceToken,
          platformEndpointArn: mockEndpointArn,
          userId: 'user123',
          registrationDate: '2023-01-01T00:00:00.000Z',
          lastUpdated: '2023-01-01T00:00:00.000Z',
          active: true
        }
      ];

      // Mock DynamoDB scan
      mockDynamoDBSend.mockResolvedValueOnce({
        Items: mockDevices.map(device => marshall(device))
      });

      const event = createMockEvent('GET', '/devices', { userId: 'user123' });
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.success).toBe(true);
      expect(responseBody.devices).toHaveLength(1);
      expect(responseBody.devices[0].deviceToken).toBe(mockDeviceToken);
    });

    it('should require userId parameter', async () => {
      const event = createMockEvent('GET', '/devices');
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(400);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.error).toContain('userId query parameter is required');
    });

    it('should handle pagination', async () => {
      const mockDevices: iOSDeviceRegistration[] = [
        {
          deviceToken: mockDeviceToken,
          platformEndpointArn: mockEndpointArn,
          userId: 'user123',
          registrationDate: '2023-01-01T00:00:00.000Z',
          lastUpdated: '2023-01-01T00:00:00.000Z',
          active: true
        }
      ];

      const mockLastEvaluatedKey = { deviceToken: { S: mockDeviceToken } };

      // Mock DynamoDB scan with pagination
      mockDynamoDBSend.mockResolvedValueOnce({
        Items: mockDevices.map(device => marshall(device)),
        LastEvaluatedKey: mockLastEvaluatedKey
      });

      const event = createMockEvent('GET', '/devices', { 
        userId: 'user123',
        limit: '5'
      });
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.success).toBe(true);
      expect(responseBody.devices).toHaveLength(1);
      expect(responseBody.nextToken).toBeDefined();
    });
  });

  describe('Device Deletion', () => {
    const createMockEvent = (method: string, path: string, pathParams?: { [key: string]: string }): APIGatewayEvent => ({
      httpMethod: method,
      path,
      pathParameters: pathParams || null,
      queryStringParameters: null,
      headers: { 'Content-Type': 'application/json' },
      body: null,
      requestContext: {
        requestId: 'test-request-id',
        identity: { sourceIp: '127.0.0.1' }
      }
    });

    it('should delete device successfully', async () => {
      const existingDevice: iOSDeviceRegistration = {
        deviceToken: mockDeviceToken,
        platformEndpointArn: mockEndpointArn,
        userId: 'user123',
        registrationDate: '2023-01-01T00:00:00.000Z',
        lastUpdated: '2023-01-01T00:00:00.000Z',
        active: true
      };

      // Mock DynamoDB get (existing device)
      mockDynamoDBSend.mockResolvedValueOnce({ 
        Item: marshall(existingDevice)
      });

      // Mock SNS delete endpoint
      mockSNSSend.mockResolvedValueOnce({});

      // Mock DynamoDB delete
      mockDynamoDBSend.mockResolvedValueOnce({});

      const event = createMockEvent('DELETE', `/devices/${mockDeviceToken}`, { 
        deviceToken: mockDeviceToken 
      });
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.success).toBe(true);
      expect(responseBody.deletedAt).toBeDefined();

      // Verify SNS delete was called
      expect(mockSNSSend).toHaveBeenCalledWith(
        expect.any(Object)
      );
    });

    it('should return 404 for non-existent device', async () => {
      // Mock DynamoDB get (device doesn't exist)
      mockDynamoDBSend.mockResolvedValueOnce({ Item: undefined });

      const event = createMockEvent('DELETE', `/devices/${mockDeviceToken}`, { 
        deviceToken: mockDeviceToken 
      });
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(404);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.error).toContain('Device not found');
    });

    it('should require device token parameter', async () => {
      const event = createMockEvent('DELETE', '/devices/');
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(400);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.error).toContain('Device token path parameter is required');
    });

    it('should handle URL-encoded device tokens', async () => {
      const encodedToken = encodeURIComponent(mockDeviceToken);
      
      const existingDevice: iOSDeviceRegistration = {
        deviceToken: mockDeviceToken,
        platformEndpointArn: mockEndpointArn,
        userId: 'user123',
        registrationDate: '2023-01-01T00:00:00.000Z',
        lastUpdated: '2023-01-01T00:00:00.000Z',
        active: true
      };

      // Mock DynamoDB get (existing device)
      mockDynamoDBSend.mockResolvedValueOnce({ 
        Item: marshall(existingDevice)
      });

      // Mock SNS delete endpoint
      mockSNSSend.mockResolvedValueOnce({});

      // Mock DynamoDB delete
      mockDynamoDBSend.mockResolvedValueOnce({});

      const event = createMockEvent('DELETE', `/devices/${encodedToken}`, { 
        deviceToken: encodedToken 
      });
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(200);
    });

    it('should continue if SNS endpoint deletion fails', async () => {
      const existingDevice: iOSDeviceRegistration = {
        deviceToken: mockDeviceToken,
        platformEndpointArn: mockEndpointArn,
        userId: 'user123',
        registrationDate: '2023-01-01T00:00:00.000Z',
        lastUpdated: '2023-01-01T00:00:00.000Z',
        active: true
      };

      // Mock DynamoDB get (existing device)
      mockDynamoDBSend.mockResolvedValueOnce({ 
        Item: marshall(existingDevice)
      });

      // Mock SNS delete endpoint failure (should not fail the operation)
      mockSNSSend.mockRejectedValueOnce(new Error('Endpoint not found'));

      // Mock DynamoDB delete (should still succeed)
      mockDynamoDBSend.mockResolvedValueOnce({});

      const event = createMockEvent('DELETE', `/devices/${mockDeviceToken}`, { 
        deviceToken: mockDeviceToken 
      });
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.success).toBe(true);
    });
  });

  describe('CORS and Options', () => {
    const createMockEvent = (method: string, path: string): APIGatewayEvent => ({
      httpMethod: method,
      path,
      pathParameters: null,
      queryStringParameters: null,
      headers: { 'Content-Type': 'application/json' },
      body: null,
      requestContext: {
        requestId: 'test-request-id',
        identity: { sourceIp: '127.0.0.1' }
      }
    });

    it('should handle OPTIONS requests for CORS', async () => {
      const event = createMockEvent('OPTIONS', '/devices');
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(200);
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(response.headers['Access-Control-Allow-Methods']).toContain('POST');
      expect(response.headers['Access-Control-Allow-Headers']).toContain('Content-Type');
    });

    it('should include CORS headers in all responses', async () => {
      const event = createMockEvent('POST', '/devices');
      const response = await handler.handleRequest(event);

      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
    });

    it('should return 404 for unknown paths', async () => {
      const event = createMockEvent('GET', '/unknown');
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(404);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.error).toBe('Not Found');
    });
  });

  describe('Error Handling', () => {
    const createMockEvent = (method: string, path: string, body?: any): APIGatewayEvent => ({
      httpMethod: method,
      path,
      pathParameters: null,
      queryStringParameters: null,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : null,
      requestContext: {
        requestId: 'test-request-id',
        identity: { sourceIp: '127.0.0.1' }
      }
    });

    it('should handle malformed JSON in request body', async () => {
      const event: APIGatewayEvent = {
        httpMethod: 'POST',
        path: '/devices',
        pathParameters: null,
        queryStringParameters: null,
        headers: { 'Content-Type': 'application/json' },
        body: '{ invalid json',
        requestContext: {
          requestId: 'test-request-id',
          identity: { sourceIp: '127.0.0.1' }
        }
      };

      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(500);
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
    });

    it('should handle DynamoDB errors gracefully', async () => {
      const registrationRequest: DeviceRegistrationRequest = {
        deviceToken: mockDeviceToken,
        userId: 'user123',
        bundleId: mockBundleId
      };

      // Mock DynamoDB get failure
      mockDynamoDBSend.mockRejectedValueOnce(new Error('DynamoDB service unavailable'));

      const event = createMockEvent('POST', '/devices', registrationRequest);
      const response = await handler.handleRequest(event);

      expect(response.statusCode).toBe(500);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.success).toBe(false);
      expect(responseBody.error).toContain('DynamoDB service unavailable');
    });
  });
});