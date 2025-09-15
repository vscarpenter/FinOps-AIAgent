#!/usr/bin/env node

/**
 * Configuration Validation Script
 * 
 * This script validates the AWS Spend Monitor configuration including
 * iOS settings, AWS service access, and deployment prerequisites.
 */

import { ConfigValidator, validateEnvironmentVariables, createSampleConfig } from '../src/utils/config-validator';
import { SpendMonitorConfigValidation } from '../src/utils/config-validator';

interface CliOptions {
  config?: string;
  region?: string;
  skipAws?: boolean;
  skipNetwork?: boolean;
  sample?: boolean;
  help?: boolean;
  verbose?: boolean;
}

class ConfigValidationCli {
  private options: CliOptions;

  constructor(options: CliOptions) {
    this.options = options;
  }

  async run(): Promise<number> {
    try {
      if (this.options.help) {
        this.showHelp();
        return 0;
      }

      if (this.options.sample) {
        this.showSampleConfig();
        return 0;
      }

      console.log('🔍 AWS Spend Monitor Configuration Validation');
      console.log('==============================================\n');

      // Load configuration
      const config = await this.loadConfiguration();
      if (!config) {
        console.error('❌ Failed to load configuration');
        return 1;
      }

      // Validate environment variables
      console.log('📋 Validating environment variables...');
      const envResult = validateEnvironmentVariables();
      this.printValidationResult(envResult);

      // Validate configuration
      console.log('\n⚙️  Validating configuration...');
      const validator = new ConfigValidator(this.options.region || config.region);
      const configResult = await validator.validateConfiguration(config, {
        skipAwsValidation: this.options.skipAws,
        skipNetworkTests: this.options.skipNetwork,
        region: this.options.region
      });
      this.printValidationResult(configResult);

      // Validate Lambda function if deployed
      console.log('\n🔧 Validating Lambda function...');
      const lambdaResult = await this.validateLambdaFunction(validator);
      this.printValidationResult(lambdaResult);

      // Generate summary
      const totalErrors = envResult.errors.length + configResult.errors.length + lambdaResult.errors.length;
      const totalWarnings = envResult.warnings.length + configResult.warnings.length + lambdaResult.warnings.length;

      console.log('\n📊 Validation Summary');
      console.log('====================');
      console.log(`Total Errors: ${totalErrors}`);
      console.log(`Total Warnings: ${totalWarnings}`);

      if (totalErrors === 0) {
        console.log('\n✅ Configuration validation passed!');
        if (totalWarnings > 0) {
          console.log(`⚠️  Note: ${totalWarnings} warning(s) to review`);
        }
        return 0;
      } else {
        console.log('\n❌ Configuration validation failed');
        console.log('Please fix the errors above before deploying');
        return 1;
      }

    } catch (error) {
      console.error('❌ Validation failed with error:', error instanceof Error ? error.message : 'Unknown error');
      return 1;
    }
  }

