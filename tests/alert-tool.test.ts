import { AlertTool } from '../src/tools/alert-tool';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { CostAnalysis, EnhancedCostAnalysis, AlertContext, ServiceCost } from '../src/types';

// Mock the AWS SDK
jest.mock('@aws-sdk/client-sns');

const mockSNSClient = {
  send: jest.fn()
};

(SNSClient as jest.Mock).mockImplementation(() => mockSNSClient);

describe('AlertTool', () => {
  let tool: AlertTool;
  let mockCostAnalysis: CostAnalysis;
  let mockAlertContext: AlertContext;
  let mockTopServices: ServiceCost[];

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new AlertTool('us-east-1', { maxAttempts: 1 }); // Disable retries for tests
    
    // Mock the logger
    (tool as any).alertLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    // Setup test data
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

  describe('sendSpendAlert', () => {
    it('should send alert successfully without iOS config', async () => {
      mockSNSClient.send.mockResolvedValue({ MessageId: 'test-message-id' });

      await tool.sendSpendAlert(
        mockCostAnalysis,
        mockAlertContext,
        'arn:aws:sns:us-east-1:123456789012:spend-alerts'
      );

      expect(mockSNSClient.send).toHaveBeenCalledWith(
        expect.any(PublishCommand)
      );

      expect((tool as any).alertLogger.info).toHaveBeenCalledWith(
        'Spend alert sent successfully',
        expect.objectContaining({
          totalCost: 15.50,
          threshold: 10.00,
          exceedAmount: 5.50,
          alertLevel: 'CRITICAL',
          hasIOSPayload: false
        })
      );
    });

    it('should send alert with iOS payload when iOS config provided', async () => {
      mockSNSClient.send.mockResolvedValue({ MessageId: 'test-message-id' });

      const iosConfig = {
        platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/MyApp',
        bundleId: 'com.example.spendmonitor'
      };

      await tool.sendSpendAlert(
        mockCostAnalysis,
        mockAlertContext,
        'arn:aws:sns:us-east-1:123456789012:spend-alerts',
        iosConfig
      );

      expect(mockSNSClient.send).toHaveBeenCalledWith(
        expect.any(PublishCommand)
      );

      expect((tool as any).alertLogger.info).toHaveBeenCalledWith(
        'Spend alert sent successfully',
        expect.objectContaining({
          hasIOSPayload: true
        })
      );
    });

    it('should handle SNS delivery failures', async () => {
      const snsError = new Error('Topic not found');
      snsError.name = 'NotFound';
      mockSNSClient.send.mockRejectedValue(snsError);

      await expect(tool.sendSpendAlert(
        mockCostAnalysis,
        mockAlertContext,
        'arn:aws:sns:us-east-1:123456789012:invalid-topic'
      )).rejects.toThrow('Alert delivery failed: Topic not found');

      expect((tool as any).alertLogger.error).toHaveBeenCalledWith(
        'Failed to send spend alert',
        snsError,
        expect.objectContaining({
          topicArn: 'arn:aws:sns:us-east-1:123456789012:invalid-topic',
          totalCost: 15.50,
          threshold: 10.00
        })
      );
    });

    it('should retry on retryable errors', async () => {
      const throttleError = new Error('Rate exceeded');
      throttleError.name = 'ThrottlingException';
      
      // Create a new tool with retries enabled for this test
      const retryTool = new AlertTool('us-east-1', { maxAttempts: 2, baseDelay: 10 });
      (retryTool as any).alertLogger = (tool as any).alertLogger;

      mockSNSClient.send
        .mockRejectedValueOnce(throttleError)
        .mockResolvedValueOnce({ MessageId: 'test-message-id' });

      await retryTool.sendSpendAlert(
        mockCostAnalysis,
        mockAlertContext,
        'arn:aws:sns:us-east-1:123456789012:spend-alerts'
      );

      expect(mockSNSClient.send).toHaveBeenCalledTimes(2);
      expect((retryTool as any).alertLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('SNS operation failed, retrying'),
        expect.objectContaining({
          attempt: 1,
          maxAttempts: 2,
          error: 'Rate exceeded'
        })
      );
    });
  });

  describe('formatAlertMessage', () => {
    it('should format comprehensive alert message', () => {
      const message = tool.formatAlertMessage(mockCostAnalysis, mockAlertContext);

      expect(message).toContain('AWS Spend Alert - CRITICAL');
      expect(message).toContain('Current Spending: $15.50');
      expect(message).toContain('Threshold: $10.00');
      expect(message).toContain('Over Budget: $5.50 (55.0%)');
      expect(message).toContain('Projected Monthly: $31.00');
      expect(message).toContain('Top Cost-Driving Services:');
      expect(message).toContain('1. EC2: $10.00 (64.5%)');
      expect(message).toContain('2. S3: $3.50 (22.6%)');
      expect(message).toContain('3. Lambda: $2.00 (12.9%)');
      expect(message).toContain('Recommendations:');
    });

    it('should handle empty top services list', () => {
      const contextWithoutServices = {
        ...mockAlertContext,
        topServices: []
      };

      const message = tool.formatAlertMessage(mockCostAnalysis, contextWithoutServices);

      expect(message).toContain('AWS Spend Alert - CRITICAL');
      expect(message).not.toContain('Top Cost-Driving Services:');
      expect(message).toContain('Recommendations:');
    });
  });

  describe('formatSMSMessage', () => {
    it('should format concise SMS message', () => {
      const smsMessage = tool.formatSMSMessage(mockCostAnalysis, mockAlertContext);

      expect(smsMessage).toBe(
        'AWS Spend Alert: $15.50 spent (over $10 threshold by $5.50). Top service: EC2 ($10.00) Projected monthly: $31.00'
      );
    });

    it('should handle empty top services for SMS', () => {
      const contextWithoutServices = {
        ...mockAlertContext,
        topServices: []
      };

      const smsMessage = tool.formatSMSMessage(mockCostAnalysis, contextWithoutServices);

      expect(smsMessage).toBe(
        'AWS Spend Alert: $15.50 spent (over $10 threshold by $5.50). Projected monthly: $31.00'
      );
    });
  });

  describe('formatIOSPayload', () => {
    it('should format iOS push notification payload correctly', () => {
      const iosPayload = tool.formatIOSPayload(mockCostAnalysis, mockAlertContext);

      expect(iosPayload.aps.alert.title).toBe('AWS Spend Alert');
      expect(iosPayload.aps.alert.body).toBe('$15.50 spent - $5.50 over budget');
      expect(iosPayload.aps.alert.subtitle).toBe('Critical Budget Exceeded');
      expect(iosPayload.aps.badge).toBe(1);
      expect(iosPayload.aps.sound).toBe('critical-alert.caf');
      expect(iosPayload.aps['content-available']).toBe(1);

      expect(iosPayload.customData.spendAmount).toBe(15.50);
      expect(iosPayload.customData.threshold).toBe(10.00);
      expect(iosPayload.customData.exceedAmount).toBe(5.50);
      expect(iosPayload.customData.topService).toBe('EC2');
      expect(iosPayload.customData.alertId).toMatch(/^spend-alert-\d+$/);
    });

    it('should use warning sound for WARNING level alerts', () => {
      const warningContext = {
        ...mockAlertContext,
        alertLevel: 'WARNING' as const
      };

      const iosPayload = tool.formatIOSPayload(mockCostAnalysis, warningContext);

      expect(iosPayload.aps.alert.subtitle).toBe('Budget Threshold Exceeded');
      expect(iosPayload.aps.sound).toBe('default');
    });

    it('should handle missing top service', () => {
      const contextWithoutServices = {
        ...mockAlertContext,
        topServices: []
      };

      const iosPayload = tool.formatIOSPayload(mockCostAnalysis, contextWithoutServices);

      expect(iosPayload.customData.topService).toBe('Unknown');
    });
  });

  describe('createAlertContext', () => {
    it('should create alert context with WARNING level for moderate overage', () => {
      const context = tool.createAlertContext(mockCostAnalysis, 12.00, mockTopServices);

      expect(context.threshold).toBe(12.00);
      expect(context.exceedAmount).toBe(3.50);
      expect(context.percentageOver).toBeCloseTo(29.17, 2);
      expect(context.alertLevel).toBe('WARNING');
      expect(context.topServices).toBe(mockTopServices);
    });

    it('should create alert context with CRITICAL level for high overage', () => {
      const context = tool.createAlertContext(mockCostAnalysis, 8.00, mockTopServices);

      expect(context.threshold).toBe(8.00);
      expect(context.exceedAmount).toBe(7.50);
      expect(context.percentageOver).toBeCloseTo(93.75, 2);
      expect(context.alertLevel).toBe('CRITICAL');
    });
  });

  describe('validateChannels', () => {
    it('should validate valid SNS topic ARN', async () => {
      const channels = await tool.validateChannels('arn:aws:sns:us-east-1:123456789012:spend-alerts');

      expect(channels.email).toBe(true);
      expect(channels.sms).toBe(true);
      expect(channels.ios).toBe(true);
    });

    it('should reject invalid SNS topic ARN', async () => {
      const channels = await tool.validateChannels('invalid-arn');

      expect(channels.email).toBe(false);
      expect(channels.sms).toBe(false);
      expect(channels.ios).toBe(false);
    });
  });

  describe('sendTestAlert', () => {
    it('should send test alert successfully', async () => {
      mockSNSClient.send.mockResolvedValue({ MessageId: 'test-message-id' });

      await tool.sendTestAlert('arn:aws:sns:us-east-1:123456789012:spend-alerts');

      expect(mockSNSClient.send).toHaveBeenCalledWith(
        expect.any(PublishCommand)
      );

      expect((tool as any).alertLogger.info).toHaveBeenCalledWith(
        'Test alert sent successfully',
        { topicArn: 'arn:aws:sns:us-east-1:123456789012:spend-alerts' }
      );
    });

    it('should send test alert with iOS configuration', async () => {
      mockSNSClient.send.mockResolvedValue({ MessageId: 'test-message-id' });

      const iosConfig = {
        platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/MyApp',
        bundleId: 'com.example.spendmonitor'
      };

      await tool.sendTestAlert(
        'arn:aws:sns:us-east-1:123456789012:spend-alerts',
        iosConfig
      );

      expect(mockSNSClient.send).toHaveBeenCalledWith(
        expect.any(PublishCommand)
      );
    });
  });

  describe('AI-Enhanced Alert Formatting', () => {
    let mockEnhancedCostAnalysis: any;

    beforeEach(() => {
      mockEnhancedCostAnalysis = {
        ...mockCostAnalysis,
        aiAnalysis: {
          summary: 'EC2 costs are significantly higher than usual, indicating potential over-provisioning.',
          keyInsights: [
            'EC2 instances are running at 30% average utilization',
            'Storage costs increased by 45% compared to last month',
            'Lambda invocations are within normal parameters'
          ],
          confidenceScore: 0.85,
          analysisTimestamp: '2023-01-15T12:00:00.000Z',
          modelUsed: 'amazon.titan-text-express-v1'
        },
        anomalies: {
          anomaliesDetected: true,
          anomalies: [
            {
              service: 'EC2',
              severity: 'HIGH' as const,
              description: 'EC2 costs are 200% higher than historical average',
              confidenceScore: 0.9,
              suggestedAction: 'Review instance types and consider rightsizing'
            }
          ]
        },
        recommendations: [
          {
            category: 'RIGHTSIZING' as const,
            service: 'EC2',
            description: 'Downsize EC2 instances based on utilization patterns',
            estimatedSavings: 150.75,
            priority: 'HIGH' as const,
            implementationComplexity: 'MEDIUM' as const
          },
          {
            category: 'STORAGE_OPTIMIZATION' as const,
            service: 'S3',
            description: 'Implement lifecycle policies for infrequently accessed data',
            estimatedSavings: 25.50,
            priority: 'MEDIUM' as const,
            implementationComplexity: 'EASY' as const
          }
        ],
        aiProcessingTime: 1250,
        fallbackUsed: false
      };
    });

    describe('formatAIInsights', () => {
      it('should format comprehensive AI insights with all components', () => {
        const insights = tool.formatAIInsights(mockEnhancedCostAnalysis);

        expect(insights).toContain('🤖 AI Analysis:');
        expect(insights).toContain('📊 EC2 costs are significantly higher than usual');
        expect(insights).toContain('🔍 Key Insights:');
        expect(insights).toContain('• EC2 instances are running at 30% average utilization');
        expect(insights).toContain('🟢 AI Confidence: 85%');
        expect(insights).toContain('⚠️ Detected Anomalies:');
        expect(insights).toContain('🔴 EC2: EC2 costs are 200% higher than historical average (90% confidence)');
        expect(insights).toContain('💡 Action: Review instance types and consider rightsizing');
        expect(insights).toContain('💰 AI Optimization Recommendations:');
        expect(insights).toContain('🔴 EC2: Downsize EC2 instances based on utilization patterns (Save ~$150.75/month)');
        expect(insights).toContain('💵 Total Potential Monthly Savings: $176.25');
      });

      it('should display confidence score with appropriate emoji', () => {
        // Test high confidence (green)
        mockEnhancedCostAnalysis.aiAnalysis.confidenceScore = 0.85;
        let insights = tool.formatAIInsights(mockEnhancedCostAnalysis);
        expect(insights).toContain('🟢 AI Confidence: 85%');

        // Test medium confidence (yellow)
        mockEnhancedCostAnalysis.aiAnalysis.confidenceScore = 0.65;
        insights = tool.formatAIInsights(mockEnhancedCostAnalysis);
        expect(insights).toContain('🟡 AI Confidence: 65%');

        // Test low confidence (red)
        mockEnhancedCostAnalysis.aiAnalysis.confidenceScore = 0.45;
        insights = tool.formatAIInsights(mockEnhancedCostAnalysis);
        expect(insights).toContain('🔴 AI Confidence: 45%');
      });

      it('should handle anomalies with different severity levels', () => {
        mockEnhancedCostAnalysis.anomalies.anomalies = [
          {
            service: 'EC2',
            severity: 'HIGH',
            description: 'High severity anomaly',
            confidenceScore: 0.9
          },
          {
            service: 'S3',
            severity: 'MEDIUM',
            description: 'Medium severity anomaly',
            confidenceScore: 0.7
          },
          {
            service: 'Lambda',
            severity: 'LOW',
            description: 'Low severity anomaly',
            confidenceScore: 0.5
          }
        ];

        const insights = tool.formatAIInsights(mockEnhancedCostAnalysis);

        expect(insights).toContain('🔴 EC2: High severity anomaly (90% confidence)');
        expect(insights).toContain('🟡 S3: Medium severity anomaly (70% confidence)');
        expect(insights).toContain('🟢 Lambda: Low severity anomaly (50% confidence)');
      });

      it('should limit recommendations to top 3 and sort by priority', () => {
        mockEnhancedCostAnalysis.recommendations = [
          { category: 'OTHER', service: 'Service1', description: 'Low priority rec', priority: 'LOW', estimatedSavings: 10 },
          { category: 'RIGHTSIZING', service: 'Service2', description: 'High priority rec', priority: 'HIGH', estimatedSavings: 100 },
          { category: 'STORAGE_OPTIMIZATION', service: 'Service3', description: 'Medium priority rec', priority: 'MEDIUM', estimatedSavings: 50 },
          { category: 'SPOT_INSTANCES', service: 'Service4', description: 'Another high priority rec', priority: 'HIGH', estimatedSavings: 200 }
        ];

        const insights = tool.formatAIInsights(mockEnhancedCostAnalysis);

        // Should show top 3 recommendations sorted by priority
        expect(insights).toContain('🔴 Service2: High priority rec (Save ~$100.00/month)');
        expect(insights).toContain('🟡 Service3: Medium priority rec (Save ~$50.00/month)');
        expect(insights).toContain('🟢 Service1: Low priority rec (Save ~$10.00/month)');
        // Should not show the 4th recommendation due to limit of 3
        expect(insights).not.toContain('Service4');
      });

      it('should show fallback indicator when AI analysis failed', () => {
        mockEnhancedCostAnalysis.fallbackUsed = true;

        const insights = tool.formatAIInsights(mockEnhancedCostAnalysis);

        expect(insights).toContain('ℹ️ Note: AI analysis unavailable, using basic cost analysis');
      });

      it('should handle missing AI components gracefully', () => {
        const partialAnalysis = {
          ...mockCostAnalysis,
          aiAnalysis: {
            summary: 'Basic summary only',
            keyInsights: [],
            confidenceScore: 0.6,
            analysisTimestamp: '2023-01-15T12:00:00.000Z',
            modelUsed: 'amazon.titan-text-express-v1'
          }
        };

        const insights = tool.formatAIInsights(partialAnalysis);

        expect(insights).toContain('🤖 AI Analysis:');
        expect(insights).toContain('📊 Basic summary only');
        expect(insights).toContain('🟡 AI Confidence: 60%');
        expect(insights).not.toContain('⚠️ Detected Anomalies:');
        expect(insights).not.toContain('💰 AI Optimization Recommendations:');
      });

      it('should return empty string when no AI data is available', () => {
        const basicAnalysis = { ...mockCostAnalysis };

        const insights = tool.formatAIInsights(basicAnalysis);

        expect(insights).toBe('');
      });
    });

    describe('Enhanced formatAlertMessage', () => {
      it('should include AI insights in email alert message', () => {
        const message = tool.formatAlertMessage(mockEnhancedCostAnalysis, mockAlertContext);

        expect(message).toContain('AWS Spend Alert - CRITICAL');
        expect(message).toContain('🤖 AI Analysis:');
        expect(message).toContain('📊 EC2 costs are significantly higher than usual');
        expect(message).toContain('💰 AI Optimization Recommendations:');
        expect(message).toContain('💡 General Recommendations:');
      });

      it('should work with basic cost analysis when no AI data available', () => {
        const message = tool.formatAlertMessage(mockCostAnalysis, mockAlertContext);

        expect(message).toContain('AWS Spend Alert - CRITICAL');
        expect(message).not.toContain('🤖 AI Analysis:');
        expect(message).toContain('💡 General Recommendations:');
      });
    });

    describe('Enhanced formatSMSMessage', () => {
      it('should include AI tip in SMS when confidence is high and savings significant', () => {
        const smsMessage = tool.formatSMSMessage(mockEnhancedCostAnalysis, mockAlertContext);

        expect(smsMessage).toContain('AWS Spend Alert: $15.50 spent');
        expect(smsMessage).toContain('AI Tip: Downsize EC2 instances based on utilization patter... (Save ~$151/mo)');
      });

      it('should not include AI tip when confidence is low', () => {
        mockEnhancedCostAnalysis.aiAnalysis.confidenceScore = 0.5;

        const smsMessage = tool.formatSMSMessage(mockEnhancedCostAnalysis, mockAlertContext);

        expect(smsMessage).toContain('AWS Spend Alert: $15.50 spent');
        expect(smsMessage).not.toContain('AI Tip:');
      });

      it('should not include AI tip when estimated savings are low', () => {
        mockEnhancedCostAnalysis.recommendations[0].estimatedSavings = 2.50;

        const smsMessage = tool.formatSMSMessage(mockEnhancedCostAnalysis, mockAlertContext);

        expect(smsMessage).toContain('AWS Spend Alert: $15.50 spent');
        expect(smsMessage).not.toContain('AI Tip:');
      });

      it('should work with basic cost analysis', () => {
        const smsMessage = tool.formatSMSMessage(mockCostAnalysis, mockAlertContext);

        expect(smsMessage).toBe(
          'AWS Spend Alert: $15.50 spent (over $10 threshold by $5.50). Top service: EC2 ($10.00) Projected monthly: $31.00'
        );
      });
    });

    describe('Enhanced formatIOSPayload', () => {
      it('should include AI insights in iOS payload custom data', () => {
        const iosPayload = tool.formatIOSPayload(mockEnhancedCostAnalysis, mockAlertContext);

        expect(iosPayload.aps.alert.title).toBe('AWS Spend Alert');
        expect(iosPayload.aps.alert.body).toContain('$15.50 spent - $5.50 over budget');
        expect(iosPayload.aps.alert.body).toContain('AI suggests: Downsize EC2 instances based on utilization patterns (Save ~$151/mo)');

        expect(iosPayload.customData.aiInsights).toBeDefined();
        expect(iosPayload.customData.aiInsights?.summary).toContain('EC2 costs are significantly higher than usual');
        expect(iosPayload.customData.aiInsights?.confidenceScore).toBe(0.85);
        expect(iosPayload.customData.aiInsights?.keyInsights).toHaveLength(3);
        expect(iosPayload.customData.aiInsights?.hasAnomalies).toBe(true);
        expect(iosPayload.customData.aiInsights?.topRecommendation?.category).toBe('RIGHTSIZING');
        expect(iosPayload.customData.aiInsights?.topRecommendation?.estimatedSavings).toBe(150.75);

        expect(iosPayload.customData.projectedMonthly).toBe(31.00);
        expect(iosPayload.customData.fallbackUsed).toBe(false);
        expect(iosPayload.customData.analysisTimestamp).toBe('2023-01-15T12:00:00.000Z');
      });

      it('should truncate long text for mobile display', () => {
        mockEnhancedCostAnalysis.aiAnalysis.summary = 'This is a very long summary that should be truncated for mobile display because iOS notifications have length limits and we need to ensure the content fits properly within those constraints while still providing useful information to the user about their AWS spending patterns and recommendations.';
        mockEnhancedCostAnalysis.recommendations[0].description = 'This is a very long recommendation description that should be truncated for mobile display to ensure it fits within iOS notification limits while still providing actionable guidance.';

        const iosPayload = tool.formatIOSPayload(mockEnhancedCostAnalysis, mockAlertContext);

        expect(iosPayload.customData.aiInsights?.summary.length).toBeLessThanOrEqual(200);
        expect(iosPayload.customData.aiInsights?.summary).toContain('...');
        expect(iosPayload.customData.aiInsights?.topRecommendation?.description.length).toBeLessThanOrEqual(150);
        expect(iosPayload.customData.aiInsights?.topRecommendation?.description).toContain('...');
      });

      it('should not include AI recommendation in body when confidence is low', () => {
        mockEnhancedCostAnalysis.aiAnalysis.confidenceScore = 0.5;

        const iosPayload = tool.formatIOSPayload(mockEnhancedCostAnalysis, mockAlertContext);

        expect(iosPayload.aps.alert.body).toBe('$15.50 spent - $5.50 over budget');
        expect(iosPayload.aps.alert.body).not.toContain('AI suggests:');
      });

      it('should not include AI recommendation in body when savings are low', () => {
        mockEnhancedCostAnalysis.recommendations[0].estimatedSavings = 5.00;

        const iosPayload = tool.formatIOSPayload(mockEnhancedCostAnalysis, mockAlertContext);

        expect(iosPayload.aps.alert.body).toBe('$15.50 spent - $5.50 over budget');
        expect(iosPayload.aps.alert.body).not.toContain('AI suggests:');
      });

      it('should work with basic cost analysis without AI data', () => {
        const iosPayload = tool.formatIOSPayload(mockCostAnalysis, mockAlertContext);

        expect(iosPayload.aps.alert.body).toBe('$15.50 spent - $5.50 over budget');
        expect(iosPayload.customData.aiInsights).toBeNull();
        expect(iosPayload.customData.fallbackUsed).toBe(false);
        expect(iosPayload.customData.analysisTimestamp).toBeDefined();
      });

      it('should indicate fallback usage when AI analysis failed', () => {
        mockEnhancedCostAnalysis.fallbackUsed = true;

        const iosPayload = tool.formatIOSPayload(mockEnhancedCostAnalysis, mockAlertContext);

        expect(iosPayload.customData.fallbackUsed).toBe(true);
      });
    });

    describe('truncateForMobile', () => {
      it('should truncate long text with ellipsis', () => {
        const longText = 'This is a very long text that should be truncated';
        const truncated = (tool as any).truncateForMobile(longText, 20);

        expect(truncated).toBe('This is a very lo...');
        expect(truncated.length).toBe(20);
      });

      it('should return original text if within limit', () => {
        const shortText = 'Short text';
        const result = (tool as any).truncateForMobile(shortText, 20);

        expect(result).toBe('Short text');
      });

      it('should handle empty or null text', () => {
        expect((tool as any).truncateForMobile('', 20)).toBe('');
        expect((tool as any).truncateForMobile(null, 20)).toBe(null);
        expect((tool as any).truncateForMobile(undefined, 20)).toBe(undefined);
      });
    });
  });
});