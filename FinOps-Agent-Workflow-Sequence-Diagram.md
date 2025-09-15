# FinOps AI Agent - Workflow Sequence Diagram

## Architecture Overview

The FinOps AI Agent is a comprehensive AWS-native serverless application that monitors spending and sends multi-channel alerts. It leverages AWS Strands AI framework for intelligent orchestration and includes advanced iOS push notification capabilities.

## Sequence Diagram

```mermaid
sequenceDiagram
    participant User as User/iOS App
    participant EventBridge as AWS EventBridge
    participant Lambda as Lambda Function
    participant Agent as SpendMonitorAgent
    participant Task as SpendMonitorTask
    participant CostTool as CostAnalysisTool
    participant AlertTool as AlertTool
    participant iOSTool as iOSManagementTool
    participant CostExplorer as AWS Cost Explorer
    participant SNS as AWS SNS
    participant APNS as Apple Push Service
    participant DynamoDB as DynamoDB
    participant CloudWatch as CloudWatch

    Note over EventBridge,CloudWatch: Daily Scheduled Execution (9:00 UTC)

    EventBridge->>Lambda: Trigger daily execution
    Lambda->>Agent: handler() - Initialize agent

    rect rgb(240, 248, 255)
        Note over Agent: Agent Initialization Phase
        Agent->>Agent: validateConfiguration()
        Agent->>Agent: initializeTools()
        Agent->>Agent: initializeTasks()

        opt iOS Configuration Present
            Agent->>iOSTool: new iOSManagementTool()
            Agent->>iOSTool: performComprehensiveHealthCheck()
            iOSTool->>SNS: validateAPNSConfig()
            iOSTool->>DynamoDB: validateDeviceTokenTable()
            iOSTool-->>Agent: Health check results

            opt Health Issues Detected
                Agent->>iOSTool: performAutomatedRecovery()
                iOSTool-->>Agent: Recovery results
            end
        end

        Agent->>CostTool: new CostAnalysisTool()
        Agent->>AlertTool: new AlertTool()
        Agent->>Task: new SpendMonitorTask()
    end

    rect rgb(248, 255, 248)
        Note over Agent,Task: Task Execution Phase
        Agent->>Task: execute(config)

        Task->>Task: executeStep('validation')
        Task->>Task: executeStep('cost-analysis')
        Task->>Task: executeStep('threshold-check')
        Task->>Task: executeStep('alert-processing')
        Task->>Task: executeStep('cleanup')
    end

    rect rgb(255, 248, 248)
        Note over Agent,CostExplorer: Cost Analysis Phase
        Agent->>CostTool: getCurrentMonthCosts()

        loop Retry Logic (up to 3 attempts)
            CostTool->>CostExplorer: GetCostAndUsageCommand
            CostExplorer-->>CostTool: Cost data response
        end

        CostTool->>CostTool: formatCostData()
        CostTool->>CostTool: calculateProjectedMonthlyCost()
        CostTool-->>Agent: CostAnalysis object

        Agent->>Task: setCostAnalysis(costAnalysis)
    end

    rect rgb(255, 255, 240)
        Note over Agent,AlertTool: Threshold Check & Alert Phase
        Agent->>Agent: checkThresholdAndAlert(costAnalysis)

        alt Spending > Threshold
            Agent->>Agent: createAlertContext()
            Agent->>Task: setAlertContext(alertContext)

            Agent->>AlertTool: sendSpendAlert(costAnalysis, alertContext, topicArn, iosConfig)

            AlertTool->>AlertTool: formatAlertMessage() (Email/SMS)
            AlertTool->>AlertTool: formatSMSMessage()

            opt iOS Configuration Present
                AlertTool->>AlertTool: formatIOSPayload()
                AlertTool->>AlertTool: Create JSON message structure
            end

            AlertTool->>SNS: PublishCommand (Multi-channel message)

            par Email/SMS Delivery
                SNS->>SNS: Process email subscriptions
                SNS->>SNS: Process SMS subscriptions
            and iOS Push Delivery (if configured)
                SNS->>APNS: Send push notification
                APNS->>User: iOS push notification
            end

            SNS-->>AlertTool: Message delivery confirmation
            AlertTool-->>Agent: Alert sent successfully

            opt iOS Delivery Failure
                AlertTool->>AlertTool: detectIOSError()
                AlertTool->>SNS: PublishCommand (Fallback to email/SMS only)
                SNS-->>AlertTool: Fallback delivery confirmation
            end

        else Spending <= Threshold
            Agent->>Agent: Log "within threshold"
        end
    end

    rect rgb(248, 248, 255)
        Note over Agent,CloudWatch: Metrics & Monitoring Phase
        Agent->>CloudWatch: Record execution metrics
        AlertTool->>CloudWatch: Record alert delivery metrics

        opt iOS Metrics
            iOSTool->>CloudWatch: Record iOS notification metrics
            iOSTool->>CloudWatch: Record APNS health metrics
            iOSTool->>CloudWatch: Record device token metrics
        end

        Agent->>CloudWatch: Record spend metrics
        Agent->>CloudWatch: Record performance metrics
    end

    rect rgb(240, 240, 240)
        Note over Lambda,CloudWatch: Execution Completion
        Agent-->>Lambda: Execution results
        Lambda->>CloudWatch: Log execution details
        Lambda-->>EventBridge: Execution complete
    end

    Note over User,CloudWatch: Separate Device Registration Flow (API Gateway)

    rect rgb(255, 250, 240)
        Note over User,DynamoDB: iOS Device Registration (Separate API)
        User->>API Gateway: POST /devices (Register device token)
        API Gateway->>Device Registration Lambda: Process registration
        Device Registration Lambda->>SNS: CreatePlatformEndpoint
        Device Registration Lambda->>DynamoDB: Store device token mapping
        Device Registration Lambda-->>User: Registration confirmation
    end
```

