"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsCollector = void 0;
exports.createMetricsCollector = createMetricsCollector;
const client_cloudwatch_1 = require("@aws-sdk/client-cloudwatch");
const logger_1 = require("./logger");
/**
 * CloudWatch metrics utility for monitoring agent performance
 */
class MetricsCollector {
    constructor(region, namespace = 'SpendMonitor/Agent') {
        this.logger = (0, logger_1.createLogger)('MetricsCollector');
        this.cloudWatch = new client_cloudwatch_1.CloudWatchClient({ region });
        this.namespace = namespace;
    }
    /**
     * Records execution duration metric
     */
    async recordExecutionDuration(operation, durationMs, success) {
        const metrics = [
            {
                MetricName: 'ExecutionDuration',
                Value: durationMs,
                Unit: 'Milliseconds',
                Dimensions: [
                    { Name: 'Operation', Value: operation },
                    { Name: 'Status', Value: success ? 'Success' : 'Failure' }
                ],
                Timestamp: new Date()
            }
        ];
        await this.putMetrics(metrics);
    }
    /**
     * Records success/failure rate metrics
     */
    async recordExecutionResult(operation, success) {
        const metrics = [
            {
                MetricName: 'ExecutionCount',
                Value: 1,
                Unit: 'Count',
                Dimensions: [
                    { Name: 'Operation', Value: operation },
                    { Name: 'Status', Value: success ? 'Success' : 'Failure' }
                ],
                Timestamp: new Date()
            }
        ];
        if (success) {
            metrics.push({
                MetricName: 'SuccessRate',
                Value: 1,
                Unit: 'Count',
                Dimensions: [{ Name: 'Operation', Value: operation }],
                Timestamp: new Date()
            });
        }
        else {
            metrics.push({
                MetricName: 'ErrorRate',
                Value: 1,
                Unit: 'Count',
                Dimensions: [{ Name: 'Operation', Value: operation }],
                Timestamp: new Date()
            });
        }
        await this.putMetrics(metrics);
    }
    /**
     * Records cost analysis metrics
     */
    async recordCostAnalysis(totalCost, projectedCost, serviceCount) {
        const metrics = [
            {
                MetricName: 'CurrentSpend',
                Value: totalCost,
                Unit: 'None',
                Timestamp: new Date()
            },
            {
                MetricName: 'ProjectedMonthlySpend',
                Value: projectedCost,
                Unit: 'None',
                Timestamp: new Date()
            },
            {
                MetricName: 'ServiceCount',
                Value: serviceCount,
                Unit: 'Count',
                Timestamp: new Date()
            }
        ];
        await this.putMetrics(metrics);
    }
    /**
     * Records alert delivery metrics
     */
    async recordAlertDelivery(channels, success, retryCount = 0) {
        const metrics = [
            {
                MetricName: 'AlertDeliveryCount',
                Value: 1,
                Unit: 'Count',
                Dimensions: [
                    { Name: 'Status', Value: success ? 'Success' : 'Failure' }
                ],
                Timestamp: new Date()
            },
            {
                MetricName: 'AlertChannelCount',
                Value: channels.length,
                Unit: 'Count',
                Timestamp: new Date()
            }
        ];
        if (retryCount > 0) {
            metrics.push({
                MetricName: 'AlertRetryCount',
                Value: retryCount,
                Unit: 'Count',
                Timestamp: new Date()
            });
        }
        // Record metrics per channel
        for (const channel of channels) {
            metrics.push({
                MetricName: 'ChannelDelivery',
                Value: success ? 1 : 0,
                Unit: 'Count',
                Dimensions: [
                    { Name: 'Channel', Value: channel },
                    { Name: 'Status', Value: success ? 'Success' : 'Failure' }
                ],
                Timestamp: new Date()
            });
        }
        await this.putMetrics(metrics);
    }
    /**
     * Records threshold breach metrics
     */
    async recordThresholdBreach(currentSpend, threshold, exceedAmount) {
        const metrics = [
            {
                MetricName: 'ThresholdBreach',
                Value: 1,
                Unit: 'Count',
                Timestamp: new Date()
            },
            {
                MetricName: 'ThresholdExceedAmount',
                Value: exceedAmount,
                Unit: 'None',
                Timestamp: new Date()
            },
            {
                MetricName: 'ThresholdExceedPercentage',
                Value: (exceedAmount / threshold) * 100,
                Unit: 'Percent',
                Timestamp: new Date()
            }
        ];
        await this.putMetrics(metrics);
    }
    /**
     * Records iOS notification metrics
     */
    async recordIOSNotification(deviceCount, success, invalidTokens = 0) {
        const metrics = [
            {
                MetricName: 'iOSNotificationCount',
                Value: 1,
                Unit: 'Count',
                Dimensions: [
                    { Name: 'Status', Value: success ? 'Success' : 'Failure' }
                ],
                Timestamp: new Date()
            },
            {
                MetricName: 'iOSDeviceCount',
                Value: deviceCount,
                Unit: 'Count',
                Timestamp: new Date()
            }
        ];
        if (invalidTokens > 0) {
            metrics.push({
                MetricName: 'iOSInvalidTokens',
                Value: invalidTokens,
                Unit: 'Count',
                Timestamp: new Date()
            });
        }
        await this.putMetrics(metrics);
    }
    /**
     * Records iOS device registration metrics
     */
    async recordIOSDeviceRegistration(success, errorType) {
        const metrics = [
            {
                MetricName: 'iOSDeviceRegistrationCount',
                Value: 1,
                Unit: 'Count',
                Dimensions: [
                    { Name: 'Status', Value: success ? 'Success' : 'Failure' }
                ],
                Timestamp: new Date()
            }
        ];
        if (!success && errorType) {
            metrics.push({
                MetricName: 'iOSRegistrationErrorType',
                Value: 1,
                Unit: 'Count',
                Dimensions: [
                    { Name: 'ErrorType', Value: errorType }
                ],
                Timestamp: new Date()
            });
        }
        await this.putMetrics(metrics);
    }
    /**
     * Records APNS certificate health metrics
     */
    async recordAPNSCertificateHealth(isValid, daysUntilExpiration, warningCount = 0, errorCount = 0) {
        const metrics = [
            {
                MetricName: 'APNSCertificateValid',
                Value: isValid ? 1 : 0,
                Unit: 'Count',
                Timestamp: new Date()
            },
            {
                MetricName: 'APNSCertificateWarnings',
                Value: warningCount,
                Unit: 'Count',
                Timestamp: new Date()
            },
            {
                MetricName: 'APNSCertificateErrors',
                Value: errorCount,
                Unit: 'Count',
                Timestamp: new Date()
            }
        ];
        if (daysUntilExpiration !== undefined) {
            metrics.push({
                MetricName: 'APNSCertificateDaysUntilExpiration',
                Value: daysUntilExpiration,
                Unit: 'Count',
                Timestamp: new Date()
            });
        }
        await this.putMetrics(metrics);
    }
    /**
     * Records iOS notification payload metrics
     */
    async recordIOSPayloadMetrics(payloadSize, deliveryTime, retryCount) {
        const metrics = [
            {
                MetricName: 'iOSPayloadSize',
                Value: payloadSize,
                Unit: 'Bytes',
                Timestamp: new Date()
            },
            {
                MetricName: 'iOSNotificationDeliveryTime',
                Value: deliveryTime,
                Unit: 'Milliseconds',
                Timestamp: new Date()
            }
        ];
        if (retryCount > 0) {
            metrics.push({
                MetricName: 'iOSNotificationRetryCount',
                Value: retryCount,
                Unit: 'Count',
                Timestamp: new Date()
            });
        }
        await this.putMetrics(metrics);
    }
    /**
     * Records iOS fallback usage metrics
     */
    async recordIOSFallbackUsage(fallbackChannels, success) {
        const metrics = [
            {
                MetricName: 'iOSFallbackUsed',
                Value: 1,
                Unit: 'Count',
                Dimensions: [
                    { Name: 'Status', Value: success ? 'Success' : 'Failure' }
                ],
                Timestamp: new Date()
            },
            {
                MetricName: 'iOSFallbackChannelCount',
                Value: fallbackChannels.length,
                Unit: 'Count',
                Timestamp: new Date()
            }
        ];
        // Record metrics per fallback channel
        for (const channel of fallbackChannels) {
            metrics.push({
                MetricName: 'iOSFallbackChannelUsage',
                Value: 1,
                Unit: 'Count',
                Dimensions: [
                    { Name: 'Channel', Value: channel },
                    { Name: 'Status', Value: success ? 'Success' : 'Failure' }
                ],
                Timestamp: new Date()
            });
        }
        await this.putMetrics(metrics);
    }
    /**
     * Records API call metrics
     */
    async recordAPICall(service, operation, durationMs, success) {
        const metrics = [
            {
                MetricName: 'APICallDuration',
                Value: durationMs,
                Unit: 'Milliseconds',
                Dimensions: [
                    { Name: 'Service', Value: service },
                    { Name: 'Operation', Value: operation },
                    { Name: 'Status', Value: success ? 'Success' : 'Failure' }
                ],
                Timestamp: new Date()
            },
            {
                MetricName: 'APICallCount',
                Value: 1,
                Unit: 'Count',
                Dimensions: [
                    { Name: 'Service', Value: service },
                    { Name: 'Operation', Value: operation },
                    { Name: 'Status', Value: success ? 'Success' : 'Failure' }
                ],
                Timestamp: new Date()
            }
        ];
        await this.putMetrics(metrics);
    }
    /**
     * Sends metrics to CloudWatch
     */
    async putMetrics(metrics) {
        try {
            const command = new client_cloudwatch_1.PutMetricDataCommand({
                Namespace: this.namespace,
                MetricData: metrics
            });
            await this.cloudWatch.send(command);
            this.logger.debug('Metrics sent to CloudWatch', {
                namespace: this.namespace,
                metricCount: metrics.length,
                metrics: metrics.map(m => ({ name: m.MetricName, value: m.Value, unit: m.Unit }))
            });
        }
        catch (error) {
            this.logger.error('Failed to send metrics to CloudWatch', error, {
                namespace: this.namespace,
                metricCount: metrics.length
            });
            // Don't throw error to avoid breaking main execution
        }
    }
    /**
     * Creates a timer for measuring operation duration
     */
    createTimer(operation) {
        const startTime = Date.now();
        return {
            stop: async (success) => {
                const duration = Date.now() - startTime;
                await this.recordExecutionDuration(operation, duration, success);
                await this.recordExecutionResult(operation, success);
            }
        };
    }
}
exports.MetricsCollector = MetricsCollector;
/**
 * Creates a metrics collector instance
 */
