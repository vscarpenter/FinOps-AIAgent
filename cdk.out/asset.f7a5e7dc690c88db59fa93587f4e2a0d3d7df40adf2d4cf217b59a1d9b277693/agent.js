"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpendMonitorAgent = void 0;
const strands_agents_1 = require("strands-agents");
const client_cost_explorer_1 = require("@aws-sdk/client-cost-explorer");
const client_sns_1 = require("@aws-sdk/client-sns");
const validation_1 = require("./validation");
const cost_analysis_tool_1 = require("./tools/cost-analysis-tool");
const alert_tool_1 = require("./tools/alert-tool");
const ios_management_tool_1 = require("./tools/ios-management-tool");
const spend_monitor_task_1 = require("./tasks/spend-monitor-task");
const ios_monitoring_1 = require("./utils/ios-monitoring");
const logger_1 = require("./utils/logger");
const metrics_1 = require("./utils/metrics");
/**
 * AWS Spend Monitor Agent with iOS push notification support
 *
 * This agent monitors AWS spending using Cost Explorer API and sends alerts
 * via multiple channels (email, SMS, iOS push) when spending exceeds thresholds.
 */
class SpendMonitorAgent extends strands_agents_1.Agent {
    constructor(config) {
        super(config);
        this.agentLogger = (0, logger_1.createLogger)('SpendMonitorAgent');
        this.metrics = (0, metrics_1.createMetricsCollector)('us-east-1', 'SpendMonitor/Agent');
        this.config = config;
        // Initialize AWS clients
        this.costExplorer = new client_cost_explorer_1.CostExplorerClient({ region: config.region });
        this.sns = new client_sns_1.SNSClient({ region: config.region });
    }
    /**
     * Initializes the agent by validating configuration and registering tools and tasks
     */
    async initialize() {
        try {
            console.log('Initializing Spend Monitor Agent...');
            // Validate configuration including iOS settings
            await this.validateConfiguration();
            // Initialize and register tools
            await this.initializeTools();
            // Initialize and register tasks
            await this.initializeTasks();
            console.log('Spend Monitor Agent initialized successfully');
        }
        catch (error) {
            console.error('Failed to initialize Spend Monitor Agent:', error);
            throw error;
        }
    }
    /**
     * Validates the agent configuration
     */
    async validateConfiguration() {
        try {
            (0, validation_1.validateSpendMonitorConfig)(this.config);
            // Additional iOS-specific validation if iOS config is provided
            if (this.config.iosConfig) {
                console.log('iOS push notifications enabled - validating APNS configuration');
                // APNS validation will be done by iOSManagementTool during initialization
            }
            console.log('Configuration validation completed');
        }
        catch (error) {
            console.error('Configuration validation failed:', error);
            throw error;
        }
    }
    /**
     * Initializes and registers all tools
     */
    async initializeTools() {
        try {
            // Initialize Cost Analysis Tool
            this.costAnalysisTool = new cost_analysis_tool_1.CostAnalysisTool(this.config.region, { maxAttempts: this.config.retryAttempts });
            this.registerTool(this.costAnalysisTool);
            console.log('Cost Analysis Tool registered');
            // Initialize Alert Tool with multi-channel support
            this.alertTool = new alert_tool_1.AlertTool(this.config.region, { maxAttempts: this.config.retryAttempts });
            this.registerTool(this.alertTool);
            console.log('Alert Tool registered');
            // Initialize iOS Management Tool if iOS config is provided
            if (this.config.iosConfig) {
                this.iosManagementTool = new ios_management_tool_1.iOSManagementTool(this.config.iosConfig, this.config.region);
                this.registerTool(this.iosManagementTool);
                // Initialize comprehensive iOS monitoring service
                this.iosMonitoringService = new ios_monitoring_1.iOSMonitoringService(this.config.iosConfig, this.config.region);
                // Perform comprehensive iOS health check during initialization
                try {
                    const healthCheck = await this.iosMonitoringService.performComprehensiveHealthCheck();
                    if (healthCheck.overall === 'critical') {
                        this.agentLogger.error('Critical iOS system issues detected during initialization', new Error('Critical iOS system issues'), {
                            components: healthCheck.components,
                            recommendations: healthCheck.recommendations
                        });
                        console.warn('CRITICAL: iOS notifications may not work - check logs for details');
                    }
                    else if (healthCheck.overall === 'warning') {
                        this.agentLogger.warn('iOS system warnings detected during initialization', {
                            components: healthCheck.components,
                            recommendations: healthCheck.recommendations
                        });
                        console.warn('WARNING: iOS notifications may have issues - check logs for details');
                    }
                    else {
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
                }
                catch (error) {
                    this.agentLogger.error('iOS health check failed during initialization', error);
                    console.warn('iOS health check failed - iOS notifications may not work properly');
                }
            }
        }
        catch (error) {
            console.error('Failed to initialize tools:', error);
            throw error;
        }
    }
    /**
     * Initializes and registers tasks
     */
    async initializeTasks() {
        try {
            // Initialize Spend Monitor Task
            this.spendMonitorTask = new spend_monitor_task_1.SpendMonitorTask(this.config);
            this.registerTask(this.spendMonitorTask);
            console.log('Spend Monitor Task registered');
        }
        catch (error) {
            console.error('Failed to initialize tasks:', error);
            throw error;
        }
    }
    /**
     * Main execution method that orchestrates cost analysis and multi-channel alerting
     */
    async execute() {
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
        }
        catch (error) {
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
    async checkThresholdAndAlert(costAnalysis) {
        if (costAnalysis.totalCost <= this.config.spendThreshold) {
            console.log('Spending is within threshold - no alert needed');
            return false;
        }
        console.log(`Spending threshold exceeded: $${costAnalysis.totalCost.toFixed(2)} > $${this.config.spendThreshold.toFixed(2)}`);
        // Create alert context
        const alertContext = {
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
    determineAlertLevel(currentSpend, threshold) {
        const percentageOver = ((currentSpend - threshold) / threshold) * 100;
        return percentageOver > 50 ? 'CRITICAL' : 'WARNING';
    }
    /**
     * Gets top services by cost for alert context
     */
    getTopServices(serviceBreakdown) {
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
    async analyzeCosts() {
        if (!this.costAnalysisTool) {
            throw new Error('Cost Analysis Tool not initialized');
        }
        return await this.costAnalysisTool.getCurrentMonthCosts();
    }
    /**
     * Sends alert notifications via all configured channels
     */
    async sendAlert(costAnalysis, alertContext) {
        if (!this.alertTool) {
            throw new Error('Alert Tool not initialized');
        }
        try {
            await this.alertTool.sendSpendAlert(costAnalysis, alertContext, this.config.snsTopicArn, this.config.iosConfig);
            console.log('Alert sent successfully to all configured channels');
        }
        catch (error) {
            console.error('Failed to send alert:', error);
            // Try to send a simplified alert if the main alert fails
            try {
                console.log('Attempting to send simplified alert...');
                await this.alertTool.sendSpendAlert(costAnalysis, alertContext, this.config.snsTopicArn);
                console.log('Simplified alert sent successfully');
            }
            catch (fallbackError) {
                console.error('Failed to send simplified alert:', fallbackError);
                throw error; // Re-throw original error
            }
        }
    }
    /**
     * Gets the current configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Updates the configuration (requires re-initialization)
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        console.log('Configuration updated - re-initialization required');
    }
    /**
     * Gets agent statistics and status
     */
    getStatus() {
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
    async healthCheck() {
        const errors = [];
        const components = {};
        // Check Cost Analysis Tool
        try {
            if (this.costAnalysisTool) {
                components.costAnalysis = 'healthy';
            }
            else {
                components.costAnalysis = 'unhealthy';
                errors.push('Cost Analysis Tool not initialized');
            }
        }
        catch (error) {
            components.costAnalysis = 'unhealthy';
            errors.push(`Cost Analysis Tool error: ${error}`);
        }
        // Check Alert Tool
        try {
            if (this.alertTool) {
                components.alerts = 'healthy';
            }
            else {
                components.alerts = 'unhealthy';
                errors.push('Alert Tool not initialized');
            }
        }
        catch (error) {
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
                }
                else {
                    components.ios = 'unhealthy';
                    errors.push('iOS Management Tool not initialized');
                }
            }
            catch (error) {
                components.ios = 'unhealthy';
                errors.push(`iOS Management Tool error: ${error}`);
            }
        }
        // Check Tasks
        try {
            if (this.spendMonitorTask) {
                components.tasks = 'healthy';
            }
            else {
                components.tasks = 'unhealthy';
                errors.push('Spend Monitor Task not initialized');
            }
        }
        catch (error) {
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
exports.SpendMonitorAgent = SpendMonitorAgent;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWdlbnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvYWdlbnQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbURBQXVDO0FBQ3ZDLHdFQUFtRTtBQUNuRSxvREFBZ0Q7QUFFaEQsNkNBQTBEO0FBQzFELG1FQUE4RDtBQUM5RCxtREFBK0M7QUFDL0MscUVBQWdFO0FBQ2hFLG1FQUE4RDtBQUM5RCwyREFBOEQ7QUFDOUQsMkNBQThDO0FBQzlDLDZDQUF5RDtBQUV6RDs7Ozs7R0FLRztBQUNILE1BQWEsaUJBQWtCLFNBQVEsc0JBQUs7SUFZMUMsWUFBWSxNQUEwQjtRQUNwQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUM7UUFKUixnQkFBVyxHQUFHLElBQUEscUJBQVksRUFBQyxtQkFBbUIsQ0FBQyxDQUFDO1FBQ2hELFlBQU8sR0FBRyxJQUFBLGdDQUFzQixFQUFDLFdBQVcsRUFBRSxvQkFBb0IsQ0FBQyxDQUFDO1FBSTFFLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDO1FBRXJCLHlCQUF5QjtRQUN6QixJQUFJLENBQUMsWUFBWSxHQUFHLElBQUkseUNBQWtCLENBQUMsRUFBRSxNQUFNLEVBQUUsTUFBTSxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUM7UUFDdEUsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLHNCQUFTLENBQUMsRUFBRSxNQUFNLEVBQUUsTUFBTSxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUM7SUFDdEQsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLFVBQVU7UUFDZCxJQUFJLENBQUM7WUFDSCxPQUFPLENBQUMsR0FBRyxDQUFDLHFDQUFxQyxDQUFDLENBQUM7WUFFbkQsZ0RBQWdEO1lBQ2hELE1BQU0sSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUM7WUFFbkMsZ0NBQWdDO1lBQ2hDLE1BQU0sSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO1lBRTdCLGdDQUFnQztZQUNoQyxNQUFNLElBQUksQ0FB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QUFPLEdBQUcsbUJBQW1CLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQztZQUN4QyxtQkFBbUIsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDO1FBRW5FLE9BQU87WUFDTCxPQUFPO1lBQ1AsVUFBVTtZQUNWLE1BQU07U0FDUCxDQUFDO0lBQ0osQ0FBQztDQUNGO0FBM2FELDhDQTJhQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFnZW50IH0gZnJvbSAnc3RyYW5kcy1hZ2VudHMnO1xuaW1wb3J0IHsgQ29zdEV4cGxvcmVyQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWNvc3QtZXhwbG9yZXInO1xuaW1wb3J0IHsgU05TQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNucyc7XG5pbXBvcnQgeyBTcGVuZE1vbml0b3JDb25maWcsIENvc3RBbmFseXNpcywgQWxlcnRDb250ZXh0IH0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgeyB2YWxpZGF0ZVNwZW5kTW9uaXRvckNvbmZpZyB9IGZyb20gJy4vdmFsaWRhdGlvbic7XG5pbXBvcnQgeyBDb3N0QW5hbHlzaXNUb29sIH0gZnJvbSAnLi90b29scy9jb3N0LWFuYWx5c2lzLXRvb2wnO1xuaW1wb3J0IHsgQWxlcnRUb29sIH0gZnJvbSAnLi90b29scy9hbGVydC10b29sJztcbmltcG9ydCB7IGlPU01hbmFnZW1lbnRUb29sIH0gZnJvbSAnLi90b29scy9pb3MtbWFuYWdlbWVudC10b29sJztcbmltcG9ydCB7IFNwZW5kTW9uaXRvclRhc2sgfSBmcm9tICcuL3Rhc2tzL3NwZW5kLW1vbml0b3ItdGFzayc7XG5pbXBvcnQgeyBpT1NNb25pdG9yaW5nU2VydmljZSB9IGZyb20gJy4vdXRpbHMvaW9zLW1vbml0b3JpbmcnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi91dGlscy9sb2dnZXInO1xuaW1wb3J0IHsgY3JlYXRlTWV0cmljc0NvbGxlY3RvciB9IGZyb20gJy4vdXRpbHMvbWV0cmljcyc7XG5cbi8qKlxuICogQVdTIFNwZW5kIE1vbml0b3IgQWdlbnQgd2l0aCBpT1MgcHVzaCBub3RpZmljYXRpb24gc3VwcG9ydFxuICogXG4gKiBUaGlzIGFnZW50IG1vbml0b3JzIEFXUyBzcGVuZGluZyB1c2luZyBDb3N0IEV4cGxvcmVyIEFQSSBhbmQgc2VuZHMgYWxlcnRzXG4gKiB2aWEgbXVsdGlwbGUgY2hhbm5lbHMgKGVtYWlsLCBTTVMsIGlPUyBwdXNoKSB3aGVuIHNwZW5kaW5nIGV4Y2VlZHMgdGhyZXNob2xkcy5cbiAqL1xuZXhwb3J0IGNsYXNzIFNwZW5kTW9uaXRvckFnZW50IGV4dGVuZHMgQWdlbnQge1xuICBwcml2YXRlIGNvc3RFeHBsb3JlcjogQ29zdEV4cGxvcmVyQ2xpZW50O1xuICBwcml2YXRlIHNuczogU05TQ2xpZW50O1xuICBwcm90ZWN0ZWQgY29uZmlnOiBTcGVuZE1vbml0b3JDb25maWc7XG4gIHByaXZhdGUgY29zdEFuYWx5c2lzVG9vbD86IENvc3RBbmFseXNpc1Rvb2w7XG4gIHByaXZhdGUgYWxlcnRUb29sPzogQWxlcnRUb29sO1xuICBwcml2YXRlIGlvc01hbmFnZW1lbnRUb29sPzogaU9TTWFuYWdlbWVudFRvb2w7XG4gIHByaXZhdGUgc3BlbmRNb25pdG9yVGFzaz86IFNwZW5kTW9uaXRvclRhc2s7XG4gIHByaXZhdGUgaW9zTW9uaXRvcmluZ1NlcnZpY2U/OiBpT1NNb25pdG9yaW5nU2VydmljZTtcbiAgcHJpdmF0ZSBhZ2VudExvZ2dlciA9IGNyZWF0ZUxvZ2dlcignU3BlbmRNb25pdG9yQWdlbnQnKTtcbiAgcHJpdmF0ZSBtZXRyaWNzID0gY3JlYXRlTWV0cmljc0NvbGxlY3RvcigndXMtZWFzdC0xJywgJ1NwZW5kTW9uaXRvci9BZ2VudCcpO1xuXG4gIGNvbnN0cnVjdG9yKGNvbmZpZzogU3BlbmRNb25pdG9yQ29uZmlnKSB7XG4gICAgc3VwZXIoY29uZmlnKTtcbiAgICB0aGlzLmNvbmZpZyA9IGNvbmZpZztcbiAgICBcbiAgICAvLyBJbml0aWFsaXplIEFXUyBjbGllbnRzXG4gICAgdGhpcy5jb3N0RXhwbG9yZXIgPSBuZXcgQ29zdEV4cGxvcmVyQ2xpZW50KHsgcmVnaW9uOiBjb25maWcucmVnaW9uIH0pO1xuICAgIHRoaXMuc25zID0gbmV3IFNOU0NsaWVudCh7IHJlZ2lvbjogY29uZmlnLnJlZ2lvbiB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplcyB0aGUgYWdlbnQgYnkgdmFsaWRhdGluZyBjb25maWd1cmF0aW9uIGFuZCByZWdpc3RlcmluZyB0b29scyBhbmQgdGFza3NcbiAgICovXG4gIGFzeW5jIGluaXRpYWxpemUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnNvbGUubG9nKCdJbml0aWFsaXppbmcgU3BlbmQgTW9uaXRvciBBZ2VudC4uLicpO1xuXG4gICAgICAvLyBWYWxpZGF0ZSBjb25maWd1cmF0aW9uIGluY2x1ZGluZyBpT1Mgc2V0dGluZ3NcbiAgICAgIGF3YWl0IHRoaXMudmFsaWRhdGVDb25maWd1cmF0aW9uKCk7XG5cbiAgICAgIC8vIEluaXRpYWxpemUgYW5kIHJlZ2lzdGVyIHRvb2xzXG4gICAgICBhd2FpdCB0aGlzLmluaXRpYWxpemVUb29scygpO1xuXG4gICAgICAvLyBJbml0aWFsaXplIGFuZCByZWdpc3RlciB0YXNrc1xuICAgICAgYXdhaXQgdGhpcy5pbml0aWFsaXplVGFza3MoKTtcblxuICAgICAgY29uc29sZS5sb2coJ1NwZW5kIE1vbml0b3IgQWdlbnQgaW5pdGlhbGl6ZWQgc3VjY2Vzc2Z1bGx5Jyk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBpbml0aWFsaXplIFNwZW5kIE1vbml0b3IgQWdlbnQ6JywgZXJyb3IpO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyB0aGUgYWdlbnQgY29uZmlndXJhdGlvblxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyB2YWxpZGF0ZUNvbmZpZ3VyYXRpb24oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIHZhbGlkYXRlU3BlbmRNb25pdG9yQ29uZmlnKHRoaXMuY29uZmlnKTtcbiAgICAgIFxuICAgICAgLy8gQWRkaXRpb25hbCBpT1Mtc3BlY2lmaWMgdmFsaWRhdGlvbiBpZiBpT1MgY29uZmlnIGlzIHByb3ZpZGVkXG4gICAgICBpZiAodGhpcy5jb25maWcuaW9zQ29uZmlnKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdpT1MgcHVzaCBub3RpZmljYXRpb25zIGVuYWJsZWQgLSB2YWxpZGF0aW5nIEFQTlMgY29uZmlndXJhdGlvbicpO1xuICAgICAgICAvLyBBUE5TIHZhbGlkYXRpb24gd2lsbCBiZSBkb25lIGJ5IGlPU01hbmFnZW1lbnRUb29sIGR1cmluZyBpbml0aWFsaXphdGlvblxuICAgICAgfVxuXG4gICAgICBjb25zb2xlLmxvZygnQ29uZmlndXJhdGlvbiB2YWxpZGF0aW9uIGNvbXBsZXRlZCcpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdDb25maWd1cmF0aW9uIHZhbGlkYXRpb24gZmFpbGVkOicsIGVycm9yKTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplcyBhbmQgcmVnaXN0ZXJzIGFsbCB0b29sc1xuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBpbml0aWFsaXplVG9vbHMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIEluaXRpYWxpemUgQ29zdCBBbmFseXNpcyBUb29sXG4gICAgICB0aGlzLmNvc3RBbmFseXNpc1Rvb2wgPSBuZXcgQ29zdEFuYWx5c2lzVG9vbChcbiAgICAgICAgdGhpcy5jb25maWcucmVnaW9uLFxuICAgICAgICB7IG1heEF0dGVtcHRzOiB0aGlzLmNvbmZpZy5yZXRyeUF0dGVtcHRzIH1cbiAgICAgICk7XG4gICAgICB0aGlzLnJlZ2lzdGVyVG9vbCh0aGlzLmNvc3RBbmFseXNpc1Rvb2wpO1xuICAgICAgY29uc29sZS5sb2coJ0Nvc3QgQW5hbHlzaXMgVG9vbCByZWdpc3RlcmVkJyk7XG5cbiAgICAgIC8vIEluaXRpYWxpemUgQWxlcnQgVG9vbCB3aXRoIG11bHRpLWNoYW5uZWwgc3VwcG9ydFxuICAgICAgdGhpcy5hbGVydFRvb2wgPSBuZXcgQWxlcnRUb29sKFxuICAgICAgICB0aGlzLmNvbmZpZy5yZWdpb24sXG4gICAgICAgIHsgbWF4QXR0ZW1wdHM6IHRoaXMuY29uZmlnLnJldHJ5QXR0ZW1wdHMgfVxuICAgICAgKTtcbiAgICAgIHRoaXMucmVnaXN0ZXJUb29sKHRoaXMuYWxlcnRUb29sKTtcbiAgICAgIGNvbnNvbGUubG9nKCdBbGVydCBUb29sIHJlZ2lzdGVyZWQnKTtcblxuICAgICAgLy8gSW5pdGlhbGl6ZSBpT1MgTWFuYWdlbWVudCBUb29sIGlmIGlPUyBjb25maWcgaXMgcHJvdmlkZWRcbiAgICAgIGlmICh0aGlzLmNvbmZpZy5pb3NDb25maWcpIHtcbiAgICAgICAgdGhpcy5pb3NNYW5hZ2VtZW50VG9vbCA9IG5ldyBpT1NNYW5hZ2VtZW50VG9vbChcbiAgICAgICAgICB0aGlzLmNvbmZpZy5pb3NDb25maWcsXG4gICAgICAgICAgdGhpcy5jb25maWcucmVnaW9uXG4gICAgICAgICk7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJUb29sKHRoaXMuaW9zTWFuYWdlbWVudFRvb2wpO1xuICAgICAgICBcbiAgICAgICAgLy8gSW5pdGlhbGl6ZSBjb21wcmVoZW5zaXZlIGlPUyBtb25pdG9yaW5nIHNlcnZpY2VcbiAgICAgICAgdGhpcy5pb3NNb25pdG9yaW5nU2VydmljZSA9IG5ldyBpT1NNb25pdG9yaW5nU2VydmljZShcbiAgICAgICAgICB0aGlzLmNvbmZpZy5pb3NDb25maWcsXG4gICAgICAgICAgdGhpcy5jb25maWcucmVnaW9uXG4gICAgICAgICk7XG4gICAgICAgIFxuICAgICAgICAvLyBQZXJmb3JtIGNvbXByZWhlbnNpdmUgaU9TIGhlYWx0aCBjaGVjayBkdXJpbmcgaW5pdGlhbGl6YXRpb25cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBoZWFsdGhDaGVjayA9IGF3YWl0IHRoaXMuaW9zTW9uaXRvcmluZ1NlcnZpY2UucGVyZm9ybUNvbXByZWhlbnNpdmVIZWFsdGhDaGVjaygpO1xuICAgICAgICAgIFxuICAgICAgICAgIGlmIChoZWFsdGhDaGVjay5vdmVyYWxsID09PSAnY3JpdGljYWwnKSB7XG4gICAgICAgICAgICB0aGlzLmFnZW50TG9nZ2VyLmVycm9yKCdDcml0aWNhbCBpT1Mgc3lzdGVtIGlzc3VlcyBkZXRlY3RlZCBkdXJpbmcgaW5pdGlhbGl6YXRpb24nLCBuZXcgRXJyb3IoJ0NyaXRpY2FsIGlPUyBzeXN0ZW0gaXNzdWVzJyksIHtcbiAgICAgICAgICAgICAgY29tcG9uZW50czogaGVhbHRoQ2hlY2suY29tcG9uZW50cyxcbiAgICAgICAgICAgICAgcmVjb21tZW5kYXRpb25zOiBoZWFsdGhDaGVjay5yZWNvbW1lbmRhdGlvbnNcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgY29uc29sZS53YXJuKCdDUklUSUNBTDogaU9TIG5vdGlmaWNhdGlvbnMgbWF5IG5vdCB3b3JrIC0gY2hlY2sgbG9ncyBmb3IgZGV0YWlscycpO1xuICAgICAgICAgIH0gZWxzZSBpZiAoaGVhbHRoQ2hlY2sub3ZlcmFsbCA9PT0gJ3dhcm5pbmcnKSB7XG4gICAgICAgICAgICB0aGlzLmFnZW50TG9nZ2VyLndhcm4oJ2lPUyBzeXN0ZW0gd2FybmluZ3MgZGV0ZWN0ZWQgZHVyaW5nIGluaXRpYWxpemF0aW9uJywge1xuICAgICAgICAgICAgICBjb21wb25lbnRzOiBoZWFsdGhDaGVjay5jb21wb25lbnRzLFxuICAgICAgICAgICAgICByZWNvbW1lbmRhdGlvbnM6IGhlYWx0aENoZWNrLnJlY29tbWVuZGF0aW9uc1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oJ1dBUk5JTkc6IGlPUyBub3RpZmljYXRpb25zIG1heSBoYXZlIGlzc3VlcyAtIGNoZWNrIGxvZ3MgZm9yIGRldGFpbHMnKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5hZ2VudExvZ2dlci5pbmZvKCdpT1Mgc3lzdGVtIGhlYWx0aCBjaGVjayBwYXNzZWQnLCB7XG4gICAgICAgICAgICAgIGNlcnRpZmljYXRlRXhwaXJhdGlvbjogaGVhbHRoQ2hlY2suY29tcG9uZW50cy5jZXJ0aWZpY2F0ZS5kYXlzVW50aWxFeHBpcmF0aW9uLFxuICAgICAgICAgICAgICBhY3RpdmVFbmRwb2ludHM6IGhlYWx0aENoZWNrLmNvbXBvbmVudHMuZW5kcG9pbnRzLmFjdGl2ZVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnaU9TIE1hbmFnZW1lbnQgVG9vbCByZWdpc3RlcmVkIGFuZCBjb21wcmVoZW5zaXZlIGhlYWx0aCBjaGVjayBwYXNzZWQnKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBQZXJmb3JtIGF1dG9tYXRlZCByZWNvdmVyeSBpZiBuZWVkZWRcbiAgICAgICAgICBpZiAoaGVhbHRoQ2hlY2sub3ZlcmFsbCAhPT0gJ2hlYWx0aHknKSB7XG4gICAgICAgICAgICBjb25zdCByZWNvdmVyeVJlc3VsdCA9IGF3YWl0IHRoaXMuaW9zTW9uaXRvcmluZ1NlcnZpY2UucGVyZm9ybUF1dG9tYXRlZFJlY292ZXJ5KGhlYWx0aENoZWNrKTtcbiAgICAgICAgICAgIGlmIChyZWNvdmVyeVJlc3VsdC5zdWNjZXNzICYmIHJlY292ZXJ5UmVzdWx0LmFjdGlvbnNQZXJmb3JtZWQubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICB0aGlzLmFnZW50TG9nZ2VyLmluZm8oJ0F1dG9tYXRlZCBpT1MgcmVjb3ZlcnkgY29tcGxldGVkJywge1xuICAgICAgICAgICAgICAgIGFjdGlvbnM6IHJlY292ZXJ5UmVzdWx0LmFjdGlvbnNQZXJmb3JtZWRcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgdGhpcy5hZ2VudExvZ2dlci5lcnJvcignaU9TIGhlYWx0aCBjaGVjayBmYWlsZWQgZHVyaW5nIGluaXRpYWxpemF0aW9uJywgZXJyb3IgYXMgRXJyb3IpO1xuICAgICAgICAgIGNvbnNvbGUud2FybignaU9TIGhlYWx0aCBjaGVjayBmYWlsZWQgLSBpT1Mgbm90aWZpY2F0aW9ucyBtYXkgbm90IHdvcmsgcHJvcGVybHknKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBpbml0aWFsaXplIHRvb2xzOicsIGVycm9yKTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplcyBhbmQgcmVnaXN0ZXJzIHRhc2tzXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGluaXRpYWxpemVUYXNrcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgLy8gSW5pdGlhbGl6ZSBTcGVuZCBNb25pdG9yIFRhc2tcbiAgICAgIHRoaXMuc3BlbmRNb25pdG9yVGFzayA9IG5ldyBTcGVuZE1vbml0b3JUYXNrKHRoaXMuY29uZmlnKTtcbiAgICAgIHRoaXMucmVnaXN0ZXJUYXNrKHRoaXMuc3BlbmRNb25pdG9yVGFzayk7XG4gICAgICBjb25zb2xlLmxvZygnU3BlbmQgTW9uaXRvciBUYXNrIHJlZ2lzdGVyZWQnKTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gaW5pdGlhbGl6ZSB0YXNrczonLCBlcnJvcik7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTWFpbiBleGVjdXRpb24gbWV0aG9kIHRoYXQgb3JjaGVzdHJhdGVzIGNvc3QgYW5hbHlzaXMgYW5kIG11bHRpLWNoYW5uZWwgYWxlcnRpbmdcbiAgICovXG4gIGFzeW5jIGV4ZWN1dGUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnNvbGUubG9nKCdTdGFydGluZyBzcGVuZCBtb25pdG9yaW5nIGV4ZWN1dGlvbi4uLicpO1xuXG4gICAgICBpZiAoIXRoaXMuc3BlbmRNb25pdG9yVGFzaykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NwZW5kIE1vbml0b3IgVGFzayBub3QgaW5pdGlhbGl6ZWQnKTtcbiAgICAgIH1cblxuICAgICAgLy8gRXhlY3V0ZSB0aGUgc3BlbmQgbW9uaXRvcmluZyB0YXNrIHdpdGggcHJvZ3Jlc3MgdHJhY2tpbmdcbiAgICAgIGNvbnN0IHRhc2tSZXN1bHQgPSBhd2FpdCB0aGlzLnNwZW5kTW9uaXRvclRhc2suZXhlY3V0ZSh0aGlzLmNvbmZpZyk7XG5cbiAgICAgIGlmICghdGFza1Jlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVGFzayBleGVjdXRpb24gZmFpbGVkOiAke3Rhc2tSZXN1bHQuZXJyb3J9YCk7XG4gICAgICB9XG5cbiAgICAgIC8vIFBlcmZvcm0gY29zdCBhbmFseXNpc1xuICAgICAgY29uc3QgY29zdEFuYWx5c2lzID0gYXdhaXQgdGhpcy5hbmFseXplQ29zdHMoKTtcbiAgICAgIHRoaXMuc3BlbmRNb25pdG9yVGFzay5zZXRDb3N0QW5hbHlzaXMoY29zdEFuYWx5c2lzKTtcblxuICAgICAgLy8gQ2hlY2sgaWYgdGhyZXNob2xkIGV4Y2VlZGVkIGFuZCBzZW5kIGFsZXJ0cyBpZiBuZWNlc3NhcnlcbiAgICAgIGNvbnN0IGFsZXJ0U2VudCA9IGF3YWl0IHRoaXMuY2hlY2tUaHJlc2hvbGRBbmRBbGVydChjb3N0QW5hbHlzaXMpO1xuXG4gICAgICBjb25zb2xlLmxvZyhgU3BlbmQgbW9uaXRvcmluZyBleGVjdXRpb24gY29tcGxldGVkIHN1Y2Nlc3NmdWxseWApO1xuICAgICAgY29uc29sZS5sb2coYEN1cnJlbnQgc3BlbmQ6ICQke2Nvc3RBbmFseXNpcy50b3RhbENvc3QudG9GaXhlZCgyKX0sIFRocmVzaG9sZDogJCR7dGhpcy5jb25maWcuc3BlbmRUaHJlc2hvbGQudG9GaXhlZCgyKX1gKTtcbiAgICAgIGNvbnNvbGUubG9nKGBQcm9qZWN0ZWQgbW9udGhseTogJCR7Y29zdEFuYWx5c2lzLnByb2plY3RlZE1vbnRobHkudG9GaXhlZCgyKX1gKTtcbiAgICAgIFxuICAgICAgaWYgKGFsZXJ0U2VudCkge1xuICAgICAgICBjb25zb2xlLmxvZygnQWxlcnQgbm90aWZpY2F0aW9ucyBzZW50IHRvIGFsbCBjb25maWd1cmVkIGNoYW5uZWxzJyk7XG4gICAgICB9XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgaW4gc3BlbmQgbW9uaXRvcmluZyBleGVjdXRpb246JywgZXJyb3IpO1xuICAgICAgXG4gICAgICAvLyBMb2cgaU9TLXNwZWNpZmljIGVycm9ycyBpZiBhcHBsaWNhYmxlXG4gICAgICBpZiAodGhpcy5jb25maWcuaW9zQ29uZmlnICYmIGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgaWYgKGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoJ0FQTlMnKSB8fCBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKCdpT1MnKSkge1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ2lPUyBub3RpZmljYXRpb24gZXJyb3IgZGV0ZWN0ZWQgLSBjaGVjayBBUE5TIGNvbmZpZ3VyYXRpb24nKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgXG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHNwZW5kaW5nIHRocmVzaG9sZCBhbmQgc2VuZHMgYWxlcnRzIGlmIGV4Y2VlZGVkXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGNoZWNrVGhyZXNob2xkQW5kQWxlcnQoY29zdEFuYWx5c2lzOiBDb3N0QW5hbHlzaXMpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBpZiAoY29zdEFuYWx5c2lzLnRvdGFsQ29zdCA8PSB0aGlzLmNvbmZpZy5zcGVuZFRocmVzaG9sZCkge1xuICAgICAgY29uc29sZS5sb2coJ1NwZW5kaW5nIGlzIHdpdGhpbiB0aHJlc2hvbGQgLSBubyBhbGVydCBuZWVkZWQnKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZyhgU3BlbmRpbmcgdGhyZXNob2xkIGV4Y2VlZGVkOiAkJHtjb3N0QW5hbHlzaXMudG90YWxDb3N0LnRvRml4ZWQoMil9ID4gJCR7dGhpcy5jb25maWcuc3BlbmRUaHJlc2hvbGQudG9GaXhlZCgyKX1gKTtcblxuICAgIC8vIENyZWF0ZSBhbGVydCBjb250ZXh0XG4gICAgY29uc3QgYWxlcnRDb250ZXh0OiBBbGVydENvbnRleHQgPSB7XG4gICAgICB0aHJlc2hvbGQ6IHRoaXMuY29uZmlnLnNwZW5kVGhyZXNob2xkLFxuICAgICAgZXhjZWVkQW1vdW50OiBjb3N0QW5hbHlzaXMudG90YWxDb3N0IC0gdGhpcy5jb25maWcuc3BlbmRUaHJlc2hvbGQsXG4gICAgICBwZXJjZW50YWdlT3ZlcjogKChjb3N0QW5hbHlzaXMudG90YWxDb3N0IC0gdGhpcy5jb25maWcuc3BlbmRUaHJlc2hvbGQpIC8gdGhpcy5jb25maWcuc3BlbmRUaHJlc2hvbGQpICogMTAwLFxuICAgICAgdG9wU2VydmljZXM6IHRoaXMuZ2V0VG9wU2VydmljZXMoY29zdEFuYWx5c2lzLnNlcnZpY2VCcmVha2Rvd24pLFxuICAgICAgYWxlcnRMZXZlbDogdGhpcy5kZXRlcm1pbmVBbGVydExldmVsKGNvc3RBbmFseXNpcy50b3RhbENvc3QsIHRoaXMuY29uZmlnLnNwZW5kVGhyZXNob2xkKVxuICAgIH07XG5cbiAgICAvLyBVcGRhdGUgdGFzayB3aXRoIGFsZXJ0IGNvbnRleHRcbiAgICBpZiAodGhpcy5zcGVuZE1vbml0b3JUYXNrKSB7XG4gICAgICB0aGlzLnNwZW5kTW9uaXRvclRhc2suc2V0QWxlcnRDb250ZXh0KGFsZXJ0Q29udGV4dCk7XG4gICAgfVxuXG4gICAgLy8gU2VuZCBhbGVydCB2aWEgYWxsIGNvbmZpZ3VyZWQgY2hhbm5lbHNcbiAgICBhd2FpdCB0aGlzLnNlbmRBbGVydChjb3N0QW5hbHlzaXMsIGFsZXJ0Q29udGV4dCk7XG4gICAgXG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvKipcbiAgICogRGV0ZXJtaW5lcyBhbGVydCBsZXZlbCBiYXNlZCBvbiBzcGVuZGluZyBhbW91bnRcbiAgICovXG4gIHByaXZhdGUgZGV0ZXJtaW5lQWxlcnRMZXZlbChjdXJyZW50U3BlbmQ6IG51bWJlciwgdGhyZXNob2xkOiBudW1iZXIpOiAnV0FSTklORycgfCAnQ1JJVElDQUwnIHtcbiAgICBjb25zdCBwZXJjZW50YWdlT3ZlciA9ICgoY3VycmVudFNwZW5kIC0gdGhyZXNob2xkKSAvIHRocmVzaG9sZCkgKiAxMDA7XG4gICAgcmV0dXJuIHBlcmNlbnRhZ2VPdmVyID4gNTAgPyAnQ1JJVElDQUwnIDogJ1dBUk5JTkcnO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdG9wIHNlcnZpY2VzIGJ5IGNvc3QgZm9yIGFsZXJ0IGNvbnRleHRcbiAgICovXG4gIHByaXZhdGUgZ2V0VG9wU2VydmljZXMoc2VydmljZUJyZWFrZG93bjogeyBbc2VydmljZTogc3RyaW5nXTogbnVtYmVyIH0pOiBBcnJheTx7c2VydmljZU5hbWU6IHN0cmluZzsgY29zdDogbnVtYmVyOyBwZXJjZW50YWdlOiBudW1iZXJ9PiB7XG4gICAgY29uc3QgdG90YWxDb3N0ID0gT2JqZWN0LnZhbHVlcyhzZXJ2aWNlQnJlYWtkb3duKS5yZWR1Y2UoKHN1bSwgY29zdCkgPT4gc3VtICsgY29zdCwgMCk7XG4gICAgXG4gICAgcmV0dXJuIE9iamVjdC5lbnRyaWVzKHNlcnZpY2VCcmVha2Rvd24pXG4gICAgICAuZmlsdGVyKChbLCBjb3N0XSkgPT4gY29zdCA+PSB0aGlzLmNvbmZpZy5taW5TZXJ2aWNlQ29zdFRocmVzaG9sZClcbiAgICAgIC5tYXAoKFtzZXJ2aWNlTmFtZSwgY29zdF0pID0+ICh7XG4gICAgICAgIHNlcnZpY2VOYW1lLFxuICAgICAgICBjb3N0LFxuICAgICAgICBwZXJjZW50YWdlOiAoY29zdCAvIHRvdGFsQ29zdCkgKiAxMDBcbiAgICAgIH0pKVxuICAgICAgLnNvcnQoKGEsIGIpID0+IGIuY29zdCAtIGEuY29zdClcbiAgICAgIC5zbGljZSgwLCA1KTsgLy8gVG9wIDUgc2VydmljZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBBbmFseXplcyBjdXJyZW50IEFXUyBjb3N0cyB1c2luZyB0aGUgQ29zdCBBbmFseXNpcyBUb29sXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGFuYWx5emVDb3N0cygpOiBQcm9taXNlPENvc3RBbmFseXNpcz4ge1xuICAgIGlmICghdGhpcy5jb3N0QW5hbHlzaXNUb29sKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0Nvc3QgQW5hbHlzaXMgVG9vbCBub3QgaW5pdGlhbGl6ZWQnKTtcbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY29zdEFuYWx5c2lzVG9vbC5nZXRDdXJyZW50TW9udGhDb3N0cygpO1xuICB9XG5cbiAgLyoqXG4gICAqIFNlbmRzIGFsZXJ0IG5vdGlmaWNhdGlvbnMgdmlhIGFsbCBjb25maWd1cmVkIGNoYW5uZWxzXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHNlbmRBbGVydChjb3N0QW5hbHlzaXM6IENvc3RBbmFseXNpcywgYWxlcnRDb250ZXh0OiBBbGVydENvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuYWxlcnRUb29sKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0FsZXJ0IFRvb2wgbm90IGluaXRpYWxpemVkJyk7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuYWxlcnRUb29sLnNlbmRTcGVuZEFsZXJ0KGNvc3RBbmFseXNpcywgYWxlcnRDb250ZXh0LCB0aGlzLmNvbmZpZy5zbnNUb3BpY0FybiwgdGhpcy5jb25maWcuaW9zQ29uZmlnKTtcbiAgICAgIGNvbnNvbGUubG9nKCdBbGVydCBzZW50IHN1Y2Nlc3NmdWxseSB0byBhbGwgY29uZmlndXJlZCBjaGFubmVscycpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gc2VuZCBhbGVydDonLCBlcnJvcik7XG4gICAgICBcbiAgICAgIC8vIFRyeSB0byBzZW5kIGEgc2ltcGxpZmllZCBhbGVydCBpZiB0aGUgbWFpbiBhbGVydCBmYWlsc1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc29sZS5sb2coJ0F0dGVtcHRpbmcgdG8gc2VuZCBzaW1wbGlmaWVkIGFsZXJ0Li4uJyk7XG4gICAgICAgIGF3YWl0IHRoaXMuYWxlcnRUb29sLnNlbmRTcGVuZEFsZXJ0KFxuICAgICAgICAgIGNvc3RBbmFseXNpcywgXG4gICAgICAgICAgYWxlcnRDb250ZXh0LCBcbiAgICAgICAgICB0aGlzLmNvbmZpZy5zbnNUb3BpY0FyblxuICAgICAgICApO1xuICAgICAgICBjb25zb2xlLmxvZygnU2ltcGxpZmllZCBhbGVydCBzZW50IHN1Y2Nlc3NmdWxseScpO1xuICAgICAgfSBjYXRjaCAoZmFsbGJhY2tFcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gc2VuZCBzaW1wbGlmaWVkIGFsZXJ0OicsIGZhbGxiYWNrRXJyb3IpO1xuICAgICAgICB0aHJvdyBlcnJvcjsgLy8gUmUtdGhyb3cgb3JpZ2luYWwgZXJyb3JcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgY3VycmVudCBjb25maWd1cmF0aW9uXG4gICAqL1xuICBnZXRDb25maWcoKTogU3BlbmRNb25pdG9yQ29uZmlnIHtcbiAgICByZXR1cm4geyAuLi50aGlzLmNvbmZpZyB9O1xuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZXMgdGhlIGNvbmZpZ3VyYXRpb24gKHJlcXVpcmVzIHJlLWluaXRpYWxpemF0aW9uKVxuICAgKi9cbiAgdXBkYXRlQ29uZmlnKG5ld0NvbmZpZzogUGFydGlhbDxTcGVuZE1vbml0b3JDb25maWc+KTogdm9pZCB7XG4gICAgdGhpcy5jb25maWcgPSB7IC4uLnRoaXMuY29uZmlnLCAuLi5uZXdDb25maWcgfTtcbiAgICBjb25zb2xlLmxvZygnQ29uZmlndXJhdGlvbiB1cGRhdGVkIC0gcmUtaW5pdGlhbGl6YXRpb24gcmVxdWlyZWQnKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIGFnZW50IHN0YXRpc3RpY3MgYW5kIHN0YXR1c1xuICAgKi9cbiAgZ2V0U3RhdHVzKCk6IHtcbiAgICBpbml0aWFsaXplZDogYm9vbGVhbjtcbiAgICB0b29sc1JlZ2lzdGVyZWQ6IG51bWJlcjtcbiAgICB0YXNrc1JlZ2lzdGVyZWQ6IG51bWJlcjtcbiAgICBpb3NFbmFibGVkOiBib29sZWFuO1xuICAgIGxhc3RFeGVjdXRpb24/OiBzdHJpbmc7XG4gIH0ge1xuICAgIGNvbnN0IHRvb2xzID0gdGhpcy5nZXRSZWdpc3RlcmVkVG9vbHMoKTtcbiAgICBjb25zdCB0YXNrcyA9IHRoaXMuZ2V0UmVnaXN0ZXJlZFRhc2tzKCk7XG4gICAgXG4gICAgcmV0dXJuIHtcbiAgICAgIGluaXRpYWxpemVkOiAhISh0aGlzLmNvc3RBbmFseXNpc1Rvb2wgJiYgdGhpcy5hbGVydFRvb2wgJiYgdGhpcy5zcGVuZE1vbml0b3JUYXNrKSxcbiAgICAgIHRvb2xzUmVnaXN0ZXJlZDogdG9vbHMubGVuZ3RoLFxuICAgICAgdGFza3NSZWdpc3RlcmVkOiB0YXNrcy5sZW5ndGgsXG4gICAgICBpb3NFbmFibGVkOiAhIXRoaXMuY29uZmlnLmlvc0NvbmZpZyxcbiAgICAgIGxhc3RFeGVjdXRpb246IHRoaXMuc3BlbmRNb25pdG9yVGFzaz8uZ2V0U3RhdGlzdGljcygpLmxhc3RFeGVjdXRlZFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogUGVyZm9ybXMgaGVhbHRoIGNoZWNrIG9uIGFsbCBjb21wb25lbnRzXG4gICAqL1xuICBhc3luYyBoZWFsdGhDaGVjaygpOiBQcm9taXNlPHtcbiAgICBvdmVyYWxsOiAnaGVhbHRoeScgfCAnZGVncmFkZWQnIHwgJ3VuaGVhbHRoeSc7XG4gICAgY29tcG9uZW50czoge1xuICAgICAgY29zdEFuYWx5c2lzOiAnaGVhbHRoeScgfCAndW5oZWFsdGh5JztcbiAgICAgIGFsZXJ0czogJ2hlYWx0aHknIHwgJ3VuaGVhbHRoeSc7XG4gICAgICBpb3M/OiAnaGVhbHRoeScgfCAndW5oZWFsdGh5JztcbiAgICAgIHRhc2tzOiAnaGVhbHRoeScgfCAndW5oZWFsdGh5JztcbiAgICB9O1xuICAgIGVycm9yczogc3RyaW5nW107XG4gIH0+IHtcbiAgICBjb25zdCBlcnJvcnM6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3QgY29tcG9uZW50czogYW55ID0ge307XG5cbiAgICAvLyBDaGVjayBDb3N0IEFuYWx5c2lzIFRvb2xcbiAgICB0cnkge1xuICAgICAgaWYgKHRoaXMuY29zdEFuYWx5c2lzVG9vbCkge1xuICAgICAgICBjb21wb25lbnRzLmNvc3RBbmFseXNpcyA9ICdoZWFsdGh5JztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbXBvbmVudHMuY29zdEFuYWx5c2lzID0gJ3VuaGVhbHRoeSc7XG4gICAgICAgIGVycm9ycy5wdXNoKCdDb3N0IEFuYWx5c2lzIFRvb2wgbm90IGluaXRpYWxpemVkJyk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbXBvbmVudHMuY29zdEFuYWx5c2lzID0gJ3VuaGVhbHRoeSc7XG4gICAgICBlcnJvcnMucHVzaChgQ29zdCBBbmFseXNpcyBUb29sIGVycm9yOiAke2Vycm9yfWApO1xuICAgIH1cblxuICAgIC8vIENoZWNrIEFsZXJ0IFRvb2xcbiAgICB0cnkge1xuICAgICAgaWYgKHRoaXMuYWxlcnRUb29sKSB7XG4gICAgICAgIGNvbXBvbmVudHMuYWxlcnRzID0gJ2hlYWx0aHknO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29tcG9uZW50cy5hbGVydHMgPSAndW5oZWFsdGh5JztcbiAgICAgICAgZXJyb3JzLnB1c2goJ0FsZXJ0IFRvb2wgbm90IGluaXRpYWxpemVkJyk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbXBvbmVudHMuYWxlcnRzID0gJ3VuaGVhbHRoeSc7XG4gICAgICBlcnJvcnMucHVzaChgQWxlcnQgVG9vbCBlcnJvcjogJHtlcnJvcn1gKTtcbiAgICB9XG5cbiAgICAvLyBDaGVjayBpT1MgTWFuYWdlbWVudCBUb29sIGlmIGVuYWJsZWRcbiAgICBpZiAodGhpcy5jb25maWcuaW9zQ29uZmlnKSB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAodGhpcy5pb3NNYW5hZ2VtZW50VG9vbCkge1xuICAgICAgICAgIGNvbnN0IGlzVmFsaWRBUE5TID0gYXdhaXQgdGhpcy5pb3NNYW5hZ2VtZW50VG9vbC52YWxpZGF0ZUFQTlNDb25maWcoKTtcbiAgICAgICAgICBjb21wb25lbnRzLmlvcyA9IGlzVmFsaWRBUE5TID8gJ2hlYWx0aHknIDogJ3VuaGVhbHRoeSc7XG4gICAgICAgICAgaWYgKCFpc1ZhbGlkQVBOUykge1xuICAgICAgICAgICAgZXJyb3JzLnB1c2goJ0FQTlMgY29uZmlndXJhdGlvbiB2YWxpZGF0aW9uIGZhaWxlZCcpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb21wb25lbnRzLmlvcyA9ICd1bmhlYWx0aHknO1xuICAgICAgICAgIGVycm9ycy5wdXNoKCdpT1MgTWFuYWdlbWVudCBUb29sIG5vdCBpbml0aWFsaXplZCcpO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb21wb25lbnRzLmlvcyA9ICd1bmhlYWx0aHknO1xuICAgICAgICBlcnJvcnMucHVzaChgaU9TIE1hbmFnZW1lbnQgVG9vbCBlcnJvcjogJHtlcnJvcn1gKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBDaGVjayBUYXNrc1xuICAgIHRyeSB7XG4gICAgICBpZiAodGhpcy5zcGVuZE1vbml0b3JUYXNrKSB7XG4gICAgICAgIGNvbXBvbmVudHMudGFza3MgPSAnaGVhbHRoeSc7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb21wb25lbnRzLnRhc2tzID0gJ3VuaGVhbHRoeSc7XG4gICAgICAgIGVycm9ycy5wdXNoKCdTcGVuZCBNb25pdG9yIFRhc2sgbm90IGluaXRpYWxpemVkJyk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbXBvbmVudHMudGFza3MgPSAndW5oZWFsdGh5JztcbiAgICAgIGVycm9ycy5wdXNoKGBTcGVuZCBNb25pdG9yIFRhc2sgZXJyb3I6ICR7ZXJyb3J9YCk7XG4gICAgfVxuXG4gICAgLy8gRGV0ZXJtaW5lIG92ZXJhbGwgaGVhbHRoXG4gICAgY29uc3QgdW5oZWFsdGh5Q29tcG9uZW50cyA9IE9iamVjdC52YWx1ZXMoY29tcG9uZW50cykuZmlsdGVyKHN0YXR1cyA9PiBzdGF0dXMgPT09ICd1bmhlYWx0aHknKS5sZW5ndGg7XG4gICAgY29uc3Qgb3ZlcmFsbCA9IHVuaGVhbHRoeUNvbXBvbmVudHMgPT09IDAgPyAnaGVhbHRoeScgOiBcbiAgICAgICAgICAgICAgICAgICB1bmhlYWx0aHlDb21wb25lbnRzIDw9IDEgPyAnZGVncmFkZWQnIDogJ3VuaGVhbHRoeSc7XG5cbiAgICByZXR1cm4ge1xuICAgICAgb3ZlcmFsbCxcbiAgICAgIGNvbXBvbmVudHMsXG4gICAgICBlcnJvcnNcbiAgICB9O1xuICB9XG59Il19