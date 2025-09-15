/**
 * iOS Device Registration Examples
 * 
 * This file contains examples of how to register iOS devices
 * for push notifications with the AWS Spend Monitor.
 */

const AWS = require('aws-sdk');
const https = require('https');

// Configuration
const config = {
    region: process.env.AWS_REGION || 'us-east-1',
    platformApplicationArn: process.env.IOS_PLATFORM_APP_ARN,
    bundleId: process.env.IOS_BUNDLE_ID || 'com.example.aws-spend-monitor',
    apiUrl: process.env.API_URL || 'https://api.example.com'
};

// Initialize AWS SNS client
const sns = new AWS.SNS({ region: config.region });

/**
 * Example 1: Direct SNS Platform Endpoint Registration
 * 
 * This example shows how to register a device token directly
 * with AWS SNS to create a platform endpoint.
 */
async function registerDeviceWithSNS(deviceToken, userId = null) {
    console.log('Registering device with SNS...');
    
    try {
        // Validate device token format
        if (!isValidDeviceToken(deviceToken)) {
            throw new Error('Invalid device token format');
        }
        
        // Create platform endpoint
        const params = {
            PlatformApplicationArn: config.platformApplicationArn,
            Token: deviceToken,
            CustomUserData: userId ? JSON.stringify({ userId, registeredAt: new Date().toISOString() }) : undefined
        };
        
        const result = await sns.createPlatformEndpoint(params).promise();
        
        console.log('✓ Device registered successfully');
        console.log('Endpoint ARN:', result.EndpointArn);
        
        return {
            success: true,
            endpointArn: result.EndpointArn,
            deviceToken: deviceToken
        };
        
    } catch (error) {
        console.error('✗ Registration failed:', error.message);
        
        // Handle duplicate registration
        if (error.code === 'InvalidParameter' && error.message.includes('already exists')) {
            console.log('Device already registered, retrieving existing endpoint...');
            return await getExistingEndpoint(deviceToken);
        }
        
        throw error;
    }
}

/**
 * Example 2: API Gateway Registration
 * 
 * This example shows how to register a device using the
 * REST API endpoint (if deployed).
 */
async function registerDeviceWithAPI(deviceToken, userId = null) {
    console.log('Registering device with API...');
    
    const registrationData = {
        deviceToken: deviceToken,
        bundleId: config.bundleId,
        userId: userId,
        platform: 'ios'
    };
    
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(registrationData);
        
        const options = {
            hostname: new URL(config.apiUrl).hostname,
            port: 443,
            path: '/devices',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        console.log('✓ Device registered via API');
                        console.log('Response:', response);
                        resolve(response);
                    } else {
                        console.error('✗ API registration failed:', response);
                        reject(new Error(`API returned ${res.statusCode}: ${response.message || data}`));
                    }
                } catch (parseError) {
                    reject(new Error(`Failed to parse API response: ${parseError.message}`));
                }
            });
        });
        
        req.on('error', (error) => {
            console.error('✗ API request failed:', error.message);
            reject(error);
        });
        
        req.write(postData);
        req.end();
    });
}

/**
 * Example 3: Batch Device Registration
 * 
 * This example shows how to register multiple devices at once.
 */
