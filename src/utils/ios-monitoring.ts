import { createLogger } from './logger';
import { createMetricsCollector } from './metrics';
import { iOSManagementTool } from '../tools/ios-management-tool';
import { AlertTool } from '../tools/alert-tool';
import { iOSPushConfig } from '../types';

/**
 * Comprehensive iOS monitoring and error handling service
 */
export class iOSMonitoringService {
  private logger = createLogger('iOSMonitoringService');
  private metrics = createMetricsCollector('us-east-1', 'SpendMonitor/iOS');
  private iosManagementTool: iOSManagementTool;
  private alertTool: AlertTool;
  private iosConfig: iOSPushConfig;

  constructor(iosConfig: iOSPushConfig, region: string = 'us-east-1') {
    this.iosConfig = iosConfig;
    this.iosManagementTool = new iOSManagementTool(iosConfig, region);
    this.alertTool = new AlertTool(region);
  }

  /**
   * Performs comprehensive iOS system health monitoring
   */
  async performComprehensiveHealthCheck(): Promise<{
    overall: 'healthy' | 'warning' | 'critical';
    components: {
      platformApp: { status: string; details: string[] };
      certificate: { status: string; details: string[]; daysUntilExpiration?: number };
      endpoints: { active: number; invalid: number; total: number };
      feedback: { processed: boolean; removedTokens: number; errors: string[] };
    };
    recommendations: string[];
    metrics: {
      healthCheckDuration: number;
      certificateValidationTime: number;
      feedbackProcessingTime: number;
    };
  }> {
    const startTime = Date.now();
    const timer = this.metrics.createTimer('ComprehensiveHealthCheck');

    try {
      this.logger.info('Starting comprehensive iOS health monitoring');

      // Parallel execution of health checks for better performance
      const [
        platformAppHealth,
        certificateHealth,
        feedbackResult
      ] = await Promise.allSettled([
        this.iosManagementTool.validateAPNSConfig(),
        this.measureCertificateValidation(),
        this.measureFeedbackProcessing()
      ]);

      // Process results and handle any failures
      const platformAppStatus = platformAppHealth.status === 'fulfilled' && platformAppHealth.value ? 'healthy' : 'critical';
      const platformAppDetails = platformAppStatus === 'healthy' ? 
        ['Platform application is accessible and functional'] : 
        ['Platform application validation failed - check configuration'];

      let certificateStatus: 'healthy' | 'warning' | 'critical' = 'healthy';
      let certificateDetails: string[] = [];
      let daysUntilExpiration: number | undefined;

      if (certificateHealth.status === 'fulfilled') {
        const certResult = certificateHealth.value;
        if (certResult.errors.length > 0) {
          certificateStatus = 'critical';
          certificateDetails = certResult.errors;
        } else if (certResult.warnings.length > 0) {
          certificateStatus = 'warning';
          certificateDetails = certResult.warnings;
        } else {
          certificateDetails = ['Certificate appears healthy'];
        }
        daysUntilExpiration = certResult.daysUntilExpiration;
      } else {
        certificateStatus = 'critical';
        certificateDetails = ['Certificate health check failed'];
      }

      let feedbackProcessed = false;
      let removedTokens = 0;
      let feedbackErrors: string[] = [];

      if (feedbackResult.status === 'fulfilled') {
        const feedback = feedbackResult.value;
        feedbackProcessed = true;
        removedTokens = feedback.removedTokens.length;
        feedbackErrors = feedback.errors;
      } else {
        feedbackErrors = ['Feedback processing failed'];
      }

      // Calculate endpoint health metrics
      const totalEndpoints = Math.max(100, removedTokens + 50); // Estimate based on removed tokens
      const activeEndpoints = totalEndpoints - removedTokens;
      const invalidPercentage = totalEndpoints > 0 ? (removedTokens / totalEndpoints) * 100 : 0;

      // Generate recommendations based on health status
      const recommendations: string[] = [];
      let overallStatus: 'healthy' | 'warning' | 'critical' = 'healthy';

      if (platformAppStatus === 'critical' || certificateStatus === 'critical') {
        overallStatus = 'critical';
      } else if (certificateStatus === 'warning') {
        overallStatus = 'warning';
      }

      if (certificateStatus === 'critical') {
        recommendations.push('URGENT: Renew APNS certificate immediately - iOS notifications are failing');
      } else if (certificateStatus === 'warning') {
        recommendations.push('Plan APNS certificate renewal - expiration approaching');
      }

      if (invalidPercentage > 50) {
        overallStatus = 'critical';
        recommendations.push('CRITICAL: High number of invalid device tokens - investigate app distribution and user engagement');
      } else if (invalidPercentage > 20) {
        if (overallStatus === 'healthy') overallStatus = 'warning';
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
            (certificateHealth.value as any).validationTime || 0 : 0,
          feedbackProcessingTime: feedbackResult.status === 'fulfilled' ? 
            (feedbackResult.value as any).processingTime || 0 : 0
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

    } catch (error) {
      this.logger.error('Comprehensive iOS health check failed', error as Error);
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
  private async measureCertificateValidation(): Promise<any> {
    const startTime = Date.now();
    try {
      const result = await this.iosManagementTool.validateAPNSCertificateHealth();
      const validationTime = Date.now() - startTime;
      
      // Record certificate health metrics
      await this.metrics.recordAPNSCertificateHealth(
        result.isValid,
        result.daysUntilExpiration,
        result.warnings.length,
        result.errors.length
      );

      return { ...result, validationTime };
    } catch (error) {
      const validationTime = Date.now() - startTime;
      this.logger.error('Certificate validation measurement failed', error as Error);
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
  private async measureFeedbackProcessing(): Promise<any> {
    const startTime = Date.now();
    try {
      const result = await this.iosManagementTool.processAPNSFeedback();
      const processingTime = Date.now() - startTime;
      
      return { ...result, processingTime };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error('Feedback processing measurement failed', error as Error);
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
  private async recordHealthCheckMetrics(
    overallStatus: 'healthy' | 'warning' | 'critical',
    details: {
      platformAppHealthy: boolean;
      certificateHealthy: boolean;
      feedbackProcessed: boolean;
      invalidTokenPercentage: number;
      daysUntilExpiration?: number;
      healthCheckDuration: number;
    }
  ): Promise<void> {
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
        await this.metrics.recordAPNSCertificateHealth(
          details.certificateHealthy,
          details.daysUntilExpiration,
          overallStatus === 'warning' ? 1 : 0,
          overallStatus === 'critical' ? 1 : 0
        );
      }

      // Record invalid token percentage as a custom metric
      await this.metrics.recordIOSNotification(
        100, // Total devices (normalized)
        true, // Success (we're just recording the percentage)
        Math.round(details.invalidTokenPercentage) // Invalid token percentage
      );

    } catch (error) {
      this.logger.error('Failed to record health check metrics', error as Error);
    }
  }

  /**
   * Performs automated recovery actions based on health status
   */
  async performAutomatedRecovery(healthStatus: any): Promise<{
    actionsPerformed: string[];
    success: boolean;
    errors: string[];
  }> {
    const timer = this.metrics.createTimer('AutomatedRecovery');
    const actionsPerformed: string[] = [];
    const errors: string[] = [];

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
        } catch (error) {
          const errorMessage = `Token cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
          errors.push(errorMessage);
          this.logger.error('Automated token cleanup failed', error as Error);
        }
      }

      // Action 2: Validate and refresh platform application if needed
      if (healthStatus.components.platformApp.status !== 'healthy') {
        try {
          this.logger.info('Attempting platform application validation refresh');
          const validationResult = await this.iosManagementTool.validateAPNSConfig();
          
          if (validationResult) {
            actionsPerformed.push('Platform application validation refreshed successfully');
          } else {
            errors.push('Platform application validation refresh failed');
          }
        } catch (error) {
          const errorMessage = `Platform app refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
          errors.push(errorMessage);
          this.logger.error('Automated platform app refresh failed', error as Error);
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

    } catch (error) {
      this.logger.error('Automated recovery process failed', error as Error);
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
  async monitorNotificationDelivery(
    notificationAttempts: number,
    successfulDeliveries: number,
    failedDeliveries: number,
    fallbackUsed: boolean
  ): Promise<void> {
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
          this.logger.error('Background health check failed', error as Error);
        });
      }

    } catch (error) {
      this.logger.error('iOS notification delivery monitoring failed', error as Error);
    }
  }

  /**
   * Gets current iOS system status summary
   */
  async getSystemStatusSummary(): Promise<{
    status: 'operational' | 'degraded' | 'outage';
    lastHealthCheck?: Date;
    certificateExpiration?: Date;
    activeDevices: number;
    recentErrors: number;
  }> {
    try {
      // This would typically query recent metrics from CloudWatch
      // For now, we'll perform a quick validation
      const isConfigValid = await this.iosManagementTool.validateAPNSConfig();
      
      return {
        status: isConfigValid ? 'operational' : 'degraded',
        lastHealthCheck: new Date(),
        activeDevices: 0, // Would be populated from actual metrics
        recentErrors: 0   // Would be populated from actual metrics
      };
    } catch (error) {
      this.logger.error('Failed to get iOS system status summary', error as Error);
      return {
        status: 'outage',
        lastHealthCheck: new Date(),
        activeDevices: 0,
        recentErrors: 1
      };
    }
  }
}

/**
 * Creates an iOS monitoring service instance
 */
export function createiOSMonitoringService(iosConfig: iOSPushConfig, region?: string): iOSMonitoringService {
  return new iOSMonitoringService(iosConfig, region);
}