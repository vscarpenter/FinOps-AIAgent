const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

async function testModelAccess() {
    try {
        const client = new BedrockRuntimeClient({ 
            region: process.env.BEDROCK_REGION || 'us-east-1'
        });
        
        const modelId = process.env.BEDROCK_MODEL_ID || 'amazon.titan-text-express-v1';
        
        let requestBody;
        if (modelId.startsWith('amazon.titan-text')) {
            requestBody = {
                inputText: 'Test access validation',
                textGenerationConfig: {
                    maxTokenCount: 10,
                    temperature: 0.1,
                    stopSequences: [],
                    topP: 1
                }
            };
        } else if (modelId.startsWith('amazon.titan-embed')) {
            requestBody = {
                inputText: 'Test access validation'
            };
        } else if (modelId.startsWith('anthropic.claude')) {
            requestBody = {
                prompt: '\n\nHuman: Test access validation\n\nAssistant:',
                max_tokens_to_sample: 10,
                temperature: 0.1
            };
        } else {
            throw new Error(`Unsupported model: ${modelId}`);
        }
        
        const command = new InvokeModelCommand({
            modelId: modelId,
            body: JSON.stringify(requestBody),
            contentType: 'application/json',
            accept: 'application/json'
        });
        
        const response = await client.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        
        console.log('SUCCESS: Model access validated');
        console.log(`Model: ${modelId}`);
        console.log(`Response received: ${JSON.stringify(responseBody).length} bytes`);
        process.exit(0);
    } catch (error) {
        console.error('ERROR: Model access failed');
        console.error(`Model: ${process.env.BEDROCK_MODEL_ID || 'amazon.titan-text-express-v1'}`);
        console.error(`Error: ${error.message}`);
        
        if (error.name === 'AccessDeniedException') {
            console.error('CAUSE: Model access not enabled in Bedrock console');
        } else if (error.name === 'ValidationException') {
            console.error('CAUSE: Invalid request parameters');
        } else if (error.name === 'ThrottlingException') {
            console.error('CAUSE: Rate limiting - try again later');
        } else if (error.name === 'ServiceUnavailableException') {
            console.error('CAUSE: Bedrock service unavailable in region');
        }
        
        process.exit(1);
    }
}

testModelAccess();