async function registerMultipleDevices(devices) {
    console.log(`Registering ${devices.length} devices...`);
    
    const results = [];
    const batchSize = 5; // Process in batches to avoid rate limits
    
    for (let i = 0; i < devices.length; i += batchSize) {
        const batch = devices.slice(i, i + batchSize);
        
        console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(devices.length / batchSize)}`);
        
        const batchPromises = batch.map(async (device) => {
            try {
                const result = await registerDeviceWithSNS(device.token, device.userId);
                return { ...device, ...result, error: null };
            } catch (error) {
                return { ...device, success: false, error: error.message };
            }
        });
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        // Add delay between batches
        if (i + batchSize < devices.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`✓ Batch registration complete: ${successful} successful, ${failed} failed`);
    
    return results;
}

/**
 * Example 4: Update Device Token
 * 
 * This example shows how to update an existing device registration
 * when the token changes.
 */
async function updateDeviceToken(oldToken, newToken, userId = null) {
    console.log('Updating device token...');
    
    try {
        // Find existing endpoint
        const existingEndpoint = await findEndpointByToken(oldToken);
        
        if (existingEndpoint) {
            // Update the endpoint with new token
            const params = {
                EndpointArn: existingEndpoint.EndpointArn,
                Attributes: {
                    Token: newToken,
                    Enabled: 'true'
                }
            };
            
            await sns.setEndpointAttributes(params).promise();
            
            console.log('✓ Device token updated successfully');
            return {
                success: true,
                endpointArn: existingEndpoint.EndpointArn,
                oldToken: oldToken,
                newToken: newToken
            };
        } else {
            // Create new endpoint if old one doesn't exist
            console.log('Old endpoint not found, creating new registration...');
            return await registerDeviceWithSNS(newToken, userId);
        }
        
    } catch (error) {
        console.error('✗ Token update failed:', error.message);
        throw error;
    }
}

/**
 * Example 5: Remove Device Registration
 * 
 * This example shows how to remove a device from receiving notifications.
 */
async function removeDeviceRegistration(deviceToken) {
    console.log('Removing device registration...');
    
    try {
        const endpoint = await findEndpointByToken(deviceToken);
        
        if (endpoint) {
            await sns.deleteEndpoint({ EndpointArn: endpoint.EndpointArn }).promise();
            console.log('✓ Device registration removed successfully');
            return { success: true, endpointArn: endpoint.EndpointArn };
        } else {
            console.log('Device registration not found');
            return { success: true, message: 'Device not registered' };
        }
        
    } catch (error) {
        console.error('✗ Failed to remove device registration:', error.message);
        throw error;
    }
}

/**
 * Example 6: Test Notification Delivery
 * 
 * This example shows how to send a test notification to a registered device.
 */
async function sendTestNotification(deviceToken, message = 'Test notification from AWS Spend Monitor') {
    console.log('Sending test notification...');
    
    try {
        const endpoint = await findEndpointByToken(deviceToken);
        
        if (!endpoint) {
            throw new Error('Device not registered');
        }
        
        // Create APNS payload
        const payload = {
            APNS: JSON.stringify({
                aps: {
                    alert: {
                        title: 'AWS Spend Monitor',
                        body: message
                    },
                    badge: 1,
                    sound: 'default'
                },
                customData: {
                    type: 'test',
                    timestamp: new Date().toISOString()
                }
            })
        };
        
        const params = {
            TargetArn: endpoint.EndpointArn,
            Message: JSON.stringify(payload),
            MessageStructure: 'json'
        };
        
        const result = await sns.publish(params).promise();
        
        console.log('✓ Test notification sent successfully');
        console.log('Message ID:', result.MessageId);
        
        return {
            success: true,
            messageId: result.MessageId,
            endpointArn: endpoint.EndpointArn
        };
        
    } catch (error) {
        console.error('✗ Failed to send test notification:', error.message);
        throw error;
    }
}

/**
 * Example 7: List All Registered Devices
 * 
 * This example shows how to list all devices registered for the platform application.
 */
async function listRegisteredDevices() {
    console.log('Listing registered devices...');
    
    try {
        const params = {
            PlatformApplicationArn: config.platformApplicationArn
        };
        
        const endpoints = [];
        let nextToken = null;
        
        do {
            if (nextToken) {
                params.NextToken = nextToken;
            }
            
            const result = await sns.listEndpointsByPlatformApplication(params).promise();
            endpoints.push(...result.Endpoints);
            nextToken = result.NextToken;
            
        } while (nextToken);
        
        console.log(`✓ Found ${endpoints.length} registered devices`);
        
        // Format the results
        const devices = endpoints.map(endpoint => ({
            endpointArn: endpoint.EndpointArn,
            token: endpoint.Attributes.Token,
            enabled: endpoint.Attributes.Enabled === 'true',
            customUserData: endpoint.Attributes.CustomUserData ? JSON.parse(endpoint.Attributes.CustomUserData) : null
        }));
        
        return devices;
        
    } catch (error) {
        console.error('✗ Failed to list devices:', error.message);
        throw error;
    }
}

/**
 * Example 8: Clean Up Invalid Tokens
 * 
 * This example shows how to clean up endpoints with invalid or expired tokens.
 */
async function cleanupInvalidTokens() {
    console.log('Cleaning up invalid tokens...');
    
    try {
        const devices = await listRegisteredDevices();
        const invalidDevices = [];
        
        // Test each device with a simple notification
        for (const device of devices) {
            try {
                // Send a silent notification to test token validity
                const testPayload = {
                    APNS: JSON.stringify({
                        aps: {
                            'content-available': 1
                        }
                    })
                };
                
                await sns.publish({
                    TargetArn: device.endpointArn,
                    Message: JSON.stringify(testPayload),
                    MessageStructure: 'json'
                }).promise();
                
            } catch (error) {
                if (error.code === 'EndpointDisabled' || error.message.includes('invalid')) {
                    invalidDevices.push(device);
                }
            }
        }
        
        // Remove invalid devices
        for (const device of invalidDevices) {
            try {
                await sns.deleteEndpoint({ EndpointArn: device.endpointArn }).promise();
                console.log(`✓ Removed invalid device: ${device.token.substring(0, 8)}...`);
            } catch (error) {
                console.error(`✗ Failed to remove device ${device.token.substring(0, 8)}...:`, error.message);
            }
        }
        
        console.log(`✓ Cleanup complete: removed ${invalidDevices.length} invalid devices`);
        
        return {
            totalDevices: devices.length,
            invalidDevices: invalidDevices.length,
            validDevices: devices.length - invalidDevices.length
        };
        
    } catch (error) {
        console.error('✗ Cleanup failed:', error.message);
        throw error;
    }
}

// Helper Functions

/**
 * Validate device token format
 */
function isValidDeviceToken(token) {
    return typeof token === 'string' && 
           token.length === 64 && 
           /^[0-9a-fA-F]+$/.test(token);
}

/**
 * Find endpoint by device token
 */
async function findEndpointByToken(deviceToken) {
    const devices = await listRegisteredDevices();
    return devices.find(device => device.token === deviceToken);
}

/**
 * Get existing endpoint for duplicate registration
 */
async function getExistingEndpoint(deviceToken) {
    const endpoint = await findEndpointByToken(deviceToken);
    
    if (endpoint) {
        return {
            success: true,
            endpointArn: endpoint.endpointArn,
            deviceToken: deviceToken,
            existing: true
        };
    }
    
    throw new Error('Endpoint not found despite duplicate error');
}

// Example Usage and Testing

/**
 * Main function to demonstrate all examples
 */
async function runExamples() {
    console.log('=== iOS Device Registration Examples ===\n');
    
    // Example device tokens (for testing - use real tokens in production)
    const testDevices = [
        {
            token: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            userId: 'user1@example.com'
        },
        {
            token: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
            userId: 'user2@example.com'
        }
    ];
    
    try {
        // Example 1: Single device registration
        console.log('1. Single Device Registration');
        const registration = await registerDeviceWithSNS(testDevices[0].token, testDevices[0].userId);
        console.log('Result:', registration);
        console.log();
        
        // Example 2: API registration (if API is available)
        console.log('2. API Registration');
        try {
            const apiRegistration = await registerDeviceWithAPI(testDevices[1].token, testDevices[1].userId);
            console.log('Result:', apiRegistration);
        } catch (error) {
            console.log('API not available or failed:', error.message);
        }
        console.log();
        
        // Example 3: List devices
        console.log('3. List Registered Devices');
        const devices = await listRegisteredDevices();
        console.log(`Found ${devices.length} devices`);
        devices.forEach((device, index) => {
            console.log(`  ${index + 1}. ${device.token.substring(0, 16)}... (enabled: ${device.enabled})`);
        });
        console.log();
        
        // Example 4: Send test notification
        console.log('4. Send Test Notification');
        const testResult = await sendTestNotification(testDevices[0].token, 'Hello from AWS Spend Monitor!');
        console.log('Result:', testResult);
        console.log();
        
        // Example 5: Update device token
        console.log('5. Update Device Token');
        const newToken = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
        const updateResult = await updateDeviceToken(testDevices[0].token, newToken, testDevices[0].userId);
        console.log('Result:', updateResult);
        console.log();
        
        // Example 6: Cleanup
        console.log('6. Cleanup Test Devices');
        await removeDeviceRegistration(newToken);
        await removeDeviceRegistration(testDevices[1].token);
        console.log('✓ Test devices removed');
        
    } catch (error) {
        console.error('Example failed:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

// Export functions for use in other modules
module.exports = {
    registerDeviceWithSNS,
    registerDeviceWithAPI,
    registerMultipleDevices,
    updateDeviceToken,
    removeDeviceRegistration,
    sendTestNotification,
    listRegisteredDevices,
    cleanupInvalidTokens,
    isValidDeviceToken
};

// Run examples if this file is executed directly
if (require.main === module) {
    // Check configuration
    if (!config.platformApplicationArn) {
        console.error('Error: IOS_PLATFORM_APP_ARN environment variable is required');
        console.log('Run: export IOS_PLATFORM_APP_ARN="your-platform-app-arn"');
        process.exit(1);
    }
    
    runExamples().catch(error => {
        console.error('Examples failed:', error.message);
        process.exit(1);
    });
}