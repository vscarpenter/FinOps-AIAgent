/**
 * iOS Notification Validation Unit Tests
 * 
 * These tests focus on APNS payload validation, device token validation,
 * and iOS-specific notification formatting without requiring AWS services.
 */

import { 
  APNSPayloadValidator,
  TestDeviceTokenGenerator,
  APNSSandboxHelper,
  MockAPNSFeedbackService
} from './utils/ios-test-utils';
import { AlertTool } from '../src/tools/alert-tool';
import { APNSPayload, CostAnalysis, AlertContext, ServiceCost } from '../src/types';

describe('iOS Notification Validation', () => {
  let alertTool: AlertTool;

  beforeEach(() => {
    alertTool = new AlertTool();
    
    // Mock the logger to avoid console output during tests
    (alertTool as any).logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };
  });

  describe('APNS Payload Validation', () => {
    describe('Valid Payload Structure', () => {
      it('should validate a correctly structured APNS payload', () => {
        const payload = APNSPayloadValidator.createTestPayload();
        const result = APNSPayloadValidator.validatePayload(payload);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.payloadSize).toBeDefined();
        expect(result.payloadSize).toBeLessThan(4096);
      });

      it('should validate payload with minimal required fields', () => {
        const minimalPayload: APNSPayload = {
          aps: {
            alert: {
              title: 'Test',
              body: 'Test message'
            },
            badge: 0,
            sound: 'default',
            'content-available': 1
          },
          customData: {
            spendAmount: 10.00,
            threshold: 5.00,
            exceedAmount: 5.00,
            topService: 'EC2',
            alertId: 'test-123'
          }
        };

        const result = APNSPayloadValidator.validatePayload(minimalPayload);
        expect(result.isValid).toBe(true);
      });

      it('should validate payload with optional subtitle', () => {
        const payloadWithSubtitle = APNSPayloadValidator.createTestPayload({
          aps: {
            alert: {
              title: 'Test Alert',
              body: 'Test message',
              subtitle: 'Critical Alert'
            },
            badge: 1,
            sound: 'default',
            'content-available': 1
          }
        });

        const result = APNSPayloadValidator.validatePayload(payloadWithSubtitle);
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });
    });

    describe('Invalid Payload Structure', () => {
      it('should detect missing aps field', () => {
        const invalidPayload = APNSPayloadValidator.createInvalidPayload('missing-aps');
        const result = APNSPayloadValidator.validatePayload(invalidPayload);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Missing required "aps" field');
      });

      it('should detect missing alert field', () => {
        const invalidPayload = APNSPayloadValidator.createInvalidPayload('missing-alert');
        const result = APNSPayloadValidator.validatePayload(invalidPayload);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Missing required "aps.alert" field');
      });

      it('should detect invalid badge value', () => {
        const invalidPayload = APNSPayloadValidator.createInvalidPayload('invalid-badge');
        const result = APNSPayloadValidator.validatePayload(invalidPayload);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => error.includes('Invalid "aps.badge"'))).toBe(true);
      });

      it('should detect missing alert title', () => {
        const payload = APNSPayloadValidator.createTestPayload();
        (payload.aps.alert as any).title = undefined;

        const result = APNSPayloadValidator.validatePayload(payload);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => error.includes('aps.alert.title'))).toBe(true);
      });

      it('should detect missing alert body', () => {
        const payload = APNSPayloadValidator.createTestPayload();
        (payload.aps.alert as any).body = undefined;

        const result = APNSPayloadValidator.validatePayload(payload);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => error.includes('aps.alert.body'))).toBe(true);
      });

      it('should detect missing sound field', () => {
        const payload = APNSPayloadValidator.createTestPayload();
        (payload.aps as any).sound = undefined;

        const result = APNSPayloadValidator.validatePayload(payload);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => error.includes('aps.sound'))).toBe(true);
      });
    });

    describe('Payload Size Validation', () => {
      it('should detect oversized payloads', () => {
        const oversizedPayload = APNSPayloadValidator.createInvalidPayload('oversized');
        const result = APNSPayloadValidator.validatePayload(oversizedPayload);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => error.includes('exceeds APNS limit'))).toBe(true);
        expect(result.payloadSize).toBeGreaterThan(4096);
      });

      it('should warn about payloads approaching size limit', () => {
        const largePayload = APNSPayloadValidator.createTestPayload({
          customData: {
            spendAmount: 999.99,
            threshold: 100.00,
            exceedAmount: 899.99,
            topService: 'Amazon Elastic Compute Cloud - Compute',
            alertId: 'x'.repeat(3000) // Make it large but under limit
          }
        });

        const result = APNSPayloadValidator.validatePayload(largePayload);
        
        if (result.payloadSize && result.payloadSize > 3500) {
          expect(result.warnings.some(warning => warning.includes('close to APNS limit'))).toBe(true);
        }
      });

      it('should calculate payload size correctly', () => {
        const payload = APNSPayloadValidator.createTestPayload();
        const result = APNSPayloadValidator.validatePayload(payload);
        
        const actualSize = JSON.stringify(payload).length;
        expect(result.payloadSize).toBe(actualSize);
      });
    });

    describe('Content Length Validation', () => {
      it('should warn about long alert titles', () => {
        const payload = APNSPayloadValidator.createTestPayload({
          aps: {
            alert: {
              title: 'x'.repeat(150), // Exceeds recommended 100 chars
              body: 'Test message'
            },
            badge: 1,
            sound: 'default',
            'content-available': 1
          }
        });

        const result = APNSPayloadValidator.validatePayload(payload);
        expect(result.warnings.some(warning => warning.includes('title exceeds'))).toBe(true);
      });

      it('should warn about long alert bodies', () => {
        const payload = APNSPayloadValidator.createTestPayload({
          aps: {
            alert: {
              title: 'Test Alert',
              body: 'x'.repeat(250) // Exceeds recommended 200 chars
            },
            badge: 1,
            sound: 'default',
            'content-available': 1
          }
        });

        const result = APNSPayloadValidator.validatePayload(payload);
        expect(result.warnings.some(warning => warning.includes('body exceeds'))).toBe(true);
      });

      it('should warn about long subtitles', () => {
        const payload = APNSPayloadValidator.createTestPayload({
          aps: {
            alert: {
              title: 'Test Alert',
              body: 'Test message',
              subtitle: 'x'.repeat(150) // Exceeds recommended 100 chars
            },
            badge: 1,
            sound: 'default',
            'content-available': 1
          }
        });

        const result = APNSPayloadValidator.validatePayload(payload);
        expect(result.warnings.some(warning => warning.includes('subtitle exceeds'))).toBe(true);
      });
    });

    describe('Custom Data Validation', () => {
      it('should validate required custom data fields', () => {
        const payload = APNSPayloadValidator.createTestPayload();
        delete (payload.customData as any).spendAmount;

        const result = APNSPayloadValidator.validatePayload(payload);
        expect(result.warnings.some(warning => warning.includes('customData.spendAmount'))).toBe(true);
      });

      it('should validate custom data field types', () => {
        const payload = APNSPayloadValidator.createTestPayload();
        (payload.customData as any).spendAmount = 'invalid';

        const result = APNSPayloadValidator.validatePayload(payload);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => error.includes('Invalid customData.spendAmount'))).toBe(true);
      });

      it('should validate negative values in custom data', () => {
        const payload = APNSPayloadValidator.createTestPayload({
          customData: {
            spendAmount: -10.00,
            threshold: -5.00,
            exceedAmount: -5.00,
            topService: 'EC2',
            alertId: 'test'
          }
        });

        const result = APNSPayloadValidator.validatePayload(payload);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Sandbox Validation', () => {
    it('should validate payload for sandbox environment', () => {
      const payload = APNSPayloadValidator.createTestPayload();
      const result = APNSPayloadValidator.validateForSandbox(payload);

      expect(result.isValid).toBe(true);
    });

    it('should warn about custom sounds in sandbox', () => {
      const payload = APNSPayloadValidator.createTestPayload({
        aps: {
          alert: {
            title: 'Test Alert',
            body: 'Test message'
          },
          badge: 1,
          sound: 'custom-sound.caf',
          'content-available': 1
        }
      });

      const result = APNSPayloadValidator.validateForSandbox(payload);
      expect(result.warnings.some(warning => warning.includes('Custom sound files'))).toBe(true);
    });

    it('should accept default and critical sounds in sandbox', () => {
      const defaultSoundPayload = APNSPayloadValidator.createTestPayload({
        aps: {
          alert: {
            title: 'Test Alert',
            body: 'Test message'
          },
          badge: 1,
          sound: 'default',
          'content-available': 1
        }
      });
      
      const criticalSoundPayload = APNSPayloadValidator.createTestPayload({
        aps: {
          alert: {
            title: 'Test Alert',
            body: 'Test message'
          },
          badge: 1,
          sound: 'critical-alert.caf',
          'content-available': 1
        }
      });

      const defaultResult = APNSPayloadValidator.validateForSandbox(defaultSoundPayload);
      const criticalResult = APNSPayloadValidator.validateForSandbox(criticalSoundPayload);

      expect(defaultResult.warnings.some(w => w.includes('Custom sound'))).toBe(false);
      expect(criticalResult.warnings.some(w => w.includes('Custom sound'))).toBe(false);
    });
  });

  describe('Device Token Validation', () => {
    describe('Valid Token Formats', () => {
      it('should validate correct 64-character hex tokens', () => {
        const validTokens = [
          TestDeviceTokenGenerator.generateValidToken(),
          '0123456789abcdefABCDEF0123456789abcdefABCDEF0123456789abcdefABCD',
          'a'.repeat(64),
          'A'.repeat(64),
          '0'.repeat(64),
          'f'.repeat(64)
        ];

        for (const token of validTokens) {
          const result = TestDeviceTokenGenerator.validateToken(token);
          expect(result.isValid).toBe(true);
          expect(result.error).toBeUndefined();
        }
      });

      it('should generate unique valid tokens', () => {
        const tokens = TestDeviceTokenGenerator.generateValidTokens(10);
        
        expect(tokens).toHaveLength(10);
        
        // Check all tokens are unique
        const uniqueTokens = new Set(tokens);
        expect(uniqueTokens.size).toBe(10);
        
        // Check all tokens are valid
        for (const token of tokens) {
          const result = TestDeviceTokenGenerator.validateToken(token);
          expect(result.isValid).toBe(true);
        }
      });
    });

    describe('Invalid Token Formats', () => {
      it('should detect empty tokens', () => {
        const result = TestDeviceTokenGenerator.validateToken('');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('empty');
      });

      it('should detect tokens that are too short', () => {
        const shortToken = TestDeviceTokenGenerator.generateInvalidToken('too-short');
        const result = TestDeviceTokenGenerator.validateToken(shortToken);
        
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('length');
      });

      it('should detect tokens that are too long', () => {
        const longToken = TestDeviceTokenGenerator.generateInvalidToken('too-long');
        const result = TestDeviceTokenGenerator.validateToken(longToken);
        
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('length');
      });

      it('should detect tokens with invalid characters', () => {
        const invalidToken = TestDeviceTokenGenerator.generateInvalidToken('invalid-chars');
        const result = TestDeviceTokenGenerator.validateToken(invalidToken);
        
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('invalid characters');
      });

      it('should provide specific error messages for different invalid formats', () => {
        const testCases = [
          { token: '', expectedError: 'empty' },
          { token: 'short', expectedError: 'length' },
          { token: 'g'.repeat(64), expectedError: 'invalid characters' },
          { token: '!@#$'.repeat(16), expectedError: 'invalid characters' }
        ];

        for (const { token, expectedError } of testCases) {
          const result = TestDeviceTokenGenerator.validateToken(token);
          expect(result.isValid).toBe(false);
          expect(result.error?.toLowerCase()).toContain(expectedError);
        }
      });
    });
  });

  describe('iOS Payload Formatting by AlertTool', () => {
    let mockCostAnalysis: CostAnalysis;
    let mockAlertContext: AlertContext;
    let mockTopServices: ServiceCost[];

    beforeEach(() => {
      mockCostAnalysis = {
        totalCost: 15.50,
        serviceBreakdown: {
          'EC2': 10.00,
          'S3': 3.50,
          'Lambda': 2.00
        },
        period: {
          start: '2023-01-01T00:00:00.000Z',
          end: '2023-01-15T23:59:59.999Z'
        },
        projectedMonthly: 31.00,
        currency: 'USD',
        lastUpdated: '2023-01-15T12:00:00.000Z'
      };

      mockTopServices = [
        { serviceName: 'EC2', cost: 10.00, percentage: 64.5 },
        { serviceName: 'S3', cost: 3.50, percentage: 22.6 },
        { serviceName: 'Lambda', cost: 2.00, percentage: 12.9 }
      ];

      mockAlertContext = {
        threshold: 10.00,
        exceedAmount: 5.50,
        percentageOver: 55.0,
        topServices: mockTopServices,
        alertLevel: 'CRITICAL'
      };
    });

    it('should format iOS payload with correct structure', () => {
      const iosPayload = alertTool.formatIOSPayload(mockCostAnalysis, mockAlertContext);

      expect(iosPayload).toMatchObject({
        aps: {
          alert: {
            title: expect.any(String),
            body: expect.any(String),
            subtitle: expect.any(String)
          },
          badge: expect.any(Number),
          sound: expect.any(String),
          'content-available': 1
        },
        customData: {
          spendAmount: mockCostAnalysis.totalCost,
          threshold: mockAlertContext.threshold,
          exceedAmount: mockAlertContext.exceedAmount,
          topService: expect.any(String),
          alertId: expect.stringMatching(/^spend-alert-\d+$/)
        }
      });
    });

    it('should format different alert levels correctly', () => {
      const warningContext = { ...mockAlertContext, alertLevel: 'WARNING' as const };
      const criticalContext = { ...mockAlertContext, alertLevel: 'CRITICAL' as const };

      const warningPayload = alertTool.formatIOSPayload(mockCostAnalysis, warningContext);
      const criticalPayload = alertTool.formatIOSPayload(mockCostAnalysis, criticalContext);

      expect(warningPayload.aps.alert.subtitle).toBe('Budget Threshold Exceeded');
      expect(warningPayload.aps.sound).toBe('default');

      expect(criticalPayload.aps.alert.subtitle).toBe('Critical Budget Exceeded');
      expect(criticalPayload.aps.sound).toBe('critical-alert.caf');
    });

    it('should handle missing top services gracefully', () => {
      const contextWithoutServices = { ...mockAlertContext, topServices: [] };
      const iosPayload = alertTool.formatIOSPayload(mockCostAnalysis, contextWithoutServices);

      expect(iosPayload.customData.topService).toBe('Unknown');
    });

    it('should generate unique alert IDs', async () => {
      const payload1 = alertTool.formatIOSPayload(mockCostAnalysis, mockAlertContext);
      
      // Add a small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 1));
      
      const payload2 = alertTool.formatIOSPayload(mockCostAnalysis, mockAlertContext);

      expect(payload1.customData.alertId).not.toBe(payload2.customData.alertId);
    });

    it('should create APNS-compliant payloads', () => {
      const iosPayload = alertTool.formatIOSPayload(mockCostAnalysis, mockAlertContext);
      const validation = APNSPayloadValidator.validatePayload(iosPayload);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should format alert content appropriately', () => {
      const iosPayload = alertTool.formatIOSPayload(mockCostAnalysis, mockAlertContext);

      expect(iosPayload.aps.alert.title).toBe('AWS Spend Alert');
      expect(iosPayload.aps.alert.body).toContain('$15.50 spent');
      expect(iosPayload.aps.alert.body).toContain('$5.50 over budget');
      expect(iosPayload.aps.badge).toBe(1);
    });
  });

  describe('Sandbox Configuration Helper', () => {
    it('should create valid sandbox configuration', () => {
      const platformArn = 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp';
      const config = APNSSandboxHelper.createSandboxConfig(platformArn);

      expect(config).toEqual({
        platformApplicationArn: platformArn,
        bundleId: 'com.example.spendmonitor.test',
        sandbox: true
      });
    });

    it('should validate sandbox configuration correctly', () => {
      const validConfig = {
        platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp',
        bundleId: 'com.example.spendmonitor.test',
        sandbox: true
      };

      const result = APNSSandboxHelper.validateSandboxConfiguration(validConfig);
      expect(result.isValid).toBe(true);
    });

    it('should warn about non-sandbox configuration', () => {
      const prodConfig = {
        platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/ProdApp',
        bundleId: 'com.example.spendmonitor',
        sandbox: false
      };

      const result = APNSSandboxHelper.validateSandboxConfiguration(prodConfig);
      expect(result.warnings.some(w => w.includes('not set for sandbox'))).toBe(true);
    });

    it('should create comprehensive test scenarios', () => {
      const scenarios = APNSSandboxHelper.createTestScenarios();

      expect(scenarios.length).toBeGreaterThan(0);
      
      for (const scenario of scenarios) {
        expect(scenario).toMatchObject({
          name: expect.any(String),
          payload: expect.any(Object),
          expectedResult: expect.stringMatching(/^(success|error|warning)$/)
        });
      }
    });
  });

  describe('Mock APNS Feedback Service', () => {
    let feedbackService: MockAPNSFeedbackService;

    beforeEach(() => {
      feedbackService = new MockAPNSFeedbackService();
    });

    it('should track invalid tokens', () => {
      const token1 = TestDeviceTokenGenerator.generateValidToken();
      const token2 = TestDeviceTokenGenerator.generateValidToken();

      feedbackService.markTokenAsInvalid(token1);
      
      expect(feedbackService.isTokenInvalid(token1)).toBe(true);
      expect(feedbackService.isTokenInvalid(token2)).toBe(false);
    });

    it('should return list of invalid tokens', () => {
      const tokens = TestDeviceTokenGenerator.generateValidTokens(3);
      
      tokens.forEach(token => feedbackService.markTokenAsInvalid(token));
      
      const invalidTokens = feedbackService.getInvalidTokens();
      expect(invalidTokens).toHaveLength(3);
      expect(invalidTokens).toEqual(expect.arrayContaining(tokens));
    });

    it('should clear invalid tokens', () => {
      const token = TestDeviceTokenGenerator.generateValidToken();
      feedbackService.markTokenAsInvalid(token);
      
      expect(feedbackService.getInvalidTokens()).toHaveLength(1);
      
      feedbackService.clearInvalidTokens();
      
      expect(feedbackService.getInvalidTokens()).toHaveLength(0);
      expect(feedbackService.isTokenInvalid(token)).toBe(false);
    });

    it('should generate feedback response format', () => {
      const tokens = TestDeviceTokenGenerator.generateValidTokens(2);
      tokens.forEach(token => feedbackService.markTokenAsInvalid(token));
      
      const feedback = feedbackService.generateFeedbackResponse();
      
      expect(feedback).toHaveLength(2);
      
      for (const item of feedback) {
        expect(item).toMatchObject({
          token: expect.any(String),
          timestamp: expect.any(Number),
          reason: 'InvalidToken'
        });
        expect(tokens).toContain(item.token);
      }
    });
  });
});