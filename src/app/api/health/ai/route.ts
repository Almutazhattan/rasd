/**
 * Live check of the configured AI provider, from the deployment itself:
 * for each model in the chain (primary, then fallbacks), one tool call and
 * the follow-up turn that must carry the tool result back (the step Gemini 3
 * needs thought signatures for). Reports status and latency only — never the
 * key, never model output beyond a status word.
 *
 * Cached for three minutes and de-duplicated while running, so it cannot be
 * used to run up provider usage.
 */
import { NextResponse } from 'next/server';
import { aiState, env } from '@/lib/env';
import { OpenAiCompatibleProvider } from '@/agents/openai-compatible';
import type { LlmMessage } from '@/agents/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Check = { model: string; ok: boolean; firstMs?: number; followUpMs?: number; error?: string };
let cache: { at: number; body: unknown } | null = null;
let inflight: Promise<unknown> | null = null;

async function checkModel(base: string, key: string, model: string, dialect: 'gemini' | 'json-schema',
  effort: 'low' | 'medium' | 'high' | undefined): Promise<Check> {
  const p = new OpenAiCompatibleProvider({
    name: dialect === 'gemini' ? 'gemini' : 'groq', baseUrl: base, apiKey: key, model,
    fallbackModels: [], timeoutMs: 50_000, requestTimeoutMs: 45_000, schemaDialect: dialect, reasoningEffort: effort,
  });
  const tools = [{
    name: 'get_status', description: 'Returns the platform status.',
    input_schema: { type: 'object', properties: { scope: { type: 'string' } }, required: ['scope'] },
  }];
  const system = 'You are a health check. Call get_status with scope "all", then reply with the single word: ready.';
  const messages: LlmMessage[] = [{ role: 'user', content: 'Run the health check.' }];
  try {
    const t0 = Date.now();
    const first = await p.complete({ system, messages, tools, maxTokens: 512, deadlineMs: 50_000 });
    const firstMs = Date.now() - t0;
    const use = first.toolUses[0];
    if (!use) return { model, ok: false, firstMs, error: 'model did not call the tool' };
    messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: use.id, name: use.name, input: use.input }] });
    messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: use.id, content: '{"status":"ok"}' }] });
    const t1 = Date.now();
    await p.complete({ system, messages, tools, maxTokens: 512, deadlineMs: 50_000 });
    return { model, ok: true, firstMs, followUpMs: Date.now() - t1 };
  } catch (err) {
    const detail = (err as { detail?: { message?: string } }).detail?.message;
    return { model, ok: false, error: (detail ?? (err instanceof Error ? err.message : String(err))).slice(0, 300) };
  }
}

async function run() {
  const e = env();
  if (aiState(e) !== 'CONNECTED') return { provider: e.AI_PROVIDER, state: aiState(e), checks: [] };
  if (e.AI_PROVIDER === 'gemini' && e.GEMINI_API_KEY) {
    const base = 'https://generativelanguage.googleapis.com/v1beta/openai';
    const chain = [e.GEMINI_MODEL, ...e.GEMINI_FALLBACK_MODELS.split(',').map((m) => m.trim()).filter(Boolean)];
    const checks = await Promise.all(chain.map((m) => checkModel(base, e.GEMINI_API_KEY!, m, 'gemini', e.GEMINI_REASONING_EFFORT)));
    return { provider: 'gemini', reasoningEffort: e.GEMINI_REASONING_EFFORT, checks };
  }
  if (e.AI_PROVIDER === 'groq' && e.GROQ_API_KEY) {
    const checks = [await checkModel('https://api.groq.com/openai/v1', e.GROQ_API_KEY, e.GROQ_MODEL, 'json-schema', undefined)];
    return { provider: 'groq', checks };
  }
  return { provider: e.AI_PROVIDER, note: 'live check covers the OpenAI-compatible providers', checks: [] };
}

export async function GET() {
  if (cache && Date.now() - cache.at < 180_000) {
    return NextResponse.json({ ...(cache.body as object), cached: true });
  }
  inflight ??= run().then((body) => { cache = { at: Date.now(), body }; return body; }).finally(() => { inflight = null; });
  const body = await inflight;
  return NextResponse.json({ ...(body as object), checkedAt: new Date(cache?.at ?? Date.now()).toISOString() });
}
