/**
 * LLM provider adapter. Anthropic is implemented here; Gemini and Groq use the
 * OpenAI-compatible adapter in openai-compatible.ts. AI_PROVIDER selects.
 *
 * Agent code never imports a vendor SDK: it talks to this interface. Swapping
 * providers is a new file here, not a change to any agent.
 *
 * When no provider is configured, getProvider() returns the unconfigured
 * provider, whose calls raise PROVIDER_UNCONFIGURED. Runs then persist with
 * status PROVIDER_UNCONFIGURED. Nothing is ever invented to fill the gap.
 */
import Anthropic from '@anthropic-ai/sdk';
import { aiKeyName, aiState, env, type IntegrationState } from '@/lib/env';
import { OpenAiCompatibleProvider } from './openai-compatible';
import { AppError, providerUnconfigured } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { JsonSchema } from './jsonschema';

export interface LlmToolSpec {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

export interface LlmToolUse {
  id: string;
  name: string;
  input: unknown;
}

export type LlmContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string | LlmContent[];
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  tools?: LlmToolSpec[];
  maxTokens?: number;
  temperature?: number;
  /** Abort if the provider has not responded by this time. */
  deadlineMs?: number;
}

export interface LlmResult {
  text: string;
  toolUses: LlmToolUse[];
  stopReason: string | null;
  model: string;
  usage: { input: number; output: number };
}

export interface LlmProvider {
  readonly name: string;
  readonly state: IntegrationState;
  readonly model: string;
  complete(req: LlmRequest): Promise<LlmResult>;
}

class UnconfiguredProvider implements LlmProvider {
  readonly name = 'unconfigured';
  readonly state: IntegrationState;
  readonly model = '—';

  constructor(state: IntegrationState) {
    this.state = state;
  }

  async complete(): Promise<LlmResult> {
    throw providerUnconfigured(
      `No AI provider is configured. Set ${aiKeyName()} to enable agent execution.`,
    );
  }
}

class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly state: IntegrationState = 'CONNECTED';
  readonly model: string;
  private client: Anthropic;

  constructor(apiKey: string, model: string, timeoutMs: number) {
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 0 });
    this.model = model;
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const e = env();
    const controller = new AbortController();
    const budget = req.deadlineMs ?? e.AI_REQUEST_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), budget);
    try {
      const res = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: req.maxTokens ?? e.AI_MAX_OUTPUT_TOKENS,
          temperature: req.temperature ?? 0,
          system: req.system,
          messages: req.messages as Anthropic.MessageParam[],
          ...(req.tools?.length
            ? { tools: req.tools as unknown as Anthropic.Tool[] }
            : {}),
        },
        { signal: controller.signal },
      );

      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();

      const toolUses = res.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, input: b.input }));

      return {
        text,
        toolUses,
        stopReason: res.stop_reason ?? null,
        model: res.model,
        usage: { input: res.usage.input_tokens, output: res.usage.output_tokens },
      };
    } catch (err) {
      if (controller.signal.aborted) {
        throw new AppError('TIMEOUT', `The AI provider did not respond within ${budget} ms.`);
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.error('ai provider error', { provider: this.name, message });
      throw new AppError('PROVIDER_ERROR', 'The AI provider returned an error.', { message });
    } finally {
      clearTimeout(timer);
    }
  }
}

let cached: LlmProvider | null = null;

export function getProvider(): LlmProvider {
  if (cached) return cached;
  const e = env();
  const state = aiState(e);
  if (state !== 'CONNECTED') {
    cached = new UnconfiguredProvider(state);
  } else if (e.AI_PROVIDER === 'gemini' && e.GEMINI_API_KEY) {
    cached = new OpenAiCompatibleProvider({
      name: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: e.GEMINI_API_KEY,
      model: e.GEMINI_MODEL,
      timeoutMs: e.AI_REQUEST_TIMEOUT_MS,
      schemaDialect: 'gemini',
      reasoningEffort: e.GEMINI_REASONING_EFFORT,
      fallbackModels: e.GEMINI_FALLBACK_MODELS.split(',').map((m) => m.trim()).filter(Boolean),
      requestTimeoutMs: e.AI_CALL_TIMEOUT_MS,
    });
  } else if (e.AI_PROVIDER === 'groq' && e.GROQ_API_KEY) {
    cached = new OpenAiCompatibleProvider({
      name: 'groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: e.GROQ_API_KEY,
      model: e.GROQ_MODEL,
      timeoutMs: e.AI_REQUEST_TIMEOUT_MS,
      schemaDialect: 'json-schema',
      requestTimeoutMs: e.AI_CALL_TIMEOUT_MS,
    });
  } else if (e.ANTHROPIC_API_KEY) {
    cached = new AnthropicProvider(e.ANTHROPIC_API_KEY, e.ANTHROPIC_MODEL, e.AI_REQUEST_TIMEOUT_MS);
  } else {
    cached = new UnconfiguredProvider(state);
  }
  return cached;
}

/** Inject a provider. Tests and alternative deployments only. */
export function __setProvider(p: LlmProvider | null) {
  cached = p;
}
