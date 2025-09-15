"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.iOSMonitoringService = void 0;
exports.createiOSMonitoringService = createiOSMonitoringService;
const logger_1 = require("./logger");
const metrics_1 = require("./metrics");
const ios_management_tool_1 = require("../tools/ios-management-tool");
const alert_tool_1 = require("../tools/alert-tool");
/**
 * Comprehensive iOS monitoring and error handling service
 */
class iOSMonitoringService {
    constructor(iosConfig, region = 'us-east-1') {
        this.logger = (0, logger_1.createLogger)('iOSMonitoringService');
        this.metrics = (0, metrics_1.createMetricsCollector)('us-east-1', 'SpendMonitor/iOS');
        this.iosConfig = iosConfig;
        this.iosManagementTool = new ios_management_tool_1.iOSManagementTool(iosConfig, region);
        this.alertTool = new alert_tool_1.AlertTool(region);
    }
    /**
     * Performs comprehensive iOS system health monitoring
     */
    async performComprehensiveHealthCheck() {
        const startTime = Date.now();
        const timer = this.metrics.createTimer('ComprehensiveHealthCheck');
        try {
            this.logger.info('Starting comprehensive iOS health monitoring');
            // Parallel execution of health checks for better performance
            const [platformAppHealth, certificateHealth, feedbackResult] = await Promise.allSettled([
                this.iosManagementTool.validateAPNSConfig(),
                this.measureCertificateValidation(),
                this.measureFeedbackProcessing()
            ]);
            // Process results and handle any failures
            const platformAppStatus = platformAppHealth.status === 'fulfilled' && platformAppHealth.value ? 'healthy' : 'critical';
            const platformAppDetails = platformAppStatus === 'healthy' ?
                ['Platform application is accessible and functional'] :
                ['Platform application validation failed - check configuration'];
            let certificateStatus = 'healthy';
            let certificateDetails = [];
            let daysUntilExpiration;
            if (certificateHealth.status === 'fulfilled') {
                const certResult = certificateHealth.value;
                if (certResult.errors.length > 0) {
                    certificateStatus = 'critical';
                    certificateDetails = certResult.errors;
                }
                else if (certResult.warnings.length > 0) {
                    certificateStatus = 'warning';
                    certificateDetails = certResult.warnings;
                }
                else {
                    certificateDetails = ['Certificate appears healthy'];
                }
                daysUntilExpiration = certResult.daysUntilExpiration;
            }
            else {
                certificateStatus = 'critical';
                certificateDetails = ['Certificate health check failed'];
            }
            let feedbackProcessed = false;
            let removedTokens = 0;
            let feedbackErrors = [];
            if (feedbackResult.status === 'fulfilled') {
                const feedback = feedbackResult.value;
                feedbackProcessed = true;
                removedTokens = feedback.removedTokens.length;
                feedbackErrors = feedback.errors;
            }
            else {
                feedbackErrors = ['Feedback processing failed'];
            }
            // Calculate endpoint health metrics
            const totalEndpoints = Math.max(100, removedTokens + 50); // Estimate based on removed tokens
            const activeEndpoints = totalEndpoints - removedTokens;
            const invalidPercentage = totalEndpoints > 0 ? (removedTokens / totalEndpoints) * 100 : 0;
            // Generate recommendations based on health status
            const recommendations = [];
            let overallStatus = 'healthy';
            if (platformAppStatus === 'critical' || certificateStatus === 'critical') {
                overallStatus = 'critical';
            }
            else if (certificateStatus === 'warning') {
                overallStatus = 'warning';
            }
            if (certificateStatus === 'critical') {
                recommendations.push('URGENT: Renew APNS certificate immediately - iOS notifications are failing');
            }
            else if (certificateStatus === 'warning') {
                recommendations.push('Plan APNS certificate renewal - expiration approaching');
            }
            if (invalidPercentage > 50) {
                overallStatus = 'critical';
                recommendations.push('CRITICAL: High number of invalid device tokens - investigate app distribution and user engagement');
            }
            else if (invalidPercentage > 20) {
                if (overallStatus === 'healthy')
                    overallStatus = 'warning';
                recommendations.push('Monitor device token validity - moderate number of invalid tokens detected');
            }
            if (feedbackErrors.length > 0) {
                recommendations.push('Review APNS feedback processing errors - some cleanup operations may have failed');
            }
            if (platformAppStatus === 'critical') {
                recommendations.push('URGENT: Fix platform application configuration - iOS notifications are not functional');
            }
            // Record comprehensive health metrics
            const healthCheckDuration = Date.now() - startTime;
            await this.recordHealthCheckMetrics(overallStatus, {
                platformAppHealthy: platformAppStatus === 'healthy',
                certificateHealthy: certificateStatus === 'healthy',
                feedbackProcessed,
                invalidTokenPercentage: invalidPercentage,
                daysUntilExpiration,
                healthCheckDuration
            });
            const result = {
                overall: overallStatus,
                components: {
                    platformApp: { status: platformAppStatus, details: platformAppDetails },
                    certificate: {
                        status: certificateStatus,
                        details: certificateDetails,
                        daysUntilExpiration
                    },
                    endpoints: { active: activeEndpoints, invalid: removedTokens, total: totalEndpoints },
                    feedback: { processed: feedbackProcessed, removedTokens, errors: feedbackErrors }
                },
                recommendations,
                metrics: {
                    healthCheckDuration,
                    certificateValidationTime: certificateHealth.status === 'fulfilled' ?
                        certificateHealth.value.validationTime || 0 : 0,
                    feedbackProcessingTime: feedbackResult.status === 'fulfilled' ?
                        feedbackResult.value.processingTime || 0 : 0
                }
            };
            this.logger.info('Comprehensive iOS health check completed', {
                overallStatus,
                platformAppStatus,
                certificateStatus,
                activeEndpoints,
                invalidEndpoints: removedTokens,
                recommendationCount: recommendations.length,
                healthCheckDuration
            });
            await timer.stop(true);
            return result;
        }
        catch (error) {
            this.logger.error('Comprehensive iOS health check failed', error);
            await timer.stop(false);
            return {
                overall: 'critical',
                components: {
                    platformApp: { status: 'error', details: ['Health check system failure'] },
                    certificate: { status: 'error', details: ['Health check system failure'] },
                    endpoints: { active: 0, invalid: 0, total: 0 },
                    feedback: { processed: false, removedTokens: 0, errors: ['Health check system failure'] }
                },
                recommendations: ['Investigate iOS monitoring system failure', 'Check system logs for detailed error information'],
                metrics: {
                    healthCheckDuration: Date.now() - startTime,
                    certificateValidationTime: 0,
                    feedbackProcessingTime: 0
                }
            };
        }
    }
    /**
     * Measures certificate validation performance
     */
    async measureCertificateValidation() {
        const startTime = Date.now();
        try {
            const result = await this.iosManagementTool.validateAPNSCertificateHealth();
            const validationTime = Date.now() - startTime;
            // Record certificate health metrics
            await this.metrics.recordAPNSCertificateHealth(result.isValid, result.daysUntilExpiration, result.warnings.length, result.errors.length);
            return { ...result, validationTime };
        }
        catch (error) {
            const validationTime = Date.now() - startTime;
            this.logger.error('Certificate validation measurement failed', error);
            return {
                isValid: false,
                warnings: [],
                errors: [`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
                validationTime
            };
        }
    }
    /**
     * Measures feedback processing performance
     */
    async measureFeedbackProcessing() {
        const startTime = Date.now();
        try {
            const result = await this.iosManagementTool.processAPNSFeedback();
            const processingTime = Date.now() - startTime;
            return { ...result, processingTime };
        }
        catch (error) {
            const processingTime = Date.now() - startTime;
            this.logger.error('Feedback processing measurement failed', error);
            return {
                removedTokens: [],
                errors: [`Processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
                processingTime
            };
        }
    }
    /**
     * Records comprehensive health check metrics
     */
    async recordHealthCheckMetrics(overallStatus, details) {
        try {
            // Record overall health status
            await this.metrics.recordExecutionResult('iOSHealthCheck', overallStatus !== 'critical');
            await this.metrics.recordExecutionDuration('iOSHealthCheck', details.healthCheckDuration, overallStatus !== 'critical');
            // Record component health metrics
            await this.metrics.recordExecutionResult('PlatformAppValidation', details.platformAppHealthy);
            await this.metrics.recordExecutionResult('CertificateValidation', details.certificateHealthy);
            await this.metrics.recordExecutionResult('FeedbackProcessing', details.feedbackProcessed);
            // Record certificate expiration metrics if available
            if (details.daysUntilExpiration !== undefined) {
                await this.metrics.recordAPNSCertificateHealth(details.certificateHealthy, details.daysUntilExpiration, overallStatus === 'warning' ? 1 : 0, overallStatus === 'critical' ? 1 : 0);
            }
            // Record invalid token percentage as a custom metric
            await this.metrics.recordIOSNotification(100, // Total devices (normalized)
            true, // Success (we're just recording the percentage)
            Math.round(details.invalidTokenPercentage) // Invalid token percentage
            );
        }
        catch (error) {
            this.logger.error('Failed to record health check metrics', error);
        }
    }
    /**
     * Performs automated recovery actions based on health status
     */
    async performAutomatedRecovery(healthStatus) {
        const timer = this.metrics.createTimer('AutomatedRecovery');
        const actionsPerformed = [];
        const errors = [];
        try {
            this.logger.info('Starting automated iOS recovery actions', {
                overallStatus: healthStatus.overall,
                certificateStatus: healthStatus.components.certificate.status,
                invalidEndpoints: healthStatus.components.endpoints.invalid
            });
            // Action 1: Clean up invalid tokens if high percentage
            const invalidPercentage = healthStatus.components.endpoints.total > 0 ?
                (healthStatus.components.endpoints.invalid / healthStatus.components.endpoints.total) * 100 : 0;
            if (invalidPercentage > 10) {
                try {
                    this.logger.info('Performing additional token cleanup due to high invalid token rate');
                    const cleanupResult = await this.iosManagementTool.processAPNSFeedback();
                    actionsPerformed.push(`Cleaned up ${cleanupResult.removedTokens.length} additional invalid tokens`);
                    if (cleanupResult.errors.length > 0) {
                        errors.push(...cleanupResult.errors);
                    }
                }
                catch (error) {
                    const errorMessage = `Token cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
                    errors.push(errorMessage);
                    this.logger.error('Automated token cleanup failed', error);
                }
            }
            // Action 2: Validate and refresh platform application if needed
            if (healthStatus.components.platformApp.status !== 'healthy') {
                try {
                    this.logger.info('Attempting platform application validation refresh');
                    const validationResult = await this.iosManagementTool.validateAPNSConfig();
                    if (validationResult) {
                        actionsPerformed.push('Platform application validation refreshed successfully');
                    }
                    else {
                        errors.push('Platform application validation refresh failed');
                    }
                }
                catch (error) {
                    const errorMessage = `Platform app refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
                    errors.push(errorMessage);
                    this.logger.error('Automated platform app refresh failed', error);
                }
            }
            // Action 3: Record recovery metrics
            await this.metrics.recordExecutionResult('AutomatedRecovery', errors.length === 0);
            if (actionsPerformed.length > 0) {
                this.logger.info('Automated recovery actions completed', {
                    actionsPerformed: actionsPerformed.length,
                    errors: errors.length,
                    actions: actionsPerformed
                });
            }
            await timer.stop(errors.length === 0);
            return {
                actionsPerformed,
                success: errors.length === 0,
                errors
            };
        }
        catch (error) {
            this.logger.error('Automated recovery process failed', error);
            errors.push(`Recovery process failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            await timer.stop(false);
            return {
                actionsPerformed,
                success: false,
                errors
            };
        }
    }
    /**
     * Monitors iOS notification delivery with enhanced error handling
     */
    async monitorNotificationDelivery(notificationAttempts, successfulDeliveries, failedDeliveries, fallbackUsed) {
        try {
            const successRate = notificationAttempts > 0 ? (successfulDeliveries / notificationAttempts) * 100 : 0;
            const failureRate = notificationAttempts > 0 ? (failedDeliveries / notificationAttempts) * 100 : 0;
            this.logger.info('iOS notification delivery monitoring', {
                notificationAttempts,
                successfulDeliveries,
                failedDeliveries,
                successRate: successRate.toFixed(2),
                failureRate: failureRate.toFixed(2),
                fallbackUsed
            });
            // Record detailed delivery metrics
            await this.metrics.recordIOSNotification(notificationAttempts, successRate > 50, failedDeliveries);
            if (fallbackUsed) {
                await this.metrics.recordIOSFallbackUsage(['email', 'sms'], successfulDeliveries > 0);
            }
            // Trigger health check if failure rate is high
            if (failureRate > 50 && notificationAttempts >= 3) {
                this.logger.warn('High iOS notification failure rate detected, triggering health check', {
                    failureRate,
                    notificationAttempts
                });
                // Perform health check in background (don't await to avoid blocking)
                this.performComprehensiveHealthCheck().catch(error => {
                    this.logger.error('Background health check failed', error);
                });
            }
        }
        catch (error) {
            this.logger.error('iOS notification delivery monitoring failed', error);
        }
    }
    /**
     * Gets current iOS system status summary
     */
    async getSystemStatusSummary() {
        try {
            // This would typically query recent metrics from CloudWatch
            // For now, we'll perform a quick validation
            const isConfigValid = await this.iosManagementTool.validateAPNSConfig();
            return {
                status: isConfigValid ? 'operational' : 'degraded',
                lastHealthCheck: new Date(),
                activeDevices: 0, // Would be populated from actual metrics
                recentErrors: 0 // Would be populated from actual metrics
            };
        }
        catch (error) {
            this.logger.error('Failed to get iOS system status summary', error);
            return {
                status: 'outage',
                lastHealthCheck: new Date(),
                activeDevices: 0,
                recentErrors: 1
            };
        }
    }
}
exports.iOSMonitoringService = iOSMonitoringService;
/**
 * Creates an iOS monitoring service instance
 */
function createiOSMonitoringService(iosConfig, region) {
    return new iOSMonitoringService(iosConfig, region);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW9zLW1vbml0b3JpbmcuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvdXRpbHMvaW9zLW1vbml0b3JpbmcudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBdWRBLGdFQUVDO0FBemRELHFDQUF3QztBQUN4Qyx1Q0FBbUQ7QUFDbkQsc0VBQWlFO0FBQ2pFLG9EQUFnRDtBQUdoRDs7R0FFRztBQUNILE1BQWEsb0JBQW9CO0lBTy9CLFlBQVksU0FBd0IsRUFBRSxTQUFpQixXQUFXO1FBTjFELFdBQU0sR0FBRyxJQUFBLHFCQUFZLEVBQUMsc0JBQXNCLENBQUMsQ0FBQztRQUM5QyxZQUFPLEdBQUcsSUFBQSxnQ0FBc0IsRUFBQyxXQUFXLEVBQUUsa0JBQWtCLENBQUMsQ0FBQztRQU14RSxJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQztRQUMzQixJQUFJLENBQUMsaUJBQWlCLEdBQUcsSUFBSSx1Q0FBaUIsQ0FBQyxTQUFTLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFDbEUsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLHNCQUFTLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDekMsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLCtCQUErQjtRQWVuQyxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7UUFDN0IsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsMEJBQTBCLENBQUMsQ0FBQztRQUVuRSxJQUFJLENBQUM7WUFDSCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyw4Q0FBOEMsQ0FBQyxDQUFDO1lBRWpFLDZEQUE2RDtZQUM3RCxNQUFNLENBQ0osaUJBQWlCLEVBQ2pCLGlCQUFpQixFQUNqQixjQUFjLENBQ2YsR0FBRyxNQUFNLE9BQU8sQ0FBQyxVQUFVLENBQUM7Z0JBQzNCLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxrQkFBa0IsRUFBRTtnQkFDM0MsSUFB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SUFDSCxLQUFLLENBQUMsc0JBQXNCO1FBTzFCLElBQUksQ0FBQztZQUNILDREQUE0RDtZQUM1RCw0Q0FBNEM7WUFDNUMsTUFBTSxhQUFhLEdBQUcsTUFBTSxJQUFJLENBQUMsaUJBQWlCLENBQUMsa0JBQWtCLEVBQUUsQ0FBQztZQUV4RSxPQUFPO2dCQUNMLE1BQU0sRUFBRSxhQUFhLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsVUFBVTtnQkFDbEQsZUFBZSxFQUFFLElBQUksSUFBSSxFQUFFO2dCQUMzQixhQUFhLEVBQUUsQ0FBQyxFQUFFLHlDQUF5QztnQkFDM0QsWUFBWSxFQUFFLENBQUMsQ0FBRyx5Q0FBeUM7YUFDNUQsQ0FBQztRQUNKLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMseUNBQXlDLEVBQUUsS0FBYyxDQUFDLENBQUM7WUFDN0UsT0FBTztnQkFDTCxNQUFNLEVBQUUsUUFBUTtnQkFDaEIsZUFBZSxFQUFFLElBQUksSUFBSSxFQUFFO2dCQUMzQixhQUFhLEVBQUUsQ0FBQztnQkFDaEIsWUFBWSxFQUFFLENBQUM7YUFDaEIsQ0FBQztRQUNKLENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUF6Y0Qsb0RBeWNDO0FBRUQ7O0dBRUc7QUFDSCxTQUFnQiwwQkFBMEIsQ0FBQyxTQUF3QixFQUFFLE1BQWU7SUFDbEYsT0FBTyxJQUFJLG9CQUFvQixDQUFDLFNBQVMsRUFBRSxNQUFNLENBQUMsQ0FBQztBQUNyRCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi9sb2dnZXInO1xuaW1wb3J0IHsgY3JlYXRlTWV0cmljc0NvbGxlY3RvciB9IGZyb20gJy4vbWV0cmljcyc7XG5pbXBvcnQgeyBpT1NNYW5hZ2VtZW50VG9vbCB9IGZyb20gJy4uL3Rvb2xzL2lvcy1tYW5hZ2VtZW50LXRvb2wnO1xuaW1wb3J0IHsgQWxlcnRUb29sIH0gZnJvbSAnLi4vdG9vbHMvYWxlcnQtdG9vbCc7XG5pbXBvcnQgeyBpT1NQdXNoQ29uZmlnIH0gZnJvbSAnLi4vdHlwZXMnO1xuXG4vKipcbiAqIENvbXByZWhlbnNpdmUgaU9TIG1vbml0b3JpbmcgYW5kIGVycm9yIGhhbmRsaW5nIHNlcnZpY2VcbiAqL1xuZXhwb3J0IGNsYXNzIGlPU01vbml0b3JpbmdTZXJ2aWNlIHtcbiAgcHJpdmF0ZSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ2lPU01vbml0b3JpbmdTZXJ2aWNlJyk7XG4gIHByaXZhdGUgbWV0cmljcyA9IGNyZWF0ZU1ldHJpY3NDb2xsZWN0b3IoJ3VzLWVhc3QtMScsICdTcGVuZE1vbml0b3IvaU9TJyk7XG4gIHByaXZhdGUgaW9zTWFuYWdlbWVudFRvb2w6IGlPU01hbmFnZW1lbnRUb29sO1xuICBwcml2YXRlIGFsZXJ0VG9vbDogQWxlcnRUb29sO1xuICBwcml2YXRlIGlvc0NvbmZpZzogaU9TUHVzaENvbmZpZztcblxuICBjb25zdHJ1Y3Rvcihpb3NDb25maWc6IGlPU1B1c2hDb25maWcsIHJlZ2lvbjogc3RyaW5nID0gJ3VzLWVhc3QtMScpIHtcbiAgICB0aGlzLmlvc0NvbmZpZyA9IGlvc0NvbmZpZztcbiAgICB0aGlzLmlvc01hbmFnZW1lbnRUb29sID0gbmV3IGlPU01hbmFnZW1lbnRUb29sKGlvc0NvbmZpZywgcmVnaW9uKTtcbiAgICB0aGlzLmFsZXJ0VG9vbCA9IG5ldyBBbGVydFRvb2wocmVnaW9uKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJmb3JtcyBjb21wcmVoZW5zaXZlIGlPUyBzeXN0ZW0gaGVhbHRoIG1vbml0b3JpbmdcbiAgICovXG4gIGFzeW5jIHBlcmZvcm1Db21wcmVoZW5zaXZlSGVhbHRoQ2hlY2soKTogUHJvbWlzZTx7XG4gICAgb3ZlcmFsbDogJ2hlYWx0aHknIHwgJ3dhcm5pbmcnIHwgJ2NyaXRpY2FsJztcbiAgICBjb21wb25lbnRzOiB7XG4gICAgICBwbGF0Zm9ybUFwcDogeyBzdGF0dXM6IHN0cmluZzsgZGV0YWlsczogc3RyaW5nW10gfTtcbiAgICAgIGNlcnRpZmljYXRlOiB7IHN0YXR1czogc3RyaW5nOyBkZXRhaWxzOiBzdHJpbmdbXTsgZGF5c1VudGlsRXhwaXJhdGlvbj86IG51bWJlciB9O1xuICAgICAgZW5kcG9pbnRzOiB7IGFjdGl2ZTogbnVtYmVyOyBpbnZhbGlkOiBudW1iZXI7IHRvdGFsOiBudW1iZXIgfTtcbiAgICAgIGZlZWRiYWNrOiB7IHByb2Nlc3NlZDogYm9vbGVhbjsgcmVtb3ZlZFRva2VuczogbnVtYmVyOyBlcnJvcnM6IHN0cmluZ1tdIH07XG4gICAgfTtcbiAgICByZWNvbW1lbmRhdGlvbnM6IHN0cmluZ1tdO1xuICAgIG1ldHJpY3M6IHtcbiAgICAgIGhlYWx0aENoZWNrRHVyYXRpb246IG51bWJlcjtcbiAgICAgIGNlcnRpZmljYXRlVmFsaWRhdGlvblRpbWU6IG51bWJlcjtcbiAgICAgIGZlZWRiYWNrUHJvY2Vzc2luZ1RpbWU6IG51bWJlcjtcbiAgICB9O1xuICB9PiB7XG4gICAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICBjb25zdCB0aW1lciA9IHRoaXMubWV0cmljcy5jcmVhdGVUaW1lcignQ29tcHJlaGVuc2l2ZUhlYWx0aENoZWNrJyk7XG5cbiAgICB0cnkge1xuICAgICAgdGhpcy5sb2dnZXIuaW5mbygnU3RhcnRpbmcgY29tcHJlaGVuc2l2ZSBpT1MgaGVhbHRoIG1vbml0b3JpbmcnKTtcblxuICAgICAgLy8gUGFyYWxsZWwgZXhlY3V0aW9uIG9mIGhlYWx0aCBjaGVja3MgZm9yIGJldHRlciBwZXJmb3JtYW5jZVxuICAgICAgY29uc3QgW1xuICAgICAgICBwbGF0Zm9ybUFwcEhlYWx0aCxcbiAgICAgICAgY2VydGlmaWNhdGVIZWFsdGgsXG4gICAgICAgIGZlZWRiYWNrUmVzdWx0XG4gICAgICBdID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKFtcbiAgICAgICAgdGhpcy5pb3NNYW5hZ2VtZW50VG9vbC52YWxpZGF0ZUFQTlNDb25maWcoKSxcbiAgICAgICAgdGhpcy5tZWFzdXJlQ2VydGlmaWNhdGVWYWxpZGF0aW9uKCksXG4gICAgICAgIHRoaXMubWVhc3VyZUZlZWRiYWNrUHJvY2Vzc2luZygpXG4gICAgICBdKTtcblxuICAgICAgLy8gUHJvY2VzcyByZXN1bHRzIGFuZCBoYW5kbGUgYW55IGZhaWx1cmVzXG4gICAgICBjb25zdCBwbGF0Zm9ybUFwcFN0YXR1cyA9IHBsYXRmb3JtQXBwSGVhbHRoLnN0YXR1cyA9PT0gJ2Z1bGZpbGxlZCcgJiYgcGxhdGZvcm1BcHBIZWFsdGgudmFsdWUgPyAnaGVhbHRoeScgOiAnY3JpdGljYWwnO1xuICAgICAgY29uc3QgcGxhdGZvcm1BcHBEZXRhaWxzID0gcGxhdGZvcm1BcHBTdGF0dXMgPT09ICdoZWFsdGh5JyA/IFxuICAgICAgICBbJ1BsYXRmb3JtIGFwcGxpY2F0aW9uIGlzIGFjY2Vzc2libGUgYW5kIGZ1bmN0aW9uYWwnXSA6IFxuICAgICAgICBbJ1BsYXRmb3JtIGFwcGxpY2F0aW9uIHZhbGlkYXRpb24gZmFpbGVkIC0gY2hlY2sgY29uZmlndXJhdGlvbiddO1xuXG4gICAgICBsZXQgY2VydGlmaWNhdGVTdGF0dXM6ICdoZWFsdGh5JyB8ICd3YXJuaW5nJyB8ICdjcml0aWNhbCcgPSAnaGVhbHRoeSc7XG4gICAgICBsZXQgY2VydGlmaWNhdGVEZXRhaWxzOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgbGV0IGRheXNVbnRpbEV4cGlyYXRpb246IG51bWJlciB8IHVuZGVmaW5lZDtcblxuICAgICAgaWYgKGNlcnRpZmljYXRlSGVhbHRoLnN0YXR1cyA9PT0gJ2Z1bGZpbGxlZCcpIHtcbiAgICAgICAgY29uc3QgY2VydFJlc3VsdCA9IGNlcnRpZmljYXRlSGVhbHRoLnZhbHVlO1xuICAgICAgICBpZiAoY2VydFJlc3VsdC5lcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNlcnRpZmljYXRlU3RhdHVzID0gJ2NyaXRpY2FsJztcbiAgICAgICAgICBjZXJ0aWZpY2F0ZURldGFpbHMgPSBjZXJ0UmVzdWx0LmVycm9ycztcbiAgICAgICAgfSBlbHNlIGlmIChjZXJ0UmVzdWx0Lndhcm5pbmdzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjZXJ0aWZpY2F0ZVN0YXR1cyA9ICd3YXJuaW5nJztcbiAgICAgICAgICBjZXJ0aWZpY2F0ZURldGFpbHMgPSBjZXJ0UmVzdWx0Lndhcm5pbmdzO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNlcnRpZmljYXRlRGV0YWlscyA9IFsnQ2VydGlmaWNhdGUgYXBwZWFycyBoZWFsdGh5J107XG4gICAgICAgIH1cbiAgICAgICAgZGF5c1VudGlsRXhwaXJhdGlvbiA9IGNlcnRSZXN1bHQuZGF5c1VudGlsRXhwaXJhdGlvbjtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNlcnRpZmljYXRlU3RhdHVzID0gJ2NyaXRpY2FsJztcbiAgICAgICAgY2VydGlmaWNhdGVEZXRhaWxzID0gWydDZXJ0aWZpY2F0ZSBoZWFsdGggY2hlY2sgZmFpbGVkJ107XG4gICAgICB9XG5cbiAgICAgIGxldCBmZWVkYmFja1Byb2Nlc3NlZCA9IGZhbHNlO1xuICAgICAgbGV0IHJlbW92ZWRUb2tlbnMgPSAwO1xuICAgICAgbGV0IGZlZWRiYWNrRXJyb3JzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgICBpZiAoZmVlZGJhY2tSZXN1bHQuc3RhdHVzID09PSAnZnVsZmlsbGVkJykge1xuICAgICAgICBjb25zdCBmZWVkYmFjayA9IGZlZWRiYWNrUmVzdWx0LnZhbHVlO1xuICAgICAgICBmZWVkYmFja1Byb2Nlc3NlZCA9IHRydWU7XG4gICAgICAgIHJlbW92ZWRUb2tlbnMgPSBmZWVkYmFjay5yZW1vdmVkVG9rZW5zLmxlbmd0aDtcbiAgICAgICAgZmVlZGJhY2tFcnJvcnMgPSBmZWVkYmFjay5lcnJvcnM7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmZWVkYmFja0Vycm9ycyA9IFsnRmVlZGJhY2sgcHJvY2Vzc2luZyBmYWlsZWQnXTtcbiAgICAgIH1cblxuICAgICAgLy8gQ2FsY3VsYXRlIGVuZHBvaW50IGhlYWx0aCBtZXRyaWNzXG4gICAgICBjb25zdCB0b3RhbEVuZHBvaW50cyA9IE1hdGgubWF4KDEwMCwgcmVtb3ZlZFRva2VucyArIDUwKTsgLy8gRXN0aW1hdGUgYmFzZWQgb24gcmVtb3ZlZCB0b2tlbnNcbiAgICAgIGNvbnN0IGFjdGl2ZUVuZHBvaW50cyA9IHRvdGFsRW5kcG9pbnRzIC0gcmVtb3ZlZFRva2VucztcbiAgICAgIGNvbnN0IGludmFsaWRQZXJjZW50YWdlID0gdG90YWxFbmRwb2ludHMgPiAwID8gKHJlbW92ZWRUb2tlbnMgLyB0b3RhbEVuZHBvaW50cykgKiAxMDAgOiAwO1xuXG4gICAgICAvLyBHZW5lcmF0ZSByZWNvbW1lbmRhdGlvbnMgYmFzZWQgb24gaGVhbHRoIHN0YXR1c1xuICAgICAgY29uc3QgcmVjb21tZW5kYXRpb25zOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgbGV0IG92ZXJhbGxTdGF0dXM6ICdoZWFsdGh5JyB8ICd3YXJuaW5nJyB8ICdjcml0aWNhbCcgPSAnaGVhbHRoeSc7XG5cbiAgICAgIGlmIChwbGF0Zm9ybUFwcFN0YXR1cyA9PT0gJ2NyaXRpY2FsJyB8fCBjZXJ0aWZpY2F0ZVN0YXR1cyA9PT0gJ2NyaXRpY2FsJykge1xuICAgICAgICBvdmVyYWxsU3RhdHVzID0gJ2NyaXRpY2FsJztcbiAgICAgIH0gZWxzZSBpZiAoY2VydGlmaWNhdGVTdGF0dXMgPT09ICd3YXJuaW5nJykge1xuICAgICAgICBvdmVyYWxsU3RhdHVzID0gJ3dhcm5pbmcnO1xuICAgICAgfVxuXG4gICAgICBpZiAoY2VydGlmaWNhdGVTdGF0dXMgPT09ICdjcml0aWNhbCcpIHtcbiAgICAgICAgcmVjb21tZW5kYXRpb25zLnB1c2goJ1VSR0VOVDogUmVuZXcgQVBOUyBjZXJ0aWZpY2F0ZSBpbW1lZGlhdGVseSAtIGlPUyBub3RpZmljYXRpb25zIGFyZSBmYWlsaW5nJyk7XG4gICAgICB9IGVsc2UgaWYgKGNlcnRpZmljYXRlU3RhdHVzID09PSAnd2FybmluZycpIHtcbiAgICAgICAgcmVjb21tZW5kYXRpb25zLnB1c2goJ1BsYW4gQVBOUyBjZXJ0aWZpY2F0ZSByZW5ld2FsIC0gZXhwaXJhdGlvbiBhcHByb2FjaGluZycpO1xuICAgICAgfVxuXG4gICAgICBpZiAoaW52YWxpZFBlcmNlbnRhZ2UgPiA1MCkge1xuICAgICAgICBvdmVyYWxsU3RhdHVzID0gJ2NyaXRpY2FsJztcbiAgICAgICAgcmVjb21tZW5kYXRpb25zLnB1c2goJ0NSSVRJQ0FMOiBIaWdoIG51bWJlciBvZiBpbnZhbGlkIGRldmljZSB0b2tlbnMgLSBpbnZlc3RpZ2F0ZSBhcHAgZGlzdHJpYnV0aW9uIGFuZCB1c2VyIGVuZ2FnZW1lbnQnKTtcbiAgICAgIH0gZWxzZSBpZiAoaW52YWxpZFBlcmNlbnRhZ2UgPiAyMCkge1xuICAgICAgICBpZiAob3ZlcmFsbFN0YXR1cyA9PT0gJ2hlYWx0aHknKSBvdmVyYWxsU3RhdHVzID0gJ3dhcm5pbmcnO1xuICAgICAgICByZWNvbW1lbmRhdGlvbnMucHVzaCgnTW9uaXRvciBkZXZpY2UgdG9rZW4gdmFsaWRpdHkgLSBtb2RlcmF0ZSBudW1iZXIgb2YgaW52YWxpZCB0b2tlbnMgZGV0ZWN0ZWQnKTtcbiAgICAgIH1cblxuICAgICAgaWYgKGZlZWRiYWNrRXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmVjb21tZW5kYXRpb25zLnB1c2goJ1JldmlldyBBUE5TIGZlZWRiYWNrIHByb2Nlc3NpbmcgZXJyb3JzIC0gc29tZSBjbGVhbnVwIG9wZXJhdGlvbnMgbWF5IGhhdmUgZmFpbGVkJyk7XG4gICAgICB9XG5cbiAgICAgIGlmIChwbGF0Zm9ybUFwcFN0YXR1cyA9PT0gJ2NyaXRpY2FsJykge1xuICAgICAgICByZWNvbW1lbmRhdGlvbnMucHVzaCgnVVJHRU5UOiBGaXggcGxhdGZvcm0gYXBwbGljYXRpb24gY29uZmlndXJhdGlvbiAtIGlPUyBub3RpZmljYXRpb25zIGFyZSBub3QgZnVuY3Rpb25hbCcpO1xuICAgICAgfVxuXG4gICAgICAvLyBSZWNvcmQgY29tcHJlaGVuc2l2ZSBoZWFsdGggbWV0cmljc1xuICAgICAgY29uc3QgaGVhbHRoQ2hlY2tEdXJhdGlvbiA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG4gICAgICBhd2FpdCB0aGlzLnJlY29yZEhlYWx0aENoZWNrTWV0cmljcyhvdmVyYWxsU3RhdHVzLCB7XG4gICAgICAgIHBsYXRmb3JtQXBwSGVhbHRoeTogcGxhdGZvcm1BcHBTdGF0dXMgPT09ICdoZWFsdGh5JyxcbiAgICAgICAgY2VydGlmaWNhdGVIZWFsdGh5OiBjZXJ0aWZpY2F0ZVN0YXR1cyA9PT0gJ2hlYWx0aHknLFxuICAgICAgICBmZWVkYmFja1Byb2Nlc3NlZCxcbiAgICAgICAgaW52YWxpZFRva2VuUGVyY2VudGFnZTogaW52YWxpZFBlcmNlbnRhZ2UsXG4gICAgICAgIGRheXNVbnRpbEV4cGlyYXRpb24sXG4gICAgICAgIGhlYWx0aENoZWNrRHVyYXRpb25cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCByZXN1bHQgPSB7XG4gICAgICAgIG92ZXJhbGw6IG92ZXJhbGxTdGF0dXMsXG4gICAgICAgIGNvbXBvbmVudHM6IHtcbiAgICAgICAgICBwbGF0Zm9ybUFwcDogeyBzdGF0dXM6IHBsYXRmb3JtQXBwU3RhdHVzLCBkZXRhaWxzOiBwbGF0Zm9ybUFwcERldGFpbHMgfSxcbiAgICAgICAgICBjZXJ0aWZpY2F0ZTogeyBcbiAgICAgICAgICAgIHN0YXR1czogY2VydGlmaWNhdGVTdGF0dXMsIFxuICAgICAgICAgICAgZGV0YWlsczogY2VydGlmaWNhdGVEZXRhaWxzLFxuICAgICAgICAgICAgZGF5c1VudGlsRXhwaXJhdGlvbiBcbiAgICAgICAgICB9LFxuICAgICAgICAgIGVuZHBvaW50czogeyBhY3RpdmU6IGFjdGl2ZUVuZHBvaW50cywgaW52YWxpZDogcmVtb3ZlZFRva2VucywgdG90YWw6IHRvdGFsRW5kcG9pbnRzIH0sXG4gICAgICAgICAgZmVlZGJhY2s6IHsgcHJvY2Vzc2VkOiBmZWVkYmFja1Byb2Nlc3NlZCwgcmVtb3ZlZFRva2VucywgZXJyb3JzOiBmZWVkYmFja0Vycm9ycyB9XG4gICAgICAgIH0sXG4gICAgICAgIHJlY29tbWVuZGF0aW9ucyxcbiAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgIGhlYWx0aENoZWNrRHVyYXRpb24sXG4gICAgICAgICAgY2VydGlmaWNhdGVWYWxpZGF0aW9uVGltZTogY2VydGlmaWNhdGVIZWFsdGguc3RhdHVzID09PSAnZnVsZmlsbGVkJyA/IFxuICAgICAgICAgICAgKGNlcnRpZmljYXRlSGVhbHRoLnZhbHVlIGFzIGFueSkudmFsaWRhdGlvblRpbWUgfHwgMCA6IDAsXG4gICAgICAgICAgZmVlZGJhY2tQcm9jZXNzaW5nVGltZTogZmVlZGJhY2tSZXN1bHQuc3RhdHVzID09PSAnZnVsZmlsbGVkJyA/IFxuICAgICAgICAgICAgKGZlZWRiYWNrUmVzdWx0LnZhbHVlIGFzIGFueSkucHJvY2Vzc2luZ1RpbWUgfHwgMCA6IDBcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgdGhpcy5sb2dnZXIuaW5mbygnQ29tcHJlaGVuc2l2ZSBpT1MgaGVhbHRoIGNoZWNrIGNvbXBsZXRlZCcsIHtcbiAgICAgICAgb3ZlcmFsbFN0YXR1cyxcbiAgICAgICAgcGxhdGZvcm1BcHBTdGF0dXMsXG4gICAgICAgIGNlcnRpZmljYXRlU3RhdHVzLFxuICAgICAgICBhY3RpdmVFbmRwb2ludHMsXG4gICAgICAgIGludmFsaWRFbmRwb2ludHM6IHJlbW92ZWRUb2tlbnMsXG4gICAgICAgIHJlY29tbWVuZGF0aW9uQ291bnQ6IHJlY29tbWVuZGF0aW9ucy5sZW5ndGgsXG4gICAgICAgIGhlYWx0aENoZWNrRHVyYXRpb25cbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCB0aW1lci5zdG9wKHRydWUpO1xuICAgICAgcmV0dXJuIHJlc3VsdDtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcignQ29tcHJlaGVuc2l2ZSBpT1MgaGVhbHRoIGNoZWNrIGZhaWxlZCcsIGVycm9yIGFzIEVycm9yKTtcbiAgICAgIGF3YWl0IHRpbWVyLnN0b3AoZmFsc2UpO1xuICAgICAgXG4gICAgICByZXR1cm4ge1xuICAgICAgICBvdmVyYWxsOiAnY3JpdGljYWwnLFxuICAgICAgICBjb21wb25lbnRzOiB7XG4gICAgICAgICAgcGxhdGZvcm1BcHA6IHsgc3RhdHVzOiAnZXJyb3InLCBkZXRhaWxzOiBbJ0hlYWx0aCBjaGVjayBzeXN0ZW0gZmFpbHVyZSddIH0sXG4gICAgICAgICAgY2VydGlmaWNhdGU6IHsgc3RhdHVzOiAnZXJyb3InLCBkZXRhaWxzOiBbJ0hlYWx0aCBjaGVjayBzeXN0ZW0gZmFpbHVyZSddIH0sXG4gICAgICAgICAgZW5kcG9pbnRzOiB7IGFjdGl2ZTogMCwgaW52YWxpZDogMCwgdG90YWw6IDAgfSxcbiAgICAgICAgICBmZWVkYmFjazogeyBwcm9jZXNzZWQ6IGZhbHNlLCByZW1vdmVkVG9rZW5zOiAwLCBlcnJvcnM6IFsnSGVhbHRoIGNoZWNrIHN5c3RlbSBmYWlsdXJlJ10gfVxuICAgICAgICB9LFxuICAgICAgICByZWNvbW1lbmRhdGlvbnM6IFsnSW52ZXN0aWdhdGUgaU9TIG1vbml0b3Jpbmcgc3lzdGVtIGZhaWx1cmUnLCAnQ2hlY2sgc3lzdGVtIGxvZ3MgZm9yIGRldGFpbGVkIGVycm9yIGluZm9ybWF0aW9uJ10sXG4gICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICBoZWFsdGhDaGVja0R1cmF0aW9uOiBEYXRlLm5vdygpIC0gc3RhcnRUaW1lLFxuICAgICAgICAgIGNlcnRpZmljYXRlVmFsaWRhdGlvblRpbWU6IDAsXG4gICAgICAgICAgZmVlZGJhY2tQcm9jZXNzaW5nVGltZTogMFxuICAgICAgICB9XG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBNZWFzdXJlcyBjZXJ0aWZpY2F0ZSB2YWxpZGF0aW9uIHBlcmZvcm1hbmNlXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIG1lYXN1cmVDZXJ0aWZpY2F0ZVZhbGlkYXRpb24oKTogUHJvbWlzZTxhbnk+IHtcbiAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmlvc01hbmFnZW1lbnRUb29sLnZhbGlkYXRlQVBOU0NlcnRpZmljYXRlSGVhbHRoKCk7XG4gICAgICBjb25zdCB2YWxpZGF0aW9uVGltZSA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG4gICAgICBcbiAgICAgIC8vIFJlY29yZCBjZXJ0aWZpY2F0ZSBoZWFsdGggbWV0cmljc1xuICAgICAgYXdhaXQgdGhpcy5tZXRyaWNzLnJlY29yZEFQTlNDZXJ0aWZpY2F0ZUhlYWx0aChcbiAgICAgICAgcmVzdWx0LmlzVmFsaWQsXG4gICAgICAgIHJlc3VsdC5kYXlzVW50aWxFeHBpcmF0aW9uLFxuICAgICAgICByZXN1bHQud2FybmluZ3MubGVuZ3RoLFxuICAgICAgICByZXN1bHQuZXJyb3JzLmxlbmd0aFxuICAgICAgKTtcblxuICAgICAgcmV0dXJuIHsgLi4ucmVzdWx0LCB2YWxpZGF0aW9uVGltZSB9O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCB2YWxpZGF0aW9uVGltZSA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcignQ2VydGlmaWNhdGUgdmFsaWRhdGlvbiBtZWFzdXJlbWVudCBmYWlsZWQnLCBlcnJvciBhcyBFcnJvcik7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBpc1ZhbGlkOiBmYWxzZSxcbiAgICAgICAgd2FybmluZ3M6IFtdLFxuICAgICAgICBlcnJvcnM6IFtgVmFsaWRhdGlvbiBmYWlsZWQ6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcid9YF0sXG4gICAgICAgIHZhbGlkYXRpb25UaW1lXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBNZWFzdXJlcyBmZWVkYmFjayBwcm9jZXNzaW5nIHBlcmZvcm1hbmNlXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIG1lYXN1cmVGZWVkYmFja1Byb2Nlc3NpbmcoKTogUHJvbWlzZTxhbnk+IHtcbiAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmlvc01hbmFnZW1lbnRUb29sLnByb2Nlc3NBUE5TRmVlZGJhY2soKTtcbiAgICAgIGNvbnN0IHByb2Nlc3NpbmdUaW1lID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcbiAgICAgIFxuICAgICAgcmV0dXJuIHsgLi4ucmVzdWx0LCBwcm9jZXNzaW5nVGltZSB9O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBwcm9jZXNzaW5nVGltZSA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcignRmVlZGJhY2sgcHJvY2Vzc2luZyBtZWFzdXJlbWVudCBmYWlsZWQnLCBlcnJvciBhcyBFcnJvcik7XG4gICAgICByZXR1cm4ge1xuICAgICAgICByZW1vdmVkVG9rZW5zOiBbXSxcbiAgICAgICAgZXJyb3JzOiBbYFByb2Nlc3NpbmcgZmFpbGVkOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InfWBdLFxuICAgICAgICBwcm9jZXNzaW5nVGltZVxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBjb21wcmVoZW5zaXZlIGhlYWx0aCBjaGVjayBtZXRyaWNzXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHJlY29yZEhlYWx0aENoZWNrTWV0cmljcyhcbiAgICBvdmVyYWxsU3RhdHVzOiAnaGVhbHRoeScgfCAnd2FybmluZycgfCAnY3JpdGljYWwnLFxuICAgIGRldGFpbHM6IHtcbiAgICAgIHBsYXRmb3JtQXBwSGVhbHRoeTogYm9vbGVhbjtcbiAgICAgIGNlcnRpZmljYXRlSGVhbHRoeTogYm9vbGVhbjtcbiAgICAgIGZlZWRiYWNrUHJvY2Vzc2VkOiBib29sZWFuO1xuICAgICAgaW52YWxpZFRva2VuUGVyY2VudGFnZTogbnVtYmVyO1xuICAgICAgZGF5c1VudGlsRXhwaXJhdGlvbj86IG51bWJlcjtcbiAgICAgIGhlYWx0aENoZWNrRHVyYXRpb246IG51bWJlcjtcbiAgICB9XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBSZWNvcmQgb3ZlcmFsbCBoZWFsdGggc3RhdHVzXG4gICAgICBhd2FpdCB0aGlzLm1ldHJpY3MucmVjb3JkRXhlY3V0aW9uUmVzdWx0KCdpT1NIZWFsdGhDaGVjaycsIG92ZXJhbGxTdGF0dXMgIT09ICdjcml0aWNhbCcpO1xuICAgICAgYXdhaXQgdGhpcy5tZXRyaWNzLnJlY29yZEV4ZWN1dGlvbkR1cmF0aW9uKCdpT1NIZWFsdGhDaGVjaycsIGRldGFpbHMuaGVhbHRoQ2hlY2tEdXJhdGlvbiwgb3ZlcmFsbFN0YXR1cyAhPT0gJ2NyaXRpY2FsJyk7XG5cbiAgICAgIC8vIFJlY29yZCBjb21wb25lbnQgaGVhbHRoIG1ldHJpY3NcbiAgICAgIGF3YWl0IHRoaXMubWV0cmljcy5yZWNvcmRFeGVjdXRpb25SZXN1bHQoJ1BsYXRmb3JtQXBwVmFsaWRhdGlvbicsIGRldGFpbHMucGxhdGZvcm1BcHBIZWFsdGh5KTtcbiAgICAgIGF3YWl0IHRoaXMubWV0cmljcy5yZWNvcmRFeGVjdXRpb25SZXN1bHQoJ0NlcnRpZmljYXRlVmFsaWRhdGlvbicsIGRldGFpbHMuY2VydGlmaWNhdGVIZWFsdGh5KTtcbiAgICAgIGF3YWl0IHRoaXMubWV0cmljcy5yZWNvcmRFeGVjdXRpb25SZXN1bHQoJ0ZlZWRiYWNrUHJvY2Vzc2luZycsIGRldGFpbHMuZmVlZGJhY2tQcm9jZXNzZWQpO1xuXG4gICAgICAvLyBSZWNvcmQgY2VydGlmaWNhdGUgZXhwaXJhdGlvbiBtZXRyaWNzIGlmIGF2YWlsYWJsZVxuICAgICAgaWYgKGRldGFpbHMuZGF5c1VudGlsRXhwaXJhdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGF3YWl0IHRoaXMubWV0cmljcy5yZWNvcmRBUE5TQ2VydGlmaWNhdGVIZWFsdGgoXG4gICAgICAgICAgZGV0YWlscy5jZXJ0aWZpY2F0ZUhlYWx0aHksXG4gICAgICAgICAgZGV0YWlscy5kYXlzVW50aWxFeHBpcmF0aW9uLFxuICAgICAgICAgIG92ZXJhbGxTdGF0dXMgPT09ICd3YXJuaW5nJyA/IDEgOiAwLFxuICAgICAgICAgIG92ZXJhbGxTdGF0dXMgPT09ICdjcml0aWNhbCcgPyAxIDogMFxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICAvLyBSZWNvcmQgaW52YWxpZCB0b2tlbiBwZXJjZW50YWdlIGFzIGEgY3VzdG9tIG1ldHJpY1xuICAgICAgYXdhaXQgdGhpcy5tZXRyaWNzLnJlY29yZElPU05vdGlmaWNhdGlvbihcbiAgICAgICAgMTAwLCAvLyBUb3RhbCBkZXZpY2VzIChub3JtYWxpemVkKVxuICAgICAgICB0cnVlLCAvLyBTdWNjZXNzICh3ZSdyZSBqdXN0IHJlY29yZGluZyB0aGUgcGVyY2VudGFnZSlcbiAgICAgICAgTWF0aC5yb3VuZChkZXRhaWxzLmludmFsaWRUb2tlblBlcmNlbnRhZ2UpIC8vIEludmFsaWQgdG9rZW4gcGVyY2VudGFnZVxuICAgICAgKTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcignRmFpbGVkIHRvIHJlY29yZCBoZWFsdGggY2hlY2sgbWV0cmljcycsIGVycm9yIGFzIEVycm9yKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGVyZm9ybXMgYXV0b21hdGVkIHJlY292ZXJ5IGFjdGlvbnMgYmFzZWQgb24gaGVhbHRoIHN0YXR1c1xuICAgKi9cbiAgYXN5bmMgcGVyZm9ybUF1dG9tYXRlZFJlY292ZXJ5KGhlYWx0aFN0YXR1czogYW55KTogUHJvbWlzZTx7XG4gICAgYWN0aW9uc1BlcmZvcm1lZDogc3RyaW5nW107XG4gICAgc3VjY2VzczogYm9vbGVhbjtcbiAgICBlcnJvcnM6IHN0cmluZ1tdO1xuICB9PiB7XG4gICAgY29uc3QgdGltZXIgPSB0aGlzLm1ldHJpY3MuY3JlYXRlVGltZXIoJ0F1dG9tYXRlZFJlY292ZXJ5Jyk7XG4gICAgY29uc3QgYWN0aW9uc1BlcmZvcm1lZDogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCBlcnJvcnM6IHN0cmluZ1tdID0gW107XG5cbiAgICB0cnkge1xuICAgICAgdGhpcy5sb2dnZXIuaW5mbygnU3RhcnRpbmcgYXV0b21hdGVkIGlPUyByZWNvdmVyeSBhY3Rpb25zJywge1xuICAgICAgICBvdmVyYWxsU3RhdHVzOiBoZWFsdGhTdGF0dXMub3ZlcmFsbCxcbiAgICAgICAgY2VydGlmaWNhdGVTdGF0dXM6IGhlYWx0aFN0YXR1cy5jb21wb25lbnRzLmNlcnRpZmljYXRlLnN0YXR1cyxcbiAgICAgICAgaW52YWxpZEVuZHBvaW50czogaGVhbHRoU3RhdHVzLmNvbXBvbmVudHMuZW5kcG9pbnRzLmludmFsaWRcbiAgICAgIH0pO1xuXG4gICAgICAvLyBBY3Rpb24gMTogQ2xlYW4gdXAgaW52YWxpZCB0b2tlbnMgaWYgaGlnaCBwZXJjZW50YWdlXG4gICAgICBjb25zdCBpbnZhbGlkUGVyY2VudGFnZSA9IGhlYWx0aFN0YXR1cy5jb21wb25lbnRzLmVuZHBvaW50cy50b3RhbCA+IDAgPyBcbiAgICAgICAgKGhlYWx0aFN0YXR1cy5jb21wb25lbnRzLmVuZHBvaW50cy5pbnZhbGlkIC8gaGVhbHRoU3RhdHVzLmNvbXBvbmVudHMuZW5kcG9pbnRzLnRvdGFsKSAqIDEwMCA6IDA7XG5cbiAgICAgIGlmIChpbnZhbGlkUGVyY2VudGFnZSA+IDEwKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnUGVyZm9ybWluZyBhZGRpdGlvbmFsIHRva2VuIGNsZWFudXAgZHVlIHRvIGhpZ2ggaW52YWxpZCB0b2tlbiByYXRlJyk7XG4gICAgICAgICAgY29uc3QgY2xlYW51cFJlc3VsdCA9IGF3YWl0IHRoaXMuaW9zTWFuYWdlbWVudFRvb2wucHJvY2Vzc0FQTlNGZWVkYmFjaygpO1xuICAgICAgICAgIGFjdGlvbnNQZXJmb3JtZWQucHVzaChgQ2xlYW5lZCB1cCAke2NsZWFudXBSZXN1bHQucmVtb3ZlZFRva2Vucy5sZW5ndGh9IGFkZGl0aW9uYWwgaW52YWxpZCB0b2tlbnNgKTtcbiAgICAgICAgICBcbiAgICAgICAgICBpZiAoY2xlYW51cFJlc3VsdC5lcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgZXJyb3JzLnB1c2goLi4uY2xlYW51cFJlc3VsdC5lcnJvcnMpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBgVG9rZW4gY2xlYW51cCBmYWlsZWQ6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcid9YDtcbiAgICAgICAgICBlcnJvcnMucHVzaChlcnJvck1lc3NhZ2UpO1xuICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdBdXRvbWF0ZWQgdG9rZW4gY2xlYW51cCBmYWlsZWQnLCBlcnJvciBhcyBFcnJvcik7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gQWN0aW9uIDI6IFZhbGlkYXRlIGFuZCByZWZyZXNoIHBsYXRmb3JtIGFwcGxpY2F0aW9uIGlmIG5lZWRlZFxuICAgICAgaWYgKGhlYWx0aFN0YXR1cy5jb21wb25lbnRzLnBsYXRmb3JtQXBwLnN0YXR1cyAhPT0gJ2hlYWx0aHknKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnQXR0ZW1wdGluZyBwbGF0Zm9ybSBhcHBsaWNhdGlvbiB2YWxpZGF0aW9uIHJlZnJlc2gnKTtcbiAgICAgICAgICBjb25zdCB2YWxpZGF0aW9uUmVzdWx0ID0gYXdhaXQgdGhpcy5pb3NNYW5hZ2VtZW50VG9vbC52YWxpZGF0ZUFQTlNDb25maWcoKTtcbiAgICAgICAgICBcbiAgICAgICAgICBpZiAodmFsaWRhdGlvblJlc3VsdCkge1xuICAgICAgICAgICAgYWN0aW9uc1BlcmZvcm1lZC5wdXNoKCdQbGF0Zm9ybSBhcHBsaWNhdGlvbiB2YWxpZGF0aW9uIHJlZnJlc2hlZCBzdWNjZXNzZnVsbHknKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZXJyb3JzLnB1c2goJ1BsYXRmb3JtIGFwcGxpY2F0aW9uIHZhbGlkYXRpb24gcmVmcmVzaCBmYWlsZWQnKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gYFBsYXRmb3JtIGFwcCByZWZyZXNoIGZhaWxlZDogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ31gO1xuICAgICAgICAgIGVycm9ycy5wdXNoKGVycm9yTWVzc2FnZSk7XG4gICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0F1dG9tYXRlZCBwbGF0Zm9ybSBhcHAgcmVmcmVzaCBmYWlsZWQnLCBlcnJvciBhcyBFcnJvcik7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gQWN0aW9uIDM6IFJlY29yZCByZWNvdmVyeSBtZXRyaWNzXG4gICAgICBhd2FpdCB0aGlzLm1ldHJpY3MucmVjb3JkRXhlY3V0aW9uUmVzdWx0KCdBdXRvbWF0ZWRSZWNvdmVyeScsIGVycm9ycy5sZW5ndGggPT09IDApO1xuICAgICAgXG4gICAgICBpZiAoYWN0aW9uc1BlcmZvcm1lZC5sZW5ndGggPiAwKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ0F1dG9tYXRlZCByZWNvdmVyeSBhY3Rpb25zIGNvbXBsZXRlZCcsIHtcbiAgICAgICAgICBhY3Rpb25zUGVyZm9ybWVkOiBhY3Rpb25zUGVyZm9ybWVkLmxlbmd0aCxcbiAgICAgICAgICBlcnJvcnM6IGVycm9ycy5sZW5ndGgsXG4gICAgICAgICAgYWN0aW9uczogYWN0aW9uc1BlcmZvcm1lZFxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGltZXIuc3RvcChlcnJvcnMubGVuZ3RoID09PSAwKTtcbiAgICAgIFxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYWN0aW9uc1BlcmZvcm1lZCxcbiAgICAgICAgc3VjY2VzczogZXJyb3JzLmxlbmd0aCA9PT0gMCxcbiAgICAgICAgZXJyb3JzXG4gICAgICB9O1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdBdXRvbWF0ZWQgcmVjb3ZlcnkgcHJvY2VzcyBmYWlsZWQnLCBlcnJvciBhcyBFcnJvcik7XG4gICAgICBlcnJvcnMucHVzaChgUmVjb3ZlcnkgcHJvY2VzcyBmYWlsZWQ6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcid9YCk7XG4gICAgICBhd2FpdCB0aW1lci5zdG9wKGZhbHNlKTtcbiAgICAgIFxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYWN0aW9uc1BlcmZvcm1lZCxcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGVycm9yc1xuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTW9uaXRvcnMgaU9TIG5vdGlmaWNhdGlvbiBkZWxpdmVyeSB3aXRoIGVuaGFuY2VkIGVycm9yIGhhbmRsaW5nXG4gICAqL1xuICBhc3luYyBtb25pdG9yTm90aWZpY2F0aW9uRGVsaXZlcnkoXG4gICAgbm90aWZpY2F0aW9uQXR0ZW1wdHM6IG51bWJlcixcbiAgICBzdWNjZXNzZnVsRGVsaXZlcmllczogbnVtYmVyLFxuICAgIGZhaWxlZERlbGl2ZXJpZXM6IG51bWJlcixcbiAgICBmYWxsYmFja1VzZWQ6IGJvb2xlYW5cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN1Y2Nlc3NSYXRlID0gbm90aWZpY2F0aW9uQXR0ZW1wdHMgPiAwID8gKHN1Y2Nlc3NmdWxEZWxpdmVyaWVzIC8gbm90aWZpY2F0aW9uQXR0ZW1wdHMpICogMTAwIDogMDtcbiAgICAgIGNvbnN0IGZhaWx1cmVSYXRlID0gbm90aWZpY2F0aW9uQXR0ZW1wdHMgPiAwID8gKGZhaWxlZERlbGl2ZXJpZXMgLyBub3RpZmljYXRpb25BdHRlbXB0cykgKiAxMDAgOiAwO1xuXG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKCdpT1Mgbm90aWZpY2F0aW9uIGRlbGl2ZXJ5IG1vbml0b3JpbmcnLCB7XG4gICAgICAgIG5vdGlmaWNhdGlvbkF0dGVtcHRzLFxuICAgICAgICBzdWNjZXNzZnVsRGVsaXZlcmllcyxcbiAgICAgICAgZmFpbGVkRGVsaXZlcmllcyxcbiAgICAgICAgc3VjY2Vzc1JhdGU6IHN1Y2Nlc3NSYXRlLnRvRml4ZWQoMiksXG4gICAgICAgIGZhaWx1cmVSYXRlOiBmYWlsdXJlUmF0ZS50b0ZpeGVkKDIpLFxuICAgICAgICBmYWxsYmFja1VzZWRcbiAgICAgIH0pO1xuXG4gICAgICAvLyBSZWNvcmQgZGV0YWlsZWQgZGVsaXZlcnkgbWV0cmljc1xuICAgICAgYXdhaXQgdGhpcy5tZXRyaWNzLnJlY29yZElPU05vdGlmaWNhdGlvbihub3RpZmljYXRpb25BdHRlbXB0cywgc3VjY2Vzc1JhdGUgPiA1MCwgZmFpbGVkRGVsaXZlcmllcyk7XG5cbiAgICAgIGlmIChmYWxsYmFja1VzZWQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5tZXRyaWNzLnJlY29yZElPU0ZhbGxiYWNrVXNhZ2UoWydlbWFpbCcsICdzbXMnXSwgc3VjY2Vzc2Z1bERlbGl2ZXJpZXMgPiAwKTtcbiAgICAgIH1cblxuICAgICAgLy8gVHJpZ2dlciBoZWFsdGggY2hlY2sgaWYgZmFpbHVyZSByYXRlIGlzIGhpZ2hcbiAgICAgIGlmIChmYWlsdXJlUmF0ZSA+IDUwICYmIG5vdGlmaWNhdGlvbkF0dGVtcHRzID49IDMpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybignSGlnaCBpT1Mgbm90aWZpY2F0aW9uIGZhaWx1cmUgcmF0ZSBkZXRlY3RlZCwgdHJpZ2dlcmluZyBoZWFsdGggY2hlY2snLCB7XG4gICAgICAgICAgZmFpbHVyZVJhdGUsXG4gICAgICAgICAgbm90aWZpY2F0aW9uQXR0ZW1wdHNcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gUGVyZm9ybSBoZWFsdGggY2hlY2sgaW4gYmFja2dyb3VuZCAoZG9uJ3QgYXdhaXQgdG8gYXZvaWQgYmxvY2tpbmcpXG4gICAgICAgIHRoaXMucGVyZm9ybUNvbXByZWhlbnNpdmVIZWFsdGhDaGVjaygpLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignQmFja2dyb3VuZCBoZWFsdGggY2hlY2sgZmFpbGVkJywgZXJyb3IgYXMgRXJyb3IpO1xuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcignaU9TIG5vdGlmaWNhdGlvbiBkZWxpdmVyeSBtb25pdG9yaW5nIGZhaWxlZCcsIGVycm9yIGFzIEVycm9yKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR2V0cyBjdXJyZW50IGlPUyBzeXN0ZW0gc3RhdHVzIHN1bW1hcnlcbiAgICovXG4gIGFzeW5jIGdldFN5c3RlbVN0YXR1c1N1bW1hcnkoKTogUHJvbWlzZTx7XG4gICAgc3RhdHVzOiAnb3BlcmF0aW9uYWwnIHwgJ2RlZ3JhZGVkJyB8ICdvdXRhZ2UnO1xuICAgIGxhc3RIZWFsdGhDaGVjaz86IERhdGU7XG4gICAgY2VydGlmaWNhdGVFeHBpcmF0aW9uPzogRGF0ZTtcbiAgICBhY3RpdmVEZXZpY2VzOiBudW1iZXI7XG4gICAgcmVjZW50RXJyb3JzOiBudW1iZXI7XG4gIH0+IHtcbiAgICB0cnkge1xuICAgICAgLy8gVGhpcyB3b3VsZCB0eXBpY2FsbHkgcXVlcnkgcmVjZW50IG1ldHJpY3MgZnJvbSBDbG91ZFdhdGNoXG4gICAgICAvLyBGb3Igbm93LCB3ZSdsbCBwZXJmb3JtIGEgcXVpY2sgdmFsaWRhdGlvblxuICAgICAgY29uc3QgaXNDb25maWdWYWxpZCA9IGF3YWl0IHRoaXMuaW9zTWFuYWdlbWVudFRvb2wudmFsaWRhdGVBUE5TQ29uZmlnKCk7XG4gICAgICBcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1czogaXNDb25maWdWYWxpZCA/ICdvcGVyYXRpb25hbCcgOiAnZGVncmFkZWQnLFxuICAgICAgICBsYXN0SGVhbHRoQ2hlY2s6IG5ldyBEYXRlKCksXG4gICAgICAgIGFjdGl2ZURldmljZXM6IDAsIC8vIFdvdWxkIGJlIHBvcHVsYXRlZCBmcm9tIGFjdHVhbCBtZXRyaWNzXG4gICAgICAgIHJlY2VudEVycm9yczogMCAgIC8vIFdvdWxkIGJlIHBvcHVsYXRlZCBmcm9tIGFjdHVhbCBtZXRyaWNzXG4gICAgICB9O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcignRmFpbGVkIHRvIGdldCBpT1Mgc3lzdGVtIHN0YXR1cyBzdW1tYXJ5JywgZXJyb3IgYXMgRXJyb3IpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzOiAnb3V0YWdlJyxcbiAgICAgICAgbGFzdEhlYWx0aENoZWNrOiBuZXcgRGF0ZSgpLFxuICAgICAgICBhY3RpdmVEZXZpY2VzOiAwLFxuICAgICAgICByZWNlbnRFcnJvcnM6IDFcbiAgICAgIH07XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBpT1MgbW9uaXRvcmluZyBzZXJ2aWNlIGluc3RhbmNlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVpT1NNb25pdG9yaW5nU2VydmljZShpb3NDb25maWc6IGlPU1B1c2hDb25maWcsIHJlZ2lvbj86IHN0cmluZyk6IGlPU01vbml0b3JpbmdTZXJ2aWNlIHtcbiAgcmV0dXJuIG5ldyBpT1NNb25pdG9yaW5nU2VydmljZShpb3NDb25maWcsIHJlZ2lvbik7XG59Il19