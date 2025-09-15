"use strict";
/**
 * Lambda entry point for iOS Device Registration API
 *
 * This is a separate Lambda function from the main spend monitor agent
 * that handles device registration, updates, and management for iOS push notifications.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const device_registration_handler_1 = require("./device-registration-handler");
/**
 * AWS Lambda handler for API Gateway events
 *
 * This function is deployed as a separate Lambda function and handles
 * all device registration API requests through API Gateway.
 */
const handler = async (event) => {
    console.log('Device Registration API Lambda invoked:', {
        method: event.httpMethod,
        path: event.path,
        requestId: event.requestContext.requestId,
        sourceIp: event.requestContext.identity.sourceIp
    });
    try {
        // Call the device registration handler
        const response = await (0, device_registration_handler_1.handler)(event);
        console.log('Device Registration API response:', {
            statusCode: response.statusCode,
            requestId: event.requestContext.requestId
        });
        return response;
    }
    catch (error) {
        console.error('Unhandled error in Device Registration API:', error);
        // Return a generic error response
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Internal Server Error',
                message: 'An unexpected error occurred',
                requestId: event.requestContext.requestId
            })
        };
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGV2aWNlLXJlZ2lzdHJhdGlvbi1pbmRleC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9kZXZpY2UtcmVnaXN0cmF0aW9uLWluZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7R0FLRzs7O0FBRUgsK0VBQXFGO0FBR3JGOzs7OztHQUtHO0FBQ0ksTUFBTSxPQUFPLEdBQUcsS0FBSyxFQUFFLEtBQXNCLEVBQStCLEVBQUU7SUFDbkYsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5Q0FBeUMsRUFBRTtRQUNyRCxNQUFNLEVBQUUsS0FBSyxDQUFDLFVBQVU7UUFDeEIsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJO1FBQ2hCLFNBQVMsRUFBRSxLQUFLLENBQUMsY0FBYyxDQUFDLFNBQVM7UUFDekMsUUFBUSxFQUFFLEtBQUssQ0FBQyxjQUFjLENBQUMsUUFBUSxDQUFDLFFBQVE7S0FDakQsQ0FBQyxDQUFDO0lBRUgsSUFBSSxDQUFDO1FBQ0gsdUNBQXVDO1FBQ3ZDLE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBQSxxQ0FBeUIsRUFBQyxLQUFLLENBQUMsQ0FBQztRQUV4RCxPQUFPLENBQUMsR0FBRyxDQUFDLG1DQUFtQyxFQUFFO1lBQy9DLFVBQVUsRUFBRSxRQUFRLENBQUMsVUFBVTtZQUMvQixTQUFTLEVBQUUsS0FBSyxDQUFDLGNBQWMsQ0FBQyxTQUFTO1NBQzFDLENBQUMsQ0FBQztRQUVILE9BQU8sUUFBUSxDQUFDO0lBRWxCLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyw2Q0FBNkMsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUVwRSxrQ0FBa0M7UUFDbEMsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFO2dCQUNQLGNBQWMsRUFBRSxrQkFBa0I7Z0JBQ2xDLDZCQUE2QixFQUFFLEdBQUc7YUFDbkM7WUFDRCxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDbkIsS0FBSyxFQUFFLHVCQUF1QjtnQkFDOUIsT0FBTyxFQUFFLDhCQUE4QjtnQkFDdkMsU0FBUyxFQUFFLEtBQUssQ0FBQyxjQUFjLENBQUMsU0FBUzthQUMxQyxDQUFDO1NBQ0gsQ0FBQztJQUNKLENBQUM7QUFDSCxDQUFDLENBQUM7QUFwQ1csUUFBQSxPQUFPLFdBb0NsQiIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogTGFtYmRhIGVudHJ5IHBvaW50IGZvciBpT1MgRGV2aWNlIFJlZ2lzdHJhdGlvbiBBUElcbiAqIFxuICogVGhpcyBpcyBhIHNlcGFyYXRlIExhbWJkYSBmdW5jdGlvbiBmcm9tIHRoZSBtYWluIHNwZW5kIG1vbml0b3IgYWdlbnRcbiAqIHRoYXQgaGFuZGxlcyBkZXZpY2UgcmVnaXN0cmF0aW9uLCB1cGRhdGVzLCBhbmQgbWFuYWdlbWVudCBmb3IgaU9TIHB1c2ggbm90aWZpY2F0aW9ucy5cbiAqL1xuXG5pbXBvcnQgeyBoYW5kbGVyIGFzIGRldmljZVJlZ2lzdHJhdGlvbkhhbmRsZXIgfSBmcm9tICcuL2RldmljZS1yZWdpc3RyYXRpb24taGFuZGxlcic7XG5pbXBvcnQgeyBBUElHYXRld2F5RXZlbnQsIEFQSUdhdGV3YXlSZXNwb25zZSB9IGZyb20gJy4vdHlwZXMnO1xuXG4vKipcbiAqIEFXUyBMYW1iZGEgaGFuZGxlciBmb3IgQVBJIEdhdGV3YXkgZXZlbnRzXG4gKiBcbiAqIFRoaXMgZnVuY3Rpb24gaXMgZGVwbG95ZWQgYXMgYSBzZXBhcmF0ZSBMYW1iZGEgZnVuY3Rpb24gYW5kIGhhbmRsZXNcbiAqIGFsbCBkZXZpY2UgcmVnaXN0cmF0aW9uIEFQSSByZXF1ZXN0cyB0aHJvdWdoIEFQSSBHYXRld2F5LlxuICovXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChldmVudDogQVBJR2F0ZXdheUV2ZW50KTogUHJvbWlzZTxBUElHYXRld2F5UmVzcG9uc2U+ID0+IHtcbiAgY29uc29sZS5sb2coJ0RldmljZSBSZWdpc3RyYXRpb24gQVBJIExhbWJkYSBpbnZva2VkOicsIHtcbiAgICBtZXRob2Q6IGV2ZW50Lmh0dHBNZXRob2QsXG4gICAgcGF0aDogZXZlbnQucGF0aCxcbiAgICByZXF1ZXN0SWQ6IGV2ZW50LnJlcXVlc3RDb250ZXh0LnJlcXVlc3RJZCxcbiAgICBzb3VyY2VJcDogZXZlbnQucmVxdWVzdENvbnRleHQuaWRlbnRpdHkuc291cmNlSXBcbiAgfSk7XG5cbiAgdHJ5IHtcbiAgICAvLyBDYWxsIHRoZSBkZXZpY2UgcmVnaXN0cmF0aW9uIGhhbmRsZXJcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGRldmljZVJlZ2lzdHJhdGlvbkhhbmRsZXIoZXZlbnQpO1xuXG4gICAgY29uc29sZS5sb2coJ0RldmljZSBSZWdpc3RyYXRpb24gQVBJIHJlc3BvbnNlOicsIHtcbiAgICAgIHN0YXR1c0NvZGU6IHJlc3BvbnNlLnN0YXR1c0NvZGUsXG4gICAgICByZXF1ZXN0SWQ6IGV2ZW50LnJlcXVlc3RDb250ZXh0LnJlcXVlc3RJZFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHJlc3BvbnNlO1xuXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcignVW5oYW5kbGVkIGVycm9yIGluIERldmljZSBSZWdpc3RyYXRpb24gQVBJOicsIGVycm9yKTtcblxuICAgIC8vIFJldHVybiBhIGdlbmVyaWMgZXJyb3IgcmVzcG9uc2VcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogNTAwLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonXG4gICAgICB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBlcnJvcjogJ0ludGVybmFsIFNlcnZlciBFcnJvcicsXG4gICAgICAgIG1lc3NhZ2U6ICdBbiB1bmV4cGVjdGVkIGVycm9yIG9jY3VycmVkJyxcbiAgICAgICAgcmVxdWVzdElkOiBldmVudC5yZXF1ZXN0Q29udGV4dC5yZXF1ZXN0SWRcbiAgICAgIH0pXG4gICAgfTtcbiAgfVxufTsiXX0=