## Component Interaction Details

### 1. **Infrastructure Layer (AWS CDK)**
- **EventBridge Rule**: Triggers daily execution at 9:00 UTC
- **Lambda Function**: Hosts the Strands AI agent
- **SNS Topics**: Handle multi-channel alert delivery
- **DynamoDB Table**: Stores iOS device tokens
- **API Gateway**: Provides device registration endpoints
- **CloudWatch**: Monitoring, metrics, and alarms

### 2. **AI Agent Layer (AWS Strands Framework)**
- **SpendMonitorAgent**: Main orchestrator extending Strands Agent base class
- **SpendMonitorTask**: Task that manages execution workflow with progress tracking
- **Tool Registration**: Automated registration of tools with the agent framework

### 3. **Tools Layer**
- **CostAnalysisTool**: Interfaces with AWS Cost Explorer API
- **AlertTool**: Handles multi-channel alert formatting and delivery
- **iOSManagementTool**: Manages iOS push notifications and device health

### 4. **Data Flow**
1. **Cost Collection**: Real-time AWS spending data from Cost Explorer
2. **Analysis**: Current vs. projected spending calculations
3. **Decision Making**: Threshold comparison and alert level determination
4. **Multi-Channel Delivery**: Email, SMS, and iOS push notifications
5. **Metrics Collection**: Performance and delivery metrics to CloudWatch

### 5. **Error Handling & Resilience**
- **Retry Logic**: Exponential backoff for AWS API calls
- **iOS Fallback**: Automatic fallback to email/SMS if iOS delivery fails
- **Health Monitoring**: Comprehensive health checks for all components
- **Automated Recovery**: Self-healing capabilities for common issues

### 6. **Security & Compliance**
- **IAM Roles**: Least privilege access for all components
- **API Key Protection**: Rate-limited device registration API
- **APNS Certificate Management**: Automated certificate health monitoring
- **Data Encryption**: At-rest and in-transit encryption for all data

## Key Features

### **Intelligent Orchestration**
- AWS Strands framework provides AI-driven task orchestration
- Progress tracking and step-by-step execution monitoring
- Automatic error recovery and retry logic

### **Multi-Channel Alerting**
- **Email**: Rich formatted alerts with spending breakdown
- **SMS**: Concise alerts optimized for mobile
- **iOS Push**: Native push notifications with custom data

### **Advanced iOS Integration**
- Device token management with DynamoDB storage
- APNS certificate health monitoring with expiration alerts
- Automatic fallback mechanisms for delivery failures
- Comprehensive device lifecycle management

### **Operational Excellence**
- CloudWatch dashboard with 20+ custom metrics
- Automated alarms for system health monitoring
- Comprehensive logging and distributed tracing
- Performance optimization with caching and batching

This architecture provides a robust, scalable, and intelligent FinOps solution that leverages modern AWS services and AI frameworks for automated financial operations monitoring.