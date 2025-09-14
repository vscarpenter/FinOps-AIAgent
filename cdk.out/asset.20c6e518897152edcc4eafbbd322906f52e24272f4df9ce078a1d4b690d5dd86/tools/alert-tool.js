"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlertTool = void 0;
const strands_agents_1 = require("strands-agents");
const client_sns_1 = require("@aws-sdk/client-sns");
/**
 * Tool for sending multi-channel alerts via AWS SNS
 */
class AlertTool extends strands_agents_1.Tool {
    constructor(region = 'us-east-1', retryConfig) {
        super();
        this.snsClient = new client_sns_1.SNSClient({ region });
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
            this.logger.info('Spend alert sent successfully', {
                totalCost: costAnalysis.totalCost,
                threshold: alertContext.threshold,
                exceedAmount: alertContext.exceedAmount,
                alertLevel: alertContext.alertLevel,
                topServices: alertContext.topServices.length,
                hasIOSPayload: !!iosPayload
            });
        }
        catch (error) {
            this.logger.error('Failed to send spend alert', {
                error,
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
            this.logger.warn('Failed to validate notification channels', { error, topicArn });
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
                this.logger.warn(`SNS operation failed, retrying in ${delay}ms`, {
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
        this.logger.info('Test alert sent successfully', { topicArn });
    }
}
exports.AlertTool = AlertTool;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWxlcnQtdG9vbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy90b29scy9hbGVydC10b29sLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1EQUFzQztBQUN0QyxvREFBcUY7QUFHckY7O0dBRUc7QUFDSCxNQUFhLFNBQVUsU0FBUSxxQkFBSTtJQUlqQyxZQUFZLFNBQWlCLFdBQVcsRUFBRSxXQUFrQztRQUMxRSxLQUFLLEVBQUUsQ0FBQztRQUNSLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxzQkFBUyxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQztRQUMzQyxJQUFJLENBQUMsV0FBVyxHQUFHO1lBQ2pCLFdBQVcsRUFBRSxDQUFDO1lBQ2QsU0FBUyxFQUFFLElBQUk7WUFDZixRQUFRLEVBQUUsS0FBSztZQUNmLGlCQUFpQixFQUFFLENBQUM7WUFDcEIsR0FBRyxXQUFXO1NBQ2YsQ0FBQztJQUNKLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxjQUFjLENBQ2xCLFlBQTBCLEVBQzFCLFlBQTBCLEVBQzFCLFFBQWdCLEVBQ2hCLFNBQWdFO1FBRWhFLElBQUksQ0FBQztZQUNILHlDQUF5QztZQUN6QyxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsa0JBQWtCLENBQUMsWUFBWSxFQUFFLFlBQVksQ0FBQyxDQUFDO1lBQzVFLE1BQU0sVUFBVSxHQUFHLFNBQVMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFlBQVksRUFBRSxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO1lBRXhGLHVEQUF1RDtZQUN2RCxNQUFNLGlCQUFpQixHQUFRLEVBQUUsQ0FBQztZQUVsQyx3Q0FBd0M7WUFDeEMsSUFBSSxPQUFlLENBQUM7WUFDcEIsSUFBSSxnQkFBb0MsQ0FBQztZQUV6QyxJQUFJLFVBQVUsRUFBRSxDQUFDO2dCQUNmLG9EQUFvRDtnQkFDcEQsZ0JBQWdCLEdBQUcsTUFBTSxD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LEtBQUssRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFFO1lBQ3hGLEVBQUUsV0FBVyxFQUFFLCtCQUErQixFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsVUFBVSxFQUFFLElBQUksRUFBRTtZQUM5RSxFQUFFLFdBQVcsRUFBRSxZQUFZLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFFO1NBQzVELENBQUM7UUFFRixNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxnQkFBZ0IsRUFBRSxLQUFLLEVBQUUsZUFBZSxDQUFDLENBQUM7UUFFM0YsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDLGdCQUFnQixFQUFFLGdCQUFnQixFQUFFLFFBQVEsRUFBRSxTQUFTLENBQUMsQ0FBQztRQUVuRixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyw4QkFBOEIsRUFBRSxFQUFFLFFBQVEsRUFBRSxDQUFDLENBQUM7SUFDakUsQ0FBQztDQUNGO0FBblZELDhCQW1WQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFRvb2wgfSBmcm9tICdzdHJhbmRzLWFnZW50cyc7XG5pbXBvcnQgeyBTTlNDbGllbnQsIFB1Ymxpc2hDb21tYW5kLCBQdWJsaXNoQ29tbWFuZElucHV0IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNucyc7XG5pbXBvcnQgeyBDb3N0QW5hbHlzaXMsIEFsZXJ0Q29udGV4dCwgU2VydmljZUNvc3QsIEFQTlNQYXlsb2FkLCBSZXRyeUNvbmZpZyB9IGZyb20gJy4uL3R5cGVzJztcblxuLyoqXG4gKiBUb29sIGZvciBzZW5kaW5nIG11bHRpLWNoYW5uZWwgYWxlcnRzIHZpYSBBV1MgU05TXG4gKi9cbmV4cG9ydCBjbGFzcyBBbGVydFRvb2wgZXh0ZW5kcyBUb29sIHtcbiAgcHJpdmF0ZSBzbnNDbGllbnQ6IFNOU0NsaWVudDtcbiAgcHJpdmF0ZSByZXRyeUNvbmZpZzogUmV0cnlDb25maWc7XG5cbiAgY29uc3RydWN0b3IocmVnaW9uOiBzdHJpbmcgPSAndXMtZWFzdC0xJywgcmV0cnlDb25maWc/OiBQYXJ0aWFsPFJldHJ5Q29uZmlnPikge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5zbnNDbGllbnQgPSBuZXcgU05TQ2xpZW50KHsgcmVnaW9uIH0pO1xuICAgIHRoaXMucmV0cnlDb25maWcgPSB7XG4gICAgICBtYXhBdHRlbXB0czogMyxcbiAgICAgIGJhc2VEZWxheTogMTAwMCxcbiAgICAgIG1heERlbGF5OiAzMDAwMCxcbiAgICAgIGJhY2tvZmZNdWx0aXBsaWVyOiAyLFxuICAgICAgLi4ucmV0cnlDb25maWdcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIFNlbmRzIHNwZW5kIGFsZXJ0IHRvIGFsbCBjb25maWd1cmVkIG5vdGlmaWNhdGlvbiBjaGFubmVsc1xuICAgKi9cbiAgYXN5bmMgc2VuZFNwZW5kQWxlcnQoXG4gICAgY29zdEFuYWx5c2lzOiBDb3N0QW5hbHlzaXMsXG4gICAgYWxlcnRDb250ZXh0OiBBbGVydENvbnRleHQsXG4gICAgdG9waWNBcm46IHN0cmluZyxcbiAgICBpb3NDb25maWc/OiB7IHBsYXRmb3JtQXBwbGljYXRpb25Bcm46IHN0cmluZzsgYnVuZGxlSWQ6IHN0cmluZyB9XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBGb3JtYXQgbWVzc2FnZXMgZm9yIGRpZmZlcmVudCBjaGFubmVsc1xuICAgICAgY29uc3QgZW1haWxTbXNNZXNzYWdlID0gdGhpcy5mb3JtYXRBbGVydE1lc3NhZ2UoY29zdEFuYWx5c2lzLCBhbGVydENvbnRleHQpO1xuICAgICAgY29uc3QgaW9zUGF5bG9hZCA9IGlvc0NvbmZpZyA/IHRoaXMuZm9ybWF0SU9TUGF5bG9hZChjb3N0QW5hbHlzaXMsIGFsZXJ0Q29udGV4dCkgOiBudWxsO1xuXG4gICAgICAvLyBDcmVhdGUgbWVzc2FnZSBhdHRyaWJ1dGVzIGZvciBtdWx0aS1jaGFubmVsIGRlbGl2ZXJ5XG4gICAgICBjb25zdCBtZXNzYWdlQXR0cmlidXRlczogYW55ID0ge307XG5cbiAgICAgIC8vIFByZXBhcmUgdGhlIG1lc3NhZ2Ugc3RydWN0dXJlIGZvciBTTlNcbiAgICAgIGxldCBtZXNzYWdlOiBzdHJpbmc7XG4gICAgICBsZXQgbWVzc2FnZVN0cnVjdHVyZTogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG4gICAgICBpZiAoaW9zUGF5bG9hZCkge1xuICAgICAgICAvLyBVc2UgbWVzc2FnZSBzdHJ1Y3R1cmUgZm9yIG11bHRpLXBsYXRmb3JtIGRlbGl2ZXJ5XG4gICAgICAgIG1lc3NhZ2VTdHJ1Y3R1cmUgPSAnanNvbic7XG4gICAgICAgIG1lc3NhZ2UgPSBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgZGVmYXVsdDogZW1haWxTbXNNZXNzYWdlLFxuICAgICAgICAgIEFQTlM6IEpTT04uc3RyaW5naWZ5KGlvc1BheWxvYWQpLFxuICAgICAgICAgIEFQTlNfU0FOREJPWDogSlNPTi5zdHJpbmdpZnkoaW9zUGF5bG9hZCksXG4gICAgICAgICAgZW1haWw6IGVtYWlsU21zTWVzc2FnZSxcbiAgICAgICAgICBzbXM6IHRoaXMuZm9ybWF0U01TTWVzc2FnZShjb3N0QW5hbHlzaXMsIGFsZXJ0Q29udGV4dClcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBTaW1wbGUgbWVzc2FnZSBmb3IgZW1haWwvU01TIG9ubHlcbiAgICAgICAgbWVzc2FnZSA9IGVtYWlsU21zTWVzc2FnZTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcHVibGlzaElucHV0OiBQdWJsaXNoQ29tbWFuZElucHV0ID0ge1xuICAgICAgICBUb3BpY0FybjogdG9waWNBcm4sXG4gICAgICAgIE1lc3NhZ2U6IG1lc3NhZ2UsXG4gICAgICAgIE1lc3NhZ2VTdHJ1Y3R1cmU6IG1lc3NhZ2VTdHJ1Y3R1cmUsXG4gICAgICAgIFN1YmplY3Q6IGBBV1MgU3BlbmQgQWxlcnQ6ICQke2FsZXJ0Q29udGV4dC5leGNlZWRBbW91bnQudG9GaXhlZCgyKX0gb3ZlciBidWRnZXRgLFxuICAgICAgICBNZXNzYWdlQXR0cmlidXRlczogbWVzc2FnZUF0dHJpYnV0ZXNcbiAgICAgIH07XG5cbiAgICAgIGF3YWl0IHRoaXMuZXhlY3V0ZVdpdGhSZXRyeSgoKSA9PiB0aGlzLnNuc0NsaWVudC5zZW5kKG5ldyBQdWJsaXNoQ29tbWFuZChwdWJsaXNoSW5wdXQpKSk7XG5cbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ1NwZW5kIGFsZXJ0IHNlbnQgc3VjY2Vzc2Z1bGx5Jywge1xuICAgICAgICB0b3RhbENvc3Q6IGNvc3RBbmFseXNpcy50b3RhbENvc3QsXG4gICAgICAgIHRocmVzaG9sZDogYWxlcnRDb250ZXh0LnRocmVzaG9sZCxcbiAgICAgICAgZXhjZWVkQW1vdW50OiBhbGVydENvbnRleHQuZXhjZWVkQW1vdW50LFxuICAgICAgICBhbGVydExldmVsOiBhbGVydENvbnRleHQuYWxlcnRMZXZlbCxcbiAgICAgICAgdG9wU2VydmljZXM6IGFsZXJ0Q29udGV4dC50b3BTZXJ2aWNlcy5sZW5ndGgsXG4gICAgICAgIGhhc0lPU1BheWxvYWQ6ICEhaW9zUGF5bG9hZFxuICAgICAgfSk7XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byBzZW5kIHNwZW5kIGFsZXJ0Jywge1xuICAgICAgICBlcnJvcixcbiAgICAgICAgdG9waWNBcm4sXG4gICAgICAgIHRvdGFsQ29zdDogY29zdEFuYWx5c2lzLnRvdGFsQ29zdCxcbiAgICAgICAgdGhyZXNob2xkOiBhbGVydENvbnRleHQudGhyZXNob2xkXG4gICAgICB9KTtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQWxlcnQgZGVsaXZlcnkgZmFpbGVkOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InfWApO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBGb3JtYXRzIGFsZXJ0IG1lc3NhZ2UgZm9yIGVtYWlsIGFuZCBnZW5lcmFsIGRpc3BsYXlcbiAgICovXG4gIGZvcm1hdEFsZXJ0TWVzc2FnZShjb3N0QW5hbHlzaXM6IENvc3RBbmFseXNpcywgYWxlcnRDb250ZXh0OiBBbGVydENvbnRleHQpOiBzdHJpbmcge1xuICAgIGNvbnN0IGxpbmVzID0gW1xuICAgICAgYPCfmqggQVdTIFNwZW5kIEFsZXJ0IC0gJHthbGVydENvbnRleHQuYWxlcnRMZXZlbH1gLFxuICAgICAgJycsXG4gICAgICBgWW91ciBBV1Mgc3BlbmRpbmcgaGFzIGV4Y2VlZGVkIHRoZSBjb25maWd1cmVkIHRocmVzaG9sZC5gLFxuICAgICAgJycsXG4gICAgICBg8J+SsCBDdXJyZW50IFNwZW5kaW5nOiAkJHtjb3N0QW5hbHlzaXMudG90YWxDb3N0LnRvRml4ZWQoMil9YCxcbiAgICAgIGDwn46vIFRocmVzaG9sZDogJCR7YWxlcnRDb250ZXh0LnRocmVzaG9sZC50b0ZpeGVkKDIpfWAsXG4gICAgICBg8J+TiCBPdmVyIEJ1ZGdldDogJCR7YWxlcnRDb250ZXh0LmV4Y2VlZEFtb3VudC50b0ZpeGVkKDIpfSAoJHthbGVydENvbnRleHQucGVyY2VudGFnZU92ZXIudG9GaXhlZCgxKX0lKWAsXG4gICAgICBg8J+TiiBQcm9qZWN0ZWQgTW9udGhseTogJCR7Y29zdEFuYWx5c2lzLnByb2plY3RlZE1vbnRobHkudG9GaXhlZCgyKX1gLFxuICAgICAgJycsXG4gICAgICBg8J+ThSBQZXJpb2Q6ICR7dGhpcy5mb3JtYXREYXRlUmFuZ2UoY29zdEFuYWx5c2lzLnBlcmlvZCl9YCxcbiAgICAgICcnXG4gICAgXTtcblxuICAgIGlmIChhbGVydENvbnRleHQudG9wU2VydmljZXMubGVuZ3RoID4gMCkge1xuICAgICAgbGluZXMucHVzaCgn8J+UnSBUb3AgQ29zdC1Ecml2aW5nIFNlcnZpY2VzOicpO1xuICAgICAgYWxlcnRDb250ZXh0LnRvcFNlcnZpY2VzLmZvckVhY2goKHNlcnZpY2UsIGluZGV4KSA9PiB7XG4gICAgICAgIGxpbmVzLnB1c2goYCR7aW5kZXggKyAxfS4gJHtzZXJ2aWNlLnNlcnZpY2VOYW1lfTogJCR7c2VydmljZS5jb3N0LnRvRml4ZWQoMil9ICgke3NlcnZpY2UucGVyY2VudGFnZS50b0ZpeGVkKDEpfSUpYCk7XG4gICAgICB9KTtcbiAgICAgIGxpbmVzLnB1c2goJycpO1xuICAgIH1cblxuICAgIGxpbmVzLnB1c2goXG4gICAgICAn8J+SoSBSZWNvbW1lbmRhdGlvbnM6JyxcbiAgICAgICfigKIgUmV2aWV3IHlvdXIgQVdTIHJlc291cmNlcyBhbmQgdXNhZ2UgcGF0dGVybnMnLFxuICAgICAgJ+KAoiBDb25zaWRlciBzY2FsaW5nIGRvd24gb3IgdGVybWluYXRpbmcgdW51c2VkIHJlc291cmNlcycsXG4gICAgICAn4oCiIENoZWNrIGZvciBhbnkgdW5leHBlY3RlZCBjaGFyZ2VzIG9yIHNlcnZpY2VzJyxcbiAgICAgICfigKIgU2V0IHVwIGFkZGl0aW9uYWwgQ2xvdWRXYXRjaCBhbGFybXMgZm9yIHNwZWNpZmljIHNlcnZpY2VzJyxcbiAgICAgICcnLFxuICAgICAgYOKPsCBBbGVydCBnZW5lcmF0ZWQgYXQ6ICR7bmV3IERhdGUoKS50b0xvY2FsZVN0cmluZygnZW4tVVMnLCB7IHRpbWVab25lOiAnVVRDJyB9KX0gVVRDYFxuICAgICk7XG5cbiAgICByZXR1cm4gbGluZXMuam9pbignXFxuJyk7XG4gIH1cblxuICAvKipcbiAgICogRm9ybWF0cyBhIHNob3J0ZXIgbWVzc2FnZSBmb3IgU01TIGRlbGl2ZXJ5XG4gICAqL1xuICBmb3JtYXRTTVNNZXNzYWdlKGNvc3RBbmFseXNpczogQ29zdEFuYWx5c2lzLCBhbGVydENvbnRleHQ6IEFsZXJ0Q29udGV4dCk6IHN0cmluZyB7XG4gICAgY29uc3QgdG9wU2VydmljZSA9IGFsZXJ0Q29udGV4dC50b3BTZXJ2aWNlc1swXTtcbiAgICBjb25zdCB0b3BTZXJ2aWNlVGV4dCA9IHRvcFNlcnZpY2UgPyBgIFRvcCBzZXJ2aWNlOiAke3RvcFNlcnZpY2Uuc2VydmljZU5hbWV9ICgkJHt0b3BTZXJ2aWNlLmNvc3QudG9GaXhlZCgyKX0pYCA6ICcnO1xuICAgIFxuICAgIHJldHVybiBgQVdTIFNwZW5kIEFsZXJ0OiAkJHtjb3N0QW5hbHlzaXMudG90YWxDb3N0LnRvRml4ZWQoMil9IHNwZW50IChvdmVyICQke2FsZXJ0Q29udGV4dC50aHJlc2hvbGR9IHRocmVzaG9sZCBieSAkJHthbGVydENvbnRleHQuZXhjZWVkQW1vdW50LnRvRml4ZWQoMil9KS4ke3RvcFNlcnZpY2VUZXh0fSBQcm9qZWN0ZWQgbW9udGhseTogJCR7Y29zdEFuYWx5c2lzLnByb2plY3RlZE1vbnRobHkudG9GaXhlZCgyKX1gO1xuICB9XG5cbiAgLyoqXG4gICAqIEZvcm1hdHMgaU9TIHB1c2ggbm90aWZpY2F0aW9uIHBheWxvYWRcbiAgICovXG4gIGZvcm1hdElPU1BheWxvYWQoY29zdEFuYWx5c2lzOiBDb3N0QW5hbHlzaXMsIGFsZXJ0Q29udGV4dDogQWxlcnRDb250ZXh0KTogQVBOU1BheWxvYWQge1xuICAgIGNvbnN0IHRvcFNlcnZpY2UgPSBhbGVydENvbnRleHQudG9wU2VydmljZXNbMF07XG4gICAgY29uc3QgYWxlcnRJZCA9IGBzcGVuZC1hbGVydC0ke0RhdGUubm93KCl9YDtcblxuICAgIHJldHVybiB7XG4gICAgICBhcHM6IHtcbiAgICAgICAgYWxlcnQ6IHtcbiAgICAgICAgICB0aXRsZTogJ0FXUyBTcGVuZCBBbGVydCcsXG4gICAgICAgICAgYm9keTogYCQke2Nvc3RBbmFseXNpcy50b3RhbENvc3QudG9GaXhlZCgyKX0gc3BlbnQgLSAkJHthbGVydENvbnRleHQuZXhjZWVkQW1vdW50LnRvRml4ZWQoMil9IG92ZXIgYnVkZ2V0YCxcbiAgICAgICAgICBzdWJ0aXRsZTogYWxlcnRDb250ZXh0LmFsZXJ0TGV2ZWwgPT09ICdDUklUSUNBTCcgPyAnQ3JpdGljYWwgQnVkZ2V0IEV4Y2VlZGVkJyA6ICdCdWRnZXQgVGhyZXNob2xkIEV4Y2VlZGVkJ1xuICAgICAgICB9LFxuICAgICAgICBiYWRnZTogMSxcbiAgICAgICAgc291bmQ6IGFsZXJ0Q29udGV4dC5hbGVydExldmVsID09PSAnQ1JJVElDQUwnID8gJ2NyaXRpY2FsLWFsZXJ0LmNhZicgOiAnZGVmYXVsdCcsXG4gICAgICAgICdjb250ZW50LWF2YWlsYWJsZSc6IDFcbiAgICAgIH0sXG4gICAgICBjdXN0b21EYXRhOiB7XG4gICAgICAgIHNwZW5kQW1vdW50OiBjb3N0QW5hbHlzaXMudG90YWxDb3N0LFxuICAgICAgICB0aHJlc2hvbGQ6IGFsZXJ0Q29udGV4dC50aHJlc2hvbGQsXG4gICAgICAgIGV4Y2VlZEFtb3VudDogYWxlcnRDb250ZXh0LmV4Y2VlZEFtb3VudCxcbiAgICAgICAgdG9wU2VydmljZTogdG9wU2VydmljZT8uc2VydmljZU5hbWUgfHwgJ1Vua25vd24nLFxuICAgICAgICBhbGVydElkXG4gICAgICB9XG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGFsZXJ0IGNvbnRleHQgZnJvbSBjb3N0IGFuYWx5c2lzIGFuZCB0aHJlc2hvbGRcbiAgICovXG4gIGNyZWF0ZUFsZXJ0Q29udGV4dChjb3N0QW5hbHlzaXM6IENvc3RBbmFseXNpcywgdGhyZXNob2xkOiBudW1iZXIsIHRvcFNlcnZpY2VzOiBTZXJ2aWNlQ29zdFtdKTogQWxlcnRDb250ZXh0IHtcbiAgICBjb25zdCBleGNlZWRBbW91bnQgPSBjb3N0QW5hbHlzaXMudG90YWxDb3N0IC0gdGhyZXNob2xkO1xuICAgIGNvbnN0IHBlcmNlbnRhZ2VPdmVyID0gKGV4Y2VlZEFtb3VudCAvIHRocmVzaG9sZCkgKiAxMDA7XG4gICAgXG4gICAgLy8gRGV0ZXJtaW5lIGFsZXJ0IGxldmVsIGJhc2VkIG9uIGhvdyBtdWNoIG92ZXIgdGhyZXNob2xkXG4gICAgY29uc3QgYWxlcnRMZXZlbDogJ1dBUk5JTkcnIHwgJ0NSSVRJQ0FMJyA9IHBlcmNlbnRhZ2VPdmVyID4gNTAgPyAnQ1JJVElDQUwnIDogJ1dBUk5JTkcnO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHRocmVzaG9sZCxcbiAgICAgIGV4Y2VlZEFtb3VudCxcbiAgICAgIHBlcmNlbnRhZ2VPdmVyLFxuICAgICAgdG9wU2VydmljZXMsXG4gICAgICBhbGVydExldmVsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgbm90aWZpY2F0aW9uIGNoYW5uZWxzIGFuZCB0b3BpYyBjb25maWd1cmF0aW9uXG4gICAqL1xuICBhc3luYyB2YWxpZGF0ZUNoYW5uZWxzKHRvcGljQXJuOiBzdHJpbmcpOiBQcm9taXNlPHsgZW1haWw6IGJvb2xlYW47IHNtczogYm9vbGVhbjsgaW9zOiBib29sZWFuIH0+IHtcbiAgICB0cnkge1xuICAgICAgLy8gSW4gYSByZWFsIGltcGxlbWVudGF0aW9uLCB5b3Ugd291bGQgY2FsbCBTTlMgR2V0VG9waWNBdHRyaWJ1dGVzXG4gICAgICAvLyBhbmQgTGlzdFN1YnNjcmlwdGlvbnNCeVRvcGljIHRvIGNoZWNrIGF2YWlsYWJsZSBjaGFubmVsc1xuICAgICAgLy8gRm9yIG5vdywgd2UnbGwgcmV0dXJuIGEgYmFzaWMgdmFsaWRhdGlvblxuICAgICAgXG4gICAgICBjb25zdCBpc1ZhbGlkQXJuID0gdGhpcy5pc1ZhbGlkU05TVG9waWNBcm4odG9waWNBcm4pO1xuICAgICAgXG4gICAgICByZXR1cm4ge1xuICAgICAgICBlbWFpbDogaXNWYWxpZEFybixcbiAgICAgICAgc21zOiBpc1ZhbGlkQXJuLFxuICAgICAgICBpb3M6IGlzVmFsaWRBcm5cbiAgICAgIH07XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ0ZhaWxlZCB0byB2YWxpZGF0ZSBub3RpZmljYXRpb24gY2hhbm5lbHMnLCB7IGVycm9yLCB0b3BpY0FybiB9KTtcbiAgICAgIHJldHVybiB7IGVtYWlsOiBmYWxzZSwgc21zOiBmYWxzZSwgaW9zOiBmYWxzZSB9O1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBGb3JtYXRzIGRhdGUgcmFuZ2UgZm9yIGRpc3BsYXlcbiAgICovXG4gIHByaXZhdGUgZm9ybWF0RGF0ZVJhbmdlKHBlcmlvZDogeyBzdGFydDogc3RyaW5nOyBlbmQ6IHN0cmluZyB9KTogc3RyaW5nIHtcbiAgICBjb25zdCBzdGFydERhdGUgPSBuZXcgRGF0ZShwZXJpb2Quc3RhcnQpO1xuICAgIGNvbnN0IGVuZERhdGUgPSBuZXcgRGF0ZShwZXJpb2QuZW5kKTtcbiAgICBcbiAgICBjb25zdCBmb3JtYXRPcHRpb25zOiBJbnRsLkRhdGVUaW1lRm9ybWF0T3B0aW9ucyA9IHtcbiAgICAgIHllYXI6ICdudW1lcmljJyxcbiAgICAgIG1vbnRoOiAnc2hvcnQnLFxuICAgICAgZGF5OiAnbnVtZXJpYycsXG4gICAgICB0aW1lWm9uZTogJ1VUQydcbiAgICB9O1xuXG4gICAgcmV0dXJuIGAke3N0YXJ0RGF0ZS50b0xvY2FsZURhdGVTdHJpbmcoJ2VuLVVTJywgZm9ybWF0T3B0aW9ucyl9IC0gJHtlbmREYXRlLnRvTG9jYWxlRGF0ZVN0cmluZygnZW4tVVMnLCBmb3JtYXRPcHRpb25zKX1gO1xuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBTTlMgdG9waWMgQVJOIGZvcm1hdFxuICAgKi9cbiAgcHJpdmF0ZSBpc1ZhbGlkU05TVG9waWNBcm4oYXJuOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCBzbnNUb3BpY0FyblBhdHRlcm4gPSAvXmFybjphd3M6c25zOlthLXowLTktXSs6XFxkezEyfTpbYS16QS1aMC05Xy1dKyQvO1xuICAgIHJldHVybiBzbnNUb3BpY0FyblBhdHRlcm4udGVzdChhcm4pO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIFNOUyBvcGVyYXRpb25zIHdpdGggcmV0cnkgbG9naWNcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgZXhlY3V0ZVdpdGhSZXRyeTxUPihmbjogKCkgPT4gUHJvbWlzZTxUPik6IFByb21pc2U8VD4ge1xuICAgIGxldCBsYXN0RXJyb3I6IEVycm9yO1xuICAgIFxuICAgIGZvciAobGV0IGF0dGVtcHQgPSAxOyBhdHRlbXB0IDw9IHRoaXMucmV0cnlDb25maWcubWF4QXR0ZW1wdHM7IGF0dGVtcHQrKykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IGZuKCk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsYXN0RXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoJ1Vua25vd24gZXJyb3InKTtcbiAgICAgICAgXG4gICAgICAgIGlmIChhdHRlbXB0ID09PSB0aGlzLnJldHJ5Q29uZmlnLm1heEF0dGVtcHRzKSB7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayBpZiBlcnJvciBpcyByZXRyeWFibGVcbiAgICAgICAgaWYgKCF0aGlzLmlzUmV0cnlhYmxlRXJyb3IoZXJyb3IpKSB7XG4gICAgICAgICAgdGhyb3cgbGFzdEVycm9yO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZGVsYXkgPSBNYXRoLm1pbihcbiAgICAgICAgICB0aGlzLnJldHJ5Q29uZmlnLmJhc2VEZWxheSAqIE1hdGgucG93KHRoaXMucmV0cnlDb25maWcuYmFja29mZk11bHRpcGxpZXIsIGF0dGVtcHQgLSAxKSxcbiAgICAgICAgICB0aGlzLnJldHJ5Q29uZmlnLm1heERlbGF5XG4gICAgICAgICk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIud2FybihgU05TIG9wZXJhdGlvbiBmYWlsZWQsIHJldHJ5aW5nIGluICR7ZGVsYXl9bXNgLCB7XG4gICAgICAgICAgYXR0ZW1wdCxcbiAgICAgICAgICBtYXhBdHRlbXB0czogdGhpcy5yZXRyeUNvbmZpZy5tYXhBdHRlbXB0cyxcbiAgICAgICAgICBlcnJvcjogbGFzdEVycm9yLm1lc3NhZ2VcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYXdhaXQgdGhpcy5zbGVlcChkZWxheSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhyb3cgbGFzdEVycm9yITtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZXRlcm1pbmVzIGlmIGFuIFNOUyBlcnJvciBpcyByZXRyeWFibGVcbiAgICovXG4gIHByaXZhdGUgaXNSZXRyeWFibGVFcnJvcihlcnJvcjogYW55KTogYm9vbGVhbiB7XG4gICAgaWYgKCFlcnJvcikgcmV0dXJuIGZhbHNlO1xuXG4gICAgLy8gQVdTIFNESyBlcnJvciBjb2RlcyB0aGF0IGFyZSByZXRyeWFibGVcbiAgICBjb25zdCByZXRyeWFibGVFcnJvckNvZGVzID0gW1xuICAgICAgJ1Rocm90dGxpbmdFeGNlcHRpb24nLFxuICAgICAgJ1Rocm90dGxpbmcnLFxuICAgICAgJ1Rvb01hbnlSZXF1ZXN0c0V4Y2VwdGlvbicsXG4gICAgICAnU2VydmljZVVuYXZhaWxhYmxlJyxcbiAgICAgICdJbnRlcm5hbFNlcnZlckVycm9yJyxcbiAgICAgICdSZXF1ZXN0VGltZW91dCcsXG4gICAgICAnSW50ZXJuYWxFcnJvcidcbiAgICBdO1xuXG4gICAgLy8gQ2hlY2sgZXJyb3IgY29kZVxuICAgIGlmIChlcnJvci5uYW1lICYmIHJldHJ5YWJsZUVycm9yQ29kZXMuaW5jbHVkZXMoZXJyb3IubmFtZSkpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIC8vIENoZWNrIEhUVFAgc3RhdHVzIGNvZGVzXG4gICAgaWYgKGVycm9yLiRtZXRhZGF0YT8uaHR0cFN0YXR1c0NvZGUpIHtcbiAgICAgIGNvbnN0IHN0YXR1c0NvZGUgPSBlcnJvci4kbWV0YWRhdGEuaHR0cFN0YXR1c0NvZGU7XG4gICAgICByZXR1cm4gc3RhdHVzQ29kZSA+PSA1MDAgfHwgc3RhdHVzQ29kZSA9PT0gNDI5O1xuICAgIH1cblxuICAgIC8vIENoZWNrIGZvciBuZXR3b3JrIGVycm9yc1xuICAgIGlmIChlcnJvci5jb2RlID09PSAnRUNPTk5SRVNFVCcgfHwgZXJyb3IuY29kZSA9PT0gJ0VUSU1FRE9VVCcpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTbGVlcCB1dGlsaXR5IGZvciByZXRyeSBkZWxheXNcbiAgICovXG4gIHByaXZhdGUgc2xlZXAobXM6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgbXMpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZW5kcyBhIHRlc3QgYWxlcnQgdG8gdmVyaWZ5IG5vdGlmaWNhdGlvbiBzZXR1cFxuICAgKi9cbiAgYXN5bmMgc2VuZFRlc3RBbGVydCh0b3BpY0Fybjogc3RyaW5nLCBpb3NDb25maWc/OiB7IHBsYXRmb3JtQXBwbGljYXRpb25Bcm46IHN0cmluZzsgYnVuZGxlSWQ6IHN0cmluZyB9KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdGVzdENvc3RBbmFseXNpczogQ29zdEFuYWx5c2lzID0ge1xuICAgICAgdG90YWxDb3N0OiAxNS41MCxcbiAgICAgIHNlcnZpY2VCcmVha2Rvd246IHtcbiAgICAgICAgJ0FtYXpvbiBFbGFzdGljIENvbXB1dGUgQ2xvdWQgLSBDb21wdXRlJzogMTAuMDAsXG4gICAgICAgICdBbWF6b24gU2ltcGxlIFN0b3JhZ2UgU2VydmljZSc6IDMuNTAsXG4gICAgICAgICdBV1MgTGFtYmRhJzogMi4wMFxuICAgICAgfSxcbiAgICAgIHBlcmlvZDoge1xuICAgICAgICBzdGFydDogbmV3IERhdGUobmV3IERhdGUoKS5nZXRGdWxsWWVhcigpLCBuZXcgRGF0ZSgpLmdldE1vbnRoKCksIDEpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIGVuZDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICB9LFxuICAgICAgcHJvamVjdGVkTW9udGhseTogMzEuMDAsXG4gICAgICBjdXJyZW5jeTogJ1VTRCcsXG4gICAgICBsYXN0VXBkYXRlZDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgfTtcblxuICAgIGNvbnN0IHRlc3RUb3BTZXJ2aWNlczogU2VydmljZUNvc3RbXSA9IFtcbiAgICAgIHsgc2VydmljZU5hbWU6ICdBbWF6b24gRWxhc3RpYyBDb21wdXRlIENsb3VkIC0gQ29tcHV0ZScsIGNvc3Q6IDEwLjAwLCBwZXJjZW50YWdlOiA2NC41IH0sXG4gICAgICB7IHNlcnZpY2VOYW1lOiAnQW1hem9uIFNpbXBsZSBTdG9yYWdlIFNlcnZpY2UnLCBjb3N0OiAzLjUwLCBwZXJjZW50YWdlOiAyMi42IH0sXG4gICAgICB7IHNlcnZpY2VOYW1lOiAnQVdTIExhbWJkYScsIGNvc3Q6IDIuMDAsIHBlcmNlbnRhZ2U6IDEyLjkgfVxuICAgIF07XG5cbiAgICBjb25zdCB0ZXN0QWxlcnRDb250ZXh0ID0gdGhpcy5jcmVhdGVBbGVydENvbnRleHQodGVzdENvc3RBbmFseXNpcywgMTAuMDAsIHRlc3RUb3BTZXJ2aWNlcyk7XG5cbiAgICBhd2FpdCB0aGlzLnNlbmRTcGVuZEFsZXJ0KHRlc3RDb3N0QW5hbHlzaXMsIHRlc3RBbGVydENvbnRleHQsIHRvcGljQXJuLCBpb3NDb25maWcpO1xuICAgIFxuICAgIHRoaXMubG9nZ2VyLmluZm8oJ1Rlc3QgYWxlcnQgc2VudCBzdWNjZXNzZnVsbHknLCB7IHRvcGljQXJuIH0pO1xuICB9XG59Il19