import { SpendMonitorAgent, SpendMonitorConfig } from '../src/agent';

/**
 * Local testing example for the Spend Monitor Agent
 * This demonstrates how to run the agent locally for development and testing
 */
async function testSpendMonitorAgent() {
  console.log('🚀 Testing Spend Monitor Agent locally...\n');

  // Mock configuration for local testing
  const config: SpendMonitorConfig = {
    name: 'spend-monitor-agent-test',
    description: 'Local test of spend monitoring agent',
    spendThreshold: 5, // Lower threshold for testing
    snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic', // Mock ARN
    checkPeriodDays: 1,
    version: '1.0.0'
  };

  try {
    // Create and initialize agent
    const agent = new SpendMonitorAgent(config);
    await agent.initialize();

    console.log('✅ Agent initialized successfully');
    console.log(`📊 Monitoring threshold: $${config.spendThreshold}`);
    console.log(`📅 Check period: ${config.checkPeriodDays} day(s)\n`);

    // Execute monitoring check
    console.log('🔍 Running spend analysis...');
    await agent.execute();

    console.log('\n✅ Test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    
    if (error instanceof Error) {
      console.error('Error details:', error.message);
      
      // Common issues and suggestions
      if (error.message.includes('credentials')) {
        console.log('\n💡 Tip: Make sure AWS credentials are configured');
        console.log('   Run: aws configure');
      }
      
      if (error.message.includes('Cost Explorer')) {
        console.log('\n💡 Tip: Cost Explorer API requires billing permissions');
        console.log('   Ensure your AWS user/role has ce:GetCostAndUsage permission');
      }
    }
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testSpendMonitorAgent()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { testSpendMonitorAgent };