  private async loadConfiguration(): Promise<SpendMonitorConfigValidation | null> {
    try {
      if (this.options.config) {
        // Load from file
        const fs = await import('fs');
        const configData = JSON.parse(fs.readFileSync(this.options.config, 'utf8'));
        return configData;
      } else {
        // Load from environment variables
        const spendThreshold = parseFloat(process.env.SPEND_THRESHOLD || '10');
        const snsTopicArn = process.env.SNS_TOPIC_ARN;
        const region = process.env.AWS_REGION || 'us-east-1';

        if (!snsTopicArn) {
          console.error('❌ SNS_TOPIC_ARN environment variable is required');
          return null;
        }

        const config: SpendMonitorConfigValidation = {
          spendThreshold,
          snsTopicArn,
          region,
          checkPeriodDays: parseInt(process.env.CHECK_PERIOD_DAYS || '1'),
          retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3'),
          minServiceCostThreshold: parseFloat(process.env.MIN_SERVICE_COST_THRESHOLD || '1')
        };

        // Add iOS config if available
        const iosPlatformArn = process.env.IOS_PLATFORM_APP_ARN;
        const iosBundleId = process.env.IOS_BUNDLE_ID;

        if (iosPlatformArn && iosBundleId) {
          config.iosConfig = {
            platformApplicationArn: iosPlatformArn,
            bundleId: iosBundleId,
            sandbox: process.env.APNS_SANDBOX === 'true'
          };
        }

        return config;
      }
    } catch (error) {
      console.error('❌ Failed to load configuration:', error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  private async validateLambdaFunction(validator: ConfigValidator) {
    const functionNames = ['spend-monitor-agent', 'aws-spend-monitor', 'SpendMonitorAgent'];
    
    for (const functionName of functionNames) {
      try {
        const result = await validator.validateLambdaFunction(functionName);
        if (result.isValid || result.errors.some(e => !e.includes('Cannot access Lambda function'))) {
          return result;
        }
      } catch (error) {
        // Continue to next function name
      }
    }

    return {
      isValid: false,
      errors: [],
      warnings: ['Lambda function not found - may not be deployed yet'],
      info: []
    };
  }

  private printValidationResult(result: any): void {
    if (result.errors.length > 0) {
      console.log('❌ Errors:');
      result.errors.forEach((error: string) => console.log(`   • ${error}`));
    }

    if (result.warnings.length > 0) {
      console.log('⚠️  Warnings:');
      result.warnings.forEach((warning: string) => console.log(`   • ${warning}`));
    }

    if (this.options.verbose && result.info.length > 0) {
      console.log('ℹ️  Information:');
      result.info.forEach((info: string) => console.log(`   • ${info}`));
    }
  }

  private showSampleConfig(): void {
    const sampleConfig = createSampleConfig();
    console.log('📄 Sample Configuration');
    console.log('======================\n');
    console.log('Environment Variables:');
    console.log(`SPEND_THRESHOLD=${sampleConfig.spendThreshold}`);
    console.log(`SNS_TOPIC_ARN=${sampleConfig.snsTopicArn}`);
    console.log(`AWS_REGION=${sampleConfig.region}`);
    console.log(`CHECK_PERIOD_DAYS=${sampleConfig.checkPeriodDays}`);
    console.log(`RETRY_ATTEMPTS=${sampleConfig.retryAttempts}`);
    console.log(`MIN_SERVICE_COST_THRESHOLD=${sampleConfig.minServiceCostThreshold}`);
    
    if (sampleConfig.iosConfig) {
      console.log('\niOS Configuration:');
      console.log(`IOS_PLATFORM_APP_ARN=${sampleConfig.iosConfig.platformApplicationArn}`);
      console.log(`IOS_BUNDLE_ID=${sampleConfig.iosConfig.bundleId}`);
      console.log(`APNS_SANDBOX=${sampleConfig.iosConfig.sandbox}`);
    }

    console.log('\nJSON Configuration File:');
    console.log(JSON.stringify(sampleConfig, null, 2));
  }

  private showHelp(): void {
    console.log('AWS Spend Monitor Configuration Validator');
    console.log('========================================\n');
    console.log('Usage: npm run validate:config [options]\n');
    console.log('Options:');
    console.log('  --config FILE       Load configuration from JSON file');
    console.log('  --region REGION     Override AWS region');
    console.log('  --skip-aws          Skip AWS service validation');
    console.log('  --skip-network      Skip network connectivity tests');
    console.log('  --sample            Show sample configuration');
    console.log('  --verbose           Show detailed information');
    console.log('  --help              Show this help message\n');
    console.log('Examples:');
    console.log('  npm run validate:config');
    console.log('  npm run validate:config -- --config config.json');
    console.log('  npm run validate:config -- --skip-aws --verbose');
    console.log('  npm run validate:config -- --sample');
  }
}

// Parse command line arguments
function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--config':
        options.config = args[++i];
        break;
      case '--region':
        options.region = args[++i];
        break;
      case '--skip-aws':
        options.skipAws = true;
        break;
      case '--skip-network':
        options.skipNetwork = true;
        break;
      case '--sample':
        options.sample = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        process.exit(1);
    }
  }

  return options;
}

// Main execution
async function main() {
  const options = parseArgs();
  const cli = new ConfigValidationCli(options);
  const exitCode = await cli.run();
  process.exit(exitCode);
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}