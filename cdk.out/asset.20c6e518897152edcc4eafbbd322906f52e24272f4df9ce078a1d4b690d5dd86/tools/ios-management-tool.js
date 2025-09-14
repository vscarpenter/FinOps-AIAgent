"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.iOSManagementTool = void 0;
const strands_agents_1 = require("strands-agents");
const client_sns_1 = require("@aws-sdk/client-sns");
const validation_1 = require("../validation");
/**
 * Tool for managing iOS device registrations and APNS platform configuration
 */
class iOSManagementTool extends strands_agents_1.Tool {
    constructor(iosConfig, region = 'us-east-1') {
        super();
        this.iosConfig = iosConfig;
        this.snsClient = new client_sns_1.SNSClient({ region });
    }
    /**
     * Registers a new iOS device token with SNS platform endpoint
     */
    async registerDevice(deviceToken, userId) {
        try {
            // Validate device token format
            if (!this.isValidDeviceToken(deviceToken)) {
                throw new validation_1.ValidationError('Invalid device token format. Must be 64-character hexadecimal string.');
            }
            const now = new Date().toISOString();
            // Create platform endpoint
            const createEndpointCommand = new client_sns_1.CreatePlatformEndpointCommand({
                PlatformApplicationArn: this.iosConfig.platformApplicationArn,
                Token: deviceToken,
                CustomUserData: userId ? JSON.stringify({ userId, registrationDate: now }) : undefined
            });
            const response = await this.snsClient.send(createEndpointCommand);
            if (!response.EndpointArn) {
                throw new Error('Failed to create platform endpoint - no ARN returned');
            }
            const registration = {
                deviceToken,
                platformEndpointArn: response.EndpointArn,
                userId,
                registrationDate: now,
                lastUpdated: now,
                active: true
            };
            // Validate the registration object
            (0, validation_1.validateiOSDeviceRegistration)(registration);
            console.log(`Successfully registered iOS device: ${deviceToken.substring(0, 8)}...`);
            return registration;
        }
        catch (error) {
            console.error('Failed to register iOS device:', error);
            throw error;
        }
    }
    /**
     * Updates an existing device token registration
     */
    async updateDeviceToken(platformEndpointArn, newDeviceToken) {
        try {
            // Validate new device token format
            if (!this.isValidDeviceToken(newDeviceToken)) {
                throw new validation_1.ValidationError('Invalid device token format. Must be 64-character hexadecimal string.');
            }
            const setAttributesCommand = new client_sns_1.SetEndpointAttributesCommand({
                EndpointArn: platformEndpointArn,
                Attributes: {
                    Token: newDeviceToken,
                    Enabled: 'true'
                }
            });
            await this.snsClient.send(setAttributesCommand);
            console.log(`Successfully updated device token for endpoint: ${platformEndpointArn}`);
        }
        catch (error) {
            console.error('Failed to update device token:', error);
            throw error;
        }
    }
    /**
     * Removes invalid or expired device tokens
     */
    async removeInvalidTokens(platformEndpointArns) {
        const removedEndpoints = [];
        for (const endpointArn of platformEndpointArns) {
            try {
                // Check if endpoint is still valid
                const getAttributesCommand = new client_sns_1.GetEndpointAttributesCommand({
                    EndpointArn: endpointArn
                });
                const response = await this.snsClient.send(getAttributesCommand);
                // If endpoint is disabled or has invalid token, remove it
                if (response.Attributes?.Enabled === 'false' ||
                    !response.Attributes?.Token ||
                    !this.isValidDeviceToken(response.Attributes.Token)) {
                    await this.deleteEndpoint(endpointArn);
                    removedEndpoints.push(endpointArn);
                }
            }
            catch (error) {
                // If we can't get attributes, the endpoint is likely invalid
                console.warn(`Endpoint ${endpointArn} appears invalid, removing:`, error);
                try {
                    await this.deleteEndpoint(endpointArn);
                    removedEndpoints.push(endpointArn);
                }
                catch (deleteError) {
                    console.error(`Failed to delete invalid endpoint ${endpointArn}:`, deleteError);
                }
            }
        }
        if (removedEndpoints.length > 0) {
            console.log(`Removed ${removedEndpoints.length} invalid device endpoints`);
        }
        return removedEndpoints;
    }
    /**
     * Validates APNS configuration by checking platform application
     */
    async validateAPNSConfig() {
        try {
            // Try to create a test endpoint with a dummy token to validate the platform app
            const testToken = '0'.repeat(64); // Valid format but dummy token
            const createEndpointCommand = new client_sns_1.CreatePlatformEndpointCommand({
                PlatformApplicationArn: this.iosConfig.platformApplicationArn,
                Token: testToken
            });
            const response = await this.snsClient.send(createEndpointCommand);
            // Clean up the test endpoint
            if (response.EndpointArn) {
                await this.deleteEndpoint(response.EndpointArn);
            }
            console.log('APNS configuration validation successful');
            return true;
        }
        catch (error) {
            console.error('APNS configuration validation failed:', error);
            return false;
        }
    }
    /**
     * Validates device token format (64-character hexadecimal string)
     */
    isValidDeviceToken(token) {
        const tokenPattern = /^[a-fA-F0-9]{64}$/;
        return tokenPattern.test(token);
    }
    /**
     * Deletes a platform endpoint
     */
    async deleteEndpoint(endpointArn) {
        const deleteCommand = new client_sns_1.DeleteEndpointCommand({
            EndpointArn: endpointArn
        });
        await this.snsClient.send(deleteCommand);
        console.log(`Deleted platform endpoint: ${endpointArn}`);
    }
    /**
     * Creates a platform endpoint for a device token
     */
    async createPlatformEndpoint(deviceToken, customUserData) {
        try {
            if (!this.isValidDeviceToken(deviceToken)) {
                throw new validation_1.ValidationError('Invalid device token format. Must be 64-character hexadecimal string.');
            }
            const createEndpointCommand = new client_sns_1.CreatePlatformEndpointCommand({
                PlatformApplicationArn: this.iosConfig.platformApplicationArn,
                Token: deviceToken,
                CustomUserData: customUserData
            });
            const response = await this.snsClient.send(createEndpointCommand);
            if (!response.EndpointArn) {
                throw new Error('Failed to create platform endpoint - no ARN returned');
            }
            console.log(`Created platform endpoint: ${response.EndpointArn}`);
            return response.EndpointArn;
        }
        catch (error) {
            console.error('Failed to create platform endpoint:', error);
            throw error;
        }
    }
    /**
     * Gets the current iOS configuration
     */
    getConfig() {
        return { ...this.iosConfig };
    }
    /**
     * Updates the iOS configuration
     */
    updateConfig(newConfig) {
        this.iosConfig = { ...this.iosConfig, ...newConfig };
    }
}
exports.iOSManagementTool = iOSManagementTool;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW9zLW1hbmFnZW1lbnQtdG9vbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy90b29scy9pb3MtbWFuYWdlbWVudC10b29sLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1EQUFzQztBQUN0QyxvREFBa0s7QUFFbEssOENBQStFO0FBRS9FOztHQUVHO0FBQ0gsTUFBYSxpQkFBa0IsU0FBUSxxQkFBSTtJQUl6QyxZQUFZLFNBQXdCLEVBQUUsU0FBaUIsV0FBVztRQUNoRSxLQUFLLEVBQUUsQ0FBQztRQUNSLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO1FBQzNCLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxzQkFBUyxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQztJQUM3QyxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsY0FBYyxDQUFDLFdBQW1CLEVBQUUsTUFBZTtRQUN2RCxJQUFJLENBQUM7WUFDSCwrQkFBK0I7WUFDL0IsSUFBSSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDO2dCQUMxQyxNQUFNLElBQUksNEJBQWUsQ0FBQyx1RUFBdUUsQ0FBQyxDQUFDO1lBQ3JHLENBQUM7WUFFRCxNQUFNLEdBQUcsR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBRXJDLDJCQUEyQjtZQUMzQixNQUFNLHFCQUFxQixHQUFHLElBQUksMENBQTZCLENBQUM7Z0JBQzlELHNCQUFzQixFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsc0JBQXNCO2dCQUM3RCxLQUFLLEVBQUUsV0FBVztnQkFDbEIsY0FBYyxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxnQkFBZ0IsRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTO2FBQ3ZGLENBQUMsQ0FBQztZQUVILE1BQU0s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QU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQztZQUVsRSxJQUFJLENBQUMsUUFBUSxDQUFDLFdBQVcsRUFBRSxDQUFDO2dCQUMxQixNQUFNLElBQUksS0FBSyxDQUFDLHNEQUFzRCxDQUFDLENBQUM7WUFDMUUsQ0FBQztZQUVELE9BQU8sQ0FBQyxHQUFHLENBQUMsOEJBQThCLFFBQVEsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDO1lBQ2xFLE9BQU8sUUFBUSxDQUFDLFdBQVcsQ0FBQztRQUU5QixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMscUNBQXFDLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDNUQsTUFBTSxLQUFLLENBQUM7UUFDZCxDQUFDO0lBQ0gsQ0FBQztJQUVEOztPQUVHO0lBQ0gsU0FBUztRQUNQLE9BQU8sRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztJQUMvQixDQUFDO0lBRUQ7O09BRUc7SUFDSCxZQUFZLENBQUMsU0FBaUM7UUFDNUMsSUFBSSxDQUFDLFNBQVMsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFDLFNBQVMsRUFBRSxHQUFHLFNBQVMsRUFBRSxDQUFDO0lBQ3ZELENBQUM7Q0FDRjtBQTFORCw4Q0EwTkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBUb29sIH0gZnJvbSAnc3RyYW5kcy1hZ2VudHMnO1xuaW1wb3J0IHsgU05TQ2xpZW50LCBDcmVhdGVQbGF0Zm9ybUVuZHBvaW50Q29tbWFuZCwgRGVsZXRlRW5kcG9pbnRDb21tYW5kLCBHZXRFbmRwb2ludEF0dHJpYnV0ZXNDb21tYW5kLCBTZXRFbmRwb2ludEF0dHJpYnV0ZXNDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNucyc7XG5pbXBvcnQgeyBpT1NQdXNoQ29uZmlnLCBpT1NEZXZpY2VSZWdpc3RyYXRpb24gfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyB2YWxpZGF0ZWlPU0RldmljZVJlZ2lzdHJhdGlvbiwgVmFsaWRhdGlvbkVycm9yIH0gZnJvbSAnLi4vdmFsaWRhdGlvbic7XG5cbi8qKlxuICogVG9vbCBmb3IgbWFuYWdpbmcgaU9TIGRldmljZSByZWdpc3RyYXRpb25zIGFuZCBBUE5TIHBsYXRmb3JtIGNvbmZpZ3VyYXRpb25cbiAqL1xuZXhwb3J0IGNsYXNzIGlPU01hbmFnZW1lbnRUb29sIGV4dGVuZHMgVG9vbCB7XG4gIHByaXZhdGUgc25zQ2xpZW50OiBTTlNDbGllbnQ7XG4gIHByaXZhdGUgaW9zQ29uZmlnOiBpT1NQdXNoQ29uZmlnO1xuXG4gIGNvbnN0cnVjdG9yKGlvc0NvbmZpZzogaU9TUHVzaENvbmZpZywgcmVnaW9uOiBzdHJpbmcgPSAndXMtZWFzdC0xJykge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5pb3NDb25maWcgPSBpb3NDb25maWc7XG4gICAgdGhpcy5zbnNDbGllbnQgPSBuZXcgU05TQ2xpZW50KHsgcmVnaW9uIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIG5ldyBpT1MgZGV2aWNlIHRva2VuIHdpdGggU05TIHBsYXRmb3JtIGVuZHBvaW50XG4gICAqL1xuICBhc3luYyByZWdpc3RlckRldmljZShkZXZpY2VUb2tlbjogc3RyaW5nLCB1c2VySWQ/OiBzdHJpbmcpOiBQcm9taXNlPGlPU0RldmljZVJlZ2lzdHJhdGlvbj4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBWYWxpZGF0ZSBkZXZpY2UgdG9rZW4gZm9ybWF0XG4gICAgICBpZiAoIXRoaXMuaXNWYWxpZERldmljZVRva2VuKGRldmljZVRva2VuKSkge1xuICAgICAgICB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKCdJbnZhbGlkIGRldmljZSB0b2tlbiBmb3JtYXQuIE11c3QgYmUgNjQtY2hhcmFjdGVyIGhleGFkZWNpbWFsIHN0cmluZy4nKTtcbiAgICAgIH1cblxuICAgICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgXG4gICAgICAvLyBDcmVhdGUgcGxhdGZvcm0gZW5kcG9pbnRcbiAgICAgIGNvbnN0IGNyZWF0ZUVuZHBvaW50Q29tbWFuZCA9IG5ldyBDcmVhdGVQbGF0Zm9ybUVuZHBvaW50Q29tbWFuZCh7XG4gICAgICAgIFBsYXRmb3JtQXBwbGljYXRpb25Bcm46IHRoaXMuaW9zQ29uZmlnLnBsYXRmb3JtQXBwbGljYXRpb25Bcm4sXG4gICAgICAgIFRva2VuOiBkZXZpY2VUb2tlbixcbiAgICAgICAgQ3VzdG9tVXNlckRhdGE6IHVzZXJJZCA/IEpTT04uc3RyaW5naWZ5KHsgdXNlcklkLCByZWdpc3RyYXRpb25EYXRlOiBub3cgfSkgOiB1bmRlZmluZWRcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuc25zQ2xpZW50LnNlbmQoY3JlYXRlRW5kcG9pbnRDb21tYW5kKTtcbiAgICAgIFxuICAgICAgaWYgKCFyZXNwb25zZS5FbmRwb2ludEFybikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZhaWxlZCB0byBjcmVhdGUgcGxhdGZvcm0gZW5kcG9pbnQgLSBubyBBUk4gcmV0dXJuZWQnKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVnaXN0cmF0aW9uOiBpT1NEZXZpY2VSZWdpc3RyYXRpb24gPSB7XG4gICAgICAgIGRldmljZVRva2VuLFxuICAgICAgICBwbGF0Zm9ybUVuZHBvaW50QXJuOiByZXNwb25zZS5FbmRwb2ludEFybixcbiAgICAgICAgdXNlcklkLFxuICAgICAgICByZWdpc3RyYXRpb25EYXRlOiBub3csXG4gICAgICAgIGxhc3RVcGRhdGVkOiBub3csXG4gICAgICAgIGFjdGl2ZTogdHJ1ZVxuICAgICAgfTtcblxuICAgICAgLy8gVmFsaWRhdGUgdGhlIHJlZ2lzdHJhdGlvbiBvYmplY3RcbiAgICAgIHZhbGlkYXRlaU9TRGV2aWNlUmVnaXN0cmF0aW9uKHJlZ2lzdHJhdGlvbik7XG5cbiAgICAgIGNvbnNvbGUubG9nKGBTdWNjZXNzZnVsbHkgcmVnaXN0ZXJlZCBpT1MgZGV2aWNlOiAke2RldmljZVRva2VuLnN1YnN0cmluZygwLCA4KX0uLi5gKTtcbiAgICAgIHJldHVybiByZWdpc3RyYXRpb247XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHJlZ2lzdGVyIGlPUyBkZXZpY2U6JywgZXJyb3IpO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZXMgYW4gZXhpc3RpbmcgZGV2aWNlIHRva2VuIHJlZ2lzdHJhdGlvblxuICAgKi9cbiAgYXN5bmMgdXBkYXRlRGV2aWNlVG9rZW4ocGxhdGZvcm1FbmRwb2ludEFybjogc3RyaW5nLCBuZXdEZXZpY2VUb2tlbjogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIFZhbGlkYXRlIG5ldyBkZXZpY2UgdG9rZW4gZm9ybWF0XG4gICAgICBpZiAoIXRoaXMuaXNWYWxpZERldmljZVRva2VuKG5ld0RldmljZVRva2VuKSkge1xuICAgICAgICB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKCdJbnZhbGlkIGRldmljZSB0b2tlbiBmb3JtYXQuIE11c3QgYmUgNjQtY2hhcmFjdGVyIGhleGFkZWNpbWFsIHN0cmluZy4nKTtcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc2V0QXR0cmlidXRlc0NvbW1hbmQgPSBuZXcgU2V0RW5kcG9pbnRBdHRyaWJ1dGVzQ29tbWFuZCh7XG4gICAgICAgIEVuZHBvaW50QXJuOiBwbGF0Zm9ybUVuZHBvaW50QXJuLFxuICAgICAgICBBdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgVG9rZW46IG5ld0RldmljZVRva2VuLFxuICAgICAgICAgIEVuYWJsZWQ6ICd0cnVlJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgdGhpcy5zbnNDbGllbnQuc2VuZChzZXRBdHRyaWJ1dGVzQ29tbWFuZCk7XG4gICAgICBjb25zb2xlLmxvZyhgU3VjY2Vzc2Z1bGx5IHVwZGF0ZWQgZGV2aWNlIHRva2VuIGZvciBlbmRwb2ludDogJHtwbGF0Zm9ybUVuZHBvaW50QXJufWApO1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byB1cGRhdGUgZGV2aWNlIHRva2VuOicsIGVycm9yKTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGludmFsaWQgb3IgZXhwaXJlZCBkZXZpY2UgdG9rZW5zXG4gICAqL1xuICBhc3luYyByZW1vdmVJbnZhbGlkVG9rZW5zKHBsYXRmb3JtRW5kcG9pbnRBcm5zOiBzdHJpbmdbXSk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICBjb25zdCByZW1vdmVkRW5kcG9pbnRzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgZm9yIChjb25zdCBlbmRwb2ludEFybiBvZiBwbGF0Zm9ybUVuZHBvaW50QXJucykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gQ2hlY2sgaWYgZW5kcG9pbnQgaXMgc3RpbGwgdmFsaWRcbiAgICAgICAgY29uc3QgZ2V0QXR0cmlidXRlc0NvbW1hbmQgPSBuZXcgR2V0RW5kcG9pbnRBdHRyaWJ1dGVzQ29tbWFuZCh7XG4gICAgICAgICAgRW5kcG9pbnRBcm46IGVuZHBvaW50QXJuXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5zbnNDbGllbnQuc2VuZChnZXRBdHRyaWJ1dGVzQ29tbWFuZCk7XG4gICAgICAgIFxuICAgICAgICAvLyBJZiBlbmRwb2ludCBpcyBkaXNhYmxlZCBvciBoYXMgaW52YWxpZCB0b2tlbiwgcmVtb3ZlIGl0XG4gICAgICAgIGlmIChyZXNwb25zZS5BdHRyaWJ1dGVzPy5FbmFibGVkID09PSAnZmFsc2UnIHx8IFxuICAgICAgICAgICAgIXJlc3BvbnNlLkF0dHJpYnV0ZXM/LlRva2VuIHx8XG4gICAgICAgICAgICAhdGhpcy5pc1ZhbGlkRGV2aWNlVG9rZW4ocmVzcG9uc2UuQXR0cmlidXRlcy5Ub2tlbikpIHtcbiAgICAgICAgICBcbiAgICAgICAgICBhd2FpdCB0aGlzLmRlbGV0ZUVuZHBvaW50KGVuZHBvaW50QXJuKTtcbiAgICAgICAgICByZW1vdmVkRW5kcG9pbnRzLnB1c2goZW5kcG9pbnRBcm4pO1xuICAgICAgICB9XG5cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIC8vIElmIHdlIGNhbid0IGdldCBhdHRyaWJ1dGVzLCB0aGUgZW5kcG9pbnQgaXMgbGlrZWx5IGludmFsaWRcbiAgICAgICAgY29uc29sZS53YXJuKGBFbmRwb2ludCAke2VuZHBvaW50QXJufSBhcHBlYXJzIGludmFsaWQsIHJlbW92aW5nOmAsIGVycm9yKTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLmRlbGV0ZUVuZHBvaW50KGVuZHBvaW50QXJuKTtcbiAgICAgICAgICByZW1vdmVkRW5kcG9pbnRzLnB1c2goZW5kcG9pbnRBcm4pO1xuICAgICAgICB9IGNhdGNoIChkZWxldGVFcnJvcikge1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byBkZWxldGUgaW52YWxpZCBlbmRwb2ludCAke2VuZHBvaW50QXJufTpgLCBkZWxldGVFcnJvcik7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocmVtb3ZlZEVuZHBvaW50cy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zb2xlLmxvZyhgUmVtb3ZlZCAke3JlbW92ZWRFbmRwb2ludHMubGVuZ3RofSBpbnZhbGlkIGRldmljZSBlbmRwb2ludHNgKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVtb3ZlZEVuZHBvaW50cztcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgQVBOUyBjb25maWd1cmF0aW9uIGJ5IGNoZWNraW5nIHBsYXRmb3JtIGFwcGxpY2F0aW9uXG4gICAqL1xuICBhc3luYyB2YWxpZGF0ZUFQTlNDb25maWcoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIFRyeSB0byBjcmVhdGUgYSB0ZXN0IGVuZHBvaW50IHdpdGggYSBkdW1teSB0b2tlbiB0byB2YWxpZGF0ZSB0aGUgcGxhdGZvcm0gYXBwXG4gICAgICBjb25zdCB0ZXN0VG9rZW4gPSAnMCcucmVwZWF0KDY0KTsgLy8gVmFsaWQgZm9ybWF0IGJ1dCBkdW1teSB0b2tlblxuICAgICAgXG4gICAgICBjb25zdCBjcmVhdGVFbmRwb2ludENvbW1hbmQgPSBuZXcgQ3JlYXRlUGxhdGZvcm1FbmRwb2ludENvbW1hbmQoe1xuICAgICAgICBQbGF0Zm9ybUFwcGxpY2F0aW9uQXJuOiB0aGlzLmlvc0NvbmZpZy5wbGF0Zm9ybUFwcGxpY2F0aW9uQXJuLFxuICAgICAgICBUb2tlbjogdGVzdFRva2VuXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnNuc0NsaWVudC5zZW5kKGNyZWF0ZUVuZHBvaW50Q29tbWFuZCk7XG4gICAgICBcbiAgICAgIC8vIENsZWFuIHVwIHRoZSB0ZXN0IGVuZHBvaW50XG4gICAgICBpZiAocmVzcG9uc2UuRW5kcG9pbnRBcm4pIHtcbiAgICAgICAgYXdhaXQgdGhpcy5kZWxldGVFbmRwb2ludChyZXNwb25zZS5FbmRwb2ludEFybik7XG4gICAgICB9XG5cbiAgICAgIGNvbnNvbGUubG9nKCdBUE5TIGNvbmZpZ3VyYXRpb24gdmFsaWRhdGlvbiBzdWNjZXNzZnVsJyk7XG4gICAgICByZXR1cm4gdHJ1ZTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdBUE5TIGNvbmZpZ3VyYXRpb24gdmFsaWRhdGlvbiBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgZGV2aWNlIHRva2VuIGZvcm1hdCAoNjQtY2hhcmFjdGVyIGhleGFkZWNpbWFsIHN0cmluZylcbiAgICovXG4gIHByaXZhdGUgaXNWYWxpZERldmljZVRva2VuKHRva2VuOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCB0b2tlblBhdHRlcm4gPSAvXlthLWZBLUYwLTldezY0fSQvO1xuICAgIHJldHVybiB0b2tlblBhdHRlcm4udGVzdCh0b2tlbik7XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyBhIHBsYXRmb3JtIGVuZHBvaW50XG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGRlbGV0ZUVuZHBvaW50KGVuZHBvaW50QXJuOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBkZWxldGVDb21tYW5kID0gbmV3IERlbGV0ZUVuZHBvaW50Q29tbWFuZCh7XG4gICAgICBFbmRwb2ludEFybjogZW5kcG9pbnRBcm5cbiAgICB9KTtcblxuICAgIGF3YWl0IHRoaXMuc25zQ2xpZW50LnNlbmQoZGVsZXRlQ29tbWFuZCk7XG4gICAgY29uc29sZS5sb2coYERlbGV0ZWQgcGxhdGZvcm0gZW5kcG9pbnQ6ICR7ZW5kcG9pbnRBcm59YCk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIHBsYXRmb3JtIGVuZHBvaW50IGZvciBhIGRldmljZSB0b2tlblxuICAgKi9cbiAgYXN5bmMgY3JlYXRlUGxhdGZvcm1FbmRwb2ludChkZXZpY2VUb2tlbjogc3RyaW5nLCBjdXN0b21Vc2VyRGF0YT86IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgdHJ5IHtcbiAgICAgIGlmICghdGhpcy5pc1ZhbGlkRGV2aWNlVG9rZW4oZGV2aWNlVG9rZW4pKSB7XG4gICAgICAgIHRocm93IG5ldyBWYWxpZGF0aW9uRXJyb3IoJ0ludmFsaWQgZGV2aWNlIHRva2VuIGZvcm1hdC4gTXVzdCBiZSA2NC1jaGFyYWN0ZXIgaGV4YWRlY2ltYWwgc3RyaW5nLicpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjcmVhdGVFbmRwb2ludENvbW1hbmQgPSBuZXcgQ3JlYXRlUGxhdGZvcm1FbmRwb2ludENvbW1hbmQoe1xuICAgICAgICBQbGF0Zm9ybUFwcGxpY2F0aW9uQXJuOiB0aGlzLmlvc0NvbmZpZy5wbGF0Zm9ybUFwcGxpY2F0aW9uQXJuLFxuICAgICAgICBUb2tlbjogZGV2aWNlVG9rZW4sXG4gICAgICAgIEN1c3RvbVVzZXJEYXRhOiBjdXN0b21Vc2VyRGF0YVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5zbnNDbGllbnQuc2VuZChjcmVhdGVFbmRwb2ludENvbW1hbmQpO1xuICAgICAgXG4gICAgICBpZiAoIXJlc3BvbnNlLkVuZHBvaW50QXJuKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIHRvIGNyZWF0ZSBwbGF0Zm9ybSBlbmRwb2ludCAtIG5vIEFSTiByZXR1cm5lZCcpO1xuICAgICAgfVxuXG4gICAgICBjb25zb2xlLmxvZyhgQ3JlYXRlZCBwbGF0Zm9ybSBlbmRwb2ludDogJHtyZXNwb25zZS5FbmRwb2ludEFybn1gKTtcbiAgICAgIHJldHVybiByZXNwb25zZS5FbmRwb2ludEFybjtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gY3JlYXRlIHBsYXRmb3JtIGVuZHBvaW50OicsIGVycm9yKTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBjdXJyZW50IGlPUyBjb25maWd1cmF0aW9uXG4gICAqL1xuICBnZXRDb25maWcoKTogaU9TUHVzaENvbmZpZyB7XG4gICAgcmV0dXJuIHsgLi4udGhpcy5pb3NDb25maWcgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGVzIHRoZSBpT1MgY29uZmlndXJhdGlvblxuICAgKi9cbiAgdXBkYXRlQ29uZmlnKG5ld0NvbmZpZzogUGFydGlhbDxpT1NQdXNoQ29uZmlnPik6IHZvaWQge1xuICAgIHRoaXMuaW9zQ29uZmlnID0geyAuLi50aGlzLmlvc0NvbmZpZywgLi4ubmV3Q29uZmlnIH07XG4gIH1cbn0iXX0=