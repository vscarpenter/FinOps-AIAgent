"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlertTool = void 0;
const strands_agents_1 = require("strands-agents");
const client_sns_1 = require("@aws-sdk/client-sns");
const logger_1 = require("../utils/logger");
const metrics_1 = require("../utils/metrics");
/**
 * Tool for sending multi-channel alerts via AWS SNS
 */
class AlertTool extends strands_agents_1.Tool {
    constructor(region = 'us-east-1', retryConfig) {
        super();
        this.alertLogger = (0, logger_1.createLogger)('AlertTool');
        this.metrics = (0, metrics_1.createMetricsCollector)('us-east-1', 'SpendMonitor/Alerts');
        this.snsClient = new client_sns_1.SNSClient({ region });
        this.metrics = (0, metrics_1.createMetricsCollector)(region, 'SpendMonitor/Alerts');
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
    async sendSpendAlert(costAnalysis, alertContext, topicArn, iosConfig) {
        try {
            // Format messages for different channels
            const emailSmsMessage = this.formatAlertMessage(costAnalysis, alertContext);
            const iosPayload = iosConfig ? this.formatIOSPayload(costAnalysis, alertContext) : null;
            // Create message attributes for multi-channel delivery
            const messageAttributes = {};
            // Prepare the message structure for SNS
            let message;
            let messageStructure;
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
            }
            else {
                // Simple message for email/SMS only
                message = emailSmsMessage;
            }
            const publishInput = {
                TopicArn: topicArn,
                Message: message,
                MessageStructure: messageStructure,
                Subject: `AWS Spend Alert: $${alertContext.exceedAmount.toFixed(2)} over budget`,
                MessageAttributes: messageAttributes
            };
            await this.executeWithRetry(() => this.snsClient.send(new client_sns_1.PublishCommand(publishInput)));
            this.alertLogger.info('Spend alert sent successfully', {
                totalCost: costAnalysis.totalCost,
                threshold: alertContext.threshold,
                exceedAmount: alertContext.exceedAmount,
                alertLevel: alertContext.alertLevel,
                topServices: alertContext.topServices.length,
                hasIOSPayload: !!iosPayload
            });
        }
        catch (error) {
            this.alertLogger.error('Failed to send spend alert', error, {
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
    formatAlertMessage(costAnalysis, alertContext) {
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
        lines.push('💡 Recommendations:', '• Review your AWS resources and usage patterns', '• Consider scaling down or terminating unused resources', '• Check for any unexpected charges or services', '• Set up additional CloudWatch alarms for specific services', '', `⏰ Alert generated at: ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`);
        return lines.join('\n');
    }
    /**
     * Formats a shorter message for SMS delivery
     */
    formatSMSMessage(costAnalysis, alertContext) {
        const topService = alertContext.topServices[0];
        const topServiceText = topService ? ` Top service: ${topService.serviceName} ($${topService.cost.toFixed(2)})` : '';
        return `AWS Spend Alert: $${costAnalysis.totalCost.toFixed(2)} spent (over $${alertContext.threshold} threshold by $${alertContext.exceedAmount.toFixed(2)}).${topServiceText} Projected monthly: $${costAnalysis.projectedMonthly.toFixed(2)}`;
    }
    /**
     * Formats iOS push notification payload
     */
    formatIOSPayload(costAnalysis, alertContext) {
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
                alertId
            }
        };
    }
    /**
     * Creates alert context from cost analysis and threshold
     */
    createAlertContext(costAnalysis, threshold, topServices) {
        const exceedAmount = costAnalysis.totalCost - threshold;
        const percentageOver = (exceedAmount / threshold) * 100;
        // Determine alert level based on how much over threshold
        const alertLevel = percentageOver > 50 ? 'CRITICAL' : 'WARNING';
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
    async validateChannels(topicArn) {
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
        }
        catch (error) {
            this.alertLogger.warn('Failed to validate notification channels', { error, topicArn });
            return { email: false, sms: false, ios: false };
        }
    }
    /**
     * Formats date range for display
     */
    formatDateRange(period) {
        const startDate = new Date(period.start);
        const endDate = new Date(period.end);
        const formatOptions = {
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
    isValidSNSTopicArn(arn) {
        const snsTopicArnPattern = /^arn:aws:sns:[a-z0-9-]+:\d{12}:[a-zA-Z0-9_-]+$/;
        return snsTopicArnPattern.test(arn);
    }
    /**
     * Executes SNS operations with retry logic
     */
    async executeWithRetry(fn) {
        let lastError;
        for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
            try {
                return await fn();
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error('Unknown error');
                if (attempt === this.retryConfig.maxAttempts) {
                    break;
                }
                // Check if error is retryable
                if (!this.isRetryableError(error)) {
                    throw lastError;
                }
                const delay = Math.min(this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt - 1), this.retryConfig.maxDelay);
                this.alertLogger.warn(`SNS operation failed, retrying in ${delay}ms`, {
                    attempt,
                    maxAttempts: this.retryConfig.maxAttempts,
                    error: lastError.message
                });
                await this.sleep(delay);
            }
        }
        throw lastError;
    }
    /**
     * Determines if an SNS error is retryable
     */
    isRetryableError(error) {
        if (!error)
            return false;
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
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * Sends a test alert to verify notification setup
     */
    async sendTestAlert(topicArn, iosConfig) {
        const testCostAnalysis = {
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
        const testTopServices = [
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
    isIOSRelatedError(error) {
        if (!error)
            return false;
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
        return iosErrorIndicators.some(indicator => errorMessage.includes(indicator) ||
            errorCode.includes(indicator) ||
            errorName.includes(indicator));
    }
    /**
     * Enhanced alert delivery with comprehensive iOS monitoring
     */
    async sendSpendAlertWithIOSMonitoring(costAnalysis, alertContext, topicArn, iosConfig) {
        const startTime = Date.now();
        const timer = this.metrics.createTimer('SendSpendAlertWithMonitoring');
        const channels = [];
        let iosDeliveryAttempted = false;
        let iosDeliverySuccessful = false;
        let fallbackUsed = false;
        const deliveryErrors = [];
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
            const messageAttributes = {
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
            let message;
            let messageStructure;
            if (iosPayload) {
                messageStructure = 'json';
                message = JSON.stringify({
                    default: emailSmsMessage,
                    APNS: JSON.stringify(iosPayload),
                    APNS_SANDBOX: JSON.stringify(iosPayload),
                    email: emailSmsMessage,
                    sms: this.formatSMSMessage(costAnalysis, alertContext)
                });
            }
            else {
                message = emailSmsMessage;
            }
            const publishInput = {
                TopicArn: topicArn,
                Message: message,
                MessageStructure: messageStructure,
                Subject: `AWS Spend Alert: $${alertContext.exceedAmount.toFixed(2)} over budget`,
                MessageAttributes: messageAttributes
            };
            // Attempt primary delivery with enhanced error handling
            try {
                const result = await this.executeWithRetryWithMetrics(() => this.snsClient.send(new client_sns_1.PublishCommand(publishInput)), (attempt) => { retryCount = attempt - 1; });
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
            }
            catch (deliveryError) {
                const errorMessage = deliveryError instanceof Error ? deliveryError.message : 'Unknown delivery error';
                deliveryErrors.push(errorMessage);
                this.alertLogger.error('Primary enhanced alert delivery failed', deliveryError, {
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
                        const fallbackInput = {
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
                        const fallbackResult = await this.executeWithRetryWithMetrics(() => this.snsClient.send(new client_sns_1.PublishCommand(fallbackInput)), (attempt) => { retryCount += attempt - 1; });
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
                    }
                    catch (fallbackError) {
                        const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : 'Unknown fallback error';
                        deliveryErrors.push(`Fallback failed: ${fallbackErrorMessage}`);
                        this.alertLogger.error('Enhanced fallback alert delivery failed', fallbackError, {
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
                }
                else {
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
        }
        catch (error) {
            const deliveryTime = Date.now() - startTime;
            this.alertLogger.error('Enhanced spend alert delivery failed completely', error, {
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
    async executeWithRetryWithMetrics(fn, onRetry) {
        let lastError;
        for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
            try {
                const result = await fn();
                if (onRetry && attempt > 1) {
                    onRetry(attempt);
                }
                return result;
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error('Unknown error');
                if (attempt === this.retryConfig.maxAttempts) {
                    break;
                }
                // Check if error is retryable
                if (!this.isRetryableError(error)) {
                    throw lastError;
                }
                const delay = Math.min(this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt - 1), this.retryConfig.maxDelay);
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
        throw lastError;
    }
}
exports.AlertTool = AlertTool;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWxlcnQtdG9vbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy90b29scy9hbGVydC10b29sLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1EQUFzQztBQUN0QyxvREFBcUY7QUFFckYsNENBQStDO0FBQy9DLDhDQUEwRDtBQUUxRDs7R0FFRztBQUNILE1BQWEsU0FBVSxTQUFRLHFCQUFJO0lBTWpDLFlBQVksU0FBaUIsV0FBVyxFQUFFLFdBQWtDO1FBQzFFLEtBQUssRUFBRSxDQUFDO1FBSkYsZ0JBQVcsR0FBRyxJQUFBLHFCQUFZLEVBQUMsV0FBVyxDQUFDLENBQUM7UUFDeEMsWUFBTyxHQUFHLElBQUEsZ0NBQXNCLEVBQUMsV0FBVyxFQUFFLHFCQUFxQixDQUFDLENBQUM7UUFJM0UsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLHNCQUFTLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxDQUFDO1FBQzNDLElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBQSxnQ0FBc0IsRUFBQyxNQUFNLEVBQUUscUJBQXFCLENBQUMsQ0FBQztRQUNyRSxJQUFJLENBQUMsV0FBVyxHQUFHO1lBQ2pCLFdBQVcsRUFBRSxDQUFDO1lBQ2QsU0FBUyxFQUFFLElBQUk7WUFDZixRQUFRLEVBQUUsS0FBSztZQUNmLGlCQUFpQixFQUFFLENBQUM7WUFDcEIsR0FBRyxXQUFXO1NBQ2YsQ0FBQztJQUNKLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxjQUFjLENBQ2xCLFlBQTBCLEVBQzFCLFlBQTBCLEVBQzFCLFFBQWdCLEVBQ2hCLFNBQWdFO1FBRWhFLElBQUksQ0FBQztZQUNILHlDQUF5QztZQUN6QyxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsa0JBQWtCLENBQUMsWUFBWSxFQUFFLFlBQVksQ0FBQyxDQUFDO1lBQzVFLE1BQU0sVUFBVSxHQUFHLFNBQVMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFlBQVksRUFB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O0lBQ25CLENBQUM7Q0FDRjtBQXJyQkQsOEJBcXJCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFRvb2wgfSBmcm9tICdzdHJhbmRzLWFnZW50cyc7XG5pbXBvcnQgeyBTTlNDbGllbnQsIFB1Ymxpc2hDb21tYW5kLCBQdWJsaXNoQ29tbWFuZElucHV0IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNucyc7XG5pbXBvcnQgeyBDb3N0QW5hbHlzaXMsIEFsZXJ0Q29udGV4dCwgU2VydmljZUNvc3QsIEFQTlNQYXlsb2FkLCBSZXRyeUNvbmZpZyB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uL3V0aWxzL2xvZ2dlcic7XG5pbXBvcnQgeyBjcmVhdGVNZXRyaWNzQ29sbGVjdG9yIH0gZnJvbSAnLi4vdXRpbHMvbWV0cmljcyc7XG5cbi8qKlxuICogVG9vbCBmb3Igc2VuZGluZyBtdWx0aS1jaGFubmVsIGFsZXJ0cyB2aWEgQVdTIFNOU1xuICovXG5leHBvcnQgY2xhc3MgQWxlcnRUb29sIGV4dGVuZHMgVG9vbCB7XG4gIHByaXZhdGUgc25zQ2xpZW50OiBTTlNDbGllbnQ7XG4gIHByaXZhdGUgcmV0cnlDb25maWc6IFJldHJ5Q29uZmlnO1xuICBwcml2YXRlIGFsZXJ0TG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdBbGVydFRvb2wnKTtcbiAgcHJpdmF0ZSBtZXRyaWNzID0gY3JlYXRlTWV0cmljc0NvbGxlY3RvcigndXMtZWFzdC0xJywgJ1NwZW5kTW9uaXRvci9BbGVydHMnKTtcblxuICBjb25zdHJ1Y3RvcihyZWdpb246IHN0cmluZyA9ICd1cy1lYXN0LTEnLCByZXRyeUNvbmZpZz86IFBhcnRpYWw8UmV0cnlDb25maWc+KSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnNuc0NsaWVudCA9IG5ldyBTTlNDbGllbnQoeyByZWdpb24gfSk7XG4gICAgdGhpcy5tZXRyaWNzID0gY3JlYXRlTWV0cmljc0NvbGxlY3RvcihyZWdpb24sICdTcGVuZE1vbml0b3IvQWxlcnRzJyk7XG4gICAgdGhpcy5yZXRyeUNvbmZpZyA9IHtcbiAgICAgIG1heEF0dGVtcHRzOiAzLFxuICAgICAgYmFzZURlbGF5OiAxMDAwLFxuICAgICAgbWF4RGVsYXk6IDMwMDAwLFxuICAgICAgYmFja29mZk11bHRpcGxpZXI6IDIsXG4gICAgICAuLi5yZXRyeUNvbmZpZ1xuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogU2VuZHMgc3BlbmQgYWxlcnQgdG8gYWxsIGNvbmZpZ3VyZWQgbm90aWZpY2F0aW9uIGNoYW5uZWxzXG4gICAqL1xuICBhc3luYyBzZW5kU3BlbmRBbGVydChcbiAgICBjb3N0QW5hbHlzaXM6IENvc3RBbmFseXNpcyxcbiAgICBhbGVydENvbnRleHQ6IEFsZXJ0Q29udGV4dCxcbiAgICB0b3BpY0Fybjogc3RyaW5nLFxuICAgIGlvc0NvbmZpZz86IHsgcGxhdGZvcm1BcHBsaWNhdGlvbkFybjogc3RyaW5nOyBidW5kbGVJZDogc3RyaW5nIH1cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIEZvcm1hdCBtZXNzYWdlcyBmb3IgZGlmZmVyZW50IGNoYW5uZWxzXG4gICAgICBjb25zdCBlbWFpbFNtc01lc3NhZ2UgPSB0aGlzLmZvcm1hdEFsZXJ0TWVzc2FnZShjb3N0QW5hbHlzaXMsIGFsZXJ0Q29udGV4dCk7XG4gICAgICBjb25zdCBpb3NQYXlsb2FkID0gaW9zQ29uZmlnID8gdGhpcy5mb3JtYXRJT1NQYXlsb2FkKGNvc3RBbmFseXNpcywgYWxlcnRDb250ZXh0KSA6IG51bGw7XG5cbiAgICAgIC8vIENyZWF0ZSBtZXNzYWdlIGF0dHJpYnV0ZXMgZm9yIG11bHRpLWNoYW5uZWwgZGVsaXZlcnlcbiAgICAgIGNvbnN0IG1lc3NhZ2VBdHRyaWJ1dGVzOiBhbnkgPSB7fTtcblxuICAgICAgLy8gUHJlcGFyZSB0aGUgbWVzc2FnZSBzdHJ1Y3R1cmUgZm9yIFNOU1xuICAgICAgbGV0IG1lc3NhZ2U6IHN0cmluZztcbiAgICAgIGxldCBtZXNzYWdlU3RydWN0dXJlOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cbiAgICAgIGlmIChpb3NQYXlsb2FkKSB7XG4gICAgICAgIC8vIFVzZSBtZXNzYWdlIHN0cnVjdHVyZSBmb3IgbXVsdGktcGxhdGZvcm0gZGVsaXZlcnlcbiAgICAgICAgbWVzc2FnZVN0cnVjdHVyZSA9ICdqc29uJztcbiAgICAgICAgbWVzc2FnZSA9IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBkZWZhdWx0OiBlbWFpbFNtc01lc3NhZ2UsXG4gICAgICAgICAgQVBOUzogSlNPTi5zdHJpbmdpZnkoaW9zUGF5bG9hZCksXG4gICAgICAgICAgQVBOU19TQU5EQk9YOiBKU09OLnN0cmluZ2lmeShpb3NQYXlsb2FkKSxcbiAgICAgICAgICBlbWFpbDogZW1haWxTbXNNZXNzYWdlLFxuICAgICAgICAgIHNtczogdGhpcy5mb3JtYXRTTVNNZXNzYWdlKGNvc3RBbmFseXNpcywgYWxlcnRDb250ZXh0KVxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFNpbXBsZSBtZXNzYWdlIGZvciBlbWFpbC9TTVMgb25seVxuICAgICAgICBtZXNzYWdlID0gZW1haWxTbXNNZXNzYWdlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBwdWJsaXNoSW5wdXQ6IFB1Ymxpc2hDb21tYW5kSW5wdXQgPSB7XG4gICAgICAgIFRvcGljQXJuOiB0b3BpY0FybixcbiAgICAgICAgTWVzc2FnZTogbWVzc2FnZSxcbiAgICAgICAgTWVzc2FnZVN0cnVjdHVyZTogbWVzc2FnZVN0cnVjdHVyZSxcbiAgICAgICAgU3ViamVjdDogYEFXUyBTcGVuZCBBbGVydDogJCR7YWxlcnRDb250ZXh0LmV4Y2VlZEFtb3VudC50b0ZpeGVkKDIpfSBvdmVyIGJ1ZGdldGAsXG4gICAgICAgIE1lc3NhZ2VBdHRyaWJ1dGVzOiBtZXNzYWdlQXR0cmlidXRlc1xuICAgICAgfTtcblxuICAgICAgYXdhaXQgdGhpcy5leGVjdXRlV2l0aFJldHJ5KCgpID0+IHRoaXMuc25zQ2xpZW50LnNlbmQobmV3IFB1Ymxpc2hDb21tYW5kKHB1Ymxpc2hJbnB1dCkpKTtcblxuICAgICAgdGhpcy5hbGVydExvZ2dlci5pbmZvKCdTcGVuZCBhbGVydCBzZW50IHN1Y2Nlc3NmdWxseScsIHtcbiAgICAgICAgdG90YWxDb3N0OiBjb3N0QW5hbHlzaXMudG90YWxDb3N0LFxuICAgICAgICB0aHJlc2hvbGQ6IGFsZXJ0Q29udGV4dC50aHJlc2hvbGQsXG4gICAgICAgIGV4Y2VlZEFtb3VudDogYWxlcnRDb250ZXh0LmV4Y2VlZEFtb3VudCxcbiAgICAgICAgYWxlcnRMZXZlbDogYWxlcnRDb250ZXh0LmFsZXJ0TGV2ZWwsXG4gICAgICAgIHRvcFNlcnZpY2VzOiBhbGVydENvbnRleHQudG9wU2VydmljZXMubGVuZ3RoLFxuICAgICAgICBoYXNJT1NQYXlsb2FkOiAhIWlvc1BheWxvYWRcbiAgICAgIH0pO1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuYWxlcnRMb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byBzZW5kIHNwZW5kIGFsZXJ0JywgZXJyb3IgYXMgRXJyb3IsIHtcbiAgICAgICAgdG9waWNBcm4sXG4gICAgICAgIHRvdGFsQ29zdDogY29zdEFuYWx5c2lzLnRvdGFsQ29zdCxcbiAgICAgICAgdGhyZXNob2xkOiBhbGVydENvbnRleHQudGhyZXNob2xkXG4gICAgICB9KTtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQWxlcnQgZGVsaXZlcnkgZmFpbGVkOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InfWApO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBGb3JtYXRzIGFsZXJ0IG1lc3NhZ2UgZm9yIGVtYWlsIGFuZCBnZW5lcmFsIGRpc3BsYXlcbiAgICovXG4gIGZvcm1hdEFsZXJ0TWVzc2FnZShjb3N0QW5hbHlzaXM6IENvc3RBbmFseXNpcywgYWxlcnRDb250ZXh0OiBBbGVydENvbnRleHQpOiBzdHJpbmcge1xuICAgIGNvbnN0IGxpbmVzID0gW1xuICAgICAgYPCfmqggQVdTIFNwZW5kIEFsZXJ0IC0gJHthbGVydENvbnRleHQuYWxlcnRMZXZlbH1gLFxuICAgICAgJycsXG4gICAgICBgWW91ciBBV1Mgc3BlbmRpbmcgaGFzIGV4Y2VlZGVkIHRoZSBjb25maWd1cmVkIHRocmVzaG9sZC5gLFxuICAgICAgJycsXG4gICAgICBg8J+SsCBDdXJyZW50IFNwZW5kaW5nOiAkJHtjb3N0QW5hbHlzaXMudG90YWxDb3N0LnRvRml4ZWQoMil9YCxcbiAgICAgIGDwn46vIFRocmVzaG9sZDogJCR7YWxlcnRDb250ZXh0LnRocmVzaG9sZC50b0ZpeGVkKDIpfWAsXG4gICAgICBg8J+TiCBPdmVyIEJ1ZGdldDogJCR7YWxlcnRDb250ZXh0LmV4Y2VlZEFtb3VudC50b0ZpeGVkKDIpfSAoJHthbGVydENvbnRleHQucGVyY2VudGFnZU92ZXIudG9GaXhlZCgxKX0lKWAsXG4gICAgICBg8J+TiiBQcm9qZWN0ZWQgTW9udGhseTogJCR7Y29zdEFuYWx5c2lzLnByb2plY3RlZE1vbnRobHkudG9GaXhlZCgyKX1gLFxuICAgICAgJycsXG4gICAgICBg8J+ThSBQZXJpb2Q6ICR7dGhpcy5mb3JtYXREYXRlUmFuZ2UoY29zdEFuYWx5c2lzLnBlcmlvZCl9YCxcbiAgICAgICcnXG4gICAgXTtcblxuICAgIGlmIChhbGVydENvbnRleHQudG9wU2VydmljZXMubGVuZ3RoID4gMCkge1xuICAgICAgbGluZXMucHVzaCgn8J+UnSBUb3AgQ29zdC1Ecml2aW5nIFNlcnZpY2VzOicpO1xuICAgICAgYWxlcnRDb250ZXh0LnRvcFNlcnZpY2VzLmZvckVhY2goKHNlcnZpY2UsIGluZGV4KSA9PiB7XG4gICAgICAgIGxpbmVzLnB1c2goYCR7aW5kZXggKyAxfS4gJHtzZXJ2aWNlLnNlcnZpY2VOYW1lfTogJCR7c2VydmljZS5jb3N0LnRvRml4ZWQoMil9ICgke3NlcnZpY2UucGVyY2VudGFnZS50b0ZpeGVkKDEpfSUpYCk7XG4gICAgICB9KTtcbiAgICAgIGxpbmVzLnB1c2goJycpO1xuICAgIH1cblxuICAgIGxpbmVzLnB1c2goXG4gICAgICAn8J+SoSBSZWNvbW1lbmRhdGlvbnM6JyxcbiAgICAgICfigKIgUmV2aWV3IHlvdXIgQVdTIHJlc291cmNlcyBhbmQgdXNhZ2UgcGF0dGVybnMnLFxuICAgICAgJ+KAoiBDb25zaWRlciBzY2FsaW5nIGRvd24gb3IgdGVybWluYXRpbmcgdW51c2VkIHJlc291cmNlcycsXG4gICAgICAn4oCiIENoZWNrIGZvciBhbnkgdW5leHBlY3RlZCBjaGFyZ2VzIG9yIHNlcnZpY2VzJyxcbiAgICAgICfigKIgU2V0IHVwIGFkZGl0aW9uYWwgQ2xvdWRXYXRjaCBhbGFybXMgZm9yIHNwZWNpZmljIHNlcnZpY2VzJyxcbiAgICAgICcnLFxuICAgICAgYOKPsCBBbGVydCBnZW5lcmF0ZWQgYXQ6ICR7bmV3IERhdGUoKS50b0xvY2FsZVN0cmluZygnZW4tVVMnLCB7IHRpbWVab25lOiAnVVRDJyB9KX0gVVRDYFxuICAgICk7XG5cbiAgICByZXR1cm4gbGluZXMuam9pbignXFxuJyk7XG4gIH1cblxuICAvKipcbiAgICogRm9ybWF0cyBhIHNob3J0ZXIgbWVzc2FnZSBmb3IgU01TIGRlbGl2ZXJ5XG4gICAqL1xuICBmb3JtYXRTTVNNZXNzYWdlKGNvc3RBbmFseXNpczogQ29zdEFuYWx5c2lzLCBhbGVydENvbnRleHQ6IEFsZXJ0Q29udGV4dCk6IHN0cmluZyB7XG4gICAgY29uc3QgdG9wU2VydmljZSA9IGFsZXJ0Q29udGV4dC50b3BTZXJ2aWNlc1swXTtcbiAgICBjb25zdCB0b3BTZXJ2aWNlVGV4dCA9IHRvcFNlcnZpY2UgPyBgIFRvcCBzZXJ2aWNlOiAke3RvcFNlcnZpY2Uuc2VydmljZU5hbWV9ICgkJHt0b3BTZXJ2aWNlLmNvc3QudG9GaXhlZCgyKX0pYCA6ICcnO1xuICAgIFxuICAgIHJldHVybiBgQVdTIFNwZW5kIEFsZXJ0OiAkJHtjb3N0QW5hbHlzaXMudG90YWxDb3N0LnRvRml4ZWQoMil9IHNwZW50IChvdmVyICQke2FsZXJ0Q29udGV4dC50aHJlc2hvbGR9IHRocmVzaG9sZCBieSAkJHthbGVydENvbnRleHQuZXhjZWVkQW1vdW50LnRvRml4ZWQoMil9KS4ke3RvcFNlcnZpY2VUZXh0fSBQcm9qZWN0ZWQgbW9udGhseTogJCR7Y29zdEFuYWx5c2lzLnByb2plY3RlZE1vbnRobHkudG9GaXhlZCgyKX1gO1xuICB9XG5cbiAgLyoqXG4gICAqIEZvcm1hdHMgaU9TIHB1c2ggbm90aWZpY2F0aW9uIHBheWxvYWRcbiAgICovXG4gIGZvcm1hdElPU1BheWxvYWQoY29zdEFuYWx5c2lzOiBDb3N0QW5hbHlzaXMsIGFsZXJ0Q29udGV4dDogQWxlcnRDb250ZXh0KTogQVBOU1BheWxvYWQge1xuICAgIGNvbnN0IHRvcFNlcnZpY2UgPSBhbGVydENvbnRleHQudG9wU2VydmljZXNbMF07XG4gICAgY29uc3QgYWxlcnRJZCA9IGBzcGVuZC1hbGVydC0ke0RhdGUubm93KCl9YDtcblxuICAgIHJldHVybiB7XG4gICAgICBhcHM6IHtcbiAgICAgICAgYWxlcnQ6IHtcbiAgICAgICAgICB0aXRsZTogJ0FXUyBTcGVuZCBBbGVydCcsXG4gICAgICAgICAgYm9keTogYCQke2Nvc3RBbmFseXNpcy50b3RhbENvc3QudG9GaXhlZCgyKX0gc3BlbnQgLSAkJHthbGVydENvbnRleHQuZXhjZWVkQW1vdW50LnRvRml4ZWQoMil9IG92ZXIgYnVkZ2V0YCxcbiAgICAgICAgICBzdWJ0aXRsZTogYWxlcnRDb250ZXh0LmFsZXJ0TGV2ZWwgPT09ICdDUklUSUNBTCcgPyAnQ3JpdGljYWwgQnVkZ2V0IEV4Y2VlZGVkJyA6ICdCdWRnZXQgVGhyZXNob2xkIEV4Y2VlZGVkJ1xuICAgICAgICB9LFxuICAgICAgICBiYWRnZTogMSxcbiAgICAgICAgc291bmQ6IGFsZXJ0Q29udGV4dC5hbGVydExldmVsID09PSAnQ1JJVElDQUwnID8gJ2NyaXRpY2FsLWFsZXJ0LmNhZicgOiAnZGVmYXVsdCcsXG4gICAgICAgICdjb250ZW50LWF2YWlsYWJsZSc6IDFcbiAgICAgIH0sXG4gICAgICBjdXN0b21EYXRhOiB7XG4gICAgICAgIHNwZW5kQW1vdW50OiBjb3N0QW5hbHlzaXMudG90YWxDb3N0LFxuICAgICAgICB0aHJlc2hvbGQ6IGFsZXJ0Q29udGV4dC50aHJlc2hvbGQsXG4gICAgICAgIGV4Y2VlZEFtb3VudDogYWxlcnRDb250ZXh0LmV4Y2VlZEFtb3VudCxcbiAgICAgICAgdG9wU2VydmljZTogdG9wU2VydmljZT8uc2VydmljZU5hbWUgfHwgJ1Vua25vd24nLFxuICAgICAgICBhbGVydElkXG4gICAgICB9XG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGFsZXJ0IGNvbnRleHQgZnJvbSBjb3N0IGFuYWx5c2lzIGFuZCB0aHJlc2hvbGRcbiAgICovXG4gIGNyZWF0ZUFsZXJ0Q29udGV4dChjb3N0QW5hbHlzaXM6IENvc3RBbmFseXNpcywgdGhyZXNob2xkOiBudW1iZXIsIHRvcFNlcnZpY2VzOiBTZXJ2aWNlQ29zdFtdKTogQWxlcnRDb250ZXh0IHtcbiAgICBjb25zdCBleGNlZWRBbW91bnQgPSBjb3N0QW5hbHlzaXMudG90YWxDb3N0IC0gdGhyZXNob2xkO1xuICAgIGNvbnN0IHBlcmNlbnRhZ2VPdmVyID0gKGV4Y2VlZEFtb3VudCAvIHRocmVzaG9sZCkgKiAxMDA7XG4gICAgXG4gICAgLy8gRGV0ZXJtaW5lIGFsZXJ0IGxldmVsIGJhc2VkIG9uIGhvdyBtdWNoIG92ZXIgdGhyZXNob2xkXG4gICAgY29uc3QgYWxlcnRMZXZlbDogJ1dBUk5JTkcnIHwgJ0NSSVRJQ0FMJyA9IHBlcmNlbnRhZ2VPdmVyID4gNTAgPyAnQ1JJVElDQUwnIDogJ1dBUk5JTkcnO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHRocmVzaG9sZCxcbiAgICAgIGV4Y2VlZEFtb3VudCxcbiAgICAgIHBlcmNlbnRhZ2VPdmVyLFxuICAgICAgdG9wU2VydmljZXMsXG4gICAgICBhbGVydExldmVsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgbm90aWZpY2F0aW9uIGNoYW5uZWxzIGFuZCB0b3BpYyBjb25maWd1cmF0aW9uXG4gICAqL1xuICBhc3luYyB2YWxpZGF0ZUNoYW5uZWxzKHRvcGljQXJuOiBzdHJpbmcpOiBQcm9taXNlPHsgZW1haWw6IGJvb2xlYW47IHNtczogYm9vbGVhbjsgaW9zOiBib29sZWFuIH0+IHtcbiAgICB0cnkge1xuICAgICAgLy8gSW4gYSByZWFsIGltcGxlbWVudGF0aW9uLCB5b3Ugd291bGQgY2FsbCBTTlMgR2V0VG9waWNBdHRyaWJ1dGVzXG4gICAgICAvLyBhbmQgTGlzdFN1YnNjcmlwdGlvbnNCeVRvcGljIHRvIGNoZWNrIGF2YWlsYWJsZSBjaGFubmVsc1xuICAgICAgLy8gRm9yIG5vdywgd2UnbGwgcmV0dXJuIGEgYmFzaWMgdmFsaWRhdGlvblxuICAgICAgXG4gICAgICBjb25zdCBpc1ZhbGlkQXJuID0gdGhpcy5pc1ZhbGlkU05TVG9waWNBcm4odG9waWNBcm4pO1xuICAgICAgXG4gICAgICByZXR1cm4ge1xuICAgICAgICBlbWFpbDogaXNWYWxpZEFybixcbiAgICAgICAgc21zOiBpc1ZhbGlkQXJuLFxuICAgICAgICBpb3M6IGlzVmFsaWRBcm5cbiAgICAgIH07XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuYWxlcnRMb2dnZXIud2FybignRmFpbGVkIHRvIHZhbGlkYXRlIG5vdGlmaWNhdGlvbiBjaGFubmVscycsIHsgZXJyb3IsIHRvcGljQXJuIH0pO1xuICAgICAgcmV0dXJuIHsgZW1haWw6IGZhbHNlLCBzbXM6IGZhbHNlLCBpb3M6IGZhbHNlIH07XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEZvcm1hdHMgZGF0ZSByYW5nZSBmb3IgZGlzcGxheVxuICAgKi9cbiAgcHJpdmF0ZSBmb3JtYXREYXRlUmFuZ2UocGVyaW9kOiB7IHN0YXJ0OiBzdHJpbmc7IGVuZDogc3RyaW5nIH0pOiBzdHJpbmcge1xuICAgIGNvbnN0IHN0YXJ0RGF0ZSA9IG5ldyBEYXRlKHBlcmlvZC5zdGFydCk7XG4gICAgY29uc3QgZW5kRGF0ZSA9IG5ldyBEYXRlKHBlcmlvZC5lbmQpO1xuICAgIFxuICAgIGNvbnN0IGZvcm1hdE9wdGlvbnM6IEludGwuRGF0ZVRpbWVGb3JtYXRPcHRpb25zID0ge1xuICAgICAgeWVhcjogJ251bWVyaWMnLFxuICAgICAgbW9udGg6ICdzaG9ydCcsXG4gICAgICBkYXk6ICdudW1lcmljJyxcbiAgICAgIHRpbWVab25lOiAnVVRDJ1xuICAgIH07XG5cbiAgICByZXR1cm4gYCR7c3RhcnREYXRlLnRvTG9jYWxlRGF0ZVN0cmluZygnZW4tVVMnLCBmb3JtYXRPcHRpb25zKX0gLSAke2VuZERhdGUudG9Mb2NhbGVEYXRlU3RyaW5nKCdlbi1VUycsIGZvcm1hdE9wdGlvbnMpfWA7XG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIFNOUyB0b3BpYyBBUk4gZm9ybWF0XG4gICAqL1xuICBwcml2YXRlIGlzVmFsaWRTTlNUb3BpY0Fybihhcm46IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IHNuc1RvcGljQXJuUGF0dGVybiA9IC9eYXJuOmF3czpzbnM6W2EtejAtOS1dKzpcXGR7MTJ9OlthLXpBLVowLTlfLV0rJC87XG4gICAgcmV0dXJuIHNuc1RvcGljQXJuUGF0dGVybi50ZXN0KGFybik7XG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgU05TIG9wZXJhdGlvbnMgd2l0aCByZXRyeSBsb2dpY1xuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBleGVjdXRlV2l0aFJldHJ5PFQ+KGZuOiAoKSA9PiBQcm9taXNlPFQ+KTogUHJvbWlzZTxUPiB7XG4gICAgbGV0IGxhc3RFcnJvcjogRXJyb3I7XG4gICAgXG4gICAgZm9yIChsZXQgYXR0ZW1wdCA9IDE7IGF0dGVtcHQgPD0gdGhpcy5yZXRyeUNvbmZpZy5tYXhBdHRlbXB0czsgYXR0ZW1wdCsrKSB7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gYXdhaXQgZm4oKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxhc3RFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcignVW5rbm93biBlcnJvcicpO1xuICAgICAgICBcbiAgICAgICAgaWYgKGF0dGVtcHQgPT09IHRoaXMucmV0cnlDb25maWcubWF4QXR0ZW1wdHMpIHtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENoZWNrIGlmIGVycm9yIGlzIHJldHJ5YWJsZVxuICAgICAgICBpZiAoIXRoaXMuaXNSZXRyeWFibGVFcnJvcihlcnJvcikpIHtcbiAgICAgICAgICB0aHJvdyBsYXN0RXJyb3I7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBkZWxheSA9IE1hdGgubWluKFxuICAgICAgICAgIHRoaXMucmV0cnlDb25maWcuYmFzZURlbGF5ICogTWF0aC5wb3codGhpcy5yZXRyeUNvbmZpZy5iYWNrb2ZmTXVsdGlwbGllciwgYXR0ZW1wdCAtIDEpLFxuICAgICAgICAgIHRoaXMucmV0cnlDb25maWcubWF4RGVsYXlcbiAgICAgICAgKTtcblxuICAgICAgICB0aGlzLmFsZXJ0TG9nZ2VyLndhcm4oYFNOUyBvcGVyYXRpb24gZmFpbGVkLCByZXRyeWluZyBpbiAke2RlbGF5fW1zYCwge1xuICAgICAgICAgIGF0dGVtcHQsXG4gICAgICAgICAgbWF4QXR0ZW1wdHM6IHRoaXMucmV0cnlDb25maWcubWF4QXR0ZW1wdHMsXG4gICAgICAgICAgZXJyb3I6IGxhc3RFcnJvci5tZXNzYWdlXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGF3YWl0IHRoaXMuc2xlZXAoZGVsYXkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHRocm93IGxhc3RFcnJvciE7XG4gIH1cblxuICAvKipcbiAgICogRGV0ZXJtaW5lcyBpZiBhbiBTTlMgZXJyb3IgaXMgcmV0cnlhYmxlXG4gICAqL1xuICBwcml2YXRlIGlzUmV0cnlhYmxlRXJyb3IoZXJyb3I6IGFueSk6IGJvb2xlYW4ge1xuICAgIGlmICghZXJyb3IpIHJldHVybiBmYWxzZTtcblxuICAgIC8vIEFXUyBTREsgZXJyb3IgY29kZXMgdGhhdCBhcmUgcmV0cnlhYmxlXG4gICAgY29uc3QgcmV0cnlhYmxlRXJyb3JDb2RlcyA9IFtcbiAgICAgICdUaHJvdHRsaW5nRXhjZXB0aW9uJyxcbiAgICAgICdUaHJvdHRsaW5nJyxcbiAgICAgICdUb29NYW55UmVxdWVzdHNFeGNlcHRpb24nLFxuICAgICAgJ1NlcnZpY2VVbmF2YWlsYWJsZScsXG4gICAgICAnSW50ZXJuYWxTZXJ2ZXJFcnJvcicsXG4gICAgICAnUmVxdWVzdFRpbWVvdXQnLFxuICAgICAgJ0ludGVybmFsRXJyb3InXG4gICAgXTtcblxuICAgIC8vIENoZWNrIGVycm9yIGNvZGVcbiAgICBpZiAoZXJyb3IubmFtZSAmJiByZXRyeWFibGVFcnJvckNvZGVzLmluY2x1ZGVzKGVycm9yLm5hbWUpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBDaGVjayBIVFRQIHN0YXR1cyBjb2Rlc1xuICAgIGlmIChlcnJvci4kbWV0YWRhdGE/Lmh0dHBTdGF0dXNDb2RlKSB7XG4gICAgICBjb25zdCBzdGF0dXNDb2RlID0gZXJyb3IuJG1ldGFkYXRhLmh0dHBTdGF0dXNDb2RlO1xuICAgICAgcmV0dXJuIHN0YXR1c0NvZGUgPj0gNTAwIHx8IHN0YXR1c0NvZGUgPT09IDQyOTtcbiAgICB9XG5cbiAgICAvLyBDaGVjayBmb3IgbmV0d29yayBlcnJvcnNcbiAgICBpZiAoZXJyb3IuY29kZSA9PT0gJ0VDT05OUkVTRVQnIHx8IGVycm9yLmNvZGUgPT09ICdFVElNRURPVVQnKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvKipcbiAgICogU2xlZXAgdXRpbGl0eSBmb3IgcmV0cnkgZGVsYXlzXG4gICAqL1xuICBwcml2YXRlIHNsZWVwKG1zOiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIG1zKSk7XG4gIH1cblxuICAvKipcbiAgICogU2VuZHMgYSB0ZXN0IGFsZXJ0IHRvIHZlcmlmeSBub3RpZmljYXRpb24gc2V0dXBcbiAgICovXG4gIGFzeW5jIHNlbmRUZXN0QWxlcnQodG9waWNBcm46IHN0cmluZywgaW9zQ29uZmlnPzogeyBwbGF0Zm9ybUFwcGxpY2F0aW9uQXJuOiBzdHJpbmc7IGJ1bmRsZUlkOiBzdHJpbmcgfSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHRlc3RDb3N0QW5hbHlzaXM6IENvc3RBbmFseXNpcyA9IHtcbiAgICAgIHRvdGFsQ29zdDogMTUuNTAsXG4gICAgICBzZXJ2aWNlQnJlYWtkb3duOiB7XG4gICAgICAgICdBbWF6b24gRWxhc3RpYyBDb21wdXRlIENsb3VkIC0gQ29tcHV0ZSc6IDEwLjAwLFxuICAgICAgICAnQW1hem9uIFNpbXBsZSBTdG9yYWdlIFNlcnZpY2UnOiAzLjUwLFxuICAgICAgICAnQVdTIExhbWJkYSc6IDIuMDBcbiAgICAgIH0sXG4gICAgICBwZXJpb2Q6IHtcbiAgICAgICAgc3RhcnQ6IG5ldyBEYXRlKG5ldyBEYXRlKCkuZ2V0RnVsbFllYXIoKSwgbmV3IERhdGUoKS5nZXRNb250aCgpLCAxKS50b0lTT1N0cmluZygpLFxuICAgICAgICBlbmQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgfSxcbiAgICAgIHByb2plY3RlZE1vbnRobHk6IDMxLjAwLFxuICAgICAgY3VycmVuY3k6ICdVU0QnLFxuICAgICAgbGFzdFVwZGF0ZWQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIH07XG5cbiAgICBjb25zdCB0ZXN0VG9wU2VydmljZXM6IFNlcnZpY2VDb3N0W10gPSBbXG4gICAgICB7IHNlcnZpY2VOYW1lOiAnQW1hem9uIEVsYXN0aWMgQ29tcHV0ZSBDbG91ZCAtIENvbXB1dGUnLCBjb3N0OiAxMC4wMCwgcGVyY2VudGFnZTogNjQuNSB9LFxuICAgICAgeyBzZXJ2aWNlTmFtZTogJ0FtYXpvbiBTaW1wbGUgU3RvcmFnZSBTZXJ2aWNlJywgY29zdDogMy41MCwgcGVyY2VudGFnZTogMjIuNiB9LFxuICAgICAgeyBzZXJ2aWNlTmFtZTogJ0FXUyBMYW1iZGEnLCBjb3N0OiAyLjAwLCBwZXJjZW50YWdlOiAxMi45IH1cbiAgICBdO1xuXG4gICAgY29uc3QgdGVzdEFsZXJ0Q29udGV4dCA9IHRoaXMuY3JlYXRlQWxlcnRDb250ZXh0KHRlc3RDb3N0QW5hbHlzaXMsIDEwLjAwLCB0ZXN0VG9wU2VydmljZXMpO1xuXG4gICAgYXdhaXQgdGhpcy5zZW5kU3BlbmRBbGVydCh0ZXN0Q29zdEFuYWx5c2lzLCB0ZXN0QWxlcnRDb250ZXh0LCB0b3BpY0FybiwgaW9zQ29uZmlnKTtcbiAgICBcbiAgICB0aGlzLmFsZXJ0TG9nZ2VyLmluZm8oJ1Rlc3QgYWxlcnQgc2VudCBzdWNjZXNzZnVsbHknLCB7IHRvcGljQXJuIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIERldGVybWluZXMgaWYgYW4gZXJyb3IgaXMgcmVsYXRlZCB0byBpT1MvQVBOUyBkZWxpdmVyeVxuICAgKi9cbiAgcHJpdmF0ZSBpc0lPU1JlbGF0ZWRFcnJvcihlcnJvcjogYW55KTogYm9vbGVhbiB7XG4gICAgaWYgKCFlcnJvcikgcmV0dXJuIGZhbHNlO1xuXG4gICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZXJyb3IubWVzc2FnZT8udG9Mb3dlckNhc2UoKSB8fCAnJztcbiAgICBjb25zdCBlcnJvckNvZGUgPSBlcnJvci5jb2RlPy50b0xvd2VyQ2FzZSgpIHx8ICcnO1xuICAgIGNvbnN0IGVycm9yTmFtZSA9IGVycm9yLm5hbWU/LnRvTG93ZXJDYXNlKCkgfHwgJyc7XG5cbiAgICAvLyBDaGVjayBmb3IgaU9TL0FQTlMgc3BlY2lmaWMgZXJyb3IgaW5kaWNhdG9yc1xuICAgIGNvbnN0IGlvc0Vycm9ySW5kaWNhdG9ycyA9IFtcbiAgICAgICdhcG5zJyxcbiAgICAgICdwbGF0Zm9ybSBlbmRwb2ludCcsXG4gICAgICAnaW52YWxpZCB0b2tlbicsXG4gICAgICAnZW5kcG9pbnQgZGlzYWJsZWQnLFxuICAgICAgJ2NlcnRpZmljYXRlJyxcbiAgICAgICdwbGF0Zm9ybSBhcHBsaWNhdGlvbicsXG4gICAgICAnaW9zJyxcbiAgICAgICdwdXNoIG5vdGlmaWNhdGlvbidcbiAgICBdO1xuXG4gICAgcmV0dXJuIGlvc0Vycm9ySW5kaWNhdG9ycy5zb21lKGluZGljYXRvciA9PiBcbiAgICAgIGVycm9yTWVzc2FnZS5pbmNsdWRlcyhpbmRpY2F0b3IpIHx8IFxuICAgICAgZXJyb3JDb2RlLmluY2x1ZGVzKGluZGljYXRvcikgfHwgXG4gICAgICBlcnJvck5hbWUuaW5jbHVkZXMoaW5kaWNhdG9yKVxuICAgICk7XG4gIH1cblxuICAvKipcbiAgICogRW5oYW5jZWQgYWxlcnQgZGVsaXZlcnkgd2l0aCBjb21wcmVoZW5zaXZlIGlPUyBtb25pdG9yaW5nXG4gICAqL1xuICBhc3luYyBzZW5kU3BlbmRBbGVydFdpdGhJT1NNb25pdG9yaW5nKFxuICAgIGNvc3RBbmFseXNpczogQ29zdEFuYWx5c2lzLFxuICAgIGFsZXJ0Q29udGV4dDogQWxlcnRDb250ZXh0LFxuICAgIHRvcGljQXJuOiBzdHJpbmcsXG4gICAgaW9zQ29uZmlnPzogeyBwbGF0Zm9ybUFwcGxpY2F0aW9uQXJuOiBzdHJpbmc7IGJ1bmRsZUlkOiBzdHJpbmcgfVxuICApOiBQcm9taXNlPHtcbiAgICBzdWNjZXNzOiBib29sZWFuO1xuICAgIGNoYW5uZWxzOiBzdHJpbmdbXTtcbiAgICBpb3NEZWxpdmVyZWQ6IGJvb2xlYW47XG4gICAgZmFsbGJhY2tVc2VkOiBib29sZWFuO1xuICAgIGVycm9yczogc3RyaW5nW107XG4gICAgbWV0cmljczoge1xuICAgICAgZGVsaXZlcnlUaW1lOiBudW1iZXI7XG4gICAgICByZXRyeUNvdW50OiBudW1iZXI7XG4gICAgICBwYXlsb2FkU2l6ZTogbnVtYmVyO1xuICAgIH07XG4gIH0+IHtcbiAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIGNvbnN0IHRpbWVyID0gdGhpcy5tZXRyaWNzLmNyZWF0ZVRpbWVyKCdTZW5kU3BlbmRBbGVydFdpdGhNb25pdG9yaW5nJyk7XG4gICAgY29uc3QgY2hhbm5lbHM6IHN0cmluZ1tdID0gW107XG4gICAgbGV0IGlvc0RlbGl2ZXJ5QXR0ZW1wdGVkID0gZmFsc2U7XG4gICAgbGV0IGlvc0RlbGl2ZXJ5U3VjY2Vzc2Z1bCA9IGZhbHNlO1xuICAgIGxldCBmYWxsYmFja1VzZWQgPSBmYWxzZTtcbiAgICBjb25zdCBkZWxpdmVyeUVycm9yczogc3RyaW5nW10gPSBbXTtcbiAgICBsZXQgcmV0cnlDb3VudCA9IDA7XG5cbiAgICB0cnkge1xuICAgICAgdGhpcy5hbGVydExvZ2dlci5pbmZvKCdTdGFydGluZyBlbmhhbmNlZCBzcGVuZCBhbGVydCBkZWxpdmVyeSB3aXRoIGlPUyBtb25pdG9yaW5nJywge1xuICAgICAgICB0b3RhbENvc3Q6IGNvc3RBbmFseXNpcy50b3RhbENvc3QsXG4gICAgICAgIHRocmVzaG9sZDogYWxlcnRDb250ZXh0LnRocmVzaG9sZCxcbiAgICAgICAgZXhjZWVkQW1vdW50OiBhbGVydENvbnRleHQuZXhjZWVkQW1vdW50LFxuICAgICAgICBhbGVydExldmVsOiBhbGVydENvbnRleHQuYWxlcnRMZXZlbCxcbiAgICAgICAgaGFzSU9TQ29uZmlnOiAhIWlvc0NvbmZpZ1xuICAgICAgfSk7XG5cbiAgICAgIC8vIEZvcm1hdCBtZXNzYWdlcyBmb3IgZGlmZmVyZW50IGNoYW5uZWxzXG4gICAgICBjb25zdCBlbWFpbFNtc01lc3NhZ2UgPSB0aGlzLmZvcm1hdEFsZXJ0TWVzc2FnZShjb3N0QW5hbHlzaXMsIGFsZXJ0Q29udGV4dCk7XG4gICAgICBjb25zdCBpb3NQYXlsb2FkID0gaW9zQ29uZmlnID8gdGhpcy5mb3JtYXRJT1NQYXlsb2FkKGNvc3RBbmFseXNpcywgYWxlcnRDb250ZXh0KSA6IG51bGw7XG4gICAgICBjb25zdCBwYXlsb2FkU2l6ZSA9IGlvc1BheWxvYWQgPyBKU09OLnN0cmluZ2lmeShpb3NQYXlsb2FkKS5sZW5ndGggOiBlbWFpbFNtc01lc3NhZ2UubGVuZ3RoO1xuXG4gICAgICAvLyBEZXRlcm1pbmUgYXZhaWxhYmxlIGNoYW5uZWxzXG4gICAgICBjaGFubmVscy5wdXNoKCdlbWFpbCcsICdzbXMnKTtcbiAgICAgIGlmIChpb3NQYXlsb2FkKSB7XG4gICAgICAgIGNoYW5uZWxzLnB1c2goJ2lvcycpO1xuICAgICAgICBpb3NEZWxpdmVyeUF0dGVtcHRlZCA9IHRydWU7XG4gICAgICB9XG5cbiAgICAgIC8vIExvZyBpT1MgcGF5bG9hZCBkZXRhaWxzIGZvciBtb25pdG9yaW5nXG4gICAgICBpZiAoaW9zUGF5bG9hZCkge1xuICAgICAgICB0aGlzLmFsZXJ0TG9nZ2VyLmRlYnVnKCdpT1MgcGF5bG9hZCBwcmVwYXJlZCcsIHtcbiAgICAgICAgICBwYXlsb2FkU2l6ZSxcbiAgICAgICAgICBhbGVydFRpdGxlOiBpb3NQYXlsb2FkLmFwcy5hbGVydC50aXRsZSxcbiAgICAgICAgICBhbGVydEJvZHk6IGlvc1BheWxvYWQuYXBzLmFsZXJ0LmJvZHksXG4gICAgICAgICAgYmFkZ2U6IGlvc1BheWxvYWQuYXBzLmJhZGdlLFxuICAgICAgICAgIHNvdW5kOiBpb3NQYXlsb2FkLmFwcy5zb3VuZCxcbiAgICAgICAgICBjdXN0b21EYXRhS2V5czogT2JqZWN0LmtleXMoaW9zUGF5bG9hZC5jdXN0b21EYXRhKVxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gQ3JlYXRlIGVuaGFuY2VkIG1lc3NhZ2UgYXR0cmlidXRlc1xuICAgICAgY29uc3QgbWVzc2FnZUF0dHJpYnV0ZXM6IGFueSA9IHtcbiAgICAgICAgJ2FsZXJ0X2xldmVsJzoge1xuICAgICAgICAgIERhdGFUeXBlOiAnU3RyaW5nJyxcbiAgICAgICAgICBTdHJpbmdWYWx1ZTogYWxlcnRDb250ZXh0LmFsZXJ0TGV2ZWxcbiAgICAgICAgfSxcbiAgICAgICAgJ3NwZW5kX2Ftb3VudCc6IHtcbiAgICAgICAgICBEYXRhVHlwZTogJ051bWJlcicsXG4gICAgICAgICAgU3RyaW5nVmFsdWU6IGNvc3RBbmFseXNpcy50b3RhbENvc3QudG9TdHJpbmcoKVxuICAgICAgICB9LFxuICAgICAgICAndGhyZXNob2xkJzoge1xuICAgICAgICAgIERhdGFUeXBlOiAnTnVtYmVyJyxcbiAgICAgICAgICBTdHJpbmdWYWx1ZTogYWxlcnRDb250ZXh0LnRocmVzaG9sZC50b1N0cmluZygpXG4gICAgICAgIH0sXG4gICAgICAgICdkZWxpdmVyeV90aW1lc3RhbXAnOiB7XG4gICAgICAgICAgRGF0YVR5cGU6ICdTdHJpbmcnLFxuICAgICAgICAgIFN0cmluZ1ZhbHVlOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgaWYgKGlvc0RlbGl2ZXJ5QXR0ZW1wdGVkKSB7XG4gICAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzWydpb3NfcGF5bG9hZF9zaXplJ10gPSB7XG4gICAgICAgICAgRGF0YVR5cGU6ICdOdW1iZXInLFxuICAgICAgICAgIFN0cmluZ1ZhbHVlOiBwYXlsb2FkU2l6ZS50b1N0cmluZygpXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIC8vIFByZXBhcmUgdGhlIG1lc3NhZ2Ugc3RydWN0dXJlIGZvciBTTlNcbiAgICAgIGxldCBtZXNzYWdlOiBzdHJpbmc7XG4gICAgICBsZXQgbWVzc2FnZVN0cnVjdHVyZTogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG4gICAgICBpZiAoaW9zUGF5bG9hZCkge1xuICAgICAgICBtZXNzYWdlU3RydWN0dXJlID0gJ2pzb24nO1xuICAgICAgICBtZXNzYWdlID0gSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGRlZmF1bHQ6IGVtYWlsU21zTWVzc2FnZSxcbiAgICAgICAgICBBUE5TOiBKU09OLnN0cmluZ2lmeShpb3NQYXlsb2FkKSxcbiAgICAgICAgICBBUE5TX1NBTkRCT1g6IEpTT04uc3RyaW5naWZ5KGlvc1BheWxvYWQpLFxuICAgICAgICAgIGVtYWlsOiBlbWFpbFNtc01lc3NhZ2UsXG4gICAgICAgICAgc21zOiB0aGlzLmZvcm1hdFNNU01lc3NhZ2UoY29zdEFuYWx5c2lzLCBhbGVydENvbnRleHQpXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbWVzc2FnZSA9IGVtYWlsU21zTWVzc2FnZTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcHVibGlzaElucHV0OiBQdWJsaXNoQ29tbWFuZElucHV0ID0ge1xuICAgICAgICBUb3BpY0FybjogdG9waWNBcm4sXG4gICAgICAgIE1lc3NhZ2U6IG1lc3NhZ2UsXG4gICAgICAgIE1lc3NhZ2VTdHJ1Y3R1cmU6IG1lc3NhZ2VTdHJ1Y3R1cmUsXG4gICAgICAgIFN1YmplY3Q6IGBBV1MgU3BlbmQgQWxlcnQ6ICQke2FsZXJ0Q29udGV4dC5leGNlZWRBbW91bnQudG9GaXhlZCgyKX0gb3ZlciBidWRnZXRgLFxuICAgICAgICBNZXNzYWdlQXR0cmlidXRlczogbWVzc2FnZUF0dHJpYnV0ZXNcbiAgICAgIH07XG5cbiAgICAgIC8vIEF0dGVtcHQgcHJpbWFyeSBkZWxpdmVyeSB3aXRoIGVuaGFuY2VkIGVycm9yIGhhbmRsaW5nXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmV4ZWN1dGVXaXRoUmV0cnlXaXRoTWV0cmljcyhcbiAgICAgICAgICAoKSA9PiB0aGlzLnNuc0NsaWVudC5zZW5kKG5ldyBQdWJsaXNoQ29tbWFuZChwdWJsaXNoSW5wdXQpKSxcbiAgICAgICAgICAoYXR0ZW1wdCkgPT4geyByZXRyeUNvdW50ID0gYXR0ZW1wdCAtIDE7IH1cbiAgICAgICAgKTtcbiAgICAgICAgXG4gICAgICAgIGlmIChpb3NEZWxpdmVyeUF0dGVtcHRlZCkge1xuICAgICAgICAgIGlvc0RlbGl2ZXJ5U3VjY2Vzc2Z1bCA9IHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmFsZXJ0TG9nZ2VyLmluZm8oJ0VuaGFuY2VkIHNwZW5kIGFsZXJ0IHNlbnQgc3VjY2Vzc2Z1bGx5Jywge1xuICAgICAgICAgIG1lc3NhZ2VJZDogcmVzdWx0Lk1lc3NhZ2VJZCxcbiAgICAgICAgICBjaGFubmVscyxcbiAgICAgICAgICBkZWxpdmVyeVRpbWU6IERhdGUubm93KCkgLSBzdGFydFRpbWUsXG4gICAgICAgICAgcmV0cnlDb3VudCxcbiAgICAgICAgICBwYXlsb2FkU2l6ZSxcbiAgICAgICAgICBpb3NEZWxpdmVyeVN1Y2Nlc3NmdWxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gUmVjb3JkIGRldGFpbGVkIHN1Y2Nlc3MgbWV0cmljc1xuICAgICAgICBhd2FpdCB0aGlzLm1ldHJpY3MucmVjb3JkQWxlcnREZWxpdmVyeShjaGFubmVscywgdHJ1ZSwgcmV0cnlDb3VudCk7XG4gICAgICAgIFxuICAgICAgICBpZiAoaW9zRGVsaXZlcnlBdHRlbXB0ZWQpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLm1ldHJpY3MucmVjb3JkSU9TTm90aWZpY2F0aW9uKDEsIGlvc0RlbGl2ZXJ5U3VjY2Vzc2Z1bCwgMCk7XG4gICAgICAgIH1cblxuICAgICAgfSBjYXRjaCAoZGVsaXZlcnlFcnJvcikge1xuICAgICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBkZWxpdmVyeUVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBkZWxpdmVyeUVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBkZWxpdmVyeSBlcnJvcic7XG4gICAgICAgIGRlbGl2ZXJ5RXJyb3JzLnB1c2goZXJyb3JNZXNzYWdlKTtcblxuICAgICAgICB0aGlzLmFsZXJ0TG9nZ2VyLmVycm9yKCdQcmltYXJ5IGVuaGFuY2VkIGFsZXJ0IGRlbGl2ZXJ5IGZhaWxlZCcsIGRlbGl2ZXJ5RXJyb3IgYXMgRXJyb3IsIHtcbiAgICAgICAgICB0b3BpY0FybixcbiAgICAgICAgICBjaGFubmVscyxcbiAgICAgICAgICBpb3NEZWxpdmVyeUF0dGVtcHRlZCxcbiAgICAgICAgICByZXRyeUNvdW50LFxuICAgICAgICAgIHBheWxvYWRTaXplXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEVuaGFuY2VkIGlPUyBmYWxsYmFjayBoYW5kbGluZ1xuICAgICAgICBpZiAoaW9zRGVsaXZlcnlBdHRlbXB0ZWQgJiYgdGhpcy5pc0lPU1JlbGF0ZWRFcnJvcihkZWxpdmVyeUVycm9yKSkge1xuICAgICAgICAgIHRoaXMuYWxlcnRMb2dnZXIud2FybignaU9TIGRlbGl2ZXJ5IGZhaWxlZCwgYXR0ZW1wdGluZyBlbmhhbmNlZCBmYWxsYmFjayB0byBlbWFpbC9TTVMgb25seScsIHtcbiAgICAgICAgICAgIG9yaWdpbmFsRXJyb3I6IGVycm9yTWVzc2FnZSxcbiAgICAgICAgICAgIHBheWxvYWRTaXplXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgXG4gICAgICAgICAgZmFsbGJhY2tVc2VkID0gdHJ1ZTtcbiAgICAgICAgICBcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgZmFsbGJhY2tJbnB1dDogUHVibGlzaENvbW1hbmRJbnB1dCA9IHtcbiAgICAgICAgICAgICAgVG9waWNBcm46IHRvcGljQXJuLFxuICAgICAgICAgICAgICBNZXNzYWdlOiBlbWFpbFNtc01lc3NhZ2UsXG4gICAgICAgICAgICAgIFN1YmplY3Q6IGBBV1MgU3BlbmQgQWxlcnQ6ICQke2FsZXJ0Q29udGV4dC5leGNlZWRBbW91bnQudG9GaXhlZCgyKX0gb3ZlciBidWRnZXQgKGlPUyBkZWxpdmVyeSBmYWlsZWQpYCxcbiAgICAgICAgICAgICAgTWVzc2FnZUF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAgICAgICAuLi5tZXNzYWdlQXR0cmlidXRlcyxcbiAgICAgICAgICAgICAgICAnZmFsbGJhY2tfcmVhc29uJzoge1xuICAgICAgICAgICAgICAgICAgRGF0YVR5cGU6ICdTdHJpbmcnLFxuICAgICAgICAgICAgICAgICAgU3RyaW5nVmFsdWU6ICdpT1MgZGVsaXZlcnkgZmFpbGVkJ1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgJ29yaWdpbmFsX2Vycm9yJzoge1xuICAgICAgICAgICAgICAgICAgRGF0YVR5cGU6ICdTdHJpbmcnLFxuICAgICAgICAgICAgICAgICAgU3RyaW5nVmFsdWU6IGVycm9yTWVzc2FnZS5zdWJzdHJpbmcoMCwgMjU2KSAvLyBUcnVuY2F0ZSBmb3IgU05TIGxpbWl0c1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgY29uc3QgZmFsbGJhY2tSZXN1bHQgPSBhd2FpdCB0aGlzLmV4ZWN1dGVXaXRoUmV0cnlXaXRoTWV0cmljcyhcbiAgICAgICAgICAgICAgKCkgPT4gdGhpcy5zbnNDbGllbnQuc2VuZChuZXcgUHVibGlzaENvbW1hbmQoZmFsbGJhY2tJbnB1dCkpLFxuICAgICAgICAgICAgICAoYXR0ZW1wdCkgPT4geyByZXRyeUNvdW50ICs9IGF0dGVtcHQgLSAxOyB9XG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmFsZXJ0TG9nZ2VyLmluZm8oJ0VuaGFuY2VkIGZhbGxiYWNrIGFsZXJ0IGRlbGl2ZXJ5IHN1Y2Nlc3NmdWwnLCB7XG4gICAgICAgICAgICAgIG1lc3NhZ2VJZDogZmFsbGJhY2tSZXN1bHQuTWVzc2FnZUlkLFxuICAgICAgICAgICAgICBmYWxsYmFja0NoYW5uZWxzOiBbJ2VtYWlsJywgJ3NtcyddLFxuICAgICAgICAgICAgICB0b3RhbERlbGl2ZXJ5VGltZTogRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSxcbiAgICAgICAgICAgICAgdG90YWxSZXRyeUNvdW50OiByZXRyeUNvdW50LFxuICAgICAgICAgICAgICBvcmlnaW5hbEVycm9yOiBlcnJvck1lc3NhZ2VcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBSZWNvcmQgZmFsbGJhY2sgc3VjY2VzcyBtZXRyaWNzXG4gICAgICAgICAgICBhd2FpdCB0aGlzLm1ldHJpY3MucmVjb3JkQWxlcnREZWxpdmVyeShbJ2VtYWlsJywgJ3NtcyddLCB0cnVlLCByZXRyeUNvdW50KTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubWV0cmljcy5yZWNvcmRJT1NOb3RpZmljYXRpb24oMSwgZmFsc2UsIDApO1xuXG4gICAgICAgICAgfSBjYXRjaCAoZmFsbGJhY2tFcnJvcikge1xuICAgICAgICAgICAgY29uc3QgZmFsbGJhY2tFcnJvck1lc3NhZ2UgPSBmYWxsYmFja0Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBmYWxsYmFja0Vycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBmYWxsYmFjayBlcnJvcic7XG4gICAgICAgICAgICBkZWxpdmVyeUVycm9ycy5wdXNoKGBGYWxsYmFjayBmYWlsZWQ6ICR7ZmFsbGJhY2tFcnJvck1lc3NhZ2V9YCk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYWxlcnRMb2dnZXIuZXJyb3IoJ0VuaGFuY2VkIGZhbGxiYWNrIGFsZXJ0IGRlbGl2ZXJ5IGZhaWxlZCcsIGZhbGxiYWNrRXJyb3IgYXMgRXJyb3IsIHtcbiAgICAgICAgICAgICAgdG90YWxSZXRyeUNvdW50OiByZXRyeUNvdW50LFxuICAgICAgICAgICAgICB0b3RhbERlbGl2ZXJ5VGltZTogRGF0ZS5ub3coKSAtIHN0YXJ0VGltZVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFJlY29yZCBjb21wbGV0ZSBmYWlsdXJlIG1ldHJpY3NcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubWV0cmljcy5yZWNvcmRBbGVydERlbGl2ZXJ5KGNoYW5uZWxzLCBmYWxzZSwgcmV0cnlDb3VudCk7XG4gICAgICAgICAgICBpZiAoaW9zRGVsaXZlcnlBdHRlbXB0ZWQpIHtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5tZXRyaWNzLnJlY29yZElPU05vdGlmaWNhdGlvbigxLCBmYWxzZSwgMCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRW5oYW5jZWQgYWxlcnQgZGVsaXZlcnkgY29tcGxldGVseSBmYWlsZWQ6ICR7ZGVsaXZlcnlFcnJvcnMuam9pbignOyAnKX1gKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gTm9uLWlPUyByZWxhdGVkIGVycm9yIG9yIG5vIGlPUyBpbnZvbHZlZFxuICAgICAgICAgIGF3YWl0IHRoaXMubWV0cmljcy5yZWNvcmRBbGVydERlbGl2ZXJ5KGNoYW5uZWxzLCBmYWxzZSwgcmV0cnlDb3VudCk7XG4gICAgICAgICAgaWYgKGlvc0RlbGl2ZXJ5QXR0ZW1wdGVkKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLm1ldHJpY3MucmVjb3JkSU9TTm90aWZpY2F0aW9uKDEsIGZhbHNlLCAwKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgXG4gICAgICAgICAgdGhyb3cgZGVsaXZlcnlFcnJvcjtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBkZWxpdmVyeVRpbWUgPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xuICAgICAgYXdhaXQgdGltZXIuc3RvcCh0cnVlKTtcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgY2hhbm5lbHMsXG4gICAgICAgIGlvc0RlbGl2ZXJlZDogaW9zRGVsaXZlcnlTdWNjZXNzZnVsLFxuICAgICAgICBmYWxsYmFja1VzZWQsXG4gICAgICAgIGVycm9yczogZGVsaXZlcnlFcnJvcnMsXG4gICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICBkZWxpdmVyeVRpbWUsXG4gICAgICAgICAgcmV0cnlDb3VudCxcbiAgICAgICAgICBwYXlsb2FkU2l6ZVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGRlbGl2ZXJ5VGltZSA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG4gICAgICBcbiAgICAgIHRoaXMuYWxlcnRMb2dnZXIuZXJyb3IoJ0VuaGFuY2VkIHNwZW5kIGFsZXJ0IGRlbGl2ZXJ5IGZhaWxlZCBjb21wbGV0ZWx5JywgZXJyb3IgYXMgRXJyb3IsIHtcbiAgICAgICAgdG9waWNBcm4sXG4gICAgICAgIHRvdGFsQ29zdDogY29zdEFuYWx5c2lzLnRvdGFsQ29zdCxcbiAgICAgICAgdGhyZXNob2xkOiBhbGVydENvbnRleHQudGhyZXNob2xkLFxuICAgICAgICBkZWxpdmVyeVRpbWUsXG4gICAgICAgIHJldHJ5Q291bnQsXG4gICAgICAgIGRlbGl2ZXJ5RXJyb3JzXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgdGltZXIuc3RvcChmYWxzZSk7XG4gICAgICBcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICBjaGFubmVscyxcbiAgICAgICAgaW9zRGVsaXZlcmVkOiBmYWxzZSxcbiAgICAgICAgZmFsbGJhY2tVc2VkLFxuICAgICAgICBlcnJvcnM6IGRlbGl2ZXJ5RXJyb3JzLFxuICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgZGVsaXZlcnlUaW1lLFxuICAgICAgICAgIHJldHJ5Q291bnQsXG4gICAgICAgICAgcGF5bG9hZFNpemU6IDBcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5oYW5jZWQgcmV0cnkgZXhlY3V0aW9uIHdpdGggbWV0cmljcyB0cmFja2luZ1xuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBleGVjdXRlV2l0aFJldHJ5V2l0aE1ldHJpY3M8VD4oXG4gICAgZm46ICgpID0+IFByb21pc2U8VD4sXG4gICAgb25SZXRyeT86IChhdHRlbXB0OiBudW1iZXIpID0+IHZvaWRcbiAgKTogUHJvbWlzZTxUPiB7XG4gICAgbGV0IGxhc3RFcnJvcjogRXJyb3I7XG4gICAgXG4gICAgZm9yIChsZXQgYXR0ZW1wdCA9IDE7IGF0dGVtcHQgPD0gdGhpcy5yZXRyeUNvbmZpZy5tYXhBdHRlbXB0czsgYXR0ZW1wdCsrKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBmbigpO1xuICAgICAgICBcbiAgICAgICAgaWYgKG9uUmV0cnkgJiYgYXR0ZW1wdCA+IDEpIHtcbiAgICAgICAgICBvblJldHJ5KGF0dGVtcHQpO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbGFzdEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKCdVbmtub3duIGVycm9yJyk7XG4gICAgICAgIFxuICAgICAgICBpZiAoYXR0ZW1wdCA9PT0gdGhpcy5yZXRyeUNvbmZpZy5tYXhBdHRlbXB0cykge1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgZXJyb3IgaXMgcmV0cnlhYmxlXG4gICAgICAgIGlmICghdGhpcy5pc1JldHJ5YWJsZUVycm9yKGVycm9yKSkge1xuICAgICAgICAgIHRocm93IGxhc3RFcnJvcjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGRlbGF5ID0gTWF0aC5taW4oXG4gICAgICAgICAgdGhpcy5yZXRyeUNvbmZpZy5iYXNlRGVsYXkgKiBNYXRoLnBvdyh0aGlzLnJldHJ5Q29uZmlnLmJhY2tvZmZNdWx0aXBsaWVyLCBhdHRlbXB0IC0gMSksXG4gICAgICAgICAgdGhpcy5yZXRyeUNvbmZpZy5tYXhEZWxheVxuICAgICAgICApO1xuXG4gICAgICAgIHRoaXMuYWxlcnRMb2dnZXIud2FybihgRW5oYW5jZWQgU05TIG9wZXJhdGlvbiBmYWlsZWQsIHJldHJ5aW5nIGluICR7ZGVsYXl9bXNgLCB7XG4gICAgICAgICAgYXR0ZW1wdCxcbiAgICAgICAgICBtYXhBdHRlbXB0czogdGhpcy5yZXRyeUNvbmZpZy5tYXhBdHRlbXB0cyxcbiAgICAgICAgICBlcnJvcjogbGFzdEVycm9yLm1lc3NhZ2UsXG4gICAgICAgICAgaXNJT1NSZWxhdGVkOiB0aGlzLmlzSU9TUmVsYXRlZEVycm9yKGVycm9yKVxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAob25SZXRyeSkge1xuICAgICAgICAgIG9uUmV0cnkoYXR0ZW1wdCk7XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB0aGlzLnNsZWVwKGRlbGF5KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aHJvdyBsYXN0RXJyb3IhO1xuICB9XG59Il19