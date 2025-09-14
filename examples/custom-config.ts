import { SpendMonitorAgent, SpendMonitorConfig } from '../src/agent';

/**
 * Example showing how to customize the Spend Monitor Agent
 * for different environments and use cases
 */

// Development environment configuration
export const devConfig: SpendMonitorConfig = {
  name: 'spend-monitor-dev',
  description: 'Development environment spend monitoring',
  spendThreshold: 5, // Lower threshold for dev
  snsTopicArn: process.env.DEV_SNS_TOPIC_ARN || '',
  checkPeriodDays: 1,
  version: '1.0.0'
};

// Production environment configuration
export const prodConfig: SpendMonitorConfig = {
  name: 'spend-monitor-prod',
  description: 'Production environment spend monitoring',
  spendThreshold: 100, // Higher threshold for production
  snsTopicArn: process.env.PROD_SNS_TOPIC_ARN || '',
  checkPeriodDays: 1,
  version: '1.0.0'
};

// Staging environment with more frequent checks
export const stagingConfig: SpendMonitorConfig = {
  name: 'spend-monitor-staging',
  description: 'Staging environment with frequent monitoring',
  spendThreshold: 25,
  snsTopicArn: process.env.STAGING_SNS_TOPIC_ARN || '',
  checkPeriodDays: 0.5, // Check twice daily
  version: '1.0.0'
};

/**
 * Factory function to create agents for different environments
 */
export function createSpendMonitorAgent(environment: 'dev' | 'staging' | 'prod'): SpendMonitorAgent {
  let config: SpendMonitorConfig;
  
  switch (environment) {
    case 'dev':
      config = devConfig;
      break;
    case 'staging':
      config = stagingConfig;
      break;
    case 'prod':
      config = prodConfig;
      break;
    default:
      throw new Error(`Unknown environment: ${environment}`);
  }
  
  return new SpendMonitorAgent(config);
}

/**
 * Example of running different configurations
 */
async function demonstrateConfigurations() {
  console.log('🔧 Demonstrating different agent configurations...\n');
  
  const environments = ['dev', 'staging', 'prod'] as const;
  
  for (const env of environments) {
    try {
      console.log(`📋 ${env.toUpperCase()} Configuration:`);
      const agent = createSpendMonitorAgent(env);
      await agent.initialize();
      
      console.log(`   ✅ Agent created for ${env} environment`);
      console.log(`   💰 Threshold: $${agent['config'].spendThreshold}`);
      console.log(`   ⏰ Check frequency: Every ${agent['config'].checkPeriodDays} day(s)\n`);
      
    } catch (error) {
      console.error(`   ❌ Failed to create ${env} agent:`, error);
    }
  }
}

if (require.main === module) {
  demonstrateConfigurations();
}