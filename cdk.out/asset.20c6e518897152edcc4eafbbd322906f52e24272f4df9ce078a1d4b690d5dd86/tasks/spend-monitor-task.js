"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpendMonitorTask = void 0;
const strands_agents_1 = require("strands-agents");
const validation_1 = require("../validation");
/**
 * Spend monitoring task implementation with progress tracking and validation
 */
class SpendMonitorTask extends strands_agents_1.Task {
    constructor(config) {
        super();
        this.metadata = {
            taskId: this.generateTaskId(),
            taskType: 'spend-monitor',
            threshold: config.spendThreshold,
            region: config.region,
            checkPeriodDays: config.checkPeriodDays,
            createdAt: new Date().toISOString(),
            executionCount: 0,
            status: 'pending'
        };
    }
    /**
     * Validates task configuration and prerequisites
     */
    async validate(config) {
        try {
            // Validate configuration using existing validation function
            (0, validation_1.validateSpendMonitorConfig)(config);
            // Additional task-specific validations
            if (config.spendThreshold <= 0) {
                throw new Error('Spend threshold must be greater than 0');
            }
            if (config.checkPeriodDays <= 0) {
                throw new Error('Check period days must be greater than 0');
            }
            console.log('Task validation completed successfully');
        }
        catch (error) {
            console.error('Task validation failed:', error);
            throw error;
        }
    }
    /**
     * Executes the spend monitoring task with progress tracking
     */
    async execute(config) {
        const executionId = this.generateExecutionId();
        const startTime = new Date().toISOString();
        // Initialize execution context
        this.context = {
            config,
            executionStartTime: startTime,
            progressSteps: [
                { step: 'validation', status: 'pending' },
                { step: 'cost-analysis', status: 'pending' },
                { step: 'threshold-check', status: 'pending' },
                { step: 'alert-processing', status: 'pending' },
                { step: 'cleanup', status: 'pending' }
            ]
        };
        // Update metadata
        this.metadata.status = 'running';
        this.metadata.executionCount++;
        this.metadata.lastExecuted = startTime;
        try {
            console.log(`Starting spend monitor task execution: ${executionId}`);
            // Step 1: Validation
            await this.executeStep('validation', async () => {
                await this.validate(config);
            });
            // Step 2: Cost Analysis (this would be handled by the agent)
            await this.executeStep('cost-analysis', async () => {
                // This step is a placeholder - actual cost analysis is done by CostAnalysisTool
                // We just track that this step should happen
                console.log('Cost analysis step - delegated to CostAnalysisTool');
            });
            // Step 3: Threshold Check
            let thresholdExceeded = false;
            await this.executeStep('threshold-check', async () => {
                // This step is a placeholder - actual threshold check is done by the agent
                // We just track that this step should happen
                console.log('Threshold check step - delegated to agent logic');
            });
            // Step 4: Alert Processing
            let alertSent = false;
            await this.executeStep('alert-processing', async () => {
                // This step is a placeholder - actual alert sending is done by AlertTool
                // We just track that this step should happen
                console.log('Alert processing step - delegated to AlertTool');
            });
            // Step 5: Cleanup
            await this.executeStep('cleanup', async () => {
                // Cleanup any temporary resources or state
                console.log('Task cleanup completed');
            });
            const endTime = new Date().toISOString();
            const duration = new Date(endTime).getTime() - new Date(startTime).getTime();
            this.metadata.status = 'completed';
            const result = {
                success: true,
                executionId,
                startTime,
                endTime,
                duration,
                costAnalysis: this.context.costAnalysis,
                alertSent,
                thresholdExceeded,
                metadata: { ...this.metadata },
                progressSteps: [...this.context.progressSteps]
            };
            console.log(`Task execution completed successfully: ${executionId}`);
            return result;
        }
        catch (error) {
            const endTime = new Date().toISOString();
            const duration = new Date(endTime).getTime() - new Date(startTime).getTime();
            this.metadata.status = 'failed';
            const result = {
                success: false,
                executionId,
                startTime,
                endTime,
                duration,
                alertSent: false,
                thresholdExceeded: false,
                error: error instanceof Error ? error.message : String(error),
                metadata: { ...this.metadata },
                progressSteps: this.context?.progressSteps || []
            };
            console.error(`Task execution failed: ${executionId}`, error);
            return result;
        }
    }
    /**
     * Executes a single step with progress tracking
     */
    async executeStep(stepName, stepFunction) {
        if (!this.context) {
            throw new Error('Task context not initialized');
        }
        const step = this.context.progressSteps.find(s => s.step === stepName);
        if (!step) {
            throw new Error(`Step not found: ${stepName}`);
        }
        step.status = 'in-progress';
        step.startTime = new Date().toISOString();
        try {
            await stepFunction();
            step.status = 'completed';
            step.endTime = new Date().toISOString();
            console.log(`Step completed: ${stepName}`);
        }
        catch (error) {
            step.status = 'failed';
            step.endTime = new Date().toISOString();
            step.error = error instanceof Error ? error.message : String(error);
            console.error(`Step failed: ${stepName}`, error);
            throw error;
        }
    }
    /**
     * Updates cost analysis results in the task context
     */
    setCostAnalysis(costAnalysis) {
        if (this.context) {
            this.context.costAnalysis = costAnalysis;
        }
    }
    /**
     * Updates alert context in the task context
     */
    setAlertContext(alertContext) {
        if (this.context) {
            this.context.alertContext = alertContext;
        }
    }
    /**
     * Gets current task metadata
     */
    getMetadata() {
        return { ...this.metadata };
    }
    /**
     * Gets current execution context
     */
    getContext() {
        return this.context ? { ...this.context } : undefined;
    }
    /**
     * Gets current progress status
     */
    getProgress() {
        if (!this.context) {
            return { completed: 0, total: 0 };
        }
        const completed = this.context.progressSteps.filter(s => s.status === 'completed').length;
        const total = this.context.progressSteps.length;
        const currentStep = this.context.progressSteps.find(s => s.status === 'in-progress')?.step;
        return { completed, total, currentStep };
    }
    /**
     * Resets task state for new execution
     */
    reset() {
        this.metadata.status = 'pending';
        this.context = undefined;
    }
    /**
     * Generates a unique task ID
     */
    generateTaskId() {
        return `spend-monitor-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    /**
     * Generates a unique execution ID
     */
    generateExecutionId() {
        return `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    /**
     * Gets task statistics
     */
    getStatistics() {
        return {
            totalExecutions: this.metadata.executionCount,
            lastExecuted: this.metadata.lastExecuted,
            currentStatus: this.metadata.status,
            createdAt: this.metadata.createdAt
        };
    }
}
exports.SpendMonitorTask = SpendMonitorTask;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3BlbmQtbW9uaXRvci10YXNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Rhc2tzL3NwZW5kLW1vbml0b3ItdGFzay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtREFBc0M7QUFFdEMsOENBQTJEO0FBeUQzRDs7R0FFRztBQUNILE1BQWEsZ0JBQWlCLFNBQVEscUJBQUk7SUFJeEMsWUFBWSxNQUEwQjtRQUNwQyxLQUFLLEVBQUUsQ0FBQztRQUVSLElBQUksQ0FBQyxRQUFRLEdBQUc7WUFDZCxNQUFNLEVBQUUsSUFBSSxDQUFDLGNBQWMsRUFBRTtZQUM3QixRQUFRLEVBQUUsZUFBZTtZQUN6QixTQUFTLEVBQUUsTUFBTSxDQUFDLGNBQWM7WUFDaEMsTUFBTSxFQUFFLE1BQU0sQ0FBQyxNQUFNO1lBQ3JCLGVBQWUsRUFBRSxNQUFNLENBQUMsZUFBZTtZQUN2QyxTQUFTLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7WUFDbkMsY0FBYyxFQUFFLENBQUM7WUFDakIsTUFBTSxFQUFFLFNBQVM7U0FDbEIsQ0FBQztJQUNKLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxRQUFRLENBQUMsTUFBMEI7UUFDdkMsSUFBSSxDQUFDO1lBQ0gsNERBQTREO1lBQzVELElBQUEsdUNBQTBCLEVBQUMsTUFBTSxDQUFDLENBQUM7WUFFbkMsdUNBQXVDO1lBQ3ZDLElBQUksTUFBTSxDQUFDLGNBQWMsSUFBSSxDQUFDLEVBQUUsQ0FBQztnQkFDL0IsTUFBTSxJQUFJLEtBQUssQ0FBQyx3Q0FBd0MsQ0FBQyxDQUFDO1lBQzVELENBQUM7WUFFRCxJQUFJLE1BQU0sQ0FBQyxlQUFlLElBQUksQ0FBQyxFQUFFLENBQUM7Z0JBQ2hDLE1BQU0sSUFBSSxLQUFLLENBQUMsMENBQTBDLENBQUMsQ0FBQztZQUM5RCxDQUFDO1lBRUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyx3Q0FBd0MsQ0FBQyxDQUFDO1FBQ3hELENBQUM7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Q0FBQyxjQUFjO1lBQzdDLFlBQVksRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLFlBQVk7WUFDeEMsYUFBYSxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTTtZQUNuQyxTQUFTLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxTQUFTO1NBQ25DLENBQUM7SUFDSixDQUFDO0NBQ0Y7QUF6UUQsNENBeVFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgVGFzayB9IGZyb20gJ3N0cmFuZHMtYWdlbnRzJztcbmltcG9ydCB7IFNwZW5kTW9uaXRvckNvbmZpZywgQ29zdEFuYWx5c2lzLCBBbGVydENvbnRleHQgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyB2YWxpZGF0ZVNwZW5kTW9uaXRvckNvbmZpZyB9IGZyb20gJy4uL3ZhbGlkYXRpb24nO1xuXG4vKipcbiAqIFRhc2sgbWV0YWRhdGEgaW50ZXJmYWNlIGZvciBzcGVuZCBtb25pdG9yaW5nXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3BlbmRNb25pdG9yVGFza01ldGFkYXRhIHtcbiAgdGFza0lkOiBzdHJpbmc7XG4gIHRhc2tUeXBlOiAnc3BlbmQtbW9uaXRvcic7XG4gIHRocmVzaG9sZDogbnVtYmVyO1xuICByZWdpb246IHN0cmluZztcbiAgY2hlY2tQZXJpb2REYXlzOiBudW1iZXI7XG4gIGNyZWF0ZWRBdDogc3RyaW5nO1xuICBsYXN0RXhlY3V0ZWQ/OiBzdHJpbmc7XG4gIGV4ZWN1dGlvbkNvdW50OiBudW1iZXI7XG4gIHN0YXR1czogJ3BlbmRpbmcnIHwgJ3J1bm5pbmcnIHwgJ2NvbXBsZXRlZCcgfCAnZmFpbGVkJztcbn1cblxuLyoqXG4gKiBUYXNrIGV4ZWN1dGlvbiBjb250ZXh0IGZvciBzcGVuZCBtb25pdG9yaW5nXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3BlbmRNb25pdG9yVGFza0NvbnRleHQge1xuICBjb25maWc6IFNwZW5kTW9uaXRvckNvbmZpZztcbiAgY29zdEFuYWx5c2lzPzogQ29zdEFuYWx5c2lzO1xuICBhbGVydENvbnRleHQ/OiBBbGVydENvbnRleHQ7XG4gIGV4ZWN1dGlvblN0YXJ0VGltZTogc3RyaW5nO1xuICBwcm9ncmVzc1N0ZXBzOiBUYXNrUHJvZ3Jlc3NTdGVwW107XG59XG5cbi8qKlxuICogUHJvZ3Jlc3MgdHJhY2tpbmcgZm9yIHRhc2sgZXhlY3V0aW9uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVGFza1Byb2dyZXNzU3RlcCB7XG4gIHN0ZXA6IHN0cmluZztcbiAgc3RhdHVzOiAncGVuZGluZycgfCAnaW4tcHJvZ3Jlc3MnIHwgJ2NvbXBsZXRlZCcgfCAnZmFpbGVkJztcbiAgc3RhcnRUaW1lPzogc3RyaW5nO1xuICBlbmRUaW1lPzogc3RyaW5nO1xuICBlcnJvcj86IHN0cmluZztcbiAgZGV0YWlscz86IGFueTtcbn1cblxuLyoqXG4gKiBUYXNrIGV4ZWN1dGlvbiByZXN1bHRcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBTcGVuZE1vbml0b3JUYXNrUmVzdWx0IHtcbiAgc3VjY2VzczogYm9vbGVhbjtcbiAgZXhlY3V0aW9uSWQ6IHN0cmluZztcbiAgc3RhcnRUaW1lOiBzdHJpbmc7XG4gIGVuZFRpbWU6IHN0cmluZztcbiAgZHVyYXRpb246IG51bWJlcjtcbiAgY29zdEFuYWx5c2lzPzogQ29zdEFuYWx5c2lzO1xuICBhbGVydFNlbnQ6IGJvb2xlYW47XG4gIHRocmVzaG9sZEV4Y2VlZGVkOiBib29sZWFuO1xuICBlcnJvcj86IHN0cmluZztcbiAgbWV0YWRhdGE6IFNwZW5kTW9uaXRvclRhc2tNZXRhZGF0YTtcbiAgcHJvZ3Jlc3NTdGVwczogVGFza1Byb2dyZXNzU3RlcFtdO1xufVxuXG4vKipcbiAqIFNwZW5kIG1vbml0b3JpbmcgdGFzayBpbXBsZW1lbnRhdGlvbiB3aXRoIHByb2dyZXNzIHRyYWNraW5nIGFuZCB2YWxpZGF0aW9uXG4gKi9cbmV4cG9ydCBjbGFzcyBTcGVuZE1vbml0b3JUYXNrIGV4dGVuZHMgVGFzayB7XG4gIHByaXZhdGUgbWV0YWRhdGE6IFNwZW5kTW9uaXRvclRhc2tNZXRhZGF0YTtcbiAgcHJpdmF0ZSBjb250ZXh0PzogU3BlbmRNb25pdG9yVGFza0NvbnRleHQ7XG5cbiAgY29uc3RydWN0b3IoY29uZmlnOiBTcGVuZE1vbml0b3JDb25maWcpIHtcbiAgICBzdXBlcigpO1xuICAgIFxuICAgIHRoaXMubWV0YWRhdGEgPSB7XG4gICAgICB0YXNrSWQ6IHRoaXMuZ2VuZXJhdGVUYXNrSWQoKSxcbiAgICAgIHRhc2tUeXBlOiAnc3BlbmQtbW9uaXRvcicsXG4gICAgICB0aHJlc2hvbGQ6IGNvbmZpZy5zcGVuZFRocmVzaG9sZCxcbiAgICAgIHJlZ2lvbjogY29uZmlnLnJlZ2lvbixcbiAgICAgIGNoZWNrUGVyaW9kRGF5czogY29uZmlnLmNoZWNrUGVyaW9kRGF5cyxcbiAgICAgIGNyZWF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgZXhlY3V0aW9uQ291bnQ6IDAsXG4gICAgICBzdGF0dXM6ICdwZW5kaW5nJ1xuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIHRhc2sgY29uZmlndXJhdGlvbiBhbmQgcHJlcmVxdWlzaXRlc1xuICAgKi9cbiAgYXN5bmMgdmFsaWRhdGUoY29uZmlnOiBTcGVuZE1vbml0b3JDb25maWcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgLy8gVmFsaWRhdGUgY29uZmlndXJhdGlvbiB1c2luZyBleGlzdGluZyB2YWxpZGF0aW9uIGZ1bmN0aW9uXG4gICAgICB2YWxpZGF0ZVNwZW5kTW9uaXRvckNvbmZpZyhjb25maWcpO1xuICAgICAgXG4gICAgICAvLyBBZGRpdGlvbmFsIHRhc2stc3BlY2lmaWMgdmFsaWRhdGlvbnNcbiAgICAgIGlmIChjb25maWcuc3BlbmRUaHJlc2hvbGQgPD0gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NwZW5kIHRocmVzaG9sZCBtdXN0IGJlIGdyZWF0ZXIgdGhhbiAwJyk7XG4gICAgICB9XG5cbiAgICAgIGlmIChjb25maWcuY2hlY2tQZXJpb2REYXlzIDw9IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDaGVjayBwZXJpb2QgZGF5cyBtdXN0IGJlIGdyZWF0ZXIgdGhhbiAwJyk7XG4gICAgICB9XG5cbiAgICAgIGNvbnNvbGUubG9nKCdUYXNrIHZhbGlkYXRpb24gY29tcGxldGVkIHN1Y2Nlc3NmdWxseScpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdUYXNrIHZhbGlkYXRpb24gZmFpbGVkOicsIGVycm9yKTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlcyB0aGUgc3BlbmQgbW9uaXRvcmluZyB0YXNrIHdpdGggcHJvZ3Jlc3MgdHJhY2tpbmdcbiAgICovXG4gIGFzeW5jIGV4ZWN1dGUoY29uZmlnOiBTcGVuZE1vbml0b3JDb25maWcpOiBQcm9taXNlPFNwZW5kTW9uaXRvclRhc2tSZXN1bHQ+IHtcbiAgICBjb25zdCBleGVjdXRpb25JZCA9IHRoaXMuZ2VuZXJhdGVFeGVjdXRpb25JZCgpO1xuICAgIGNvbnN0IHN0YXJ0VGltZSA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICBcbiAgICAvLyBJbml0aWFsaXplIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAgdGhpcy5jb250ZXh0ID0ge1xuICAgICAgY29uZmlnLFxuICAgICAgZXhlY3V0aW9uU3RhcnRUaW1lOiBzdGFydFRpbWUsXG4gICAgICBwcm9ncmVzc1N0ZXBzOiBbXG4gICAgICAgIHsgc3RlcDogJ3ZhbGlkYXRpb24nLCBzdGF0dXM6ICdwZW5kaW5nJyB9LFxuICAgICAgICB7IHN0ZXA6ICdjb3N0LWFuYWx5c2lzJywgc3RhdHVzOiAncGVuZGluZycgfSxcbiAgICAgICAgeyBzdGVwOiAndGhyZXNob2xkLWNoZWNrJywgc3RhdHVzOiAncGVuZGluZycgfSxcbiAgICAgICAgeyBzdGVwOiAnYWxlcnQtcHJvY2Vzc2luZycsIHN0YXR1czogJ3BlbmRpbmcnIH0sXG4gICAgICAgIHsgc3RlcDogJ2NsZWFudXAnLCBzdGF0dXM6ICdwZW5kaW5nJyB9XG4gICAgICBdXG4gICAgfTtcblxuICAgIC8vIFVwZGF0ZSBtZXRhZGF0YVxuICAgIHRoaXMubWV0YWRhdGEuc3RhdHVzID0gJ3J1bm5pbmcnO1xuICAgIHRoaXMubWV0YWRhdGEuZXhlY3V0aW9uQ291bnQrKztcbiAgICB0aGlzLm1ldGFkYXRhLmxhc3RFeGVjdXRlZCA9IHN0YXJ0VGltZTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zb2xlLmxvZyhgU3RhcnRpbmcgc3BlbmQgbW9uaXRvciB0YXNrIGV4ZWN1dGlvbjogJHtleGVjdXRpb25JZH1gKTtcblxuICAgICAgLy8gU3RlcCAxOiBWYWxpZGF0aW9uXG4gICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVTdGVwKCd2YWxpZGF0aW9uJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLnZhbGlkYXRlKGNvbmZpZyk7XG4gICAgICB9KTtcblxuICAgICAgLy8gU3RlcCAyOiBDb3N0IEFuYWx5c2lzICh0aGlzIHdvdWxkIGJlIGhhbmRsZWQgYnkgdGhlIGFnZW50KVxuICAgICAgYXdhaXQgdGhpcy5leGVjdXRlU3RlcCgnY29zdC1hbmFseXNpcycsIGFzeW5jICgpID0+IHtcbiAgICAgICAgLy8gVGhpcyBzdGVwIGlzIGEgcGxhY2Vob2xkZXIgLSBhY3R1YWwgY29zdCBhbmFseXNpcyBpcyBkb25lIGJ5IENvc3RBbmFseXNpc1Rvb2xcbiAgICAgICAgLy8gV2UganVzdCB0cmFjayB0aGF0IHRoaXMgc3RlcCBzaG91bGQgaGFwcGVuXG4gICAgICAgIGNvbnNvbGUubG9nKCdDb3N0IGFuYWx5c2lzIHN0ZXAgLSBkZWxlZ2F0ZWQgdG8gQ29zdEFuYWx5c2lzVG9vbCcpO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFN0ZXAgMzogVGhyZXNob2xkIENoZWNrXG4gICAgICBsZXQgdGhyZXNob2xkRXhjZWVkZWQgPSBmYWxzZTtcbiAgICAgIGF3YWl0IHRoaXMuZXhlY3V0ZVN0ZXAoJ3RocmVzaG9sZC1jaGVjaycsIGFzeW5jICgpID0+IHtcbiAgICAgICAgLy8gVGhpcyBzdGVwIGlzIGEgcGxhY2Vob2xkZXIgLSBhY3R1YWwgdGhyZXNob2xkIGNoZWNrIGlzIGRvbmUgYnkgdGhlIGFnZW50XG4gICAgICAgIC8vIFdlIGp1c3QgdHJhY2sgdGhhdCB0aGlzIHN0ZXAgc2hvdWxkIGhhcHBlblxuICAgICAgICBjb25zb2xlLmxvZygnVGhyZXNob2xkIGNoZWNrIHN0ZXAgLSBkZWxlZ2F0ZWQgdG8gYWdlbnQgbG9naWMnKTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBTdGVwIDQ6IEFsZXJ0IFByb2Nlc3NpbmdcbiAgICAgIGxldCBhbGVydFNlbnQgPSBmYWxzZTtcbiAgICAgIGF3YWl0IHRoaXMuZXhlY3V0ZVN0ZXAoJ2FsZXJ0LXByb2Nlc3NpbmcnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIC8vIFRoaXMgc3RlcCBpcyBhIHBsYWNlaG9sZGVyIC0gYWN0dWFsIGFsZXJ0IHNlbmRpbmcgaXMgZG9uZSBieSBBbGVydFRvb2xcbiAgICAgICAgLy8gV2UganVzdCB0cmFjayB0aGF0IHRoaXMgc3RlcCBzaG91bGQgaGFwcGVuXG4gICAgICAgIGNvbnNvbGUubG9nKCdBbGVydCBwcm9jZXNzaW5nIHN0ZXAgLSBkZWxlZ2F0ZWQgdG8gQWxlcnRUb29sJyk7XG4gICAgICB9KTtcblxuICAgICAgLy8gU3RlcCA1OiBDbGVhbnVwXG4gICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVTdGVwKCdjbGVhbnVwJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAvLyBDbGVhbnVwIGFueSB0ZW1wb3JhcnkgcmVzb3VyY2VzIG9yIHN0YXRlXG4gICAgICAgIGNvbnNvbGUubG9nKCdUYXNrIGNsZWFudXAgY29tcGxldGVkJyk7XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgZW5kVGltZSA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICAgIGNvbnN0IGR1cmF0aW9uID0gbmV3IERhdGUoZW5kVGltZSkuZ2V0VGltZSgpIC0gbmV3IERhdGUoc3RhcnRUaW1lKS5nZXRUaW1lKCk7XG5cbiAgICAgIHRoaXMubWV0YWRhdGEuc3RhdHVzID0gJ2NvbXBsZXRlZCc7XG5cbiAgICAgIGNvbnN0IHJlc3VsdDogU3BlbmRNb25pdG9yVGFza1Jlc3VsdCA9IHtcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICAgIHN0YXJ0VGltZSxcbiAgICAgICAgZW5kVGltZSxcbiAgICAgICAgZHVyYXRpb24sXG4gICAgICAgIGNvc3RBbmFseXNpczogdGhpcy5jb250ZXh0LmNvc3RBbmFseXNpcyxcbiAgICAgICAgYWxlcnRTZW50LFxuICAgICAgICB0aHJlc2hvbGRFeGNlZWRlZCxcbiAgICAgICAgbWV0YWRhdGE6IHsgLi4udGhpcy5tZXRhZGF0YSB9LFxuICAgICAgICBwcm9ncmVzc1N0ZXBzOiBbLi4udGhpcy5jb250ZXh0LnByb2dyZXNzU3RlcHNdXG4gICAgICB9O1xuXG4gICAgICBjb25zb2xlLmxvZyhgVGFzayBleGVjdXRpb24gY29tcGxldGVkIHN1Y2Nlc3NmdWxseTogJHtleGVjdXRpb25JZH1gKTtcbiAgICAgIHJldHVybiByZXN1bHQ7XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgZW5kVGltZSA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICAgIGNvbnN0IGR1cmF0aW9uID0gbmV3IERhdGUoZW5kVGltZSkuZ2V0VGltZSgpIC0gbmV3IERhdGUoc3RhcnRUaW1lKS5nZXRUaW1lKCk7XG5cbiAgICAgIHRoaXMubWV0YWRhdGEuc3RhdHVzID0gJ2ZhaWxlZCc7XG5cbiAgICAgIGNvbnN0IHJlc3VsdDogU3BlbmRNb25pdG9yVGFza1Jlc3VsdCA9IHtcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGV4ZWN1dGlvbklkLFxuICAgICAgICBzdGFydFRpbWUsXG4gICAgICAgIGVuZFRpbWUsXG4gICAgICAgIGR1cmF0aW9uLFxuICAgICAgICBhbGVydFNlbnQ6IGZhbHNlLFxuICAgICAgICB0aHJlc2hvbGRFeGNlZWRlZDogZmFsc2UsXG4gICAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvciksXG4gICAgICAgIG1ldGFkYXRhOiB7IC4uLnRoaXMubWV0YWRhdGEgfSxcbiAgICAgICAgcHJvZ3Jlc3NTdGVwczogdGhpcy5jb250ZXh0Py5wcm9ncmVzc1N0ZXBzIHx8IFtdXG4gICAgICB9O1xuXG4gICAgICBjb25zb2xlLmVycm9yKGBUYXNrIGV4ZWN1dGlvbiBmYWlsZWQ6ICR7ZXhlY3V0aW9uSWR9YCwgZXJyb3IpO1xuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYSBzaW5nbGUgc3RlcCB3aXRoIHByb2dyZXNzIHRyYWNraW5nXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGV4ZWN1dGVTdGVwKHN0ZXBOYW1lOiBzdHJpbmcsIHN0ZXBGdW5jdGlvbjogKCkgPT4gUHJvbWlzZTx2b2lkPik6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5jb250ZXh0KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Rhc2sgY29udGV4dCBub3QgaW5pdGlhbGl6ZWQnKTtcbiAgICB9XG5cbiAgICBjb25zdCBzdGVwID0gdGhpcy5jb250ZXh0LnByb2dyZXNzU3RlcHMuZmluZChzID0+IHMuc3RlcCA9PT0gc3RlcE5hbWUpO1xuICAgIGlmICghc3RlcCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTdGVwIG5vdCBmb3VuZDogJHtzdGVwTmFtZX1gKTtcbiAgICB9XG5cbiAgICBzdGVwLnN0YXR1cyA9ICdpbi1wcm9ncmVzcyc7XG4gICAgc3RlcC5zdGFydFRpbWUgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgc3RlcEZ1bmN0aW9uKCk7XG4gICAgICBzdGVwLnN0YXR1cyA9ICdjb21wbGV0ZWQnO1xuICAgICAgc3RlcC5lbmRUaW1lID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgY29uc29sZS5sb2coYFN0ZXAgY29tcGxldGVkOiAke3N0ZXBOYW1lfWApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBzdGVwLnN0YXR1cyA9ICdmYWlsZWQnO1xuICAgICAgc3RlcC5lbmRUaW1lID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgc3RlcC5lcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgIGNvbnNvbGUuZXJyb3IoYFN0ZXAgZmFpbGVkOiAke3N0ZXBOYW1lfWAsIGVycm9yKTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGVzIGNvc3QgYW5hbHlzaXMgcmVzdWx0cyBpbiB0aGUgdGFzayBjb250ZXh0XG4gICAqL1xuICBzZXRDb3N0QW5hbHlzaXMoY29zdEFuYWx5c2lzOiBDb3N0QW5hbHlzaXMpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5jb250ZXh0KSB7XG4gICAgICB0aGlzLmNvbnRleHQuY29zdEFuYWx5c2lzID0gY29zdEFuYWx5c2lzO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGVzIGFsZXJ0IGNvbnRleHQgaW4gdGhlIHRhc2sgY29udGV4dFxuICAgKi9cbiAgc2V0QWxlcnRDb250ZXh0KGFsZXJ0Q29udGV4dDogQWxlcnRDb250ZXh0KTogdm9pZCB7XG4gICAgaWYgKHRoaXMuY29udGV4dCkge1xuICAgICAgdGhpcy5jb250ZXh0LmFsZXJ0Q29udGV4dCA9IGFsZXJ0Q29udGV4dDtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR2V0cyBjdXJyZW50IHRhc2sgbWV0YWRhdGFcbiAgICovXG4gIGdldE1ldGFkYXRhKCk6IFNwZW5kTW9uaXRvclRhc2tNZXRhZGF0YSB7XG4gICAgcmV0dXJuIHsgLi4udGhpcy5tZXRhZGF0YSB9O1xuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgY3VycmVudCBleGVjdXRpb24gY29udGV4dFxuICAgKi9cbiAgZ2V0Q29udGV4dCgpOiBTcGVuZE1vbml0b3JUYXNrQ29udGV4dCB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMuY29udGV4dCA/IHsgLi4udGhpcy5jb250ZXh0IH0gOiB1bmRlZmluZWQ7XG4gIH1cblxuICAvKipcbiAgICogR2V0cyBjdXJyZW50IHByb2dyZXNzIHN0YXR1c1xuICAgKi9cbiAgZ2V0UHJvZ3Jlc3MoKTogeyBjb21wbGV0ZWQ6IG51bWJlcjsgdG90YWw6IG51bWJlcjsgY3VycmVudFN0ZXA/OiBzdHJpbmcgfSB7XG4gICAgaWYgKCF0aGlzLmNvbnRleHQpIHtcbiAgICAgIHJldHVybiB7IGNvbXBsZXRlZDogMCwgdG90YWw6IDAgfTtcbiAgICB9XG5cbiAgICBjb25zdCBjb21wbGV0ZWQgPSB0aGlzLmNvbnRleHQucHJvZ3Jlc3NTdGVwcy5maWx0ZXIocyA9PiBzLnN0YXR1cyA9PT0gJ2NvbXBsZXRlZCcpLmxlbmd0aDtcbiAgICBjb25zdCB0b3RhbCA9IHRoaXMuY29udGV4dC5wcm9ncmVzc1N0ZXBzLmxlbmd0aDtcbiAgICBjb25zdCBjdXJyZW50U3RlcCA9IHRoaXMuY29udGV4dC5wcm9ncmVzc1N0ZXBzLmZpbmQocyA9PiBzLnN0YXR1cyA9PT0gJ2luLXByb2dyZXNzJyk/LnN0ZXA7XG5cbiAgICByZXR1cm4geyBjb21wbGV0ZWQsIHRvdGFsLCBjdXJyZW50U3RlcCB9O1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc2V0cyB0YXNrIHN0YXRlIGZvciBuZXcgZXhlY3V0aW9uXG4gICAqL1xuICByZXNldCgpOiB2b2lkIHtcbiAgICB0aGlzLm1ldGFkYXRhLnN0YXR1cyA9ICdwZW5kaW5nJztcbiAgICB0aGlzLmNvbnRleHQgPSB1bmRlZmluZWQ7XG4gIH1cblxuICAvKipcbiAgICogR2VuZXJhdGVzIGEgdW5pcXVlIHRhc2sgSURcbiAgICovXG4gIHByaXZhdGUgZ2VuZXJhdGVUYXNrSWQoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gYHNwZW5kLW1vbml0b3ItJHtEYXRlLm5vdygpfS0ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnN1YnN0cigyLCA5KX1gO1xuICB9XG5cbiAgLyoqXG4gICAqIEdlbmVyYXRlcyBhIHVuaXF1ZSBleGVjdXRpb24gSURcbiAgICovXG4gIHByaXZhdGUgZ2VuZXJhdGVFeGVjdXRpb25JZCgpOiBzdHJpbmcge1xuICAgIHJldHVybiBgZXhlYy0ke0RhdGUubm93KCl9LSR7TWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc3Vic3RyKDIsIDkpfWA7XG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0YXNrIHN0YXRpc3RpY3NcbiAgICovXG4gIGdldFN0YXRpc3RpY3MoKToge1xuICAgIHRvdGFsRXhlY3V0aW9uczogbnVtYmVyO1xuICAgIGxhc3RFeGVjdXRlZD86IHN0cmluZztcbiAgICBjdXJyZW50U3RhdHVzOiBzdHJpbmc7XG4gICAgY3JlYXRlZEF0OiBzdHJpbmc7XG4gIH0ge1xuICAgIHJldHVybiB7XG4gICAgICB0b3RhbEV4ZWN1dGlvbnM6IHRoaXMubWV0YWRhdGEuZXhlY3V0aW9uQ291bnQsXG4gICAgICBsYXN0RXhlY3V0ZWQ6IHRoaXMubWV0YWRhdGEubGFzdEV4ZWN1dGVkLFxuICAgICAgY3VycmVudFN0YXR1czogdGhpcy5tZXRhZGF0YS5zdGF0dXMsXG4gICAgICBjcmVhdGVkQXQ6IHRoaXMubWV0YWRhdGEuY3JlYXRlZEF0XG4gICAgfTtcbiAgfVxufSJdfQ==