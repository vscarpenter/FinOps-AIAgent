declare module 'strands-agents' {
  export interface AgentConfig {
    region?: string;
    retryAttempts?: number;
    [key: string]: any;
  }

  export class Agent {
    protected config: AgentConfig;
    protected logger: {
      info: (message: string, meta?: any) => void;
      error: (message: string, meta?: any) => void;
      warn: (message: string, meta?: any) => void;
      debug: (message: string, meta?: any) => void;
    };

    constructor(config: AgentConfig);
    
    registerTool(tool: Tool): void;
    registerTask(task: Task): void;
    getRegisteredTools(): Tool[];
    getRegisteredTasks(): Task[];
  }

  export class Tool {
    protected logger: {
      info: (message: string, meta?: any) => void;
      error: (message: string, meta?: any) => void;
      warn: (message: string, meta?: any) => void;
      debug: (message: string, meta?: any) => void;
    };

    constructor();
  }

  export class Task {
    protected logger: {
      info: (message: string, meta?: any) => void;
      error: (message: string, meta?: any) => void;
      warn: (message: string, meta?: any) => void;
      debug: (message: string, meta?: any) => void;
    };

    constructor();
  }
}