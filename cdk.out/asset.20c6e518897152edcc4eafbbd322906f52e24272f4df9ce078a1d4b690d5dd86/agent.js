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
/**
 * AWS Spend Monitor Agent with iOS push notification support
 *
 * This agent monitors AWS spending using Cost Explorer API and sends alerts
 * via multiple channels (email, SMS, iOS push) when spending exceeds thresholds.
 */
class SpendMonitorAgent extends strands_agents_1.Agent {
    constructor(config) {
        super(config);
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
                // Validate APNS configuration
                const isValidAPNS = await this.iosManagementTool.validateAPNSConfig();
                if (!isValidAPNS) {
                    console.warn('APNS configuration validation failed - iOS notifications may not work');
                }
                else {
                    console.log('iOS Management Tool registered and APNS validated');
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWdlbnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvYWdlbnQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbURBQXVDO0FBQ3ZDLHdFQUFtRTtBQUNuRSxvREFBZ0Q7QUFFaEQsNkNBQTBEO0FBQzFELG1FQUE4RDtBQUM5RCxtREFBK0M7QUFDL0MscUVBQWdFO0FBQ2hFLG1FQUE4RDtBQUU5RDs7Ozs7R0FLRztBQUNILE1BQWEsaUJBQWtCLFNBQVEsc0JBQUs7SUFTMUMsWUFBWSxNQUEwQjtRQUNwQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDZCxJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQztRQUVyQix5QkFBeUI7UUFDekIsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFJLHlDQUFrQixDQUFDLEVBQUUsTUFBTSxFQUFFLE1BQU0sQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDO1FBQ3RFLElBQUksQ0FBQyxHQUFHLEdBQUcsSUFBSSxzQkFBUyxDQUFDLEVBQUUsTUFBTSxFQUFFLE1BQU0sQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDO0lBQ3RELENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxVQUFVO1FBQ2QsSUFBSSxDQUFDO1lBQ0gsT0FBTyxDQUFDLEdBQUcsQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDO1lBRW5ELGdEQUFnRDtZQUNoRCxNQUFNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1lBRW5DLGdDQUFnQztZQUNoQyxNQUFNLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUU3QixnQ0FBZ0M7WUFDaEMsTUFBTSxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7WUFFN0IsT0FBTyxDQUFDLEdBQUcsQ0FBQyw4Q0FBOEMsQ0FBQyxDQUFDO1FBQzlELENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQywyQ0FBMkMsRUFBRSxLQUFLLENBQUMsQ0FBQztZ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QUFDO2dCQUMxQixVQUFVLENBQUMsS0FBSyxHQUFHLFNBQVMsQ0FBQztZQUMvQixDQUFDO2lCQUFNLENBQUM7Z0JBQ04sVUFBVSxDQUFDLEtBQUssR0FBRyxXQUFXLENBQUM7Z0JBQy9CLE1BQU0sQ0FBQyxJQUFJLENBQUMsb0NBQW9DLENBQUMsQ0FBQztZQUNwRCxDQUFDO1FBQ0gsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixVQUFVLENBQUMsS0FBSyxHQUFHLFdBQVcsQ0FBQztZQUMvQixNQUFNLENBQUMsSUFBSSxDQUFDLDZCQUE2QixLQUFLLEVBQUUsQ0FBQyxDQUFDO1FBQ3BELENBQUM7UUFFRCwyQkFBMkI7UUFDM0IsTUFBTSxtQkFBbUIsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLE1BQU0sS0FBSyxXQUFXLENBQUMsQ0FBQyxNQUFNLENBQUM7UUFDdEcsTUFBTSxPQUFPLEdBQUcsbUJBQW1CLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQztZQUN4QyxtQkFBbUIsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDO1FBRW5FLE9BQU87WUFDTCxPQUFPO1lBQ1AsVUFBVTtZQUNWLE1BQU07U0FDUCxDQUFDO0lBQ0osQ0FBQztDQUNGO0FBbllELDhDQW1ZQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFnZW50IH0gZnJvbSAnc3RyYW5kcy1hZ2VudHMnO1xuaW1wb3J0IHsgQ29zdEV4cGxvcmVyQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWNvc3QtZXhwbG9yZXInO1xuaW1wb3J0IHsgU05TQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNucyc7XG5pbXBvcnQgeyBTcGVuZE1vbml0b3JDb25maWcsIENvc3RBbmFseXNpcywgQWxlcnRDb250ZXh0IH0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgeyB2YWxpZGF0ZVNwZW5kTW9uaXRvckNvbmZpZyB9IGZyb20gJy4vdmFsaWRhdGlvbic7XG5pbXBvcnQgeyBDb3N0QW5hbHlzaXNUb29sIH0gZnJvbSAnLi90b29scy9jb3N0LWFuYWx5c2lzLXRvb2wnO1xuaW1wb3J0IHsgQWxlcnRUb29sIH0gZnJvbSAnLi90b29scy9hbGVydC10b29sJztcbmltcG9ydCB7IGlPU01hbmFnZW1lbnRUb29sIH0gZnJvbSAnLi90b29scy9pb3MtbWFuYWdlbWVudC10b29sJztcbmltcG9ydCB7IFNwZW5kTW9uaXRvclRhc2sgfSBmcm9tICcuL3Rhc2tzL3NwZW5kLW1vbml0b3ItdGFzayc7XG5cbi8qKlxuICogQVdTIFNwZW5kIE1vbml0b3IgQWdlbnQgd2l0aCBpT1MgcHVzaCBub3RpZmljYXRpb24gc3VwcG9ydFxuICogXG4gKiBUaGlzIGFnZW50IG1vbml0b3JzIEFXUyBzcGVuZGluZyB1c2luZyBDb3N0IEV4cGxvcmVyIEFQSSBhbmQgc2VuZHMgYWxlcnRzXG4gKiB2aWEgbXVsdGlwbGUgY2hhbm5lbHMgKGVtYWlsLCBTTVMsIGlPUyBwdXNoKSB3aGVuIHNwZW5kaW5nIGV4Y2VlZHMgdGhyZXNob2xkcy5cbiAqL1xuZXhwb3J0IGNsYXNzIFNwZW5kTW9uaXRvckFnZW50IGV4dGVuZHMgQWdlbnQge1xuICBwcml2YXRlIGNvc3RFeHBsb3JlcjogQ29zdEV4cGxvcmVyQ2xpZW50O1xuICBwcml2YXRlIHNuczogU05TQ2xpZW50O1xuICBwcm90ZWN0ZWQgY29uZmlnOiBTcGVuZE1vbml0b3JDb25maWc7XG4gIHByaXZhdGUgY29zdEFuYWx5c2lzVG9vbD86IENvc3RBbmFseXNpc1Rvb2w7XG4gIHByaXZhdGUgYWxlcnRUb29sPzogQWxlcnRUb29sO1xuICBwcml2YXRlIGlvc01hbmFnZW1lbnRUb29sPzogaU9TTWFuYWdlbWVudFRvb2w7XG4gIHByaXZhdGUgc3BlbmRNb25pdG9yVGFzaz86IFNwZW5kTW9uaXRvclRhc2s7XG5cbiAgY29uc3RydWN0b3IoY29uZmlnOiBTcGVuZE1vbml0b3JDb25maWcpIHtcbiAgICBzdXBlcihjb25maWcpO1xuICAgIHRoaXMuY29uZmlnID0gY29uZmlnO1xuICAgIFxuICAgIC8vIEluaXRpYWxpemUgQVdTIGNsaWVudHNcbiAgICB0aGlzLmNvc3RFeHBsb3JlciA9IG5ldyBDb3N0RXhwbG9yZXJDbGllbnQoeyByZWdpb246IGNvbmZpZy5yZWdpb24gfSk7XG4gICAgdGhpcy5zbnMgPSBuZXcgU05TQ2xpZW50KHsgcmVnaW9uOiBjb25maWcucmVnaW9uIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemVzIHRoZSBhZ2VudCBieSB2YWxpZGF0aW5nIGNvbmZpZ3VyYXRpb24gYW5kIHJlZ2lzdGVyaW5nIHRvb2xzIGFuZCB0YXNrc1xuICAgKi9cbiAgYXN5bmMgaW5pdGlhbGl6ZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgY29uc29sZS5sb2coJ0luaXRpYWxpemluZyBTcGVuZCBNb25pdG9yIEFnZW50Li4uJyk7XG5cbiAgICAgIC8vIFZhbGlkYXRlIGNvbmZpZ3VyYXRpb24gaW5jbHVkaW5nIGlPUyBzZXR0aW5nc1xuICAgICAgYXdhaXQgdGhpcy52YWxpZGF0ZUNvbmZpZ3VyYXRpb24oKTtcblxuICAgICAgLy8gSW5pdGlhbGl6ZSBhbmQgcmVnaXN0ZXIgdG9vbHNcbiAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZVRvb2xzKCk7XG5cbiAgICAgIC8vIEluaXRpYWxpemUgYW5kIHJlZ2lzdGVyIHRhc2tzXG4gICAgICBhd2FpdCB0aGlzLmluaXRpYWxpemVUYXNrcygpO1xuXG4gICAgICBjb25zb2xlLmxvZygnU3BlbmQgTW9uaXRvciBBZ2VudCBpbml0aWFsaXplZCBzdWNjZXNzZnVsbHknKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIGluaXRpYWxpemUgU3BlbmQgTW9uaXRvciBBZ2VudDonLCBlcnJvcik7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIHRoZSBhZ2VudCBjb25maWd1cmF0aW9uXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHZhbGlkYXRlQ29uZmlndXJhdGlvbigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgdmFsaWRhdGVTcGVuZE1vbml0b3JDb25maWcodGhpcy5jb25maWcpO1xuICAgICAgXG4gICAgICAvLyBBZGRpdGlvbmFsIGlPUy1zcGVjaWZpYyB2YWxpZGF0aW9uIGlmIGlPUyBjb25maWcgaXMgcHJvdmlkZWRcbiAgICAgIGlmICh0aGlzLmNvbmZpZy5pb3NDb25maWcpIHtcbiAgICAgICAgY29uc29sZS5sb2coJ2lPUyBwdXNoIG5vdGlmaWNhdGlvbnMgZW5hYmxlZCAtIHZhbGlkYXRpbmcgQVBOUyBjb25maWd1cmF0aW9uJyk7XG4gICAgICAgIC8vIEFQTlMgdmFsaWRhdGlvbiB3aWxsIGJlIGRvbmUgYnkgaU9TTWFuYWdlbWVudFRvb2wgZHVyaW5nIGluaXRpYWxpemF0aW9uXG4gICAgICB9XG5cbiAgICAgIGNvbnNvbGUubG9nKCdDb25maWd1cmF0aW9uIHZhbGlkYXRpb24gY29tcGxldGVkJyk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0NvbmZpZ3VyYXRpb24gdmFsaWRhdGlvbiBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemVzIGFuZCByZWdpc3RlcnMgYWxsIHRvb2xzXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGluaXRpYWxpemVUb29scygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgLy8gSW5pdGlhbGl6ZSBDb3N0IEFuYWx5c2lzIFRvb2xcbiAgICAgIHRoaXMuY29zdEFuYWx5c2lzVG9vbCA9IG5ldyBDb3N0QW5hbHlzaXNUb29sKFxuICAgICAgICB0aGlzLmNvbmZpZy5yZWdpb24sXG4gICAgICAgIHsgbWF4QXR0ZW1wdHM6IHRoaXMuY29uZmlnLnJldHJ5QXR0ZW1wdHMgfVxuICAgICAgKTtcbiAgICAgIHRoaXMucmVnaXN0ZXJUb29sKHRoaXMuY29zdEFuYWx5c2lzVG9vbCk7XG4gICAgICBjb25zb2xlLmxvZygnQ29zdCBBbmFseXNpcyBUb29sIHJlZ2lzdGVyZWQnKTtcblxuICAgICAgLy8gSW5pdGlhbGl6ZSBBbGVydCBUb29sIHdpdGggbXVsdGktY2hhbm5lbCBzdXBwb3J0XG4gICAgICB0aGlzLmFsZXJ0VG9vbCA9IG5ldyBBbGVydFRvb2woXG4gICAgICAgIHRoaXMuY29uZmlnLnJlZ2lvbixcbiAgICAgICAgeyBtYXhBdHRlbXB0czogdGhpcy5jb25maWcucmV0cnlBdHRlbXB0cyB9XG4gICAgICApO1xuICAgICAgdGhpcy5yZWdpc3RlclRvb2wodGhpcy5hbGVydFRvb2wpO1xuICAgICAgY29uc29sZS5sb2coJ0FsZXJ0IFRvb2wgcmVnaXN0ZXJlZCcpO1xuXG4gICAgICAvLyBJbml0aWFsaXplIGlPUyBNYW5hZ2VtZW50IFRvb2wgaWYgaU9TIGNvbmZpZyBpcyBwcm92aWRlZFxuICAgICAgaWYgKHRoaXMuY29uZmlnLmlvc0NvbmZpZykge1xuICAgICAgICB0aGlzLmlvc01hbmFnZW1lbnRUb29sID0gbmV3IGlPU01hbmFnZW1lbnRUb29sKFxuICAgICAgICAgIHRoaXMuY29uZmlnLmlvc0NvbmZpZyxcbiAgICAgICAgICB0aGlzLmNvbmZpZy5yZWdpb25cbiAgICAgICAgKTtcbiAgICAgICAgdGhpcy5yZWdpc3RlclRvb2wodGhpcy5pb3NNYW5hZ2VtZW50VG9vbCk7XG4gICAgICAgIFxuICAgICAgICAvLyBWYWxpZGF0ZSBBUE5TIGNvbmZpZ3VyYXRpb25cbiAgICAgICAgY29uc3QgaXNWYWxpZEFQTlMgPSBhd2FpdCB0aGlzLmlvc01hbmFnZW1lbnRUb29sLnZhbGlkYXRlQVBOU0NvbmZpZygpO1xuICAgICAgICBpZiAoIWlzVmFsaWRBUE5TKSB7XG4gICAgICAgICAgY29uc29sZS53YXJuKCdBUE5TIGNvbmZpZ3VyYXRpb24gdmFsaWRhdGlvbiBmYWlsZWQgLSBpT1Mgbm90aWZpY2F0aW9ucyBtYXkgbm90IHdvcmsnKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zb2xlLmxvZygnaU9TIE1hbmFnZW1lbnQgVG9vbCByZWdpc3RlcmVkIGFuZCBBUE5TIHZhbGlkYXRlZCcpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIGluaXRpYWxpemUgdG9vbHM6JywgZXJyb3IpO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemVzIGFuZCByZWdpc3RlcnMgdGFza3NcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgaW5pdGlhbGl6ZVRhc2tzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBJbml0aWFsaXplIFNwZW5kIE1vbml0b3IgVGFza1xuICAgICAgdGhpcy5zcGVuZE1vbml0b3JUYXNrID0gbmV3IFNwZW5kTW9uaXRvclRhc2sodGhpcy5jb25maWcpO1xuICAgICAgdGhpcy5yZWdpc3RlclRhc2sodGhpcy5zcGVuZE1vbml0b3JUYXNrKTtcbiAgICAgIGNvbnNvbGUubG9nKCdTcGVuZCBNb25pdG9yIFRhc2sgcmVnaXN0ZXJlZCcpO1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBpbml0aWFsaXplIHRhc2tzOicsIGVycm9yKTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBNYWluIGV4ZWN1dGlvbiBtZXRob2QgdGhhdCBvcmNoZXN0cmF0ZXMgY29zdCBhbmFseXNpcyBhbmQgbXVsdGktY2hhbm5lbCBhbGVydGluZ1xuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgY29uc29sZS5sb2coJ1N0YXJ0aW5nIHNwZW5kIG1vbml0b3JpbmcgZXhlY3V0aW9uLi4uJyk7XG5cbiAgICAgIGlmICghdGhpcy5zcGVuZE1vbml0b3JUYXNrKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignU3BlbmQgTW9uaXRvciBUYXNrIG5vdCBpbml0aWFsaXplZCcpO1xuICAgICAgfVxuXG4gICAgICAvLyBFeGVjdXRlIHRoZSBzcGVuZCBtb25pdG9yaW5nIHRhc2sgd2l0aCBwcm9ncmVzcyB0cmFja2luZ1xuICAgICAgY29uc3QgdGFza1Jlc3VsdCA9IGF3YWl0IHRoaXMuc3BlbmRNb25pdG9yVGFzay5leGVjdXRlKHRoaXMuY29uZmlnKTtcblxuICAgICAgaWYgKCF0YXNrUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUYXNrIGV4ZWN1dGlvbiBmYWlsZWQ6ICR7dGFza1Jlc3VsdC5lcnJvcn1gKTtcbiAgICAgIH1cblxuICAgICAgLy8gUGVyZm9ybSBjb3N0IGFuYWx5c2lzXG4gICAgICBjb25zdCBjb3N0QW5hbHlzaXMgPSBhd2FpdCB0aGlzLmFuYWx5emVDb3N0cygpO1xuICAgICAgdGhpcy5zcGVuZE1vbml0b3JUYXNrLnNldENvc3RBbmFseXNpcyhjb3N0QW5hbHlzaXMpO1xuXG4gICAgICAvLyBDaGVjayBpZiB0aHJlc2hvbGQgZXhjZWVkZWQgYW5kIHNlbmQgYWxlcnRzIGlmIG5lY2Vzc2FyeVxuICAgICAgY29uc3QgYWxlcnRTZW50ID0gYXdhaXQgdGhpcy5jaGVja1RocmVzaG9sZEFuZEFsZXJ0KGNvc3RBbmFseXNpcyk7XG5cbiAgICAgIGNvbnNvbGUubG9nKGBTcGVuZCBtb25pdG9yaW5nIGV4ZWN1dGlvbiBjb21wbGV0ZWQgc3VjY2Vzc2Z1bGx5YCk7XG4gICAgICBjb25zb2xlLmxvZyhgQ3VycmVudCBzcGVuZDogJCR7Y29zdEFuYWx5c2lzLnRvdGFsQ29zdC50b0ZpeGVkKDIpfSwgVGhyZXNob2xkOiAkJHt0aGlzLmNvbmZpZy5zcGVuZFRocmVzaG9sZC50b0ZpeGVkKDIpfWApO1xuICAgICAgY29uc29sZS5sb2coYFByb2plY3RlZCBtb250aGx5OiAkJHtjb3N0QW5hbHlzaXMucHJvamVjdGVkTW9udGhseS50b0ZpeGVkKDIpfWApO1xuICAgICAgXG4gICAgICBpZiAoYWxlcnRTZW50KSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdBbGVydCBub3RpZmljYXRpb25zIHNlbnQgdG8gYWxsIGNvbmZpZ3VyZWQgY2hhbm5lbHMnKTtcbiAgICAgIH1cblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBpbiBzcGVuZCBtb25pdG9yaW5nIGV4ZWN1dGlvbjonLCBlcnJvcik7XG4gICAgICBcbiAgICAgIC8vIExvZyBpT1Mtc3BlY2lmaWMgZXJyb3JzIGlmIGFwcGxpY2FibGVcbiAgICAgIGlmICh0aGlzLmNvbmZpZy5pb3NDb25maWcgJiYgZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IubWVzc2FnZS5pbmNsdWRlcygnQVBOUycpIHx8IGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoJ2lPUycpKSB7XG4gICAgICAgICAgY29uc29sZS5lcnJvcignaU9TIG5vdGlmaWNhdGlvbiBlcnJvciBkZXRlY3RlZCAtIGNoZWNrIEFQTlMgY29uZmlndXJhdGlvbicpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgc3BlbmRpbmcgdGhyZXNob2xkIGFuZCBzZW5kcyBhbGVydHMgaWYgZXhjZWVkZWRcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgY2hlY2tUaHJlc2hvbGRBbmRBbGVydChjb3N0QW5hbHlzaXM6IENvc3RBbmFseXNpcyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGlmIChjb3N0QW5hbHlzaXMudG90YWxDb3N0IDw9IHRoaXMuY29uZmlnLnNwZW5kVGhyZXNob2xkKSB7XG4gICAgICBjb25zb2xlLmxvZygnU3BlbmRpbmcgaXMgd2l0aGluIHRocmVzaG9sZCAtIG5vIGFsZXJ0IG5lZWRlZCcpO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIGNvbnNvbGUubG9nKGBTcGVuZGluZyB0aHJlc2hvbGQgZXhjZWVkZWQ6ICQke2Nvc3RBbmFseXNpcy50b3RhbENvc3QudG9GaXhlZCgyKX0gPiAkJHt0aGlzLmNvbmZpZy5zcGVuZFRocmVzaG9sZC50b0ZpeGVkKDIpfWApO1xuXG4gICAgLy8gQ3JlYXRlIGFsZXJ0IGNvbnRleHRcbiAgICBjb25zdCBhbGVydENvbnRleHQ6IEFsZXJ0Q29udGV4dCA9IHtcbiAgICAgIHRocmVzaG9sZDogdGhpcy5jb25maWcuc3BlbmRUaHJlc2hvbGQsXG4gICAgICBleGNlZWRBbW91bnQ6IGNvc3RBbmFseXNpcy50b3RhbENvc3QgLSB0aGlzLmNvbmZpZy5zcGVuZFRocmVzaG9sZCxcbiAgICAgIHBlcmNlbnRhZ2VPdmVyOiAoKGNvc3RBbmFseXNpcy50b3RhbENvc3QgLSB0aGlzLmNvbmZpZy5zcGVuZFRocmVzaG9sZCkgLyB0aGlzLmNvbmZpZy5zcGVuZFRocmVzaG9sZCkgKiAxMDAsXG4gICAgICB0b3BTZXJ2aWNlczogdGhpcy5nZXRUb3BTZXJ2aWNlcyhjb3N0QW5hbHlzaXMuc2VydmljZUJyZWFrZG93biksXG4gICAgICBhbGVydExldmVsOiB0aGlzLmRldGVybWluZUFsZXJ0TGV2ZWwoY29zdEFuYWx5c2lzLnRvdGFsQ29zdCwgdGhpcy5jb25maWcuc3BlbmRUaHJlc2hvbGQpXG4gICAgfTtcblxuICAgIC8vIFVwZGF0ZSB0YXNrIHdpdGggYWxlcnQgY29udGV4dFxuICAgIGlmICh0aGlzLnNwZW5kTW9uaXRvclRhc2spIHtcbiAgICAgIHRoaXMuc3BlbmRNb25pdG9yVGFzay5zZXRBbGVydENvbnRleHQoYWxlcnRDb250ZXh0KTtcbiAgICB9XG5cbiAgICAvLyBTZW5kIGFsZXJ0IHZpYSBhbGwgY29uZmlndXJlZCBjaGFubmVsc1xuICAgIGF3YWl0IHRoaXMuc2VuZEFsZXJ0KGNvc3RBbmFseXNpcywgYWxlcnRDb250ZXh0KTtcbiAgICBcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZXRlcm1pbmVzIGFsZXJ0IGxldmVsIGJhc2VkIG9uIHNwZW5kaW5nIGFtb3VudFxuICAgKi9cbiAgcHJpdmF0ZSBkZXRlcm1pbmVBbGVydExldmVsKGN1cnJlbnRTcGVuZDogbnVtYmVyLCB0aHJlc2hvbGQ6IG51bWJlcik6ICdXQVJOSU5HJyB8ICdDUklUSUNBTCcge1xuICAgIGNvbnN0IHBlcmNlbnRhZ2VPdmVyID0gKChjdXJyZW50U3BlbmQgLSB0aHJlc2hvbGQpIC8gdGhyZXNob2xkKSAqIDEwMDtcbiAgICByZXR1cm4gcGVyY2VudGFnZU92ZXIgPiA1MCA/ICdDUklUSUNBTCcgOiAnV0FSTklORyc7XG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0b3Agc2VydmljZXMgYnkgY29zdCBmb3IgYWxlcnQgY29udGV4dFxuICAgKi9cbiAgcHJpdmF0ZSBnZXRUb3BTZXJ2aWNlcyhzZXJ2aWNlQnJlYWtkb3duOiB7IFtzZXJ2aWNlOiBzdHJpbmddOiBudW1iZXIgfSk6IEFycmF5PHtzZXJ2aWNlTmFtZTogc3RyaW5nOyBjb3N0OiBudW1iZXI7IHBlcmNlbnRhZ2U6IG51bWJlcn0+IHtcbiAgICBjb25zdCB0b3RhbENvc3QgPSBPYmplY3QudmFsdWVzKHNlcnZpY2VCcmVha2Rvd24pLnJlZHVjZSgoc3VtLCBjb3N0KSA9PiBzdW0gKyBjb3N0LCAwKTtcbiAgICBcbiAgICByZXR1cm4gT2JqZWN0LmVudHJpZXMoc2VydmljZUJyZWFrZG93bilcbiAgICAgIC5maWx0ZXIoKFssIGNvc3RdKSA9PiBjb3N0ID49IHRoaXMuY29uZmlnLm1pblNlcnZpY2VDb3N0VGhyZXNob2xkKVxuICAgICAgLm1hcCgoW3NlcnZpY2VOYW1lLCBjb3N0XSkgPT4gKHtcbiAgICAgICAgc2VydmljZU5hbWUsXG4gICAgICAgIGNvc3QsXG4gICAgICAgIHBlcmNlbnRhZ2U6IChjb3N0IC8gdG90YWxDb3N0KSAqIDEwMFxuICAgICAgfSkpXG4gICAgICAuc29ydCgoYSwgYikgPT4gYi5jb3N0IC0gYS5jb3N0KVxuICAgICAgLnNsaWNlKDAsIDUpOyAvLyBUb3AgNSBzZXJ2aWNlc1xuICB9XG5cbiAgLyoqXG4gICAqIEFuYWx5emVzIGN1cnJlbnQgQVdTIGNvc3RzIHVzaW5nIHRoZSBDb3N0IEFuYWx5c2lzIFRvb2xcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgYW5hbHl6ZUNvc3RzKCk6IFByb21pc2U8Q29zdEFuYWx5c2lzPiB7XG4gICAgaWYgKCF0aGlzLmNvc3RBbmFseXNpc1Rvb2wpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ29zdCBBbmFseXNpcyBUb29sIG5vdCBpbml0aWFsaXplZCcpO1xuICAgIH1cbiAgICBcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jb3N0QW5hbHlzaXNUb29sLmdldEN1cnJlbnRNb250aENvc3RzKCk7XG4gIH1cblxuICAvKipcbiAgICogU2VuZHMgYWxlcnQgbm90aWZpY2F0aW9ucyB2aWEgYWxsIGNvbmZpZ3VyZWQgY2hhbm5lbHNcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgc2VuZEFsZXJ0KGNvc3RBbmFseXNpczogQ29zdEFuYWx5c2lzLCBhbGVydENvbnRleHQ6IEFsZXJ0Q29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5hbGVydFRvb2wpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQWxlcnQgVG9vbCBub3QgaW5pdGlhbGl6ZWQnKTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5hbGVydFRvb2wuc2VuZFNwZW5kQWxlcnQoY29zdEFuYWx5c2lzLCBhbGVydENvbnRleHQsIHRoaXMuY29uZmlnLnNuc1RvcGljQXJuLCB0aGlzLmNvbmZpZy5pb3NDb25maWcpO1xuICAgICAgY29uc29sZS5sb2coJ0FsZXJ0IHNlbnQgc3VjY2Vzc2Z1bGx5IHRvIGFsbCBjb25maWd1cmVkIGNoYW5uZWxzJyk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBzZW5kIGFsZXJ0OicsIGVycm9yKTtcbiAgICAgIFxuICAgICAgLy8gVHJ5IHRvIHNlbmQgYSBzaW1wbGlmaWVkIGFsZXJ0IGlmIHRoZSBtYWluIGFsZXJ0IGZhaWxzXG4gICAgICB0cnkge1xuICAgICAgICBjb25zb2xlLmxvZygnQXR0ZW1wdGluZyB0byBzZW5kIHNpbXBsaWZpZWQgYWxlcnQuLi4nKTtcbiAgICAgICAgYXdhaXQgdGhpcy5hbGVydFRvb2wuc2VuZFNwZW5kQWxlcnQoXG4gICAgICAgICAgY29zdEFuYWx5c2lzLCBcbiAgICAgICAgICBhbGVydENvbnRleHQsIFxuICAgICAgICAgIHRoaXMuY29uZmlnLnNuc1RvcGljQXJuXG4gICAgICAgICk7XG4gICAgICAgIGNvbnNvbGUubG9nKCdTaW1wbGlmaWVkIGFsZXJ0IHNlbnQgc3VjY2Vzc2Z1bGx5Jyk7XG4gICAgICB9IGNhdGNoIChmYWxsYmFja0Vycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBzZW5kIHNpbXBsaWZpZWQgYWxlcnQ6JywgZmFsbGJhY2tFcnJvcik7XG4gICAgICAgIHRocm93IGVycm9yOyAvLyBSZS10aHJvdyBvcmlnaW5hbCBlcnJvclxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBjdXJyZW50IGNvbmZpZ3VyYXRpb25cbiAgICovXG4gIGdldENvbmZpZygpOiBTcGVuZE1vbml0b3JDb25maWcge1xuICAgIHJldHVybiB7IC4uLnRoaXMuY29uZmlnIH07XG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlcyB0aGUgY29uZmlndXJhdGlvbiAocmVxdWlyZXMgcmUtaW5pdGlhbGl6YXRpb24pXG4gICAqL1xuICB1cGRhdGVDb25maWcobmV3Q29uZmlnOiBQYXJ0aWFsPFNwZW5kTW9uaXRvckNvbmZpZz4pOiB2b2lkIHtcbiAgICB0aGlzLmNvbmZpZyA9IHsgLi4udGhpcy5jb25maWcsIC4uLm5ld0NvbmZpZyB9O1xuICAgIGNvbnNvbGUubG9nKCdDb25maWd1cmF0aW9uIHVwZGF0ZWQgLSByZS1pbml0aWFsaXphdGlvbiByZXF1aXJlZCcpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgYWdlbnQgc3RhdGlzdGljcyBhbmQgc3RhdHVzXG4gICAqL1xuICBnZXRTdGF0dXMoKToge1xuICAgIGluaXRpYWxpemVkOiBib29sZWFuO1xuICAgIHRvb2xzUmVnaXN0ZXJlZDogbnVtYmVyO1xuICAgIHRhc2tzUmVnaXN0ZXJlZDogbnVtYmVyO1xuICAgIGlvc0VuYWJsZWQ6IGJvb2xlYW47XG4gICAgbGFzdEV4ZWN1dGlvbj86IHN0cmluZztcbiAgfSB7XG4gICAgY29uc3QgdG9vbHMgPSB0aGlzLmdldFJlZ2lzdGVyZWRUb29scygpO1xuICAgIGNvbnN0IHRhc2tzID0gdGhpcy5nZXRSZWdpc3RlcmVkVGFza3MoKTtcbiAgICBcbiAgICByZXR1cm4ge1xuICAgICAgaW5pdGlhbGl6ZWQ6ICEhKHRoaXMuY29zdEFuYWx5c2lzVG9vbCAmJiB0aGlzLmFsZXJ0VG9vbCAmJiB0aGlzLnNwZW5kTW9uaXRvclRhc2spLFxuICAgICAgdG9vbHNSZWdpc3RlcmVkOiB0b29scy5sZW5ndGgsXG4gICAgICB0YXNrc1JlZ2lzdGVyZWQ6IHRhc2tzLmxlbmd0aCxcbiAgICAgIGlvc0VuYWJsZWQ6ICEhdGhpcy5jb25maWcuaW9zQ29uZmlnLFxuICAgICAgbGFzdEV4ZWN1dGlvbjogdGhpcy5zcGVuZE1vbml0b3JUYXNrPy5nZXRTdGF0aXN0aWNzKCkubGFzdEV4ZWN1dGVkXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJmb3JtcyBoZWFsdGggY2hlY2sgb24gYWxsIGNvbXBvbmVudHNcbiAgICovXG4gIGFzeW5jIGhlYWx0aENoZWNrKCk6IFByb21pc2U8e1xuICAgIG92ZXJhbGw6ICdoZWFsdGh5JyB8ICdkZWdyYWRlZCcgfCAndW5oZWFsdGh5JztcbiAgICBjb21wb25lbnRzOiB7XG4gICAgICBjb3N0QW5hbHlzaXM6ICdoZWFsdGh5JyB8ICd1bmhlYWx0aHknO1xuICAgICAgYWxlcnRzOiAnaGVhbHRoeScgfCAndW5oZWFsdGh5JztcbiAgICAgIGlvcz86ICdoZWFsdGh5JyB8ICd1bmhlYWx0aHknO1xuICAgICAgdGFza3M6ICdoZWFsdGh5JyB8ICd1bmhlYWx0aHknO1xuICAgIH07XG4gICAgZXJyb3JzOiBzdHJpbmdbXTtcbiAgfT4ge1xuICAgIGNvbnN0IGVycm9yczogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCBjb21wb25lbnRzOiBhbnkgPSB7fTtcblxuICAgIC8vIENoZWNrIENvc3QgQW5hbHlzaXMgVG9vbFxuICAgIHRyeSB7XG4gICAgICBpZiAodGhpcy5jb3N0QW5hbHlzaXNUb29sKSB7XG4gICAgICAgIGNvbXBvbmVudHMuY29zdEFuYWx5c2lzID0gJ2hlYWx0aHknO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29tcG9uZW50cy5jb3N0QW5hbHlzaXMgPSAndW5oZWFsdGh5JztcbiAgICAgICAgZXJyb3JzLnB1c2goJ0Nvc3QgQW5hbHlzaXMgVG9vbCBub3QgaW5pdGlhbGl6ZWQnKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29tcG9uZW50cy5jb3N0QW5hbHlzaXMgPSAndW5oZWFsdGh5JztcbiAgICAgIGVycm9ycy5wdXNoKGBDb3N0IEFuYWx5c2lzIFRvb2wgZXJyb3I6ICR7ZXJyb3J9YCk7XG4gICAgfVxuXG4gICAgLy8gQ2hlY2sgQWxlcnQgVG9vbFxuICAgIHRyeSB7XG4gICAgICBpZiAodGhpcy5hbGVydFRvb2wpIHtcbiAgICAgICAgY29tcG9uZW50cy5hbGVydHMgPSAnaGVhbHRoeSc7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb21wb25lbnRzLmFsZXJ0cyA9ICd1bmhlYWx0aHknO1xuICAgICAgICBlcnJvcnMucHVzaCgnQWxlcnQgVG9vbCBub3QgaW5pdGlhbGl6ZWQnKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29tcG9uZW50cy5hbGVydHMgPSAndW5oZWFsdGh5JztcbiAgICAgIGVycm9ycy5wdXNoKGBBbGVydCBUb29sIGVycm9yOiAke2Vycm9yfWApO1xuICAgIH1cblxuICAgIC8vIENoZWNrIGlPUyBNYW5hZ2VtZW50IFRvb2wgaWYgZW5hYmxlZFxuICAgIGlmICh0aGlzLmNvbmZpZy5pb3NDb25maWcpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlmICh0aGlzLmlvc01hbmFnZW1lbnRUb29sKSB7XG4gICAgICAgICAgY29uc3QgaXNWYWxpZEFQTlMgPSBhd2FpdCB0aGlzLmlvc01hbmFnZW1lbnRUb29sLnZhbGlkYXRlQVBOU0NvbmZpZygpO1xuICAgICAgICAgIGNvbXBvbmVudHMuaW9zID0gaXNWYWxpZEFQTlMgPyAnaGVhbHRoeScgOiAndW5oZWFsdGh5JztcbiAgICAgICAgICBpZiAoIWlzVmFsaWRBUE5TKSB7XG4gICAgICAgICAgICBlcnJvcnMucHVzaCgnQVBOUyBjb25maWd1cmF0aW9uIHZhbGlkYXRpb24gZmFpbGVkJyk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbXBvbmVudHMuaW9zID0gJ3VuaGVhbHRoeSc7XG4gICAgICAgICAgZXJyb3JzLnB1c2goJ2lPUyBNYW5hZ2VtZW50IFRvb2wgbm90IGluaXRpYWxpemVkJyk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbXBvbmVudHMuaW9zID0gJ3VuaGVhbHRoeSc7XG4gICAgICAgIGVycm9ycy5wdXNoKGBpT1MgTWFuYWdlbWVudCBUb29sIGVycm9yOiAke2Vycm9yfWApO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIENoZWNrIFRhc2tzXG4gICAgdHJ5IHtcbiAgICAgIGlmICh0aGlzLnNwZW5kTW9uaXRvclRhc2spIHtcbiAgICAgICAgY29tcG9uZW50cy50YXNrcyA9ICdoZWFsdGh5JztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbXBvbmVudHMudGFza3MgPSAndW5oZWFsdGh5JztcbiAgICAgICAgZXJyb3JzLnB1c2goJ1NwZW5kIE1vbml0b3IgVGFzayBub3QgaW5pdGlhbGl6ZWQnKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29tcG9uZW50cy50YXNrcyA9ICd1bmhlYWx0aHknO1xuICAgICAgZXJyb3JzLnB1c2goYFNwZW5kIE1vbml0b3IgVGFzayBlcnJvcjogJHtlcnJvcn1gKTtcbiAgICB9XG5cbiAgICAvLyBEZXRlcm1pbmUgb3ZlcmFsbCBoZWFsdGhcbiAgICBjb25zdCB1bmhlYWx0aHlDb21wb25lbnRzID0gT2JqZWN0LnZhbHVlcyhjb21wb25lbnRzKS5maWx0ZXIoc3RhdHVzID0+IHN0YXR1cyA9PT0gJ3VuaGVhbHRoeScpLmxlbmd0aDtcbiAgICBjb25zdCBvdmVyYWxsID0gdW5oZWFsdGh5Q29tcG9uZW50cyA9PT0gMCA/ICdoZWFsdGh5JyA6IFxuICAgICAgICAgICAgICAgICAgIHVuaGVhbHRoeUNvbXBvbmVudHMgPD0gMSA/ICdkZWdyYWRlZCcgOiAndW5oZWFsdGh5JztcblxuICAgIHJldHVybiB7XG4gICAgICBvdmVyYWxsLFxuICAgICAgY29tcG9uZW50cyxcbiAgICAgIGVycm9yc1xuICAgIH07XG4gIH1cbn0iXX0=