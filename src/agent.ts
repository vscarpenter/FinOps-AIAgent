// Try to import strands-agents, fallback to mock implementation
let Agent: any;
try {
  Agent = require('strands-agents').Agent;
} catch (error) {
  Agent = require('./mock-strands-agent').Agent;
}
import { CostExplorerClient } from '@aws-sdk/client-cost-explorer';
import { SNSClient } from '@aws-sdk/client-sns';
import { SpendMonitorConfig, CostAnalysis, AlertContext } from './types';
import { validateSpendMonitorConfig } from './validation';
import { CostAnalysisTool } from './tools/cost-analysis-tool';
import { AlertTool } from './tools/alert-tool';
import { iOSManagementTool } from './tools/ios-management-tool';
import { BedrockAnalysisTool } from './tools/bedrock-analysis-tool';
import { SpendMonitorTask } from './tasks/spend-monitor-task';
import { iOSMonitoringService } from './utils/ios-monitoring';
import { createLogger } from './utils/logger';
import { createMetricsCollector } from './utils/metrics';

/**
 * AWS Spend Monitor Agent with iOS push notification support
 * 
 * This agent monitors AWS spending using Cost Explorer API and sends alerts
 * via multiple channels (email, SMS, iOS push) when spending exceeds thresholds.
 */
export class SpendMonitorAgent extends Agent {
  private costExplorer: CostExplorerClient;
  private sns: SNSClient;
  protected config: SpendMonitorConfig;
  private costAnalysisTool?: CostAnalysisTool;
  private alertTool?: AlertTool;
  private iosManagementTool?: iOSManagementTool;
  private bedrockTool?: BedrockAnalysisTool;
  private spendMonitorTask?: SpendMonitorTask;
  private iosMonitoringService?: iOSMonitoringService;
  private agentLogger = createLogger('SpendMonitorAgent');
  private metrics = createMetricsCollector('us-east-1', 'SpendMonitor/Agent');

  constructor(config: SpendMonitorConfig) {
    super(config);
    this.config = config;
    
    // Initialize AWS clients
    this.costExplorer = new CostExplorerClient({ region: config.region });
    this.sns = new SNSClient({ region: config.region });
  }

  /**
   * Initializes the agent by validating configuration and registering tools and tasks
   */
  async initialize(): Promise<void> {
    try {
      console.log('Initializing Spend Monitor Agent...');

      // Validate configuration including iOS settings
      await this.validateConfiguration();

      // Initialize and register tools
      await this.initializeTools();

      // Initialize and register tasks
      await this.initializeTasks();

      console.log('Spend Monitor Agent initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Spend Monitor Agent:', error);
      throw error;
    }
  }

  /**
   * Validates the agent configuration
   */
  private async validateConfiguration(): Promise<void> {
    try {
      validateSpendMonitorConfig(this.config);
      
      // Additional iOS-specific validation if iOS config is provided
      if (this.config.iosConfig) {
        console.log('iOS push notifications enabled - validating APNS configuration');
        // APNS validation will be done by iOSManagementTool during initialization
      }

      console.log('Configuration validation completed');
    } catch (error) {
      console.error('Configuration validation failed:', error);
      throw error;
    }
  }

