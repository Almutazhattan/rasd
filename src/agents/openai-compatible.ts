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

type OaiToolCall = {
  id?: string; type: 'function'; function: { name: string; arguments: string };
  /** Gemini 3 puts its thought_signature here; it must be sent back verbatim. */
  extra_content?: { google?: { thought_signature?: string } } & Record<string, unknown>;
};
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
  /** OpenAI-style reasoning_effort; Gemini 3 maps it to its thinking level. */
  reasoningEffort?: 'low' | 'medium' | 'high';
  /** Tried in order when the primary model is overloaded, rate-limited or slow. */
  fallbackModels?: string[];
  /** Ceiling for a single HTTP call, so a hung call leaves time to retry. */
  requestTimeoutMs?: number;
}

/**
 * Gemini 3 thought signatures.
 *
 * Every tool call Gemini 3 returns carries an opaque
 * extra_content.google.thought_signature, and the next request must echo it
 * on that same tool call or Gemini rejects the turn with HTTP 400. Agents keep
 * provider-neutral history (id, name, input), so the signature is held here,
 * keyed by tool-call id, and re-attached when the history is serialised.
 * Where none is known, Google documents "skip_thought_signature_validator" as
 * the value to send.
 */
// Signatures are only valid for the model that produced them; after a
// fallback switch, the skip value is sent instead of another model's signature.
const SIGNATURES = new Map<string, { model: string; extra: OaiToolCall['extra_content'] }>();
const SIGNATURE_CAP = 5000;
export const SKIP_SIGNATURE = 'skip_thought_signature_validator';

function rememberSignature(id: string, model: string, extra: OaiToolCall['extra_content']) {
  if (!extra) return;
  if (SIGNATURES.size >= SIGNATURE_CAP) {
    const oldest = SIGNATURES.keys().next().value;
    if (oldest !== undefined) SIGNATURES.delete(oldest);
  }
  SIGNATURES.set(id, { model, extra });
}

/** Tests only. */
export function __signatureFor(id: string) {
  return SIGNATURES.get(id)?.extra;
}

// ── model health: a model that just failed is tried last for a while ──
const DEMOTE_MS = 120_000;
const demotedUntil = new Map<string, number>();
const RETRYABLE_HTTP = new Set([408, 409, 429, 500, 502, 503, 504]);

class CallError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly timedOut = false) { super(message); }
}

