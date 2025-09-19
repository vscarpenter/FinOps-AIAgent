/**
 * Mock implementation of strands-agents for testing and development
 */

export interface AgentConfig {
  region?: string;
  retryAttempts?: number;
  [key: string]: any;
}

export class Agent {
  protected config: AgentConfig;
  protected tools: Map<string, Tool> = new Map();
  protected tasks: Map<string, Task> = new Map();
  protected logger = {
    info: (message: string, meta?: any) => console.log(`[INFO] ${message}`, meta || ''),
    error: (message: string, meta?: any) => console.error(`[ERROR] ${message}`, meta || ''),
    warn: (message: string, meta?: any) => console.warn(`[WARN] ${message}`, meta || ''),
    debug: (message: string, meta?: any) => console.debug(`[DEBUG] ${message}`, meta || '')
  };

  constructor(config: AgentConfig) {
    this.config = config;
  }
  
  registerTool(tool: Tool): void {
    this.tools.set(tool.constructor.name, tool);
  }
  
  registerTask(task: Task): void {
    this.tasks.set(task.constructor.name, task);
  }
  
  getRegisteredTools(): Tool[] {
    return Array.from(this.tools.values());
  }
  
  getRegisteredTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getTask(name: string): Task | undefined {
    return this.tasks.get(name);
  }
}

export class Tool {
  protected logger = {
    info: (message: string, meta?: any) => console.log(`[TOOL INFO] ${message}`, meta || ''),
    error: (message: string, meta?: any) => console.error(`[TOOL ERROR] ${message}`, meta || ''),
    warn: (message: string, meta?: any) => console.warn(`[TOOL WARN] ${message}`, meta || ''),
    debug: (message: string, meta?: any) => console.debug(`[TOOL DEBUG] ${message}`, meta || '')
  };

  constructor() {}
}

export class Task {
  protected logger = {
    info: (message: string, meta?: any) => console.log(`[TASK INFO] ${message}`, meta || ''),
    error: (message: string, meta?: any) => console.error(`[TASK ERROR] ${message}`, meta || ''),
    warn: (message: string, meta?: any) => console.warn(`[TASK WARN] ${message}`, meta || ''),
    debug: (message: string, meta?: any) => console.debug(`[TASK DEBUG] ${message}`, meta || '')
  };

  constructor() {}
}