  /**
   * Initializes and registers all tools
   */
  private async initializeTools(): Promise<void> {
    try {
      // Initialize Cost Analysis Tool
      this.costAnalysisTool = new CostAnalysisTool(
        this.config.region,
        { maxAttempts: this.config.retryAttempts }
      );
      this.registerTool(this.costAnalysisTool);
      console.log('Cost Analysis Tool registered');

      // Initialize Alert Tool with multi-channel support
      this.alertTool = new AlertTool(
        this.config.region,
        { maxAttempts: this.config.retryAttempts }
      );
      this.registerTool(this.alertTool);
      console.log('Alert Tool registered');

      // Initialize iOS Management Tool if iOS config is provided
      if (this.config.iosConfig) {
        this.iosManagementTool = new iOSManagementTool(
          this.config.iosConfig,
          this.config.region
        );
        this.registerTool(this.iosManagementTool);
        
        // Initialize comprehensive iOS monitoring service
        this.iosMonitoringService = new iOSMonitoringService(
          this.config.iosConfig,
          this.config.region
        );
        
        // Perform comprehensive iOS health check during initialization
        try {
          const healthCheck = await this.iosMonitoringService.performComprehensiveHealthCheck();
          
          if (healthCheck.overall === 'critical') {
            this.agentLogger.error('Critical iOS system issues detected during initialization', new Error('Critical iOS system issues'), {
              components: healthCheck.components,
              recommendations: healthCheck.recommendations
            });
            console.warn('CRITICAL: iOS notifications may not work - check logs for details');
          } else if (healthCheck.overall === 'warning') {
            this.agentLogger.warn('iOS system warnings detected during initialization', {
              components: healthCheck.components,
              recommendations: healthCheck.recommendations
            });
            console.warn('WARNING: iOS notifications may have issues - check logs for details');
          } else {
            this.agentLogger.info('iOS system health check passed', {
              certificateExpiration: healthCheck.components.certificate.daysUntilExpiration,
              activeEndpoints: healthCheck.components.endpoints.active
            });
            console.log('iOS Management Tool registered and comprehensive health check passed');
          }

          // Perform automated recovery if needed
          if (healthCheck.overall !== 'healthy') {
            const recoveryResult = await this.iosMonitoringService.performAutomatedRecovery(healthCheck);
            if (recoveryResult.success && recoveryResult.actionsPerformed.length > 0) {
              this.agentLogger.info('Automated iOS recovery completed', {
                actions: recoveryResult.actionsPerformed
              });
            }
          }

        } catch (error) {
          this.agentLogger.error('iOS health check failed during initialization', error as Error);
          console.warn('iOS health check failed - iOS notifications may not work properly');
        }
      }

      // Initialize Bedrock Analysis Tool if Bedrock config is provided
      if (this.config.bedrockConfig?.enabled) {
        this.bedrockTool = new BedrockAnalysisTool(
          this.config.bedrockConfig,
          { maxAttempts: this.config.retryAttempts }
        );
        this.registerTool(this.bedrockTool);
        
        // Perform Bedrock health check during initialization
        try {
          const isBedrockHealthy = await this.bedrockTool.validateModelAccess();
          
          if (isBedrockHealthy) {
            this.agentLogger.info('Bedrock model access validated successfully', {
              modelId: this.config.bedrockConfig.modelId,
              region: this.config.bedrockConfig.region
            });
            console.log('Bedrock Analysis Tool registered and health check passed');
            
            // Record successful health check metric
            await this.metrics.recordBedrockHealthCheck(
              this.config.bedrockConfig.modelId,
              true
            );
          } else {
            this.agentLogger.warn('Bedrock model access validation failed during initialization', {
              modelId: this.config.bedrockConfig.modelId,
              region: this.config.bedrockConfig.region
            });
            console.warn('WARNING: Bedrock AI analysis may not work - check model access permissions');
            
            // Record failed health check metric
            await this.metrics.recordBedrockHealthCheck(
              this.config.bedrockConfig.modelId,
              false,
              undefined,
              'AccessValidationFailed'
            );
          }
        } catch (error) {
          this.agentLogger.error('Bedrock health check failed during initialization', error as Error, {
            modelId: this.config.bedrockConfig.modelId,
            region: this.config.bedrockConfig.region
          });
          console.warn('Bedrock health check failed - AI analysis may not work properly');
          
          // Record failed health check metric with error type
          await this.metrics.recordBedrockHealthCheck(
            this.config.bedrockConfig.modelId,
            false,
            undefined,
            error instanceof Error ? error.name : 'UnknownError'
          );
        }
      }

    } catch (error) {
      console.error('Failed to initialize tools:', error);
      throw error;
    }
  }

  /**
   * Initializes and registers tasks
   */
  private async initializeTasks(): Promise<void> {
    try {
      // Initialize Spend Monitor Task
      this.spendMonitorTask = new SpendMonitorTask(this.config);
      this.registerTask(this.spendMonitorTask);
      console.log('Spend Monitor Task registered');

    } catch (error) {
      console.error('Failed to initialize tasks:', error);
      throw error;
    }
  }

