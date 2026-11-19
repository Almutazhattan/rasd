/**
 * OpenAI-compatible chat-completions adapter, used for Google Gemini and Groq.
 *
 * Both expose the OpenAI Chat Completions wire format with function calling:
 *   Gemini: https://generativelanguage.googleapis.com/v1beta/openai
 *   Groq:   https://api.groq.com/openai/v1
 *
 * Agents speak the provider-neutral shapes in provider.ts (Anthropic-style
 * content blocks). This file translates them both ways, so no agent changes
 * when the provider does. Uses fetch only: no extra SDK.
 */
import { env, type IntegrationState } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { JsonSchema } from './jsonschema';
import type { LlmContent, LlmMessage, LlmProvider, LlmRequest, LlmResult, LlmToolUse } from './provider';

type OaiToolCall = { id?: string; type: 'function'; function: { name: string; arguments: string } };
type OaiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OaiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface OpenAiCompatibleConfig {
  name: 'gemini' | 'groq';
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Gemini accepts only an OpenAPI-style subset of JSON Schema. */
  schemaDialect: 'gemini' | 'json-schema';
}

/**
 * Gemini rejects `additionalProperties` and union `type` arrays. Rewrite
 * ["string","null"] as type + nullable and drop what it does not accept.
 * Validation of the model's output still happens against the full zod
 * contract in the runner, so nothing is loosened where it matters.
 */
export function toGeminiSchema(s: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (Array.isArray(s.type)) {
    const nonNull = s.type.filter((t) => t !== 'null');
    out.type = nonNull[0] ?? 'string';
    if (s.type.includes('null')) out.nullable = true;
  } else if (s.type) {
    out.type = s.type;
  }
  if (s.description) out.description = s.description;
  if (s.enum) {
    const values = s.enum.filter((v) => v !== null);
    if (s.enum.includes(null)) out.nullable = true;
    // Gemini enums must be strings.
    out.enum = values.map(String);
    if (!out.type || out.type !== 'string') out.type = 'string';
  }
  if (typeof s.minimum === 'number') out.minimum = s.minimum;
  if (typeof s.maximum === 'number') out.maximum = s.maximum;
  if (s.items) out.items = toGeminiSchema(s.items);
  if (s.properties) {
    out.properties = Object.fromEntries(
      Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]),
    );
    if (s.required?.length) out.required = s.required;
  }
  if (s.anyOf) out.anyOf = s.anyOf.map(toGeminiSchema);
  return out;
}

/** Provider-neutral messages → OpenAI chat messages. */
export function toOaiMessages(system: string, messages: LlmMessage[]): OaiMessage[] {
  const out: OaiMessage[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push(m.role === 'user' ? { role: 'user', content: m.content } : { role: 'assistant', content: m.content });
      continue;
    }
    const blocks = m.content as LlmContent[];
    if (m.role === 'assistant') {
      const text = blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');
      const calls = blocks
        .filter((b): b is Extract<LlmContent, { type: 'tool_use' }> => b.type === 'tool_use')
        .map((b) => ({
          id: b.id, type: 'function' as const,
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // User turn: tool results become `tool` messages (they must directly follow
    // the assistant turn that made the calls); any text follows as a user turn.
    const texts: string[] = [];
    for (const b of blocks) {
      if (b.type === 'tool_result') {
        out.push({
          role: 'tool',
          tool_call_id: b.tool_use_id,
          content: b.is_error ? `ERROR: ${b.content}` : b.content,
        });
      } else if (b.type === 'text') {
        texts.push(b.text);
      }
    }
    if (texts.length) out.push({ role: 'user', content: texts.join('\n') });
  }
  return out;
}

const STOP_REASONS: Record<string, string> = {
  tool_calls: 'tool_use', function_call: 'tool_use', stop: 'end_turn', length: 'max_tokens',
};

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: string;
  readonly state: IntegrationState = 'CONNECTED';
  readonly model: string;

  constructor(private cfg: OpenAiCompatibleConfig) {
    this.name = cfg.name;
    this.model = cfg.model;
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const e = env();
    const controller = new AbortController();
    const budget = req.deadlineMs ?? this.cfg.timeoutMs;
    const timer = setTimeout(() => controller.abort(), budget);

    const tools = req.tools?.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: this.cfg.schemaDialect === 'gemini' ? toGeminiSchema(t.input_schema) : t.input_schema,
      },
    }));

    const body = {
      model: this.cfg.model,
      messages: toOaiMessages(req.system, req.messages),
      max_tokens: req.maxTokens ?? e.AI_MAX_OUTPUT_TOKENS,
      temperature: req.temperature ?? 0,
      ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
    };

    try {
      const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${raw.slice(0, 500)}`);
      }
      const data = JSON.parse(raw) as {
        model?: string;
        choices?: { message?: { content?: string | null; tool_calls?: OaiToolCall[] }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = data.choices?.[0];
      const msg = choice?.message ?? {};

      const toolUses: LlmToolUse[] = (msg.tool_calls ?? []).map((c, i) => {
        let input: unknown;
        try {
          input = c.function.arguments ? JSON.parse(c.function.arguments) : {};
        } catch {
          // Pass the unparsable text through; the runner's validation rejects
          // it and asks the model to repair, as for any invalid submission.
          input = { __unparsable_arguments: c.function.arguments };
        }
        return { id: c.id || `call_${Date.now().toString(36)}_${i}`, name: c.function.name, input };
      });

      const finish = choice?.finish_reason ?? null;
      return {
        text: (msg.content ?? '').trim(),
        toolUses,
        stopReason: finish ? (STOP_REASONS[finish] ?? finish) : null,
        model: data.model ?? this.cfg.model,
        usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
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
