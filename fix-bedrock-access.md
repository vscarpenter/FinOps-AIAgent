# Fix Bedrock Model Access Issue

## Problem
The deployment is failing because the AWS Bedrock model `amazon.titan-text-express-v1` is not enabled in your AWS account.

## Solution

### Step 1: Enable Model Access in AWS Console
1. Go to the AWS Bedrock console: https://console.aws.amazon.com/bedrock/
2. In the left navigation, click on "Model access"
3. Click "Request model access" or "Manage model access"
4. Find "Amazon Titan Text G1 - Express" in the list
5. Click the checkbox next to it
6. Click "Request model access" or "Save changes"
7. Wait for approval (usually instant for Titan models)

### Step 2: Verify Access
Run this command to verify the model is now accessible:
```bash
node test-model-access.js
```

### Step 3: Deploy Again
Once model access is enabled, run the deployment again:
```bash
./deploy.sh --bedrock-enabled true --bedrock-model amazon.titan-text-express-v1
```

## Alternative: Deploy Without Bedrock
If you don't want to use Bedrock AI features, you can deploy without them:
```bash
./deploy.sh --bedrock-enabled false
```

## Alternative Models
If you want to use a different model that might already be enabled:
- `amazon.titan-text-lite-v1` (cost-optimized)
- `anthropic.claude-v2` (premium, higher cost)
- `anthropic.claude-instant-v1` (fast)

Check which models are available in your region:
```bash
aws bedrock list-foundation-models --region us-east-1 --query 'modelSummaries[].modelId' --output table
```