  /**
   * Main execution method that orchestrates cost analysis and multi-channel alerting
   */
  async execute(): Promise<void> {
    try {
      console.log('Starting spend monitoring execution...');

      if (!this.spendMonitorTask) {
        throw new Error('Spend Monitor Task not initialized');
      }

      // Execute the spend monitoring task with progress tracking
      const taskResult = await this.spendMonitorTask.execute(this.config);

      if (!taskResult.success) {
        throw new Error(`Task execution failed: ${taskResult.error}`);
      }

      // Perform cost analysis
      const costAnalysis = await this.analyzeCosts();
      this.spendMonitorTask.setCostAnalysis(costAnalysis);

      // Check if threshold exceeded and send alerts if necessary
      const alertSent = await this.checkThresholdAndAlert(costAnalysis);

      console.log(`Spend monitoring execution completed successfully`);
      console.log(`Current spend: $${costAnalysis.totalCost.toFixed(2)}, Threshold: $${this.config.spendThreshold.toFixed(2)}`);
      console.log(`Projected monthly: $${costAnalysis.projectedMonthly.toFixed(2)}`);
      
      if (alertSent) {
        console.log('Alert notifications sent to all configured channels');
      }

    } catch (error) {
      console.error('Error in spend monitoring execution:', error);
      
      // Log iOS-specific errors if applicable
      if (this.config.iosConfig && error instanceof Error) {
        if (error.message.includes('APNS') || error.message.includes('iOS')) {
          console.error('iOS notification error detected - check APNS configuration');
        }
      }
      
      throw error;
    }
  }

  /**
   * Checks spending threshold and sends alerts if exceeded
   */
  private async checkThresholdAndAlert(costAnalysis: CostAnalysis): Promise<boolean> {
    if (costAnalysis.totalCost <= this.config.spendThreshold) {
      console.log('Spending is within threshold - no alert needed');
      return false;
    }

    console.log(`Spending threshold exceeded: $${costAnalysis.totalCost.toFixed(2)} > $${this.config.spendThreshold.toFixed(2)}`);

    // Create alert context
    const alertContext: AlertContext = {
      threshold: this.config.spendThreshold,
      exceedAmount: costAnalysis.totalCost - this.config.spendThreshold,
      percentageOver: ((costAnalysis.totalCost - this.config.spendThreshold) / this.config.spendThreshold) * 100,
      topServices: this.getTopServices(costAnalysis.serviceBreakdown),
      alertLevel: this.determineAlertLevel(costAnalysis.totalCost, this.config.spendThreshold)
    };

    // Update task with alert context
    if (this.spendMonitorTask) {
      this.spendMonitorTask.setAlertContext(alertContext);
    }

    // Send alert via all configured channels
    await this.sendAlert(costAnalysis, alertContext);
    
    return true;
  }

  /**
   * Determines alert level based on spending amount
   */
  private determineAlertLevel(currentSpend: number, threshold: number): 'WARNING' | 'CRITICAL' {
    const percentageOver = ((currentSpend - threshold) / threshold) * 100;
    return percentageOver > 50 ? 'CRITICAL' : 'WARNING';
  }

