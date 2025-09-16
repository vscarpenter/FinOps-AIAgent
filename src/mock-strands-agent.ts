/**
 * Mock implementation of AWS Strands Agent for development/demo purposes
 * Replace this with the actual AWS Strands Agent when available
 */

export class Tool {
  protected logger: any;
  constructor() {
    this.logger = console;
  }
}

export class Task {
  constructor() {}
}

export interface AgentConfig {
  [key: string]: any;
}

export class Agent {
  protected tools: Tool[] = [];
  protected tasks: Task[] = [];
  protected config: any;

  constructor(config: any) {
    this.config = config;
  }

  /**
   * Register a tool with the agent
   */
  registerTool(tool: Tool): void {
    this.tools.push(tool);
  }

  /**
   * Register a task with the agent
   */
  registerTask(task: Task): void {
    this.tasks.push(task);
  }

  /**
   * Get all registered tools
   */
  getRegisteredTools(): Tool[] {
    return [...this.tools];
  }

  /**
   * Get all registered tasks
   */
  getRegisteredTasks(): Task[] {
    return [...this.tasks];
  }

  /**
   * Initialize method - to be overridden by subclasses
   */
  async initialize(): Promise<void> {
    // Override in subclass
  }

  /**
   * Execute method - to be overridden by subclasses
   */
  async execute(): Promise<void> {
    // Override in subclass
  }
}