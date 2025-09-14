import { Task } from 'strands-agents';
import { SpendMonitorConfig, CostAnalysis, AlertContext } from '../types';
import { validateSpendMonitorConfig } from '../validation';

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
export class SpendMonitorTask extends Task {
  private metadata: SpendMonitorTaskMetadata;
  private context?: SpendMonitorTaskContext;

  constructor(config: SpendMonitorConfig) {
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
  async validate(config: SpendMonitorConfig): Promise<void> {
    try {
      // Validate configuration using existing validation function
      validateSpendMonitorConfig(config);
      
      // Additional task-specific validations
      if (config.spendThreshold <= 0) {
        throw new Error('Spend threshold must be greater than 0');
      }

      if (config.checkPeriodDays <= 0) {
        throw new Error('Check period days must be greater than 0');
      }

      console.log('Task validation completed successfully');
    } catch (error) {
      console.error('Task validation failed:', error);
      throw error;
    }
  }

  /**
   * Executes the spend monitoring task with progress tracking
   */
  async execute(config: SpendMonitorConfig): Promise<SpendMonitorTaskResult> {
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

      const result: SpendMonitorTaskResult = {
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

    } catch (error) {
      const endTime = new Date().toISOString();
      const duration = new Date(endTime).getTime() - new Date(startTime).getTime();

      this.metadata.status = 'failed';

      const result: SpendMonitorTaskResult = {
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
  private async executeStep(stepName: string, stepFunction: () => Promise<void>): Promise<void> {
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
    } catch (error) {
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
  setCostAnalysis(costAnalysis: CostAnalysis): void {
    if (this.context) {
      this.context.costAnalysis = costAnalysis;
    }
  }

  /**
   * Updates alert context in the task context
   */
  setAlertContext(alertContext: AlertContext): void {
    if (this.context) {
      this.context.alertContext = alertContext;
    }
  }

  /**
   * Gets current task metadata
   */
  getMetadata(): SpendMonitorTaskMetadata {
    return { ...this.metadata };
  }

  /**
   * Gets current execution context
   */
  getContext(): SpendMonitorTaskContext | undefined {
    return this.context ? { ...this.context } : undefined;
  }

  /**
   * Gets current progress status
   */
  getProgress(): { completed: number; total: number; currentStep?: string } {
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
  reset(): void {
    this.metadata.status = 'pending';
    this.context = undefined;
  }

  /**
   * Generates a unique task ID
   */
  private generateTaskId(): string {
    return `spend-monitor-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generates a unique execution ID
   */
  private generateExecutionId(): string {
    return `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Gets task statistics
   */
  getStatistics(): {
    totalExecutions: number;
    lastExecuted?: string;
    currentStatus: string;
    createdAt: string;
  } {
    return {
      totalExecutions: this.metadata.executionCount,
      lastExecuted: this.metadata.lastExecuted,
      currentStatus: this.metadata.status,
      createdAt: this.metadata.createdAt
    };
  }
}