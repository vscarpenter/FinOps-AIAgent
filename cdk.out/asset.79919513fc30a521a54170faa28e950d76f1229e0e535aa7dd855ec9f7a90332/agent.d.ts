import { Agent } from 'strands-agents';
import { SpendMonitorConfig } from './types';
/**
 * AWS Spend Monitor Agent with iOS push notification support
 *
 * This agent monitors AWS spending using Cost Explorer API and sends alerts
 * via multiple channels (email, SMS, iOS push) when spending exceeds thresholds.
 */
export declare class SpendMonitorAgent extends Agent {
    private costExplorer;
    private sns;
    protected config: SpendMonitorConfig;
    private costAnalysisTool?;
    private alertTool?;
    private iosManagementTool?;
    private spendMonitorTask?;
    constructor(config: SpendMonitorConfig);
    /**
     * Initializes the agent by validating configuration and registering tools and tasks
     */
    initialize(): Promise<void>;
    /**
     * Validates the agent configuration
     */
    private validateConfiguration;
    /**
     * Initializes and registers all tools
     */
    private initializeTools;
    /**
     * Initializes and registers tasks
     */
    private initializeTasks;
    /**
     * Main execution method that orchestrates cost analysis and multi-channel alerting
     */
    execute(): Promise<void>;
    /**
     * Checks spending threshold and sends alerts if exceeded
     */
    private checkThresholdAndAlert;
    /**
     * Determines alert level based on spending amount
     */
    private determineAlertLevel;
    /**
     * Gets top services by cost for alert context
     */
    private getTopServices;
    /**
     * Analyzes current AWS costs using the Cost Analysis Tool
     */
    private analyzeCosts;
    /**
     * Sends alert notifications via all configured channels
     */
    private sendAlert;
    /**
     * Gets the current configuration
     */
    getConfig(): SpendMonitorConfig;
    /**
     * Updates the configuration (requires re-initialization)
     */
    updateConfig(newConfig: Partial<SpendMonitorConfig>): void;
    /**
     * Gets agent statistics and status
     */
    getStatus(): {
        initialized: boolean;
        toolsRegistered: number;
        tasksRegistered: number;
        iosEnabled: boolean;
        lastExecution?: string;
    };
    /**
     * Performs health check on all components
     */
    healthCheck(): Promise<{
        overall: 'healthy' | 'degraded' | 'unhealthy';
        components: {
            costAnalysis: 'healthy' | 'unhealthy';
            alerts: 'healthy' | 'unhealthy';
            ios?: 'healthy' | 'unhealthy';
            tasks: 'healthy' | 'unhealthy';
        };
        errors: string[];
    }>;
}