  /**
   * Gets top services by cost for alert context
   */
  private getTopServices(serviceBreakdown: { [service: string]: number }): Array<{serviceName: string; cost: number; percentage: number}> {
    const totalCost = Object.values(serviceBreakdown).reduce((sum, cost) => sum + cost, 0);
    
    return Object.entries(serviceBreakdown)
      .filter(([, cost]) => cost >= this.config.minServiceCostThreshold)
      .map(([serviceName, cost]) => ({
        serviceName,
        cost,
        percentage: (cost / totalCost) * 100
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5); // Top 5 services
  }

  /**
   * Analyzes current AWS costs using the Cost Analysis Tool
   */
  private async analyzeCosts(): Promise<CostAnalysis> {
    if (!this.costAnalysisTool) {
      throw new Error('Cost Analysis Tool not initialized');
    }
    
    return await this.costAnalysisTool.getCurrentMonthCosts();
  }

  /**
   * Sends alert notifications via all configured channels
   */
  private async sendAlert(costAnalysis: CostAnalysis, alertContext: AlertContext): Promise<void> {
    if (!this.alertTool) {
      throw new Error('Alert Tool not initialized');
    }

    try {
      await this.alertTool.sendSpendAlert(costAnalysis, alertContext, this.config.snsTopicArn, this.config.iosConfig);
      console.log('Alert sent successfully to all configured channels');
    } catch (error) {
      console.error('Failed to send alert:', error);
      
      // Try to send a simplified alert if the main alert fails
      try {
        console.log('Attempting to send simplified alert...');
        await this.alertTool.sendSpendAlert(
          costAnalysis, 
          alertContext, 
          this.config.snsTopicArn
        );
        console.log('Simplified alert sent successfully');
      } catch (fallbackError) {
        console.error('Failed to send simplified alert:', fallbackError);
        throw error; // Re-throw original error
      }
    }
  }

  /**
   * Gets the current configuration
   */
  getConfig(): SpendMonitorConfig {
    return { ...this.config };
  }

  /**
   * Updates the configuration (requires re-initialization)
   */
  updateConfig(newConfig: Partial<SpendMonitorConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('Configuration updated - re-initialization required');
  }

  /**
   * Gets agent statistics and status
   */
  getStatus(): {
    initialized: boolean;
    toolsRegistered: number;
    tasksRegistered: number;
    iosEnabled: boolean;
    lastExecution?: string;
  } {
    const tools = this.getRegisteredTools();
    const tasks = this.getRegisteredTasks();
    
    return {
      initialized: !!(this.costAnalysisTool && this.alertTool && this.spendMonitorTask),
      toolsRegistered: tools.length,
      tasksRegistered: tasks.length,
      iosEnabled: !!this.config.iosConfig,
      lastExecution: this.spendMonitorTask?.getStatistics().lastExecuted
    };
  }

  /**
   * Performs health check on all components
   */
  async healthCheck(): Promise<{
    overall: 'healthy' | 'degraded' | 'unhealthy';
    components: {
      costAnalysis: 'healthy' | 'unhealthy';
      alerts: 'healthy' | 'unhealthy';
      ios?: 'healthy' | 'unhealthy';
      bedrock?: 'healthy' | 'unhealthy';
      tasks: 'healthy' | 'unhealthy';
    };
    errors: string[];
  }> {
    const errors: string[] = [];
    const components: any = {};

    // Check Cost Analysis Tool
    try {
      if (this.costAnalysisTool) {
        components.costAnalysis = 'healthy';
      } else {
        components.costAnalysis = 'unhealthy';
        errors.push('Cost Analysis Tool not initialized');
      }
    } catch (error) {
      components.costAnalysis = 'unhealthy';
      errors.push(`Cost Analysis Tool error: ${error}`);
    }

    // Check Alert Tool
    try {
      if (this.alertTool) {
        components.alerts = 'healthy';
      } else {
        components.alerts = 'unhealthy';
        errors.push('Alert Tool not initialized');
      }
    } catch (error) {
      components.alerts = 'unhealthy';
      errors.push(`Alert Tool error: ${error}`);
    }

    // Check iOS Management Tool if enabled
    if (this.config.iosConfig) {
      try {
        if (this.iosManagementTool) {
          const isValidAPNS = await this.iosManagementTool.validateAPNSConfig();
          components.ios = isValidAPNS ? 'healthy' : 'unhealthy';
          if (!isValidAPNS) {
            errors.push('APNS configuration validation failed');
          }
        } else {
          components.ios = 'unhealthy';
          errors.push('iOS Management Tool not initialized');
        }
      } catch (error) {
        components.ios = 'unhealthy';
        errors.push(`iOS Management Tool error: ${error}`);
      }
    }

    // Check Bedrock AI Analysis if enabled
    if (this.config.bedrockConfig?.enabled) {
      try {
        if (this.bedrockTool) {
          const isBedrockHealthy = await this.bedrockTool.validateModelAccess();
          components.bedrock = isBedrockHealthy ? 'healthy' : 'unhealthy';
          if (!isBedrockHealthy) {
            errors.push('Bedrock model access validation failed');
          }
        } else {
          components.bedrock = 'unhealthy';
          errors.push('Bedrock Analysis Tool not initialized');
        }
      } catch (error) {
        components.bedrock = 'unhealthy';
        errors.push(`Bedrock Analysis Tool error: ${error}`);
      }
    }

    // Check Tasks
    try {
      if (this.spendMonitorTask) {
        components.tasks = 'healthy';
      } else {
        components.tasks = 'unhealthy';
        errors.push('Spend Monitor Task not initialized');
      }
    } catch (error) {
      components.tasks = 'unhealthy';
      errors.push(`Spend Monitor Task error: ${error}`);
    }

    // Determine overall health
    const unhealthyComponents = Object.values(components).filter(status => status === 'unhealthy').length;
    const overall = unhealthyComponents === 0 ? 'healthy' : 
                   unhealthyComponents <= 1 ? 'degraded' : 'unhealthy';

    return {
      overall,
      components,
      errors
    };
  }
}