function createMetricsCollector(region, namespace) {
    return new MetricsCollector(region, namespace);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWV0cmljcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy91dGlscy9tZXRyaWNzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQW1iQSx3REFFQztBQXJiRCxrRUFBaUc7QUFDakcscUNBQXdDO0FBRXhDOztHQUVHO0FBQ0gsTUFBYSxnQkFBZ0I7SUFLM0IsWUFBWSxNQUFjLEVBQUUsWUFBb0Isb0JBQW9CO1FBRjVELFdBQU0sR0FBRyxJQUFBLHFCQUFZLEVBQUMsa0JBQWtCLENBQUMsQ0FBQztRQUdoRCxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksb0NBQWdCLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxDQUFDO1FBQ25ELElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO0lBQzdCLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxTQUFpQixFQUFFLFVBQWtCLEVBQUUsT0FBZ0I7UUFDbkYsTUFBTSxPQUFPLEdBQWtCO1lBQzdCO2dCQUNFLFVBQVUsRUFBRSxtQkFBbUI7Z0JBQy9CLEtBQUssRUFBRSxVQUFVO2dCQUNqQixJQUFJLEVBQUUsY0FBYztnQkFDcEIsVUFBVSxFQUFFO29CQUNWLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFO29CQUN2QyxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxTQUFTLEVBQUU7aUJBQzNEO2dCQUNELFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRTthQUN0QjtTQUNGLENBQUM7UUFFRixNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDakMsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLHFCQUFxQixDQUFDLFNBQWlCLEVBQUUsT0FBZ0I7UUFDN0QsTUFBTSxPQUFPLEdBQWtCO1lBQzdCO2dCQUNFLFVBQVUsRUFBRSxnQkFBZ0I7Z0JBQzVCLEtBQUssRUFBRSxDQUFDO2dCQUNSLElBQUksRUFBRSxPQUFPO2dCQUNiLFVBQVUsRUFBRTtvQkFDVixFQUFFLElBQUksRUFBRSxXQUFXLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRTtvQkFDdkMsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsU0FBUyxFQUFFO2lCQUMzRDtnQkFDRCxTQUFTLEVBQUUsSUFBSSxJQUFJLEVBQUU7YUFDdEI7U0FDRixDQUFDO1FBRUYsSUFBSSxPQUFPLEVBQUUsQ0FBQztZQUNaLE9BQU8sQ0FBQyxJQUFJLENBQUM7Z0JBQ1gsVUFBVSxFQUFFLGFBQWE7Z0JBQ3pCLEtBQUssRUFBRSxDQUFDO2dCQUNSLElBQUksRUFBRSxPQUFPO2dCQUNiLFVBQVUsRUFBRSxDQUFDLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLENBQUM7Z0JBQ3JELFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRTthQUN0QixDQUFDLENBQUM7UUFDTCxDQUFDO2FBQU0sQ0FBQztZQUNOLE9BQU8sQ0FBQyxJQUFJLENBQUM7Z0JBQ1gsVUFBVSxFQUFFLFdBQVc7Z0JBQ3ZCLEtBQUssRUFBRSxDQUFDO2dCQUNSLElBQUksRUFBRSxPQUFPO2dCQUNiLFVBQVUsRUFBRSxDQUFDLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLENBQUM7Z0JBQ3JELFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRTthQUN0QixDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQ2pDLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxTQUFpQixFQUFFLGFBQXFCLEVBQUUsWUFBb0I7UUFDckYsTUFBTSxPQUFPLEdBQWtCO1lBQzdCO2dCQUNFLFVBQVUsRUFBRSxjQUFjO2dCQUMxQixLQUFLLEVBQUUsU0FBUztnQkFDaEIsSUFBSSxFQUFFLE1BQU07Z0JBQ1osU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFO2FBQ3RCO1lBQ0Q7Z0JBQ0UsVUFBVSxFQUFFLHVCQUF1QjtnQkFDbkMsS0FBSyxFQUFFLGFBQWE7Z0JBQ3BCLElBQUksRUFBRSxNQUFNO2dCQUNaLFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRTthQUN0QjtZQUNEO2dCQUNFLFVBQVUsRUFBRSxjQUFjO2dCQUMxQixLQUFLLEVBQUUsWUFBWTtnQkFDbkIsSUFBSSxFQUFFLE9BQU87Z0JBQ2IsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFO2FBQ3RCO1NBQ0YsQ0FBQztRQUVGLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUNqQyxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsbUJBQW1CLENBQUMsUUFBa0IsRUFBRSxPQUFnQixFQUFFLGFBQXFCLENBQUM7UUFDcEYsTUFBTSxPQUFPLEdBQWtCO1lBQzdCO2dCQUNFLFVBQVUsRUFBRSxvQkFBb0I7Z0JBQ2hDLEtBQUssRUFBRSxDQUFDO2dCQUNSLElBQUksRUFBRSxPQUFPO2dCQUNiLFVBQVUsRUFBRTtvQkFDVixFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxTQUFTLEVBQUU7aUJBQzNEO2dCQUNELFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRTthQUN0QjtZQUNEO2dCQUNFLFVBQVUsRUFBRSxtQkFBbUI7Z0JBQy9CLEtBQUssRUFBRSxRQUFRLENBQUMsTUFBTTtnQkFDdEIsSUFBSSxFQUFFLE9BQU87Z0JBQ2IsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFO2FBQ3RCO1NBQ0YsQ0FBQztRQUVGLElBQUksVUFBVSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ25CLE9BQU8sQ0FBQyxJQUFJLENBQUM7Z0JBQ1gsVUFBVSxFQUFFLGlCQUFpQjtnQkFDN0IsS0FBSyxFQUFFLFVBQVU7Z0JBQ2pCLElBQUksRUFBRSxPQUFPO2dCQUNiLFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRTthQUN0QixDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsNkJBQTZCO1FBQzdCLEtBQUssTUFBTSxPQUFPLElBQUksUUFBUSxFQUFFLENBQUM7WUFDL0IsT0FBTyxDQUFDLElBQUksQ0FBQztnQkFDWCxVQUFVLEVBQUUsaUJBQWlCO2dCQUM3QixLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQ3RCLElBQUksRUFBRSxPQUFPO2dCQUNiLFVBQVUsRUFBRTtvQkFDVixFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLE9BQU8sRUFBRTtvQkFDbkMsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsU0FBUyxFQUFFO2lCQUMzRDtnQkFDRCxTQUFTLEVBQUUsSUFBSSxJQUFJLEVBQUU7YUFDdEIsQ0FBQyxDQUFDO1FBQ0wsQ0FBQztRQUVELE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUNqQyxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMscUJBQXFCLENBQUMsWUFBb0IsRUFBRSxTQUFpQixFQUFFLFlBQW9CO1FBQ3ZGLE1BQU0sT0FBTyxHQUFrQjtZQUM3QjtnQkFDRSxVQUFVLEVBQUUsaUJBQWlCO2dCQUM3QixLQUFLLEVBQUUsQ0FBQztnQkFDUixJQUFJLEVBQUUsT0FBTztnQkFDYixTQUFTLEVBQUUsSUFBSSxJQUFJLEVBQUU7YUFDdEI7WUFDRDtnQkFDRSxVQUFVLEVBQUUsdUJBQXVCO2dCQUNuQyxLQUFLLEVBQUUsWUFBWTtnQkFDbkIsSUFBSSxFQUFFLE1BQU07Z0JBQ1osU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFO2FBQ3RCO1lBQ0Q7Z0JBQ0UsVUFBVSxFQUFFLDJCQUEyQjtnQkFDdkMsS0FBSyxFQUFFLENBQUMsWUFBWSxHQUFHLFNBQVMsQ0FBQyxHQUFHLEdBQUc7Z0JBQ3ZDLElBQUksRUFBRSxTQUFTO2dCQUNmLFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRTthQUN0QjtTQUNGLENBQUM7UUFFRixNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDakMsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLHFCQUFxQixDQUFDLFdBQW1CLEVBQUUsT0FBZ0IsRUFBRSxnQkFBd0IsQ0FBQztRQUMxRixNQUFNLE9BQU8sR0FBa0I7WUFDN0I7Z0JBQ0UsVUFBVSxFQUFFLHNCQUFzQjtnQkFDbEMsS0FBSyxFQUFFLENBQUM7Z0JBQ1IsSUFBSSxFQUFFLE9BQU87Z0JBQ2IsVUFBVSxFQUFFO29CQUNWLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLFNBQVMsRUFBRTtpQkFDM0Q7Z0JBQ0QsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFO2FBQ3RCO1lBQ0Q7Z0JBQ0UsVUFBVSxFQUFFLGdCQUFnQjtnQkFDNUIsS0FBSyxFQUFFLFdBQVc7Z0JBQ2xCLElBQUksRUFBRSxPQUFPO2dCQUNiLFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRTthQUN0QjtTQUNGLENBQUM7UUFFRixJQUFJLGFBQWEsR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUN0QixPQUFPLENBQUMsSUFBSSxDQUFDO2dCQUNYLFVBQVUsRUFBRSxrQkFBa0I7Z0JBQzlCLEtBQUssRUFBRSxhQUFhO2dCQUNwQixJQUFJLEVBQUUsT0FBTztnQkFDYixTQUFTLEVBQUUsSUFBSSxJQUFJLEVBQUU7YUFDdEIsQ0FBQyxDQUFDO1FBQ0wsQ0FBQztRQUVELE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUNqQyxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsMkJBQTJCLENBQUMsT0FBZ0IsRUFBRSxTQUFrQjtRQUNwRSxNQUFNLE9BQU8sR0FBa0I7WUFDN0I7Z0JBQ0UsVUFBVSxFQUFFLDRCQUE0QjtnQkFDeEMsS0FBSyxFQUFFLENBQUM7Z0JBQ1IsSUFBSSxFQUFFLE9BQU87Z0JBQ2IsVUFBVSxFQUFFO29CQUNWLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLFNBQVMsRUFBRTtpQkFDM0Q7Z0JBQ0QsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFO2FBQ3RCO1NBQ0YsQ0FBQztRQUVGLElBQUksQ0FBQyxPQUFPLElBQUksU0FBUyxFQUFFLENBQUM7WUFDMUIsT0FBTyxDQUFDLElBQUksQ0FBQztnQkFDWCxVQUFVLEVBQUUsMEJBQTBCO2dCQUN0QyxLQUFLLEVBQUUsQ0FBQztnQkFDUixJQUFJLEVBQUUsT0FBTztnQkFDYixVQUFVLEVBQUU7b0JBQ1YsRUFBRSxJQUFJLEVBQUUsV0FBVyxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUU7aUJBQ3hDO2dCQUNELFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRTthQUN0QixDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQ2pDLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQywyQkFBMkIsQ0FDL0IsT0FBZ0IsRUFDaEIsbUJBQTRCLEVBQzVCLGVBQXVCLENBQUMsRUFDeEIsYUFBcUIsQ0FBQztRQUV0QixNQUFNLE9BQU8sR0FBa0I7WUFDN0I7Z0JBQ0UsVUFBVSxFQUFFLHNCQUFzQjtnQkFDbEMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUN0QixJQUFJLEVBQUUsT0FBTztnQkFDYixTQUFTLEVBQUUsSUFBSSxJQUFJLEVBQUU7YUFDdEI7WUFDRDtnQkFDRSxVQUFVLEVBQUUseUJBQXlCO2dCQUNyQyxLQUFLLEVBQUUsWUFBWTtnQkFDbkIsSUFBSSxFQUFFLE9BQU87Z0JBQ2IsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFO2FBQ3RCO1lBQ0Q7Z0JBQ0UsVUFBVSxFQUFFLHVCQUF1QjtnQkFDbkMsS0FBSyxFQUFFLFVBQVU7Z0JBQ2pCLElBQUksRUFBRSxPQUFPO2dCQUNiLFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRTthQUN0QjtTQUNGLENBQUM7UUFFRixJQUFJLG1CQUFtQixLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ3RDLE9BQU8sQ0FBQyxJQUFJLENBQUM7Z0JBQ1gsVUFBVSxFQUFFLG9DQUFvQztnQkFDaEQsS0FBSyxFQUFFLG1CQUFtQjtnQkFDMUIsSUFBSSxFQUFFLE9BQU87Z0JBQ2IsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFO2FBQ3RCLENBQUMsQ0FBQztRQUNMLENBQUM7UUFFRCxNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDakMsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLHVCQUF1QixDQUFDLFdBQW1CLEVBQUUsWUFBb0IsRUFBRSxVQUFrQjtRQUN6RixNQUFNLE9BQU8sR0FBa0I7WUFDN0I7Z0JBQ0UsVUFBVSxFQUFFLGdCQUFnQjtnQkFDNUIsS0FBSyxFQUFFLFdBQVc7Z0JBQ2xCLElBQUksRUFBRSxPQUFPO2dCQUNiLFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRTthQUN0QjtZQUNEO2dCQUNFLFVBQVUsRUFBRSw2QkFBNkI7Z0JBQ3pDLEtBQUssRUFBRSxZQUFZO2dCQUNuQixJQUFJLEVBQUUsY0FBYztnQkFDcEIsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFO2FBQ3RCO1NBQ0YsQ0FBQztRQUVGLElBQUksVUFBVSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ25CLE9BQU8sQ0FBQyxJQUFJLENBQUM7Z0JBQ1gsVUFBVSxFQUFFLDJCQUEyQjtnQkFDdkMsS0FBSyxFQUFFLFVBQVU7Z0JBQ2pCLElBQUksRUFBRSxPQUFPO2dCQUNiLFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRTthQUN0QixDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQ2pDLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxnQkFBMEIsRUFBRSxPQUFnQjtRQUN2RSxNQUFNLE9BQU8sR0FBa0I7WUFDN0I7Z0JBQ0UsVUFBVSxFQUFFLGlCQUFpQjtnQkFDN0IsS0FBSyxFQUFFLENBQUM7Z0JBQ1IsSUFBSSxFQUFFLE9BQU87Z0JBQ2IsVUFBVSxFQUFFO29CQUNWLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLFNBQVMsRUFBRTtpQkFDM0Q7Z0JBQ0QsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFO2FBQ3RCO1lBQ0Q7Z0JBQ0UsVUFBVSxFQUFFLHlCQUF5QjtnQkFDckMsS0FBSyxFQUFFLGdCQUFnQixDQUFDLE1BQU07Z0JBQzlCLElBQUksRUFBRSxPQUFPO2dCQUNiLFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRTthQUN0QjtTQUNGLENBQUM7UUFFRixzQ0FBc0M7UUFDdEMsS0FBSyxNQUFNLE9BQU8sSUFBSSxnQkFBZ0IsRUFBRSxDQUFDO1lBQ3ZDLE9BQU8sQ0FBQyxJQUFJLENBQUM7Z0JBQ1gsVUFBVSxFQUFFLHlCQUF5QjtnQkFDckMsS0FBSyxFQUFFLENBQUM7Z0JBQ1IsSUFBSSxFQUFFLE9BQU87Z0JBQ2IsVUFBVSxFQUFFO29CQUNWLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUUsT0FBTyxFQUFFO29CQUNuQyxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxTQUFTLEVBQUU7aUJBQzNEO2dCQUNELFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRTthQUN0QixDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQ2pDLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxhQUFhLENBQUMsT0FBZSxFQUFFLFNBQWlCLEVBQUUsVUFBa0IsRUFBRSxPQUFnQjtRQUMxRixNQUFNLE9BQU8sR0FBa0I7WUFDN0I7Z0JBQ0UsVUFBVSxFQUFFLGlCQUFpQjtnQkFDN0IsS0FBSyxFQUFFLFVBQVU7Z0JBQ2pCLElBQUksRUFBRSxjQUFjO2dCQUNwQixVQUFVLEVBQUU7b0JBQ1YsRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUU7b0JBQ25DLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFO29CQUN2QyxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxTQUFTLEVBQUU7aUJBQzNEO2dCQUNELFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRTthQUN0QjtZQUNEO2dCQUNFLFVBQVUsRUFBRSxjQUFjO2dCQUMxQixLQUFLLEVBQUUsQ0FBQztnQkFDUixJQUFJLEVBQUUsT0FBTztnQkFDYixVQUFVLEVBQUU7b0JBQ1YsRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUU7b0JBQ25DLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFO29CQUN2QyxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxTQUFTLEVBQUU7aUJBQzNEO2dCQUNELFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRTthQUN0QjtTQUNGLENBQUM7UUFFRixNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDakMsQ0FBQztJQUVEOztPQUVHO0lBQ0ssS0FBSyxDQUFDLFVBQVUsQ0FBQyxPQUFzQjtRQUM3QyxJQUFJLENBQUM7WUFDSCxNQUFNLE9BQU8sR0FBRyxJQUFJLHdDQUFvQixDQUFDO2dCQUN2QyxTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVM7Z0JBQ3pCLFVBQVUsRUFBRSxPQUFPO2FBQ3BCLENBQUMsQ0FBQztZQUVILE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7WUFFcEMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsNEJBQTRCLEVBQUU7Z0JBQzlDLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUztnQkFDekIsV0FBVyxFQUFFLE9BQU8sQ0FBQyxNQUFNO2dCQUMzQixPQUFPLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLFVBQVUsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUM7YUFDbEYsQ0FBQyxDQUFDO1FBRUwsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxzQ0FBc0MsRUFBRSxLQUFjLEVBQUU7Z0JBQ3hFLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUztnQkFDekIsV0FBVyxFQUFFLE9BQU8sQ0FBQyxNQUFNO2FBQzVCLENBQUMsQ0FBQztZQUNILHFEQUFxRDtRQUN2RCxDQUFDO0lBQ0gsQ0FBQztJQUVEOztPQUVHO0lBQ0gsV0FBVyxDQUFDLFNBQWlCO1FBRzNCLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUU3QixPQUFPO1lBQ0wsSUFBSSxFQUFFLEtBQUssRUFBRSxPQUFnQixFQUFFLEVBQUU7Z0JBQy9CLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxTQUFTLENBQUM7Z0JBQ3hDLE1BQU0sSUFBSSxDQUFDLHVCQUF1QixDQUFDLFNBQVMsRUFBRSxRQUFRLEVBQUUsT0FBTyxDQUFDLENBQUM7Z0JBQ2pFLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixDQUFDLFNBQVMsRUFBRSxPQUFPLENBQUMsQ0FBQztZQUN2RCxDQUFDO1NBQ0YsQ0FBQztJQUNKLENBQUM7Q0FDRjtBQXhhRCw0Q0F3YUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLHNCQUFzQixDQUFDLE1BQWMsRUFBRSxTQUFrQjtJQUN2RSxPQUFPLElBQUksZ0JBQWdCLENBQUMsTUFBTSxFQUFFLFNBQVMsQ0FBQyxDQUFDO0FBQ2pELENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDbG91ZFdhdGNoQ2xpZW50LCBQdXRNZXRyaWNEYXRhQ29tbWFuZCwgTWV0cmljRGF0dW0gfSBmcm9tICdAYXdzLXNkay9jbGllbnQtY2xvdWR3YXRjaCc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuL2xvZ2dlcic7XG5cbi8qKlxuICogQ2xvdWRXYXRjaCBtZXRyaWNzIHV0aWxpdHkgZm9yIG1vbml0b3JpbmcgYWdlbnQgcGVyZm9ybWFuY2VcbiAqL1xuZXhwb3J0IGNsYXNzIE1ldHJpY3NDb2xsZWN0b3Ige1xuICBwcml2YXRlIGNsb3VkV2F0Y2g6IENsb3VkV2F0Y2hDbGllbnQ7XG4gIHByaXZhdGUgbmFtZXNwYWNlOiBzdHJpbmc7XG4gIHByaXZhdGUgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdNZXRyaWNzQ29sbGVjdG9yJyk7XG5cbiAgY29uc3RydWN0b3IocmVnaW9uOiBzdHJpbmcsIG5hbWVzcGFjZTogc3RyaW5nID0gJ1NwZW5kTW9uaXRvci9BZ2VudCcpIHtcbiAgICB0aGlzLmNsb3VkV2F0Y2ggPSBuZXcgQ2xvdWRXYXRjaENsaWVudCh7IHJlZ2lvbiB9KTtcbiAgICB0aGlzLm5hbWVzcGFjZSA9IG5hbWVzcGFjZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGV4ZWN1dGlvbiBkdXJhdGlvbiBtZXRyaWNcbiAgICovXG4gIGFzeW5jIHJlY29yZEV4ZWN1dGlvbkR1cmF0aW9uKG9wZXJhdGlvbjogc3RyaW5nLCBkdXJhdGlvbk1zOiBudW1iZXIsIHN1Y2Nlc3M6IGJvb2xlYW4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtZXRyaWNzOiBNZXRyaWNEYXR1bVtdID0gW1xuICAgICAge1xuICAgICAgICBNZXRyaWNOYW1lOiAnRXhlY3V0aW9uRHVyYXRpb24nLFxuICAgICAgICBWYWx1ZTogZHVyYXRpb25NcyxcbiAgICAgICAgVW5pdDogJ01pbGxpc2Vjb25kcycsXG4gICAgICAgIERpbWVuc2lvbnM6IFtcbiAgICAgICAgICB7IE5hbWU6ICdPcGVyYXRpb24nLCBWYWx1ZTogb3BlcmF0aW9uIH0sXG4gICAgICAgICAgeyBOYW1lOiAnU3RhdHVzJywgVmFsdWU6IHN1Y2Nlc3MgPyAnU3VjY2VzcycgOiAnRmFpbHVyZScgfVxuICAgICAgICBdLFxuICAgICAgICBUaW1lc3RhbXA6IG5ldyBEYXRlKClcbiAgICAgIH1cbiAgICBdO1xuXG4gICAgYXdhaXQgdGhpcy5wdXRNZXRyaWNzKG1ldHJpY3MpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgc3VjY2Vzcy9mYWlsdXJlIHJhdGUgbWV0cmljc1xuICAgKi9cbiAgYXN5bmMgcmVjb3JkRXhlY3V0aW9uUmVzdWx0KG9wZXJhdGlvbjogc3RyaW5nLCBzdWNjZXNzOiBib29sZWFuKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbWV0cmljczogTWV0cmljRGF0dW1bXSA9IFtcbiAgICAgIHtcbiAgICAgICAgTWV0cmljTmFtZTogJ0V4ZWN1dGlvbkNvdW50JyxcbiAgICAgICAgVmFsdWU6IDEsXG4gICAgICAgIFVuaXQ6ICdDb3VudCcsXG4gICAgICAgIERpbWVuc2lvbnM6IFtcbiAgICAgICAgICB7IE5hbWU6ICdPcGVyYXRpb24nLCBWYWx1ZTogb3BlcmF0aW9uIH0sXG4gICAgICAgICAgeyBOYW1lOiAnU3RhdHVzJywgVmFsdWU6IHN1Y2Nlc3MgPyAnU3VjY2VzcycgOiAnRmFpbHVyZScgfVxuICAgICAgICBdLFxuICAgICAgICBUaW1lc3RhbXA6IG5ldyBEYXRlKClcbiAgICAgIH1cbiAgICBdO1xuXG4gICAgaWYgKHN1Y2Nlc3MpIHtcbiAgICAgIG1ldHJpY3MucHVzaCh7XG4gICAgICAgIE1ldHJpY05hbWU6ICdTdWNjZXNzUmF0ZScsXG4gICAgICAgIFZhbHVlOiAxLFxuICAgICAgICBVbml0OiAnQ291bnQnLFxuICAgICAgICBEaW1lbnNpb25zOiBbeyBOYW1lOiAnT3BlcmF0aW9uJywgVmFsdWU6IG9wZXJhdGlvbiB9XSxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpXG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgbWV0cmljcy5wdXNoKHtcbiAgICAgICAgTWV0cmljTmFtZTogJ0Vycm9yUmF0ZScsXG4gICAgICAgIFZhbHVlOiAxLFxuICAgICAgICBVbml0OiAnQ291bnQnLFxuICAgICAgICBEaW1lbnNpb25zOiBbeyBOYW1lOiAnT3BlcmF0aW9uJywgVmFsdWU6IG9wZXJhdGlvbiB9XSxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnB1dE1ldHJpY3MobWV0cmljcyk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBjb3N0IGFuYWx5c2lzIG1ldHJpY3NcbiAgICovXG4gIGFzeW5jIHJlY29yZENvc3RBbmFseXNpcyh0b3RhbENvc3Q6IG51bWJlciwgcHJvamVjdGVkQ29zdDogbnVtYmVyLCBzZXJ2aWNlQ291bnQ6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1ldHJpY3M6IE1ldHJpY0RhdHVtW10gPSBbXG4gICAgICB7XG4gICAgICAgIE1ldHJpY05hbWU6ICdDdXJyZW50U3BlbmQnLFxuICAgICAgICBWYWx1ZTogdG90YWxDb3N0LFxuICAgICAgICBVbml0OiAnTm9uZScsXG4gICAgICAgIFRpbWVzdGFtcDogbmV3IERhdGUoKVxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgTWV0cmljTmFtZTogJ1Byb2plY3RlZE1vbnRobHlTcGVuZCcsXG4gICAgICAgIFZhbHVlOiBwcm9qZWN0ZWRDb3N0LFxuICAgICAgICBVbml0OiAnTm9uZScsXG4gICAgICAgIFRpbWVzdGFtcDogbmV3IERhdGUoKVxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgTWV0cmljTmFtZTogJ1NlcnZpY2VDb3VudCcsXG4gICAgICAgIFZhbHVlOiBzZXJ2aWNlQ291bnQsXG4gICAgICAgIFVuaXQ6ICdDb3VudCcsXG4gICAgICAgIFRpbWVzdGFtcDogbmV3IERhdGUoKVxuICAgICAgfVxuICAgIF07XG5cbiAgICBhd2FpdCB0aGlzLnB1dE1ldHJpY3MobWV0cmljcyk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhbGVydCBkZWxpdmVyeSBtZXRyaWNzXG4gICAqL1xuICBhc3luYyByZWNvcmRBbGVydERlbGl2ZXJ5KGNoYW5uZWxzOiBzdHJpbmdbXSwgc3VjY2VzczogYm9vbGVhbiwgcmV0cnlDb3VudDogbnVtYmVyID0gMCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1ldHJpY3M6IE1ldHJpY0RhdHVtW10gPSBbXG4gICAgICB7XG4gICAgICAgIE1ldHJpY05hbWU6ICdBbGVydERlbGl2ZXJ5Q291bnQnLFxuICAgICAgICBWYWx1ZTogMSxcbiAgICAgICAgVW5pdDogJ0NvdW50JyxcbiAgICAgICAgRGltZW5zaW9uczogW1xuICAgICAgICAgIHsgTmFtZTogJ1N0YXR1cycsIFZhbHVlOiBzdWNjZXNzID8gJ1N1Y2Nlc3MnIDogJ0ZhaWx1cmUnIH1cbiAgICAgICAgXSxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBNZXRyaWNOYW1lOiAnQWxlcnRDaGFubmVsQ291bnQnLFxuICAgICAgICBWYWx1ZTogY2hhbm5lbHMubGVuZ3RoLFxuICAgICAgICBVbml0OiAnQ291bnQnLFxuICAgICAgICBUaW1lc3RhbXA6IG5ldyBEYXRlKClcbiAgICAgIH1cbiAgICBdO1xuXG4gICAgaWYgKHJldHJ5Q291bnQgPiAwKSB7XG4gICAgICBtZXRyaWNzLnB1c2goe1xuICAgICAgICBNZXRyaWNOYW1lOiAnQWxlcnRSZXRyeUNvdW50JyxcbiAgICAgICAgVmFsdWU6IHJldHJ5Q291bnQsXG4gICAgICAgIFVuaXQ6ICdDb3VudCcsXG4gICAgICAgIFRpbWVzdGFtcDogbmV3IERhdGUoKVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gUmVjb3JkIG1ldHJpY3MgcGVyIGNoYW5uZWxcbiAgICBmb3IgKGNvbnN0IGNoYW5uZWwgb2YgY2hhbm5lbHMpIHtcbiAgICAgIG1ldHJpY3MucHVzaCh7XG4gICAgICAgIE1ldHJpY05hbWU6ICdDaGFubmVsRGVsaXZlcnknLFxuICAgICAgICBWYWx1ZTogc3VjY2VzcyA/IDEgOiAwLFxuICAgICAgICBVbml0OiAnQ291bnQnLFxuICAgICAgICBEaW1lbnNpb25zOiBbXG4gICAgICAgICAgeyBOYW1lOiAnQ2hhbm5lbCcsIFZhbHVlOiBjaGFubmVsIH0sXG4gICAgICAgICAgeyBOYW1lOiAnU3RhdHVzJywgVmFsdWU6IHN1Y2Nlc3MgPyAnU3VjY2VzcycgOiAnRmFpbHVyZScgfVxuICAgICAgICBdLFxuICAgICAgICBUaW1lc3RhbXA6IG5ldyBEYXRlKClcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucHV0TWV0cmljcyhtZXRyaWNzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIHRocmVzaG9sZCBicmVhY2ggbWV0cmljc1xuICAgKi9cbiAgYXN5bmMgcmVjb3JkVGhyZXNob2xkQnJlYWNoKGN1cnJlbnRTcGVuZDogbnVtYmVyLCB0aHJlc2hvbGQ6IG51bWJlciwgZXhjZWVkQW1vdW50OiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtZXRyaWNzOiBNZXRyaWNEYXR1bVtdID0gW1xuICAgICAge1xuICAgICAgICBNZXRyaWNOYW1lOiAnVGhyZXNob2xkQnJlYWNoJyxcbiAgICAgICAgVmFsdWU6IDEsXG4gICAgICAgIFVuaXQ6ICdDb3VudCcsXG4gICAgICAgIFRpbWVzdGFtcDogbmV3IERhdGUoKVxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgTWV0cmljTmFtZTogJ1RocmVzaG9sZEV4Y2VlZEFtb3VudCcsXG4gICAgICAgIFZhbHVlOiBleGNlZWRBbW91bnQsXG4gICAgICAgIFVuaXQ6ICdOb25lJyxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBNZXRyaWNOYW1lOiAnVGhyZXNob2xkRXhjZWVkUGVyY2VudGFnZScsXG4gICAgICAgIFZhbHVlOiAoZXhjZWVkQW1vdW50IC8gdGhyZXNob2xkKSAqIDEwMCxcbiAgICAgICAgVW5pdDogJ1BlcmNlbnQnLFxuICAgICAgICBUaW1lc3RhbXA6IG5ldyBEYXRlKClcbiAgICAgIH1cbiAgICBdO1xuXG4gICAgYXdhaXQgdGhpcy5wdXRNZXRyaWNzKG1ldHJpY3MpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgaU9TIG5vdGlmaWNhdGlvbiBtZXRyaWNzXG4gICAqL1xuICBhc3luYyByZWNvcmRJT1NOb3RpZmljYXRpb24oZGV2aWNlQ291bnQ6IG51bWJlciwgc3VjY2VzczogYm9vbGVhbiwgaW52YWxpZFRva2VuczogbnVtYmVyID0gMCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1ldHJpY3M6IE1ldHJpY0RhdHVtW10gPSBbXG4gICAgICB7XG4gICAgICAgIE1ldHJpY05hbWU6ICdpT1NOb3RpZmljYXRpb25Db3VudCcsXG4gICAgICAgIFZhbHVlOiAxLFxuICAgICAgICBVbml0OiAnQ291bnQnLFxuICAgICAgICBEaW1lbnNpb25zOiBbXG4gICAgICAgICAgeyBOYW1lOiAnU3RhdHVzJywgVmFsdWU6IHN1Y2Nlc3MgPyAnU3VjY2VzcycgOiAnRmFpbHVyZScgfVxuICAgICAgICBdLFxuICAgICAgICBUaW1lc3RhbXA6IG5ldyBEYXRlKClcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIE1ldHJpY05hbWU6ICdpT1NEZXZpY2VDb3VudCcsXG4gICAgICAgIFZhbHVlOiBkZXZpY2VDb3VudCxcbiAgICAgICAgVW5pdDogJ0NvdW50JyxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpXG4gICAgICB9XG4gICAgXTtcblxuICAgIGlmIChpbnZhbGlkVG9rZW5zID4gMCkge1xuICAgICAgbWV0cmljcy5wdXNoKHtcbiAgICAgICAgTWV0cmljTmFtZTogJ2lPU0ludmFsaWRUb2tlbnMnLFxuICAgICAgICBWYWx1ZTogaW52YWxpZFRva2VucyxcbiAgICAgICAgVW5pdDogJ0NvdW50JyxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnB1dE1ldHJpY3MobWV0cmljcyk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBpT1MgZGV2aWNlIHJlZ2lzdHJhdGlvbiBtZXRyaWNzXG4gICAqL1xuICBhc3luYyByZWNvcmRJT1NEZXZpY2VSZWdpc3RyYXRpb24oc3VjY2VzczogYm9vbGVhbiwgZXJyb3JUeXBlPzogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbWV0cmljczogTWV0cmljRGF0dW1bXSA9IFtcbiAgICAgIHtcbiAgICAgICAgTWV0cmljTmFtZTogJ2lPU0RldmljZVJlZ2lzdHJhdGlvbkNvdW50JyxcbiAgICAgICAgVmFsdWU6IDEsXG4gICAgICAgIFVuaXQ6ICdDb3VudCcsXG4gICAgICAgIERpbWVuc2lvbnM6IFtcbiAgICAgICAgICB7IE5hbWU6ICdTdGF0dXMnLCBWYWx1ZTogc3VjY2VzcyA/ICdTdWNjZXNzJyA6ICdGYWlsdXJlJyB9XG4gICAgICAgIF0sXG4gICAgICAgIFRpbWVzdGFtcDogbmV3IERhdGUoKVxuICAgICAgfVxuICAgIF07XG5cbiAgICBpZiAoIXN1Y2Nlc3MgJiYgZXJyb3JUeXBlKSB7XG4gICAgICBtZXRyaWNzLnB1c2goe1xuICAgICAgICBNZXRyaWNOYW1lOiAnaU9TUmVnaXN0cmF0aW9uRXJyb3JUeXBlJyxcbiAgICAgICAgVmFsdWU6IDEsXG4gICAgICAgIFVuaXQ6ICdDb3VudCcsXG4gICAgICAgIERpbWVuc2lvbnM6IFtcbiAgICAgICAgICB7IE5hbWU6ICdFcnJvclR5cGUnLCBWYWx1ZTogZXJyb3JUeXBlIH1cbiAgICAgICAgXSxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnB1dE1ldHJpY3MobWV0cmljcyk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBBUE5TIGNlcnRpZmljYXRlIGhlYWx0aCBtZXRyaWNzXG4gICAqL1xuICBhc3luYyByZWNvcmRBUE5TQ2VydGlmaWNhdGVIZWFsdGgoXG4gICAgaXNWYWxpZDogYm9vbGVhbiwgXG4gICAgZGF5c1VudGlsRXhwaXJhdGlvbj86IG51bWJlciwgXG4gICAgd2FybmluZ0NvdW50OiBudW1iZXIgPSAwLCBcbiAgICBlcnJvckNvdW50OiBudW1iZXIgPSAwXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1ldHJpY3M6IE1ldHJpY0RhdHVtW10gPSBbXG4gICAgICB7XG4gICAgICAgIE1ldHJpY05hbWU6ICdBUE5TQ2VydGlmaWNhdGVWYWxpZCcsXG4gICAgICAgIFZhbHVlOiBpc1ZhbGlkID8gMSA6IDAsXG4gICAgICAgIFVuaXQ6ICdDb3VudCcsXG4gICAgICAgIFRpbWVzdGFtcDogbmV3IERhdGUoKVxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgTWV0cmljTmFtZTogJ0FQTlNDZXJ0aWZpY2F0ZVdhcm5pbmdzJyxcbiAgICAgICAgVmFsdWU6IHdhcm5pbmdDb3VudCxcbiAgICAgICAgVW5pdDogJ0NvdW50JyxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBNZXRyaWNOYW1lOiAnQVBOU0NlcnRpZmljYXRlRXJyb3JzJyxcbiAgICAgICAgVmFsdWU6IGVycm9yQ291bnQsXG4gICAgICAgIFVuaXQ6ICdDb3VudCcsXG4gICAgICAgIFRpbWVzdGFtcDogbmV3IERhdGUoKVxuICAgICAgfVxuICAgIF07XG5cbiAgICBpZiAoZGF5c1VudGlsRXhwaXJhdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBtZXRyaWNzLnB1c2goe1xuICAgICAgICBNZXRyaWNOYW1lOiAnQVBOU0NlcnRpZmljYXRlRGF5c1VudGlsRXhwaXJhdGlvbicsXG4gICAgICAgIFZhbHVlOiBkYXlzVW50aWxFeHBpcmF0aW9uLFxuICAgICAgICBVbml0OiAnQ291bnQnLFxuICAgICAgICBUaW1lc3RhbXA6IG5ldyBEYXRlKClcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucHV0TWV0cmljcyhtZXRyaWNzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGlPUyBub3RpZmljYXRpb24gcGF5bG9hZCBtZXRyaWNzXG4gICAqL1xuICBhc3luYyByZWNvcmRJT1NQYXlsb2FkTWV0cmljcyhwYXlsb2FkU2l6ZTogbnVtYmVyLCBkZWxpdmVyeVRpbWU6IG51bWJlciwgcmV0cnlDb3VudDogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbWV0cmljczogTWV0cmljRGF0dW1bXSA9IFtcbiAgICAgIHtcbiAgICAgICAgTWV0cmljTmFtZTogJ2lPU1BheWxvYWRTaXplJyxcbiAgICAgICAgVmFsdWU6IHBheWxvYWRTaXplLFxuICAgICAgICBVbml0OiAnQnl0ZXMnLFxuICAgICAgICBUaW1lc3RhbXA6IG5ldyBEYXRlKClcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIE1ldHJpY05hbWU6ICdpT1NOb3RpZmljYXRpb25EZWxpdmVyeVRpbWUnLFxuICAgICAgICBWYWx1ZTogZGVsaXZlcnlUaW1lLFxuICAgICAgICBVbml0OiAnTWlsbGlzZWNvbmRzJyxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpXG4gICAgICB9XG4gICAgXTtcblxuICAgIGlmIChyZXRyeUNvdW50ID4gMCkge1xuICAgICAgbWV0cmljcy5wdXNoKHtcbiAgICAgICAgTWV0cmljTmFtZTogJ2lPU05vdGlmaWNhdGlvblJldHJ5Q291bnQnLFxuICAgICAgICBWYWx1ZTogcmV0cnlDb3VudCxcbiAgICAgICAgVW5pdDogJ0NvdW50JyxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnB1dE1ldHJpY3MobWV0cmljcyk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBpT1MgZmFsbGJhY2sgdXNhZ2UgbWV0cmljc1xuICAgKi9cbiAgYXN5bmMgcmVjb3JkSU9TRmFsbGJhY2tVc2FnZShmYWxsYmFja0NoYW5uZWxzOiBzdHJpbmdbXSwgc3VjY2VzczogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1ldHJpY3M6IE1ldHJpY0RhdHVtW10gPSBbXG4gICAgICB7XG4gICAgICAgIE1ldHJpY05hbWU6ICdpT1NGYWxsYmFja1VzZWQnLFxuICAgICAgICBWYWx1ZTogMSxcbiAgICAgICAgVW5pdDogJ0NvdW50JyxcbiAgICAgICAgRGltZW5zaW9uczogW1xuICAgICAgICAgIHsgTmFtZTogJ1N0YXR1cycsIFZhbHVlOiBzdWNjZXNzID8gJ1N1Y2Nlc3MnIDogJ0ZhaWx1cmUnIH1cbiAgICAgICAgXSxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBNZXRyaWNOYW1lOiAnaU9TRmFsbGJhY2tDaGFubmVsQ291bnQnLFxuICAgICAgICBWYWx1ZTogZmFsbGJhY2tDaGFubmVscy5sZW5ndGgsXG4gICAgICAgIFVuaXQ6ICdDb3VudCcsXG4gICAgICAgIFRpbWVzdGFtcDogbmV3IERhdGUoKVxuICAgICAgfVxuICAgIF07XG5cbiAgICAvLyBSZWNvcmQgbWV0cmljcyBwZXIgZmFsbGJhY2sgY2hhbm5lbFxuICAgIGZvciAoY29uc3QgY2hhbm5lbCBvZiBmYWxsYmFja0NoYW5uZWxzKSB7XG4gICAgICBtZXRyaWNzLnB1c2goe1xuICAgICAgICBNZXRyaWNOYW1lOiAnaU9TRmFsbGJhY2tDaGFubmVsVXNhZ2UnLFxuICAgICAgICBWYWx1ZTogMSxcbiAgICAgICAgVW5pdDogJ0NvdW50JyxcbiAgICAgICAgRGltZW5zaW9uczogW1xuICAgICAgICAgIHsgTmFtZTogJ0NoYW5uZWwnLCBWYWx1ZTogY2hhbm5lbCB9LFxuICAgICAgICAgIHsgTmFtZTogJ1N0YXR1cycsIFZhbHVlOiBzdWNjZXNzID8gJ1N1Y2Nlc3MnIDogJ0ZhaWx1cmUnIH1cbiAgICAgICAgXSxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnB1dE1ldHJpY3MobWV0cmljcyk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBBUEkgY2FsbCBtZXRyaWNzXG4gICAqL1xuICBhc3luYyByZWNvcmRBUElDYWxsKHNlcnZpY2U6IHN0cmluZywgb3BlcmF0aW9uOiBzdHJpbmcsIGR1cmF0aW9uTXM6IG51bWJlciwgc3VjY2VzczogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1ldHJpY3M6IE1ldHJpY0RhdHVtW10gPSBbXG4gICAgICB7XG4gICAgICAgIE1ldHJpY05hbWU6ICdBUElDYWxsRHVyYXRpb24nLFxuICAgICAgICBWYWx1ZTogZHVyYXRpb25NcyxcbiAgICAgICAgVW5pdDogJ01pbGxpc2Vjb25kcycsXG4gICAgICAgIERpbWVuc2lvbnM6IFtcbiAgICAgICAgICB7IE5hbWU6ICdTZXJ2aWNlJywgVmFsdWU6IHNlcnZpY2UgfSxcbiAgICAgICAgICB7IE5hbWU6ICdPcGVyYXRpb24nLCBWYWx1ZTogb3BlcmF0aW9uIH0sXG4gICAgICAgICAgeyBOYW1lOiAnU3RhdHVzJywgVmFsdWU6IHN1Y2Nlc3MgPyAnU3VjY2VzcycgOiAnRmFpbHVyZScgfVxuICAgICAgICBdLFxuICAgICAgICBUaW1lc3RhbXA6IG5ldyBEYXRlKClcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIE1ldHJpY05hbWU6ICdBUElDYWxsQ291bnQnLFxuICAgICAgICBWYWx1ZTogMSxcbiAgICAgICAgVW5pdDogJ0NvdW50JyxcbiAgICAgICAgRGltZW5zaW9uczogW1xuICAgICAgICAgIHsgTmFtZTogJ1NlcnZpY2UnLCBWYWx1ZTogc2VydmljZSB9LFxuICAgICAgICAgIHsgTmFtZTogJ09wZXJhdGlvbicsIFZhbHVlOiBvcGVyYXRpb24gfSxcbiAgICAgICAgICB7IE5hbWU6ICdTdGF0dXMnLCBWYWx1ZTogc3VjY2VzcyA/ICdTdWNjZXNzJyA6ICdGYWlsdXJlJyB9XG4gICAgICAgIF0sXG4gICAgICAgIFRpbWVzdGFtcDogbmV3IERhdGUoKVxuICAgICAgfVxuICAgIF07XG5cbiAgICBhd2FpdCB0aGlzLnB1dE1ldHJpY3MobWV0cmljcyk7XG4gIH1cblxuICAvKipcbiAgICogU2VuZHMgbWV0cmljcyB0byBDbG91ZFdhdGNoXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHB1dE1ldHJpY3MobWV0cmljczogTWV0cmljRGF0dW1bXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBjb21tYW5kID0gbmV3IFB1dE1ldHJpY0RhdGFDb21tYW5kKHtcbiAgICAgICAgTmFtZXNwYWNlOiB0aGlzLm5hbWVzcGFjZSxcbiAgICAgICAgTWV0cmljRGF0YTogbWV0cmljc1xuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IHRoaXMuY2xvdWRXYXRjaC5zZW5kKGNvbW1hbmQpO1xuICAgICAgXG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnTWV0cmljcyBzZW50IHRvIENsb3VkV2F0Y2gnLCB7XG4gICAgICAgIG5hbWVzcGFjZTogdGhpcy5uYW1lc3BhY2UsXG4gICAgICAgIG1ldHJpY0NvdW50OiBtZXRyaWNzLmxlbmd0aCxcbiAgICAgICAgbWV0cmljczogbWV0cmljcy5tYXAobSA9PiAoeyBuYW1lOiBtLk1ldHJpY05hbWUsIHZhbHVlOiBtLlZhbHVlLCB1bml0OiBtLlVuaXQgfSkpXG4gICAgICB9KTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcignRmFpbGVkIHRvIHNlbmQgbWV0cmljcyB0byBDbG91ZFdhdGNoJywgZXJyb3IgYXMgRXJyb3IsIHtcbiAgICAgICAgbmFtZXNwYWNlOiB0aGlzLm5hbWVzcGFjZSxcbiAgICAgICAgbWV0cmljQ291bnQ6IG1ldHJpY3MubGVuZ3RoXG4gICAgICB9KTtcbiAgICAgIC8vIERvbid0IHRocm93IGVycm9yIHRvIGF2b2lkIGJyZWFraW5nIG1haW4gZXhlY3V0aW9uXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSB0aW1lciBmb3IgbWVhc3VyaW5nIG9wZXJhdGlvbiBkdXJhdGlvblxuICAgKi9cbiAgY3JlYXRlVGltZXIob3BlcmF0aW9uOiBzdHJpbmcpOiB7XG4gICAgc3RvcDogKHN1Y2Nlc3M6IGJvb2xlYW4pID0+IFByb21pc2U8dm9pZD47XG4gIH0ge1xuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0b3A6IGFzeW5jIChzdWNjZXNzOiBib29sZWFuKSA9PiB7XG4gICAgICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcbiAgICAgICAgYXdhaXQgdGhpcy5yZWNvcmRFeGVjdXRpb25EdXJhdGlvbihvcGVyYXRpb24sIGR1cmF0aW9uLCBzdWNjZXNzKTtcbiAgICAgICAgYXdhaXQgdGhpcy5yZWNvcmRFeGVjdXRpb25SZXN1bHQob3BlcmF0aW9uLCBzdWNjZXNzKTtcbiAgICAgIH1cbiAgICB9O1xuICB9XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIG1ldHJpY3MgY29sbGVjdG9yIGluc3RhbmNlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVNZXRyaWNzQ29sbGVjdG9yKHJlZ2lvbjogc3RyaW5nLCBuYW1lc3BhY2U/OiBzdHJpbmcpOiBNZXRyaWNzQ29sbGVjdG9yIHtcbiAgcmV0dXJuIG5ldyBNZXRyaWNzQ29sbGVjdG9yKHJlZ2lvbiwgbmFtZXNwYWNlKTtcbn0iXX0=