/** Tests only. */
export function __resetModelHealth() { demotedUntil.clear(); }

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
export function toOaiMessages(
  system: string, messages: LlmMessage[], dialect: 'gemini' | 'json-schema' = 'json-schema',
  model?: string,
): OaiMessage[] {
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
        .map((b): OaiToolCall => ({
          id: b.id, type: 'function' as const,
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
          ...(dialect === 'gemini'
            ? {
              extra_content: (() => {
                const sig = SIGNATURES.get(b.id);
                return sig && (model === undefined || sig.model === model)
                  ? sig.extra
                  : { google: { thought_signature: SKIP_SIGNATURE } };
              })(),
            }
            : {}),
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

  /**
   * One request, made reliable: each call is capped (requestTimeoutMs) so a
   * hung call cannot eat the whole budget; an overloaded, rate-limited or slow
   * model is retried and then swapped for the next fallback model, and the
   * one that failed is tried last for the next two minutes. A request the
   * provider rejects outright (bad request, auth) is not retried.
   */
  async complete(req: LlmRequest): Promise<LlmResult> {
    const budget = req.deadlineMs ?? this.cfg.timeoutMs;
    const giveUpAt = Date.now() + budget;
    const now = Date.now();
    const chain = [this.cfg.model, ...(this.cfg.fallbackModels ?? [])]
      .filter((m, i, a) => m && a.indexOf(m) === i);
    const healthy = chain.filter((m) => (demotedUntil.get(m) ?? 0) <= now);
    const order = [...healthy, ...chain.filter((m) => !healthy.includes(m))];
    // Each model gets up to two tries, round-robin, while time remains.
    const attempts = [...order, ...order];

    const cap = this.cfg.requestTimeoutMs ?? 90_000;
    // Smallest call worth making: a couple of seconds, or the cap if it is shorter.
    const minCall = Math.min(2_500, cap);
    let lastError: CallError | null = null;
    for (let i = 0; i < attempts.length; i++) {
      const model = attempts[i];
      if (giveUpAt - Date.now() < minCall + 500) break;
      if (i > 0) {
        const pause = Math.min(1_500 * i, 5_000, giveUpAt - Date.now() - minCall - 500);
        if (pause > 0) await new Promise((r) => setTimeout(r, pause));
      }
      const timeout = Math.min(giveUpAt - Date.now() - 500, cap);
      if (timeout < minCall) break;
      try {
        const result = await this.callOnce(model, req, timeout);
        if (model !== this.cfg.model) {
          logger.info('ai fallback model answered', { provider: this.name, model, primary: this.cfg.model });
        }
        return result;
      } catch (err) {
        const e = err instanceof CallError ? err : new CallError(String(err), true);
        lastError = e;
        logger.warn('ai call failed', {
          provider: this.name, model, attempt: i + 1, retryable: e.retryable, message: e.message.slice(0, 400),
        });
        if (!e.retryable) break;
        demotedUntil.set(model, Date.now() + DEMOTE_MS);
      }
    }

    const message = lastError?.message ?? 'no attempt could be made within the time budget';
    logger.error('ai provider error', { provider: this.name, message: message.slice(0, 800) });
    if (lastError?.timedOut || !lastError) {
      throw new AppError('TIMEOUT', `The AI provider did not respond within ${budget} ms.`);
    }
    throw new AppError('PROVIDER_ERROR', 'The AI provider returned an error.', { message });
  }

  private async callOnce(model: string, req: LlmRequest, timeoutMs: number): Promise<LlmResult> {
    const e = env();
    const tools = req.tools?.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: this.cfg.schemaDialect === 'gemini' ? toGeminiSchema(t.input_schema) : t.input_schema,
      },
    }));
    const body = {
      model,
      messages: toOaiMessages(req.system, req.messages, this.cfg.schemaDialect, model),
      ...(this.cfg.reasoningEffort ? { reasoning_effort: this.cfg.reasoningEffort } : {}),
      max_tokens: req.maxTokens ?? e.AI_MAX_OUTPUT_TOKENS,
      temperature: req.temperature ?? 0,
      ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let raw: string;
    let status: number;
    try {
      const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      status = res.status;
      raw = await res.text();
    } catch (err) {
      if (controller.signal.aborted) throw new CallError(`no response within ${timeoutMs} ms`, true, true);
      throw new CallError(`network error: ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      clearTimeout(timer);
    }
    if (status < 200 || status >= 300) {
      throw new CallError(`HTTP ${status}: ${raw.slice(0, 500)}`, RETRYABLE_HTTP.has(status));
    }

    let data: {
      model?: string;
      choices?: { message?: { content?: string | null; tool_calls?: OaiToolCall[] }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      data = JSON.parse(raw);
    } catch {
      throw new CallError(`unreadable response: ${raw.slice(0, 200)}`, true);
    }
    const choice = data.choices?.[0];
    if (!choice) throw new CallError(`response had no choices: ${raw.slice(0, 200)}`, true);
    const msg = choice.message ?? {};

    const toolUses: LlmToolUse[] = (msg.tool_calls ?? []).map((c, i) => {
      let input: unknown;
      try {
        input = c.function.arguments ? JSON.parse(c.function.arguments) : {};
      } catch {
        // Pass the unparsable text through; the runner's validation rejects
        // it and asks the model to repair, as for any invalid submission.
        input = { __unparsable_arguments: c.function.arguments };
      }
      const id = c.id || `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}_${i}`;
      rememberSignature(id, model, c.extra_content);
      return { id, name: c.function.name, input };
    });

    const finish = choice.finish_reason ?? null;
    return {
      text: (msg.content ?? '').trim(),
      toolUses,
      stopReason: finish ? (STOP_REASONS[finish] ?? finish) : null,
      model: data.model ?? model,
      usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
    };
  }
}
