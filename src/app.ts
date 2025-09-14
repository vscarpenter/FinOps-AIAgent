#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SpendMonitorStack } from './infrastructure';

const app = new cdk.App();

new SpendMonitorStack(app, 'SpendMonitorStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
  },
  description: 'AWS Strands agent for monitoring spend and generating alerts'
});

app.synth();