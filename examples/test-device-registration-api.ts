/**
 * Test script for Device Registration API
 * 
 * This script demonstrates how to test the device registration API endpoints
 * and can be used for manual testing and validation.
 */

import https from 'https';
import { URL } from 'url';

interface TestConfig {
  apiUrl: string;
  apiKey: string;
  testUserId: string;
  testDeviceToken: string;
}

class DeviceRegistrationAPITester {
  private config: TestConfig;

  constructor(config: TestConfig) {
    this.config = config;
  }

  /**
   * Make HTTP request to API
   */
  private async makeRequest(
    method: string,
    path: string,
    body?: any,
    queryParams?: { [key: string]: string }
  ): Promise<{ statusCode: number; body: any; headers: any }> {
    
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.config.apiUrl);
      
      // Add query parameters
      if (queryParams) {
        Object.entries(queryParams).forEach(([key, value]) => {
          url.searchParams.append(key, value);
        });
      }

      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey,
          'User-Agent': 'DeviceRegistrationAPITester/1.0'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const parsedBody = data ? JSON.parse(data) : {};
            resolve({
              statusCode: res.statusCode || 0,
              body: parsedBody,
              headers: res.headers
            });
          } catch (error) {
            resolve({
              statusCode: res.statusCode || 0,
              body: { rawResponse: data },
              headers: res.headers
            });
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  /**
   * Generate a random device token for testing
   */
  private generateTestDeviceToken(): string {
    return Array.from({ length: 64 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }

  /**
   * Test device registration
   */
  async testDeviceRegistration(): Promise<{ success: boolean; platformEndpointArn?: string; error?: string }> {
    console.log('Testing device registration...');

    try {
      const response = await this.makeRequest('POST', '/devices', {
        deviceToken: this.config.testDeviceToken,
        userId: this.config.testUserId,
        bundleId: 'com.example.spendmonitor'
      });

      console.log(`Registration response: ${response.statusCode}`, response.body);

      if (response.statusCode === 201 && response.body.success) {
        return {
          success: true,
          platformEndpointArn: response.body.platformEndpointArn
        };
      } else {
        return {
          success: false,
          error: response.body.error || `HTTP ${response.statusCode}`
        };
      }

    } catch (error) {
      console.error('Registration test failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Test device token update
   */
  async testDeviceUpdate(): Promise<{ success: boolean; error?: string }> {
    console.log('Testing device token update...');

    const newDeviceToken = this.generateTestDeviceToken();

    try {
      const response = await this.makeRequest('PUT', '/devices', {
        currentToken: this.config.testDeviceToken,
        newToken: newDeviceToken,
        userId: this.config.testUserId
      });

      console.log(`Update response: ${response.statusCode}`, response.body);

      if (response.statusCode === 200 && response.body.success) {
        // Update config with new token for subsequent tests
        this.config.testDeviceToken = newDeviceToken;
        return { success: true };
      } else {
        return {
          success: false,
          error: response.body.error || `HTTP ${response.statusCode}`
        };
      }

    } catch (error) {
      console.error('Update test failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Test device listing
   */
  async testDeviceList(): Promise<{ success: boolean; deviceCount?: number; error?: string }> {
    console.log('Testing device list...');

    try {
      const response = await this.makeRequest('GET', '/devices', undefined, {
        userId: this.config.testUserId,
        limit: '10'
      });

      console.log(`List response: ${response.statusCode}`, response.body);

      if (response.statusCode === 200 && response.body.success) {
        return {
          success: true,
          deviceCount: response.body.devices?.length || 0
        };
      } else {
        return {
          success: false,
          error: response.body.error || `HTTP ${response.statusCode}`
        };
      }

    } catch (error) {
      console.error('List test failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Test device deletion
   */
  async testDeviceDeletion(): Promise<{ success: boolean; error?: string }> {
    console.log('Testing device deletion...');

    try {
      const encodedToken = encodeURIComponent(this.config.testDeviceToken);
      const response = await this.makeRequest('DELETE', `/devices/${encodedToken}`);

      console.log(`Delete response: ${response.statusCode}`, response.body);

      if (response.statusCode === 200 && response.body.success) {
        return { success: true };
      } else {
        return {
          success: false,
          error: response.body.error || `HTTP ${response.statusCode}`
        };
      }

    } catch (error) {
      console.error('Delete test failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Test CORS preflight request
   */
  async testCORS(): Promise<{ success: boolean; error?: string }> {
    console.log('Testing CORS preflight...');

    try {
      const response = await this.makeRequest('OPTIONS', '/devices');

      console.log(`CORS response: ${response.statusCode}`, response.headers);

      const corsHeaders = response.headers;
      const hasRequiredHeaders = 
        corsHeaders['access-control-allow-origin'] &&
        corsHeaders['access-control-allow-methods'] &&
        corsHeaders['access-control-allow-headers'];

      if (response.statusCode === 200 && hasRequiredHeaders) {
        return { success: true };
      } else {
        return {
          success: false,
          error: 'Missing required CORS headers'
        };
      }

    } catch (error) {
      console.error('CORS test failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Test error scenarios
   */
  async testErrorScenarios(): Promise<{ success: boolean; error?: string }> {
    console.log('Testing error scenarios...');

    try {
      // Test invalid device token format
      const invalidTokenResponse = await this.makeRequest('POST', '/devices', {
        deviceToken: 'invalid-token',
        userId: this.config.testUserId,
        bundleId: 'com.example.spendmonitor'
      });

      if (invalidTokenResponse.statusCode !== 400) {
        return {
          success: false,
          error: 'Expected 400 for invalid token format'
        };
      }

      // Test missing userId for list
      const missingUserIdResponse = await this.makeRequest('GET', '/devices');

      if (missingUserIdResponse.statusCode !== 400) {
        return {
          success: false,
          error: 'Expected 400 for missing userId'
        };
      }

      // Test non-existent device deletion
      const nonExistentToken = this.generateTestDeviceToken();
      const nonExistentDeleteResponse = await this.makeRequest('DELETE', `/devices/${encodeURIComponent(nonExistentToken)}`);

      if (nonExistentDeleteResponse.statusCode !== 404) {
        return {
          success: false,
          error: 'Expected 404 for non-existent device'
        };
      }

      console.log('All error scenarios passed');
      return { success: true };

    } catch (error) {
      console.error('Error scenario test failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Run all tests
   */
  async runAllTests(): Promise<void> {
    console.log('Starting Device Registration API tests...');
    console.log('API URL:', this.config.apiUrl);
    console.log('Test User ID:', this.config.testUserId);
    console.log('Test Device Token:', this.config.testDeviceToken);
    console.log('---');

    const results: { [test: string]: { success: boolean; error?: string } } = {};

    // Test CORS first
    results.cors = await this.testCORS();

    // Test error scenarios
    results.errorScenarios = await this.testErrorScenarios();

    // Test device registration
    results.registration = await this.testDeviceRegistration();

    // Test device listing (should show 1 device)
    results.listAfterRegistration = await this.testDeviceList();

    // Test device update
    results.update = await this.testDeviceUpdate();

    // Test device listing again (should still show 1 device with new token)
    results.listAfterUpdate = await this.testDeviceList();

    // Test device deletion
    results.deletion = await this.testDeviceDeletion();

    // Test device listing after deletion (should show 0 devices)
    results.listAfterDeletion = await this.testDeviceList();

    // Print results summary
    console.log('\n--- Test Results Summary ---');
    let passedTests = 0;
    let totalTests = 0;

    Object.entries(results).forEach(([testName, result]) => {
      totalTests++;
      if (result.success) {
        passedTests++;
        console.log(`✅ ${testName}: PASSED`);
      } else {
        console.log(`❌ ${testName}: FAILED - ${result.error}`);
      }
    });

    console.log(`\nOverall: ${passedTests}/${totalTests} tests passed`);

    if (passedTests === totalTests) {
      console.log('🎉 All tests passed! The Device Registration API is working correctly.');
    } else {
      console.log('⚠️  Some tests failed. Please check the API configuration and try again.');
    }
  }
}

/**
 * Main function to run tests
 */
async function main() {
  // Configuration - update these values with your actual API details
  const config: TestConfig = {
    apiUrl: process.env.DEVICE_API_URL || 'https://your-api-id.execute-api.us-east-1.amazonaws.com/v1',
    apiKey: process.env.DEVICE_API_KEY || 'your-api-key',
    testUserId: process.env.TEST_USER_ID || `test-user-${Date.now()}`,
    testDeviceToken: Array.from({ length: 64 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('')
  };

  // Validate configuration
  if (config.apiUrl.includes('your-api-id') || config.apiKey === 'your-api-key') {
    console.error('❌ Please update the configuration with your actual API URL and key');
    console.log('Set environment variables:');
    console.log('  DEVICE_API_URL=https://your-api-id.execute-api.us-east-1.amazonaws.com/v1');
    console.log('  DEVICE_API_KEY=your-actual-api-key');
    console.log('  TEST_USER_ID=your-test-user-id (optional)');
    process.exit(1);
  }

  const tester = new DeviceRegistrationAPITester(config);
  await tester.runAllTests();
}

// Run tests if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
}

export { DeviceRegistrationAPITester, TestConfig };