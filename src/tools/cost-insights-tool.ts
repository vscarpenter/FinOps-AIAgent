import { Tool } from '../mock-strands-agent';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { BedrockCostInsightsConfig, CostAnalysis, CostInsights } from '../types';
import { createLogger } from '../utils/logger';

interface InvokeConfig {
  maxOutputTokens: number;
  temperature: number;
  topP: number;
}

/**
 * Tool that enriches cost analysis with Bedrock generated insights
 */
export class CostInsightsTool extends Tool {
  private client: BedrockRuntimeClient;
  private modelId: string;
  private invokeConfig: InvokeConfig;
  private toolLogger = createLogger('CostInsightsTool');

  constructor(config: BedrockCostInsightsConfig, defaultRegion: string) {
    super();

    const region = config.region || defaultRegion;
    this.client = new BedrockRuntimeClient({ region });
    this.modelId = config.modelId;
    this.invokeConfig = {
      maxOutputTokens: config.maxOutputTokens ?? 256,
      temperature: config.temperature ?? 0.2,
      topP: config.topP ?? 0.9
    };
  }

  /**
   * Generates insights for the provided Cost Explorer summary using a Bedrock model
   */
  async generateInsights(costAnalysis: CostAnalysis, threshold: number): Promise<CostInsights | undefined> {
    const prompt = this.buildPrompt(costAnalysis, threshold);

    try {
      const response = await this.client.send(new InvokeModelCommand({
        modelId: this.modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          inputText: prompt,
          textGenerationConfig: {
            maxTokenCount: this.invokeConfig.maxOutputTokens,
            temperature: this.invokeConfig.temperature,
            topP: this.invokeConfig.topP
          }
        })
      }));

      return this.parseResponse(response.body);
    } catch (error) {
      this.toolLogger.error('Failed to generate Bedrock cost insights', error as Error, {
        modelId: this.modelId
      });
      return undefined;
    }
  }

  /**
   * Builds a compact prompt instructing the model to return JSON insights
   */
  private buildPrompt(costAnalysis: CostAnalysis, threshold: number): string {
    const topServices = Object.entries(costAnalysis.serviceBreakdown)
      .sort(([, aCost], [, bCost]) => bCost - aCost)
      .slice(0, 5)
      .map(([serviceName, cost]) => ({
        serviceName,
        cost: Number(cost.toFixed(2))
      }));

    const payload = {
      totals: {
        totalCost: Number(costAnalysis.totalCost.toFixed(2)),
        projectedMonthly: Number(costAnalysis.projectedMonthly.toFixed(2)),
        currency: costAnalysis.currency
      },
      threshold,
      period: costAnalysis.period,
      topServices,
      otherServices: Object.keys(costAnalysis.serviceBreakdown).length - topServices.length
    };

    return [
      'You are a FinOps assistant that analyses AWS Cost Explorer summaries.',
      'Using the provided JSON, highlight meaningful anomalies or trends.',
      'Respond strictly in JSON with keys: summary (<=120 words), confidence (LOW|MEDIUM|HIGH),',
      'recommendedActions (array of <=3 short strings), notableFindings (array of short strings).',
      'Do not add Markdown or additional text. Focus on cost drivers and budget impact.',
      `Input JSON: ${JSON.stringify(payload)}`
    ].join(' ');
  }

  /**
   * Parses the Titan model response body into CostInsights
   */
  private parseResponse(body: Uint8Array | undefined): CostInsights | undefined {
    if (!body) {
      return undefined;
    }

    const textDecoder = new TextDecoder('utf-8');
    let parsedText: string | undefined;

    try {
      const raw = JSON.parse(textDecoder.decode(body));
      parsedText = raw?.results?.[0]?.outputText?.trim();
    } catch (error) {
      this.toolLogger.error('Unable to decode Bedrock response', error as Error);
      return undefined;
    }

    if (!parsedText) {
      return undefined;
    }

    try {
      const payload = JSON.parse(parsedText);

      const insights: CostInsights = {
        summary: String(payload.summary || '').trim(),
        confidence: this.normaliseConfidence(payload.confidence),
        recommendedActions: Array.isArray(payload.recommendedActions) ? payload.recommendedActions.map(String) : [],
        notableFindings: Array.isArray(payload.notableFindings) ? payload.notableFindings.map(String) : [],
        modelId: this.modelId,
        generatedAt: new Date().toISOString()
      };

      return insights;
    } catch (error) {
      this.toolLogger.error('Bedrock response payload was not valid JSON', error as Error, {
        output: parsedText?.slice(0, 200)
      });
      return undefined;
    }
  }

  /**
   * Ensures the confidence value is one of the expected enums
   */
  private normaliseConfidence(value: unknown): 'LOW' | 'MEDIUM' | 'HIGH' {
    const normalised = String(value || '').toUpperCase();
    if (normalised === 'HIGH' || normalised === 'MEDIUM' || normalised === 'LOW') {
      return normalised;
    }
    return 'MEDIUM';
  }
}
