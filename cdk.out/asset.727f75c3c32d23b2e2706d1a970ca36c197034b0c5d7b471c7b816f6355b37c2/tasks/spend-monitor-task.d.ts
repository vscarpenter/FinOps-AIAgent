import { Task } from 'strands-agents';
import { SpendMonitorConfig, CostAnalysis, AlertContext } from '../types';
/**
 * Task metadata interface for spend monitoring
 */
export interface SpendMonitorTaskMetadata {
    taskId: string;
    taskType: 'spend-monitor';
    threshold: number;
    region: string;
    checkPeriodDays: number;
    createdAt: string;
    lastExecuted?: string;
    executionCount: number;
    status: 'pending' | 'running' | 'completed' | 'failed';
}
/**
 * Task execution context for spend monitoring
 */
export interface SpendMonitorTaskContext {
    config: SpendMonitorConfig;
    costAnalysis?: CostAnalysis;
    alertContext?: AlertContext;
    executionStartTime: string;
    progressSteps: TaskProgressStep[];
}
/**
 * Progress tracking for task execution
 */
export interface TaskProgressStep {
    step: string;
    status: 'pending' | 'in-progress' | 'completed' | 'failed';
    startTime?: string;
    endTime?: string;
    error?: string;
    details?: any;
}
/**
 * Task execution result
 */
export interface SpendMonitorTaskResult {
    success: boolean;
    executionId: string;
    startTime: string;
    endTime: string;
    duration: number;
    costAnalysis?: CostAnalysis;
    alertSent: boolean;
    thresholdExceeded: boolean;
    error?: string;
    metadata: SpendMonitorTaskMetadata;
    progressSteps: TaskProgressStep[];
}
/**
 * Spend monitoring task implementation with progress tracking and validation
 */
export declare class SpendMonitorTask extends Task {
    private metadata;
    private context?;
    constructor(config: SpendMonitorConfig);
    /**
     * Validates task configuration and prerequisites
     */
    validate(config: SpendMonitorConfig): Promise<void>;
    /**
     * Executes the spend monitoring task with progress tracking
     */
    execute(config: SpendMonitorConfig): Promise<SpendMonitorTaskResult>;
    /**
     * Executes a single step with progress tracking
     */
    private executeStep;
    /**
     * Updates cost analysis results in the task context
     */
    setCostAnalysis(costAnalysis: CostAnalysis): void;
    /**
     * Updates alert context in the task context
     */
    setAlertContext(alertContext: AlertContext): void;
    /**
     * Gets current task metadata
     */
    getMetadata(): SpendMonitorTaskMetadata;
    /**
     * Gets current execution context
     */
    getContext(): SpendMonitorTaskContext | undefined;
    /**
     * Gets current progress status
     */
    getProgress(): {
        completed: number;
        total: number;
        currentStep?: string;
    };
    /**
     * Resets task state for new execution
     */
    reset(): void;
    /**
     * Generates a unique task ID
     */
    private generateTaskId;
    /**
     * Generates a unique execution ID
     */
    private generateExecutionId;
    /**
     * Gets task statistics
     */
    getStatistics(): {
        totalExecutions: number;
        lastExecuted?: string;
        currentStatus: string;
        createdAt: string;
    };
}
