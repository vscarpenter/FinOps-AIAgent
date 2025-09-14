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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWV0cmljcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy91dGlscy9tZXRyaWNzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQW9TQSx3REFFQztBQXRTRCxrRUFBaUc7QUFDakcscUNBQXdDO0FBRXhDOztHQUVHO0FBQ0gsTUFBYSxnQkFBZ0I7SUFLM0IsWUFBWSxNQUFjLEVBQUUsWUFBb0Isb0JBQW9CO1FBRjVELFdBQU0sR0FBRyxJQUFBLHFCQUFZLEVBQUMsa0JBQWtCLENBQUMsQ0FBQztRQUdoRCxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksb0NBQWdCLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxDQUFDO1FBQ25ELElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO0lBQzdCLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxTQUFpQixFQUFFLFVBQWtCLEVBQUUsT0FBZ0I7UUFDbkYsTUFBTSxPQUFPLEdBQWtCO1lBQzdCO2dCQUNFLFVBQVUsRUFBRSxtQkFBbUI7Z0JBQy9CLEtBQUssRUFBRSxVQUFVO2dCQUNqQixJQUFJLEVBQUUsY0FBYztnQkFDcEIsVUFBVSxFQUFFO29CQUNWLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFO29CQUN2QyxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxTQUFTLEVBQUU7aUJBQzNEO2dCQUNELFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRTthQUN0QjtTQUNGLENBQUM7UUFFRixNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDakMsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLHFCQUFxQixDQUFDLFNBQWlCLEVBQUUsT0FBZ0I7UUFDN0QsTUFBTSxPQUFPLEdBQWtCO1lBQzdCO2dCQUNF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TyxDQUFDLENBQUM7WUFDdkQsQ0FBQztTQUNGLENBQUM7SUFDSixDQUFDO0NBQ0Y7QUF6UkQsNENBeVJDO0FBRUQ7O0dBRUc7QUFDSCxTQUFnQixzQkFBc0IsQ0FBQyxNQUFjLEVBQUUsU0FBa0I7SUFDdkUsT0FBTyxJQUFJLGdCQUFnQixDQUFDLE1BQU0sRUFBRSxTQUFTLENBQUMsQ0FBQztBQUNqRCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ2xvdWRXYXRjaENsaWVudCwgUHV0TWV0cmljRGF0YUNvbW1hbmQsIE1ldHJpY0RhdHVtIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWNsb3Vkd2F0Y2gnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi9sb2dnZXInO1xuXG4vKipcbiAqIENsb3VkV2F0Y2ggbWV0cmljcyB1dGlsaXR5IGZvciBtb25pdG9yaW5nIGFnZW50IHBlcmZvcm1hbmNlXG4gKi9cbmV4cG9ydCBjbGFzcyBNZXRyaWNzQ29sbGVjdG9yIHtcbiAgcHJpdmF0ZSBjbG91ZFdhdGNoOiBDbG91ZFdhdGNoQ2xpZW50O1xuICBwcml2YXRlIG5hbWVzcGFjZTogc3RyaW5nO1xuICBwcml2YXRlIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignTWV0cmljc0NvbGxlY3RvcicpO1xuXG4gIGNvbnN0cnVjdG9yKHJlZ2lvbjogc3RyaW5nLCBuYW1lc3BhY2U6IHN0cmluZyA9ICdTcGVuZE1vbml0b3IvQWdlbnQnKSB7XG4gICAgdGhpcy5jbG91ZFdhdGNoID0gbmV3IENsb3VkV2F0Y2hDbGllbnQoeyByZWdpb24gfSk7XG4gICAgdGhpcy5uYW1lc3BhY2UgPSBuYW1lc3BhY2U7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBleGVjdXRpb24gZHVyYXRpb24gbWV0cmljXG4gICAqL1xuICBhc3luYyByZWNvcmRFeGVjdXRpb25EdXJhdGlvbihvcGVyYXRpb246IHN0cmluZywgZHVyYXRpb25NczogbnVtYmVyLCBzdWNjZXNzOiBib29sZWFuKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbWV0cmljczogTWV0cmljRGF0dW1bXSA9IFtcbiAgICAgIHtcbiAgICAgICAgTWV0cmljTmFtZTogJ0V4ZWN1dGlvbkR1cmF0aW9uJyxcbiAgICAgICAgVmFsdWU6IGR1cmF0aW9uTXMsXG4gICAgICAgIFVuaXQ6ICdNaWxsaXNlY29uZHMnLFxuICAgICAgICBEaW1lbnNpb25zOiBbXG4gICAgICAgICAgeyBOYW1lOiAnT3BlcmF0aW9uJywgVmFsdWU6IG9wZXJhdGlvbiB9LFxuICAgICAgICAgIHsgTmFtZTogJ1N0YXR1cycsIFZhbHVlOiBzdWNjZXNzID8gJ1N1Y2Nlc3MnIDogJ0ZhaWx1cmUnIH1cbiAgICAgICAgXSxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpXG4gICAgICB9XG4gICAgXTtcblxuICAgIGF3YWl0IHRoaXMucHV0TWV0cmljcyhtZXRyaWNzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIHN1Y2Nlc3MvZmFpbHVyZSByYXRlIG1ldHJpY3NcbiAgICovXG4gIGFzeW5jIHJlY29yZEV4ZWN1dGlvblJlc3VsdChvcGVyYXRpb246IHN0cmluZywgc3VjY2VzczogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1ldHJpY3M6IE1ldHJpY0RhdHVtW10gPSBbXG4gICAgICB7XG4gICAgICAgIE1ldHJpY05hbWU6ICdFeGVjdXRpb25Db3VudCcsXG4gICAgICAgIFZhbHVlOiAxLFxuICAgICAgICBVbml0OiAnQ291bnQnLFxuICAgICAgICBEaW1lbnNpb25zOiBbXG4gICAgICAgICAgeyBOYW1lOiAnT3BlcmF0aW9uJywgVmFsdWU6IG9wZXJhdGlvbiB9LFxuICAgICAgICAgIHsgTmFtZTogJ1N0YXR1cycsIFZhbHVlOiBzdWNjZXNzID8gJ1N1Y2Nlc3MnIDogJ0ZhaWx1cmUnIH1cbiAgICAgICAgXSxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpXG4gICAgICB9XG4gICAgXTtcblxuICAgIGlmIChzdWNjZXNzKSB7XG4gICAgICBtZXRyaWNzLnB1c2goe1xuICAgICAgICBNZXRyaWNOYW1lOiAnU3VjY2Vzc1JhdGUnLFxuICAgICAgICBWYWx1ZTogMSxcbiAgICAgICAgVW5pdDogJ0NvdW50JyxcbiAgICAgICAgRGltZW5zaW9uczogW3sgTmFtZTogJ09wZXJhdGlvbicsIFZhbHVlOiBvcGVyYXRpb24gfV0sXG4gICAgICAgIFRpbWVzdGFtcDogbmV3IERhdGUoKVxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG1ldHJpY3MucHVzaCh7XG4gICAgICAgIE1ldHJpY05hbWU6ICdFcnJvclJhdGUnLFxuICAgICAgICBWYWx1ZTogMSxcbiAgICAgICAgVW5pdDogJ0NvdW50JyxcbiAgICAgICAgRGltZW5zaW9uczogW3sgTmFtZTogJ09wZXJhdGlvbicsIFZhbHVlOiBvcGVyYXRpb24gfV0sXG4gICAgICAgIFRpbWVzdGFtcDogbmV3IERhdGUoKVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5wdXRNZXRyaWNzKG1ldHJpY3MpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgY29zdCBhbmFseXNpcyBtZXRyaWNzXG4gICAqL1xuICBhc3luYyByZWNvcmRDb3N0QW5hbHlzaXModG90YWxDb3N0OiBudW1iZXIsIHByb2plY3RlZENvc3Q6IG51bWJlciwgc2VydmljZUNvdW50OiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtZXRyaWNzOiBNZXRyaWNEYXR1bVtdID0gW1xuICAgICAge1xuICAgICAgICBNZXRyaWNOYW1lOiAnQ3VycmVudFNwZW5kJyxcbiAgICAgICAgVmFsdWU6IHRvdGFsQ29zdCxcbiAgICAgICAgVW5pdDogJ05vbmUnLFxuICAgICAgICBUaW1lc3RhbXA6IG5ldyBEYXRlKClcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIE1ldHJpY05hbWU6ICdQcm9qZWN0ZWRNb250aGx5U3BlbmQnLFxuICAgICAgICBWYWx1ZTogcHJvamVjdGVkQ29zdCxcbiAgICAgICAgVW5pdDogJ05vbmUnLFxuICAgICAgICBUaW1lc3RhbXA6IG5ldyBEYXRlKClcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIE1ldHJpY05hbWU6ICdTZXJ2aWNlQ291bnQnLFxuICAgICAgICBWYWx1ZTogc2VydmljZUNvdW50LFxuICAgICAgICBVbml0OiAnQ291bnQnLFxuICAgICAgICBUaW1lc3RhbXA6IG5ldyBEYXRlKClcbiAgICAgIH1cbiAgICBdO1xuXG4gICAgYXdhaXQgdGhpcy5wdXRNZXRyaWNzKG1ldHJpY3MpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYWxlcnQgZGVsaXZlcnkgbWV0cmljc1xuICAgKi9cbiAgYXN5bmMgcmVjb3JkQWxlcnREZWxpdmVyeShjaGFubmVsczogc3RyaW5nW10sIHN1Y2Nlc3M6IGJvb2xlYW4sIHJldHJ5Q291bnQ6IG51bWJlciA9IDApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtZXRyaWNzOiBNZXRyaWNEYXR1bVtdID0gW1xuICAgICAge1xuICAgICAgICBNZXRyaWNOYW1lOiAnQWxlcnREZWxpdmVyeUNvdW50JyxcbiAgICAgICAgVmFsdWU6IDEsXG4gICAgICAgIFVuaXQ6ICdDb3VudCcsXG4gICAgICAgIERpbWVuc2lvbnM6IFtcbiAgICAgICAgICB7IE5hbWU6ICdTdGF0dXMnLCBWYWx1ZTogc3VjY2VzcyA/ICdTdWNjZXNzJyA6ICdGYWlsdXJlJyB9XG4gICAgICAgIF0sXG4gICAgICAgIFRpbWVzdGFtcDogbmV3IERhdGUoKVxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgTWV0cmljTmFtZTogJ0FsZXJ0Q2hhbm5lbENvdW50JyxcbiAgICAgICAgVmFsdWU6IGNoYW5uZWxzLmxlbmd0aCxcbiAgICAgICAgVW5pdDogJ0NvdW50JyxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpXG4gICAgICB9XG4gICAgXTtcblxuICAgIGlmIChyZXRyeUNvdW50ID4gMCkge1xuICAgICAgbWV0cmljcy5wdXNoKHtcbiAgICAgICAgTWV0cmljTmFtZTogJ0FsZXJ0UmV0cnlDb3VudCcsXG4gICAgICAgIFZhbHVlOiByZXRyeUNvdW50LFxuICAgICAgICBVbml0OiAnQ291bnQnLFxuICAgICAgICBUaW1lc3RhbXA6IG5ldyBEYXRlKClcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIFJlY29yZCBtZXRyaWNzIHBlciBjaGFubmVsXG4gICAgZm9yIChjb25zdCBjaGFubmVsIG9mIGNoYW5uZWxzKSB7XG4gICAgICBtZXRyaWNzLnB1c2goe1xuICAgICAgICBNZXRyaWNOYW1lOiAnQ2hhbm5lbERlbGl2ZXJ5JyxcbiAgICAgICAgVmFsdWU6IHN1Y2Nlc3MgPyAxIDogMCxcbiAgICAgICAgVW5pdDogJ0NvdW50JyxcbiAgICAgICAgRGltZW5zaW9uczogW1xuICAgICAgICAgIHsgTmFtZTogJ0NoYW5uZWwnLCBWYWx1ZTogY2hhbm5lbCB9LFxuICAgICAgICAgIHsgTmFtZTogJ1N0YXR1cycsIFZhbHVlOiBzdWNjZXNzID8gJ1N1Y2Nlc3MnIDogJ0ZhaWx1cmUnIH1cbiAgICAgICAgXSxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnB1dE1ldHJpY3MobWV0cmljcyk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyB0aHJlc2hvbGQgYnJlYWNoIG1ldHJpY3NcbiAgICovXG4gIGFzeW5jIHJlY29yZFRocmVzaG9sZEJyZWFjaChjdXJyZW50U3BlbmQ6IG51bWJlciwgdGhyZXNob2xkOiBudW1iZXIsIGV4Y2VlZEFtb3VudDogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbWV0cmljczogTWV0cmljRGF0dW1bXSA9IFtcbiAgICAgIHtcbiAgICAgICAgTWV0cmljTmFtZTogJ1RocmVzaG9sZEJyZWFjaCcsXG4gICAgICAgIFZhbHVlOiAxLFxuICAgICAgICBVbml0OiAnQ291bnQnLFxuICAgICAgICBUaW1lc3RhbXA6IG5ldyBEYXRlKClcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIE1ldHJpY05hbWU6ICdUaHJlc2hvbGRFeGNlZWRBbW91bnQnLFxuICAgICAgICBWYWx1ZTogZXhjZWVkQW1vdW50LFxuICAgICAgICBVbml0OiAnTm9uZScsXG4gICAgICAgIFRpbWVzdGFtcDogbmV3IERhdGUoKVxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgTWV0cmljTmFtZTogJ1RocmVzaG9sZEV4Y2VlZFBlcmNlbnRhZ2UnLFxuICAgICAgICBWYWx1ZTogKGV4Y2VlZEFtb3VudCAvIHRocmVzaG9sZCkgKiAxMDAsXG4gICAgICAgIFVuaXQ6ICdQZXJjZW50JyxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpXG4gICAgICB9XG4gICAgXTtcblxuICAgIGF3YWl0IHRoaXMucHV0TWV0cmljcyhtZXRyaWNzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGlPUyBub3RpZmljYXRpb24gbWV0cmljc1xuICAgKi9cbiAgYXN5bmMgcmVjb3JkSU9TTm90aWZpY2F0aW9uKGRldmljZUNvdW50OiBudW1iZXIsIHN1Y2Nlc3M6IGJvb2xlYW4sIGludmFsaWRUb2tlbnM6IG51bWJlciA9IDApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtZXRyaWNzOiBNZXRyaWNEYXR1bVtdID0gW1xuICAgICAge1xuICAgICAgICBNZXRyaWNOYW1lOiAnaU9TTm90aWZpY2F0aW9uQ291bnQnLFxuICAgICAgICBWYWx1ZTogMSxcbiAgICAgICAgVW5pdDogJ0NvdW50JyxcbiAgICAgICAgRGltZW5zaW9uczogW1xuICAgICAgICAgIHsgTmFtZTogJ1N0YXR1cycsIFZhbHVlOiBzdWNjZXNzID8gJ1N1Y2Nlc3MnIDogJ0ZhaWx1cmUnIH1cbiAgICAgICAgXSxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBNZXRyaWNOYW1lOiAnaU9TRGV2aWNlQ291bnQnLFxuICAgICAgICBWYWx1ZTogZGV2aWNlQ291bnQsXG4gICAgICAgIFVuaXQ6ICdDb3VudCcsXG4gICAgICAgIFRpbWVzdGFtcDogbmV3IERhdGUoKVxuICAgICAgfVxuICAgIF07XG5cbiAgICBpZiAoaW52YWxpZFRva2VucyA+IDApIHtcbiAgICAgIG1ldHJpY3MucHVzaCh7XG4gICAgICAgIE1ldHJpY05hbWU6ICdpT1NJbnZhbGlkVG9rZW5zJyxcbiAgICAgICAgVmFsdWU6IGludmFsaWRUb2tlbnMsXG4gICAgICAgIFVuaXQ6ICdDb3VudCcsXG4gICAgICAgIFRpbWVzdGFtcDogbmV3IERhdGUoKVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5wdXRNZXRyaWNzKG1ldHJpY3MpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgQVBJIGNhbGwgbWV0cmljc1xuICAgKi9cbiAgYXN5bmMgcmVjb3JkQVBJQ2FsbChzZXJ2aWNlOiBzdHJpbmcsIG9wZXJhdGlvbjogc3RyaW5nLCBkdXJhdGlvbk1zOiBudW1iZXIsIHN1Y2Nlc3M6IGJvb2xlYW4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtZXRyaWNzOiBNZXRyaWNEYXR1bVtdID0gW1xuICAgICAge1xuICAgICAgICBNZXRyaWNOYW1lOiAnQVBJQ2FsbER1cmF0aW9uJyxcbiAgICAgICAgVmFsdWU6IGR1cmF0aW9uTXMsXG4gICAgICAgIFVuaXQ6ICdNaWxsaXNlY29uZHMnLFxuICAgICAgICBEaW1lbnNpb25zOiBbXG4gICAgICAgICAgeyBOYW1lOiAnU2VydmljZScsIFZhbHVlOiBzZXJ2aWNlIH0sXG4gICAgICAgICAgeyBOYW1lOiAnT3BlcmF0aW9uJywgVmFsdWU6IG9wZXJhdGlvbiB9LFxuICAgICAgICAgIHsgTmFtZTogJ1N0YXR1cycsIFZhbHVlOiBzdWNjZXNzID8gJ1N1Y2Nlc3MnIDogJ0ZhaWx1cmUnIH1cbiAgICAgICAgXSxcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBNZXRyaWNOYW1lOiAnQVBJQ2FsbENvdW50JyxcbiAgICAgICAgVmFsdWU6IDEsXG4gICAgICAgIFVuaXQ6ICdDb3VudCcsXG4gICAgICAgIERpbWVuc2lvbnM6IFtcbiAgICAgICAgICB7IE5hbWU6ICdTZXJ2aWNlJywgVmFsdWU6IHNlcnZpY2UgfSxcbiAgICAgICAgICB7IE5hbWU6ICdPcGVyYXRpb24nLCBWYWx1ZTogb3BlcmF0aW9uIH0sXG4gICAgICAgICAgeyBOYW1lOiAnU3RhdHVzJywgVmFsdWU6IHN1Y2Nlc3MgPyAnU3VjY2VzcycgOiAnRmFpbHVyZScgfVxuICAgICAgICBdLFxuICAgICAgICBUaW1lc3RhbXA6IG5ldyBEYXRlKClcbiAgICAgIH1cbiAgICBdO1xuXG4gICAgYXdhaXQgdGhpcy5wdXRNZXRyaWNzKG1ldHJpY3MpO1xuICB9XG5cbiAgLyoqXG4gICAqIFNlbmRzIG1ldHJpY3MgdG8gQ2xvdWRXYXRjaFxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBwdXRNZXRyaWNzKG1ldHJpY3M6IE1ldHJpY0RhdHVtW10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBQdXRNZXRyaWNEYXRhQ29tbWFuZCh7XG4gICAgICAgIE5hbWVzcGFjZTogdGhpcy5uYW1lc3BhY2UsXG4gICAgICAgIE1ldHJpY0RhdGE6IG1ldHJpY3NcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCB0aGlzLmNsb3VkV2F0Y2guc2VuZChjb21tYW5kKTtcbiAgICAgIFxuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ01ldHJpY3Mgc2VudCB0byBDbG91ZFdhdGNoJywge1xuICAgICAgICBuYW1lc3BhY2U6IHRoaXMubmFtZXNwYWNlLFxuICAgICAgICBtZXRyaWNDb3VudDogbWV0cmljcy5sZW5ndGgsXG4gICAgICAgIG1ldHJpY3M6IG1ldHJpY3MubWFwKG0gPT4gKHsgbmFtZTogbS5NZXRyaWNOYW1lLCB2YWx1ZTogbS5WYWx1ZSwgdW5pdDogbS5Vbml0IH0pKVxuICAgICAgfSk7XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byBzZW5kIG1ldHJpY3MgdG8gQ2xvdWRXYXRjaCcsIGVycm9yIGFzIEVycm9yLCB7XG4gICAgICAgIG5hbWVzcGFjZTogdGhpcy5uYW1lc3BhY2UsXG4gICAgICAgIG1ldHJpY0NvdW50OiBtZXRyaWNzLmxlbmd0aFxuICAgICAgfSk7XG4gICAgICAvLyBEb24ndCB0aHJvdyBlcnJvciB0byBhdm9pZCBicmVha2luZyBtYWluIGV4ZWN1dGlvblxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgdGltZXIgZm9yIG1lYXN1cmluZyBvcGVyYXRpb24gZHVyYXRpb25cbiAgICovXG4gIGNyZWF0ZVRpbWVyKG9wZXJhdGlvbjogc3RyaW5nKToge1xuICAgIHN0b3A6IChzdWNjZXNzOiBib29sZWFuKSA9PiBQcm9taXNlPHZvaWQ+O1xuICB9IHtcbiAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIFxuICAgIHJldHVybiB7XG4gICAgICBzdG9wOiBhc3luYyAoc3VjY2VzczogYm9vbGVhbikgPT4ge1xuICAgICAgICBjb25zdCBkdXJhdGlvbiA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG4gICAgICAgIGF3YWl0IHRoaXMucmVjb3JkRXhlY3V0aW9uRHVyYXRpb24ob3BlcmF0aW9uLCBkdXJhdGlvbiwgc3VjY2Vzcyk7XG4gICAgICAgIGF3YWl0IHRoaXMucmVjb3JkRXhlY3V0aW9uUmVzdWx0KG9wZXJhdGlvbiwgc3VjY2Vzcyk7XG4gICAgICB9XG4gICAgfTtcbiAgfVxufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBtZXRyaWNzIGNvbGxlY3RvciBpbnN0YW5jZVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlTWV0cmljc0NvbGxlY3RvcihyZWdpb246IHN0cmluZywgbmFtZXNwYWNlPzogc3RyaW5nKTogTWV0cmljc0NvbGxlY3RvciB7XG4gIHJldHVybiBuZXcgTWV0cmljc0NvbGxlY3RvcihyZWdpb24sIG5hbWVzcGFjZSk7XG59Il19