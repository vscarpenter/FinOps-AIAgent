import { Tool } from '../mock-strands-agent';
import { SNSClient, PublishCommand, PublishCommandInput } from '@aws-sdk/client-sns';
import { CostAnalysis, AlertContext, ServiceCost, APNSPayload, RetryConfig } from '../types';
import { createLogger } from '../utils/logger';
import { createMetricsCollector } from '../utils/metrics';

/**
 * Tool for sending multi-channel alerts via AWS SNS
 */
export class AlertTool extends Tool {
  private snsClient: SNSClient;
  private retryConfig: RetryConfig;
  private alertLogger = createLogger('AlertTool');
  private metrics = createMetricsCollector('us-east-1', 'SpendMonitor/Alerts');

  constructor(region: string = 'us-east-1', retryConfig?: Partial<RetryConfig>) {
    super();
    this.snsClient = new SNSClient({ region });
    this.metrics = createMetricsCollector(region, 'SpendMonitor/Alerts');
    this.retryConfig = {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
      ...retryConfig
    };
  }

  /**
   * Sends spend alert to all configured notification channels
   */
  async sendSpendAlert(
    costAnalysis: CostAnalysis,
    alertContext: AlertContext,
    topicArn: string,
    iosConfig?: { platformApplicationArn: string; bundleId: string }
  ): Promise<void> {
    try {
      // Format messages for different channels
      const emailSmsMessage = this.formatAlertMessage(costAnalysis, alertContext);
      const iosPayload = iosConfig ? this.formatIOSPayload(costAnalysis, alertContext) : null;

      // Create message attributes for multi-channel delivery
      const messageAttributes: any = {};

      // Prepare the message structure for SNS
      let message: string;
      let messageStructure: string | undefined;

      if (iosPayload) {
        // Use message structure for multi-platform delivery
        messageStructure = 'json';
        message = JSON.stringify({
          default: emailSmsMessage,
          APNS: JSON.stringify(iosPayload),
          APNS_SANDBOX: JSON.stringify(iosPayload),
          email: emailSmsMessage,
          sms: this.formatSMSMessage(costAnalysis, alertContext)
        });
      } else {
        // Simple message for email/SMS only
        message = emailSmsMessage;
      }

      const publishInput: PublishCommandInput = {
        TopicArn: topicArn,
        Message: message,
        MessageStructure: messageStructure,
        Subject: `AWS Spend Alert: $${alertContext.exceedAmount.toFixed(2)} over budget`,
        MessageAttributes: messageAttributes
      };

      await this.executeWithRetry(() => this.snsClient.send(new PublishCommand(publishInput)));

      this.alertLogger.info('Spend alert sent successfully', {
        totalCost: costAnalysis.totalCost,
        threshold: alertContext.threshold,
        exceedAmount: alertContext.exceedAmount,
        alertLevel: alertContext.alertLevel,
        topServices: alertContext.topServices.length,
        hasIOSPayload: !!iosPayload
      });

    } catch (error) {
      this.alertLogger.error('Failed to send spend alert', error as Error, {
        topicArn,
        totalCost: costAnalysis.totalCost,
        threshold: alertContext.threshold
      });
      throw new Error(`Alert delivery failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Formats alert message for email and general display
   */
  formatAlertMessage(costAnalysis: CostAnalysis, alertContext: AlertContext): string {
    const lines = [
      `🚨 AWS Spend Alert - ${alertContext.alertLevel}`,
      '',
      `Your AWS spending has exceeded the configured threshold.`,
      '',
      `💰 Current Spending: $${costAnalysis.totalCost.toFixed(2)}`,
      `🎯 Threshold: $${alertContext.threshold.toFixed(2)}`,
      `📈 Over Budget: $${alertContext.exceedAmount.toFixed(2)} (${alertContext.percentageOver.toFixed(1)}%)`,
      `📊 Projected Monthly: $${costAnalysis.projectedMonthly.toFixed(2)}`,
      '',
      `📅 Period: ${this.formatDateRange(costAnalysis.period)}`,
      ''
    ];

    if (alertContext.topServices.length > 0) {
      lines.push('🔝 Top Cost-Driving Services:');
      alertContext.topServices.forEach((service, index) => {
        lines.push(`${index + 1}. ${service.serviceName}: $${service.cost.toFixed(2)} (${service.percentage.toFixed(1)}%)`);
      });
      lines.push('');
    }

    let recommendations = [
      'Review your AWS resources and usage patterns',
      'Consider scaling down or terminating unused resources',
      'Check for any unexpected charges or services',
      'Set up additional CloudWatch alarms for specific services'
    ];

    if (costAnalysis.insights) {
      lines.push('🤖 AI Cost Insight:', costAnalysis.insights.summary, '');

      if (costAnalysis.insights.notableFindings.length > 0) {
        lines.push('📌 Notable Findings:');
        costAnalysis.insights.notableFindings.forEach(finding => {
          lines.push(`• ${finding}`);
        });
        lines.push('');
      }

      if (costAnalysis.insights.recommendedActions.length > 0) {
        recommendations = costAnalysis.insights.recommendedActions;
      }

      lines.push(`Model: ${costAnalysis.insights.modelId} (confidence: ${costAnalysis.insights.confidence})`, '');
    }

    lines.push('💡 Recommendations:');
    recommendations.forEach(recommendation => {
      lines.push(`• ${recommendation}`);
    });

    lines.push(
      '',
      `⏰ Alert generated at: ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`
    );

    return lines.join('\n');
  }

  /**
   * Formats a shorter message for SMS delivery
   */
  formatSMSMessage(costAnalysis: CostAnalysis, alertContext: AlertContext): string {
    const topService = alertContext.topServices[0];
    const topServiceText = topService ? ` Top service: ${topService.serviceName} ($${topService.cost.toFixed(2)})` : '';
    const aiSummary = costAnalysis.insights?.summary ? ` AI: ${this.truncateForSms(costAnalysis.insights.summary, 100)}` : '';

    return `AWS Spend Alert: $${costAnalysis.totalCost.toFixed(2)} spent (over $${alertContext.threshold} threshold by $${alertContext.exceedAmount.toFixed(2)}).${topServiceText} Projected monthly: $${costAnalysis.projectedMonthly.toFixed(2)}.${aiSummary}`;
  }

  /**
   * Formats iOS push notification payload
   */
  formatIOSPayload(costAnalysis: CostAnalysis, alertContext: AlertContext): APNSPayload {
    const topService = alertContext.topServices[0];
    const alertId = `spend-alert-${Date.now()}`;

    return {
      aps: {
        alert: {
          title: 'AWS Spend Alert',
          body: `$${costAnalysis.totalCost.toFixed(2)} spent - $${alertContext.exceedAmount.toFixed(2)} over budget`,
          subtitle: alertContext.alertLevel === 'CRITICAL' ? 'Critical Budget Exceeded' : 'Budget Threshold Exceeded'
        },
        badge: 1,
        sound: alertContext.alertLevel === 'CRITICAL' ? 'critical-alert.caf' : 'default',
        'content-available': 1
      },
      customData: {
        spendAmount: costAnalysis.totalCost,
        threshold: alertContext.threshold,
        exceedAmount: alertContext.exceedAmount,
        topService: topService?.serviceName || 'Unknown',
        alertId,
        aiSummary: costAnalysis.insights?.summary,
        aiConfidence: costAnalysis.insights?.confidence
      }
    };
  }

  private truncateForSms(value: string, limit: number): string {
    const normalised = value.replace(/\s+/g, ' ').trim();
    if (normalised.length <= limit) {
      return normalised;
    }
    return `${normalised.slice(0, limit - 1)}…`;
  }

  /**
   * Creates alert context from cost analysis and threshold
   */
  createAlertContext(costAnalysis: CostAnalysis, threshold: number, topServices: ServiceCost[]): AlertContext {
    const exceedAmount = costAnalysis.totalCost - threshold;
    const percentageOver = (exceedAmount / threshold) * 100;
    
    // Determine alert level based on how much over threshold
    const alertLevel: 'WARNING' | 'CRITICAL' = percentageOver > 50 ? 'CRITICAL' : 'WARNING';

    return {
      threshold,
      exceedAmount,
      percentageOver,
      topServices,
      alertLevel
    };
  }

  /**
   * Validates notification channels and topic configuration
   */
  async validateChannels(topicArn: string): Promise<{ email: boolean; sms: boolean; ios: boolean }> {
    try {
      // In a real implementation, you would call SNS GetTopicAttributes
      // and ListSubscriptionsByTopic to check available channels
      // For now, we'll return a basic validation
      
      const isValidArn = this.isValidSNSTopicArn(topicArn);
      
      return {
        email: isValidArn,
        sms: isValidArn,
        ios: isValidArn
      };
    } catch (error) {
      this.alertLogger.warn('Failed to validate notification channels', { error, topicArn });
      return { email: false, sms: false, ios: false };
    }
  }

  /**
   * Formats date range for display
   */
  private formatDateRange(period: { start: string; end: string }): string {
    const startDate = new Date(period.start);
    const endDate = new Date(period.end);
    
    const formatOptions: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC'
    };

    return `${startDate.toLocaleDateString('en-US', formatOptions)} - ${endDate.toLocaleDateString('en-US', formatOptions)}`;
  }

  /**
   * Validates SNS topic ARN format
   */
  private isValidSNSTopicArn(arn: string): boolean {
    const snsTopicArnPattern = /^arn:aws:sns:[a-z0-9-]+:\d{12}:[a-zA-Z0-9_-]+$/;
    return snsTopicArnPattern.test(arn);
  }

  /**
   * Executes SNS operations with retry logic
   */
  private async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        if (attempt === this.retryConfig.maxAttempts) {
          break;
        }

        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          throw lastError;
        }

        const delay = Math.min(
          this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt - 1),
          this.retryConfig.maxDelay
        );

        this.alertLogger.warn(`SNS operation failed, retrying in ${delay}ms`, {
          attempt,
          maxAttempts: this.retryConfig.maxAttempts,
          error: lastError.message
        });

        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  /**
   * Determines if an SNS error is retryable
   */
  private isRetryableError(error: any): boolean {
    if (!error) return false;

    // AWS SDK error codes that are retryable
    const retryableErrorCodes = [
      'ThrottlingException',
      'Throttling',
      'TooManyRequestsException',
      'ServiceUnavailable',
      'InternalServerError',
      'RequestTimeout',
      'InternalError'
    ];

    // Check error code
    if (error.name && retryableErrorCodes.includes(error.name)) {
      return true;
    }

    // Check HTTP status codes
    if (error.$metadata?.httpStatusCode) {
      const statusCode = error.$metadata.httpStatusCode;
      return statusCode >= 500 || statusCode === 429;
    }

    // Check for network errors
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      return true;
    }

    return false;
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Sends a test alert to verify notification setup
   */
  async sendTestAlert(topicArn: string, iosConfig?: { platformApplicationArn: string; bundleId: string }): Promise<void> {
    const testCostAnalysis: CostAnalysis = {
      totalCost: 15.50,
      serviceBreakdown: {
        'Amazon Elastic Compute Cloud - Compute': 10.00,
        'Amazon Simple Storage Service': 3.50,
        'AWS Lambda': 2.00
      },
      period: {
        start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
        end: new Date().toISOString()
      },
      projectedMonthly: 31.00,
      currency: 'USD',
      lastUpdated: new Date().toISOString()
    };

    const testTopServices: ServiceCost[] = [
      { serviceName: 'Amazon Elastic Compute Cloud - Compute', cost: 10.00, percentage: 64.5 },
      { serviceName: 'Amazon Simple Storage Service', cost: 3.50, percentage: 22.6 },
      { serviceName: 'AWS Lambda', cost: 2.00, percentage: 12.9 }
    ];

    const testAlertContext = this.createAlertContext(testCostAnalysis, 10.00, testTopServices);

    await this.sendSpendAlert(testCostAnalysis, testAlertContext, topicArn, iosConfig);
    
    this.alertLogger.info('Test alert sent successfully', { topicArn });
  }

  /**
   * Determines if an error is related to iOS/APNS delivery
   */
  private isIOSRelatedError(error: any): boolean {
    if (!error) return false;

    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code?.toLowerCase() || '';
    const errorName = error.name?.toLowerCase() || '';

    // Check for iOS/APNS specific error indicators
    const iosErrorIndicators = [
      'apns',
      'platform endpoint',
      'invalid token',
      'endpoint disabled',
      'certificate',
      'platform application',
      'ios',
      'push notification'
    ];

    return iosErrorIndicators.some(indicator => 
      errorMessage.includes(indicator) || 
      errorCode.includes(indicator) || 
      errorName.includes(indicator)
    );
  }

  /**
   * Enhanced alert delivery with comprehensive iOS monitoring
   */
  async sendSpendAlertWithIOSMonitoring(
    costAnalysis: CostAnalysis,
    alertContext: AlertContext,
    topicArn: string,
    iosConfig?: { platformApplicationArn: string; bundleId: string }
  ): Promise<{
    success: boolean;
    channels: string[];
    iosDelivered: boolean;
    fallbackUsed: boolean;
    errors: string[];
    metrics: {
      deliveryTime: number;
      retryCount: number;
      payloadSize: number;
    };
  }> {
    const startTime = Date.now();
    const timer = this.metrics.createTimer('SendSpendAlertWithMonitoring');
    const channels: string[] = [];
    let iosDeliveryAttempted = false;
    let iosDeliverySuccessful = false;
    let fallbackUsed = false;
    const deliveryErrors: string[] = [];
    let retryCount = 0;

    try {
      this.alertLogger.info('Starting enhanced spend alert delivery with iOS monitoring', {
        totalCost: costAnalysis.totalCost,
        threshold: alertContext.threshold,
        exceedAmount: alertContext.exceedAmount,
        alertLevel: alertContext.alertLevel,
        hasIOSConfig: !!iosConfig
      });

      // Format messages for different channels
      const emailSmsMessage = this.formatAlertMessage(costAnalysis, alertContext);
      const iosPayload = iosConfig ? this.formatIOSPayload(costAnalysis, alertContext) : null;
      const payloadSize = iosPayload ? JSON.stringify(iosPayload).length : emailSmsMessage.length;

      // Determine available channels
      channels.push('email', 'sms');
      if (iosPayload) {
        channels.push('ios');
        iosDeliveryAttempted = true;
      }

      // Log iOS payload details for monitoring
      if (iosPayload) {
        this.alertLogger.debug('iOS payload prepared', {
          payloadSize,
          alertTitle: iosPayload.aps.alert.title,
          alertBody: iosPayload.aps.alert.body,
          badge: iosPayload.aps.badge,
          sound: iosPayload.aps.sound,
          customDataKeys: Object.keys(iosPayload.customData)
        });
      }

      // Create enhanced message attributes
      const messageAttributes: any = {
        'alert_level': {
          DataType: 'String',
          StringValue: alertContext.alertLevel
        },
        'spend_amount': {
          DataType: 'Number',
          StringValue: costAnalysis.totalCost.toString()
        },
        'threshold': {
          DataType: 'Number',
          StringValue: alertContext.threshold.toString()
        },
        'delivery_timestamp': {
          DataType: 'String',
          StringValue: new Date().toISOString()
        }
      };

      if (iosDeliveryAttempted) {
        messageAttributes['ios_payload_size'] = {
          DataType: 'Number',
          StringValue: payloadSize.toString()
        };
      }

      // Prepare the message structure for SNS
      let message: string;
      let messageStructure: string | undefined;

      if (iosPayload) {
        messageStructure = 'json';
        message = JSON.stringify({
          default: emailSmsMessage,
          APNS: JSON.stringify(iosPayload),
          APNS_SANDBOX: JSON.stringify(iosPayload),
          email: emailSmsMessage,
          sms: this.formatSMSMessage(costAnalysis, alertContext)
        });
      } else {
        message = emailSmsMessage;
      }

      const publishInput: PublishCommandInput = {
        TopicArn: topicArn,
        Message: message,
        MessageStructure: messageStructure,
        Subject: `AWS Spend Alert: $${alertContext.exceedAmount.toFixed(2)} over budget`,
        MessageAttributes: messageAttributes
      };

      // Attempt primary delivery with enhanced error handling
      try {
        const result = await this.executeWithRetryWithMetrics(
          () => this.snsClient.send(new PublishCommand(publishInput)),
          (attempt) => { retryCount = attempt - 1; }
        );
        
        if (iosDeliveryAttempted) {
          iosDeliverySuccessful = true;
        }

        this.alertLogger.info('Enhanced spend alert sent successfully', {
          messageId: result.MessageId,
          channels,
          deliveryTime: Date.now() - startTime,
          retryCount,
          payloadSize,
          iosDeliverySuccessful
        });

        // Record detailed success metrics
        await this.metrics.recordAlertDelivery(channels, true, retryCount);
        
        if (iosDeliveryAttempted) {
          await this.metrics.recordIOSNotification(1, iosDeliverySuccessful, 0);
        }

      } catch (deliveryError) {
        const errorMessage = deliveryError instanceof Error ? deliveryError.message : 'Unknown delivery error';
        deliveryErrors.push(errorMessage);

        this.alertLogger.error('Primary enhanced alert delivery failed', deliveryError as Error, {
          topicArn,
          channels,
          iosDeliveryAttempted,
          retryCount,
          payloadSize
        });

        // Enhanced iOS fallback handling
        if (iosDeliveryAttempted && this.isIOSRelatedError(deliveryError)) {
          this.alertLogger.warn('iOS delivery failed, attempting enhanced fallback to email/SMS only', {
            originalError: errorMessage,
            payloadSize
          });
          
          fallbackUsed = true;
          
          try {
            const fallbackInput: PublishCommandInput = {
              TopicArn: topicArn,
              Message: emailSmsMessage,
              Subject: `AWS Spend Alert: $${alertContext.exceedAmount.toFixed(2)} over budget (iOS delivery failed)`,
              MessageAttributes: {
                ...messageAttributes,
                'fallback_reason': {
                  DataType: 'String',
                  StringValue: 'iOS delivery failed'
                },
                'original_error': {
                  DataType: 'String',
                  StringValue: errorMessage.substring(0, 256) // Truncate for SNS limits
                }
              }
            };

            const fallbackResult = await this.executeWithRetryWithMetrics(
              () => this.snsClient.send(new PublishCommand(fallbackInput)),
              (attempt) => { retryCount += attempt - 1; }
            );
            
            this.alertLogger.info('Enhanced fallback alert delivery successful', {
              messageId: fallbackResult.MessageId,
              fallbackChannels: ['email', 'sms'],
              totalDeliveryTime: Date.now() - startTime,
              totalRetryCount: retryCount,
              originalError: errorMessage
            });

            // Record fallback success metrics
            await this.metrics.recordAlertDelivery(['email', 'sms'], true, retryCount);
            await this.metrics.recordIOSNotification(1, false, 0);

          } catch (fallbackError) {
            const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : 'Unknown fallback error';
            deliveryErrors.push(`Fallback failed: ${fallbackErrorMessage}`);
            
            this.alertLogger.error('Enhanced fallback alert delivery failed', fallbackError as Error, {
              totalRetryCount: retryCount,
              totalDeliveryTime: Date.now() - startTime
            });
            
            // Record complete failure metrics
            await this.metrics.recordAlertDelivery(channels, false, retryCount);
            if (iosDeliveryAttempted) {
              await this.metrics.recordIOSNotification(1, false, 0);
            }
            
            throw new Error(`Enhanced alert delivery completely failed: ${deliveryErrors.join('; ')}`);
          }
        } else {
          // Non-iOS related error or no iOS involved
          await this.metrics.recordAlertDelivery(channels, false, retryCount);
          if (iosDeliveryAttempted) {
            await this.metrics.recordIOSNotification(1, false, 0);
          }
          
          throw deliveryError;
        }
      }

      const deliveryTime = Date.now() - startTime;
      await timer.stop(true);

      return {
        success: true,
        channels,
        iosDelivered: iosDeliverySuccessful,
        fallbackUsed,
        errors: deliveryErrors,
        metrics: {
          deliveryTime,
          retryCount,
          payloadSize
        }
      };

    } catch (error) {
      const deliveryTime = Date.now() - startTime;
      
      this.alertLogger.error('Enhanced spend alert delivery failed completely', error as Error, {
        topicArn,
        totalCost: costAnalysis.totalCost,
        threshold: alertContext.threshold,
        deliveryTime,
        retryCount,
        deliveryErrors
      });

      await timer.stop(false);
      
      return {
        success: false,
        channels,
        iosDelivered: false,
        fallbackUsed,
        errors: deliveryErrors,
        metrics: {
          deliveryTime,
          retryCount,
          payloadSize: 0
        }
      };
    }
  }

  /**
   * Enhanced retry execution with metrics tracking
   */
  private async executeWithRetryWithMetrics<T>(
    fn: () => Promise<T>,
    onRetry?: (attempt: number) => void
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
      try {
        const result = await fn();
        
        if (onRetry && attempt > 1) {
          onRetry(attempt);
        }
        
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        if (attempt === this.retryConfig.maxAttempts) {
          break;
        }

        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          throw lastError;
        }

        const delay = Math.min(
          this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt - 1),
          this.retryConfig.maxDelay
        );

        this.alertLogger.warn(`Enhanced SNS operation failed, retrying in ${delay}ms`, {
          attempt,
          maxAttempts: this.retryConfig.maxAttempts,
          error: lastError.message,
          isIOSRelated: this.isIOSRelatedError(error)
        });

        if (onRetry) {
          onRetry(attempt);
        }

        await this.sleep(delay);
      }
    }

    throw lastError!;
  }
}
