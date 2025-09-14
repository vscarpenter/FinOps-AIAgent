# Product Overview

## AWS Spend Monitor Agent

An AI agent built with the AWS Strands framework that automatically monitors AWS spending and sends alerts when monthly costs exceed configurable thresholds.

### Core Purpose
- Monitor AWS costs in real-time using Cost Explorer API
- Send proactive alerts via SNS when spending thresholds are exceeded
- Provide detailed cost breakdowns by AWS service
- Enable automated cost management and budget control

### Key Features
- **Automated Monitoring**: Daily spend checks via EventBridge scheduling
- **Configurable Thresholds**: Customizable spend limits (default: $10/month)
- **Multi-Channel Alerts**: Email and SMS notifications through SNS
- **Service Breakdown**: Detailed cost analysis by AWS service
- **Trend Analysis**: Projected monthly costs based on current usage
- **Event-Driven Architecture**: Serverless execution with Lambda

### Target Use Cases
- Personal AWS account cost monitoring
- Small team budget management
- Development environment cost control
- Learning AWS Strands framework concepts
- Demonstrating AI agent patterns for cost optimization

### Business Value
- Prevents unexpected AWS bills through proactive monitoring
- Enables quick response to cost spikes
- Provides visibility into service-level spending patterns
- Reduces manual cost monitoring overhead