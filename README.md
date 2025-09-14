# FinOps AI Agent

An AI agent built with AWS Strands framework that monitors AWS spending and sends alerts when monthly costs exceed $10.

## Overview

This agent demonstrates key AWS Strands concepts:
- Agent definition and configuration
- AWS service integration (Cost Explorer, SNS)
- Automated monitoring and alerting
- Event-driven architecture

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   EventBridge   │───▶│  Strands Agent   │───▶│      SNS        │
│   (Schedule)    │    │ (Spend Monitor)  │    │   (Alerts)      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │  Cost Explorer   │
                       │     API          │
                       └──────────────────┘
```

## Features

- Daily spend monitoring
- Configurable spend thresholds
- Email/SMS notifications via SNS
- Cost breakdown by service
- Trend analysis and predictions

## Setup

1. Deploy the infrastructure: `cdk deploy`
2. Configure SNS topic subscription
3. Agent runs automatically on schedule

## Configuration

- Spend threshold: $10/month (configurable)
- Check frequency: Daily at 9 AM UTC
- Notification methods: Email, SMS