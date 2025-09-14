import { iOSManagementTool } from '../src/tools/ios-management-tool';
import { iOSPushConfig } from '../src/types';
import { ValidationError } from '../src/validation';
import { SNSClient, CreatePlatformEndpointCommand, DeleteEndpointCommand, GetEndpointAttributesCommand, SetEndpointAttributesCommand } from '@aws-sdk/client-sns';

// Mock AWS SDK
jest.mock('@aws-sdk/client-sns');

const mockSNSClient = {
  send: jest.fn()
};

(SNSClient as jest.Mock).mockImplementation(() => mockSNSClient);

describe('iOSManagementTool', () => {
  let tool: iOSManagementTool;
  let mockConfig: iOSPushConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockConfig = {
      platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp',
      bundleId: 'com.example.spendmonitor',
      sandbox: true
    };

    tool = new iOSManagementTool(mockConfig, 'us-east-1');
  });

  describe('registerDevice', () => {
    const validDeviceToken = 'a'.repeat(64);
    const mockEndpointArn = 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/12345678-1234-1234-1234-123456789012';

    it('should successfully register a new device', async () => {
      mockSNSClient.send.mockResolvedValueOnce({
        EndpointArn: mockEndpointArn
      });

      const result = await tool.registerDevice(validDeviceToken, 'user123');

      expect(mockSNSClient.send).toHaveBeenCalledWith(
        expect.any(CreatePlatformEndpointCommand)
      );

      expect(result).toEqual({
        deviceToken: validDeviceToken,
        platformEndpointArn: mockEndpointArn,
        userId: 'user123',
        registrationDate: expect.any(String),
        lastUpdated: expect.any(String),
        active: true
      });

      // Verify dates are valid ISO strings
      expect(new Date(result.registrationDate).toISOString()).toBe(result.registrationDate);
      expect(new Date(result.lastUpdated).toISOString()).toBe(result.lastUpdated);
    });

    it('should register device without userId', async () => {
      mockSNSClient.send.mockResolvedValueOnce({
        EndpointArn: mockEndpointArn
      });

      const result = await tool.registerDevice(validDeviceToken);

      expect(result.userId).toBeUndefined();
      expect(result.deviceToken).toBe(validDeviceToken);
    });

    it('should throw error for invalid device token format', async () => {
      const invalidToken = 'invalid-token';

      await expect(tool.registerDevice(invalidToken)).rejects.toThrow(ValidationError);
      await expect(tool.registerDevice(invalidToken)).rejects.toThrow('Invalid device token format');
      
      expect(mockSNSClient.send).not.toHaveBeenCalled();
    });

    it('should throw error for short device token', async () => {
      const shortToken = 'a'.repeat(32); // Too short

      await expect(tool.registerDevice(shortToken)).rejects.toThrow(ValidationError);
      expect(mockSNSClient.send).not.toHaveBeenCalled();
    });

    it('should throw error for long device token', async () => {
      const longToken = 'a'.repeat(128); // Too long

      await expect(tool.registerDevice(longToken)).rejects.toThrow(ValidationError);
      expect(mockSNSClient.send).not.toHaveBeenCalled();
    });

    it('should throw error when SNS fails to create endpoint', async () => {
      mockSNSClient.send.mockRejectedValueOnce(new Error('SNS Error'));

      await expect(tool.registerDevice(validDeviceToken)).rejects.toThrow('SNS Error');
    });

    it('should throw error when no endpoint ARN is returned', async () => {
      mockSNSClient.send.mockResolvedValueOnce({}); // No EndpointArn

      await expect(tool.registerDevice(validDeviceToken)).rejects.toThrow('Failed to create platform endpoint - no ARN returned');
    });
  });

  describe('updateDeviceToken', () => {
    const validDeviceToken = 'b'.repeat(64);
    const mockEndpointArn = 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/12345678-1234-1234-1234-123456789012';

    it('should successfully update device token', async () => {
      mockSNSClient.send.mockResolvedValueOnce({});

      await tool.updateDeviceToken(mockEndpointArn, validDeviceToken);

      expect(mockSNSClient.send).toHaveBeenCalledWith(
        expect.any(SetEndpointAttributesCommand)
      );

      const call = mockSNSClient.send.mock.calls[0][0];
      expect(call.input).toEqual({
        EndpointArn: mockEndpointArn,
        Attributes: {
          Token: validDeviceToken,
          Enabled: 'true'
        }
      });
    });

    it('should throw error for invalid device token format', async () => {
      const invalidToken = 'invalid-token';

      await expect(tool.updateDeviceToken(mockEndpointArn, invalidToken)).rejects.toThrow(ValidationError);
      expect(mockSNSClient.send).not.toHaveBeenCalled();
    });

    it('should throw error when SNS update fails', async () => {
      mockSNSClient.send.mockRejectedValueOnce(new Error('Update failed'));

      await expect(tool.updateDeviceToken(mockEndpointArn, validDeviceToken)).rejects.toThrow('Update failed');
    });
  });

  describe('removeInvalidTokens', () => {
    const mockEndpointArns = [
      'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/endpoint1',
      'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/endpoint2',
      'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/endpoint3'
    ];

    it('should remove disabled endpoints', async () => {
      // Mock responses for GetEndpointAttributes
      mockSNSClient.send
        .mockResolvedValueOnce({
          Attributes: { Enabled: 'false', Token: 'a'.repeat(64) }
        })
        .mockResolvedValueOnce({
          Attributes: { Enabled: 'true', Token: 'b'.repeat(64) }
        })
        .mockResolvedValueOnce({
          Attributes: { Enabled: 'false', Token: 'c'.repeat(64) }
        })
        // Mock DeleteEndpoint responses
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const removedEndpoints = await tool.removeInvalidTokens(mockEndpointArns);

      expect(removedEndpoints).toEqual([mockEndpointArns[0], mockEndpointArns[2]]);
      expect(mockSNSClient.send).toHaveBeenCalledTimes(5); // 3 gets + 2 deletes
    });

    it('should remove endpoints with invalid tokens', async () => {
      mockSNSClient.send
        .mockResolvedValueOnce({
          Attributes: { Enabled: 'true', Token: 'invalid-token' }
        })
        .mockResolvedValueOnce({
          Attributes: { Enabled: 'true', Token: 'b'.repeat(64) }
        })
        // Mock DeleteEndpoint response
        .mockResolvedValueOnce({});

      const removedEndpoints = await tool.removeInvalidTokens([mockEndpointArns[0], mockEndpointArns[1]]);

      expect(removedEndpoints).toEqual([mockEndpointArns[0]]);
    });

    it('should remove endpoints that fail to get attributes', async () => {
      mockSNSClient.send
        .mockRejectedValueOnce(new Error('Endpoint not found'))
        .mockResolvedValueOnce({
          Attributes: { Enabled: 'true', Token: 'b'.repeat(64) }
        })
        // Mock DeleteEndpoint response
        .mockResolvedValueOnce({});

      const removedEndpoints = await tool.removeInvalidTokens([mockEndpointArns[0], mockEndpointArns[1]]);

      expect(removedEndpoints).toEqual([mockEndpointArns[0]]);
    });

    it('should handle delete failures gracefully', async () => {
      mockSNSClient.send
        .mockResolvedValueOnce({
          Attributes: { Enabled: 'false', Token: 'a'.repeat(64) }
        })
        // Mock DeleteEndpoint failure
        .mockRejectedValueOnce(new Error('Delete failed'));

      const removedEndpoints = await tool.removeInvalidTokens([mockEndpointArns[0]]);

      expect(removedEndpoints).toEqual([]); // Should not include failed deletes
    });

    it('should return empty array when no endpoints need removal', async () => {
      mockSNSClient.send
        .mockResolvedValueOnce({
          Attributes: { Enabled: 'true', Token: 'a'.repeat(64) }
        })
        .mockResolvedValueOnce({
          Attributes: { Enabled: 'true', Token: 'b'.repeat(64) }
        });

      const removedEndpoints = await tool.removeInvalidTokens([mockEndpointArns[0], mockEndpointArns[1]]);

      expect(removedEndpoints).toEqual([]);
      expect(mockSNSClient.send).toHaveBeenCalledTimes(2); // Only get calls, no deletes
    });
  });

  describe('validateAPNSConfig', () => {
    it('should return true for valid APNS configuration', async () => {
      const mockEndpointArn = 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/test-endpoint';
      
      mockSNSClient.send
        .mockResolvedValueOnce({ EndpointArn: mockEndpointArn }) // CreatePlatformEndpoint
        .mockResolvedValueOnce({}); // DeleteEndpoint

      const isValid = await tool.validateAPNSConfig();

      expect(isValid).toBe(true);
      expect(mockSNSClient.send).toHaveBeenCalledTimes(2);
    });

    it('should return false when platform application is invalid', async () => {
      mockSNSClient.send.mockRejectedValueOnce(new Error('Invalid platform application'));

      const isValid = await tool.validateAPNSConfig();

      expect(isValid).toBe(false);
    });

    it('should handle missing endpoint ARN in response', async () => {
      mockSNSClient.send.mockResolvedValueOnce({}); // No EndpointArn

      const isValid = await tool.validateAPNSConfig();

      expect(isValid).toBe(true); // Should still be considered valid
      expect(mockSNSClient.send).toHaveBeenCalledTimes(1); // No delete call
    });
  });

  describe('createPlatformEndpoint', () => {
    const validDeviceToken = 'c'.repeat(64);
    const mockEndpointArn = 'arn:aws:sns:us-east-1:123456789012:endpoint/APNS/TestApp/new-endpoint';

    it('should successfully create platform endpoint', async () => {
      mockSNSClient.send.mockResolvedValueOnce({
        EndpointArn: mockEndpointArn
      });

      const result = await tool.createPlatformEndpoint(validDeviceToken, 'custom-data');

      expect(result).toBe(mockEndpointArn);
      expect(mockSNSClient.send).toHaveBeenCalledWith(
        expect.any(CreatePlatformEndpointCommand)
      );

      const call = mockSNSClient.send.mock.calls[0][0];
      expect(call.input).toEqual({
        PlatformApplicationArn: mockConfig.platformApplicationArn,
        Token: validDeviceToken,
        CustomUserData: 'custom-data'
      });
    });

    it('should create endpoint without custom user data', async () => {
      mockSNSClient.send.mockResolvedValueOnce({
        EndpointArn: mockEndpointArn
      });

      const result = await tool.createPlatformEndpoint(validDeviceToken);

      expect(result).toBe(mockEndpointArn);
      
      const call = mockSNSClient.send.mock.calls[0][0];
      expect(call.input.CustomUserData).toBeUndefined();
    });

    it('should throw error for invalid device token', async () => {
      const invalidToken = 'invalid';

      await expect(tool.createPlatformEndpoint(invalidToken)).rejects.toThrow(ValidationError);
      expect(mockSNSClient.send).not.toHaveBeenCalled();
    });

    it('should throw error when no endpoint ARN is returned', async () => {
      mockSNSClient.send.mockResolvedValueOnce({});

      await expect(tool.createPlatformEndpoint(validDeviceToken)).rejects.toThrow('Failed to create platform endpoint - no ARN returned');
    });
  });

  describe('configuration management', () => {
    it('should return current configuration', () => {
      const config = tool.getConfig();

      expect(config).toEqual(mockConfig);
      expect(config).not.toBe(mockConfig); // Should be a copy
    });

    it('should update configuration', () => {
      const updates = {
        sandbox: false,
        bundleId: 'com.example.newapp'
      };

      tool.updateConfig(updates);
      const updatedConfig = tool.getConfig();

      expect(updatedConfig).toEqual({
        ...mockConfig,
        ...updates
      });
    });

    it('should not modify original config when updating', () => {
      const originalConfig = { ...mockConfig };
      
      tool.updateConfig({ sandbox: false });

      expect(mockConfig).toEqual(originalConfig);
    });
  });

  describe('device token validation', () => {
    it('should accept valid 64-character hex tokens', () => {
      const validTokens = [
        'a'.repeat(64),
        'A'.repeat(64),
        '0'.repeat(64),
        'f'.repeat(64),
        'F'.repeat(64),
        '1234567890abcdefABCDEF1234567890abcdefABCDEF1234567890abcdefABCD'
      ];

      for (const token of validTokens) {
        expect(() => tool['isValidDeviceToken'](token)).not.toThrow();
        expect(tool['isValidDeviceToken'](token)).toBe(true);
      }
    });

    it('should reject invalid tokens', () => {
      const invalidTokens = [
        '', // Empty
        'short', // Too short
        'g'.repeat(64), // Invalid hex character
        '!'.repeat(64), // Invalid character
        'a'.repeat(63), // One character short
        'a'.repeat(65), // One character too long
        'a'.repeat(32), // Half length
        'hello world', // Completely invalid
      ];

      for (const token of invalidTokens) {
        expect(tool['isValidDeviceToken'](token)).toBe(false);
      }
    });
  });
});