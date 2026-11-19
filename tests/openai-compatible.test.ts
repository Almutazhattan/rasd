/**
 * The OpenAI-compatible adapter used for Google Gemini and Groq.
 *
 * fetch is replaced, so these tests check the wire format the adapter sends
 * and how it reads replies — the parts that decide whether an agent run works
 * on a provider other than Anthropic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleProvider, SKIP_SIGNATURE, __signatureFor, toGeminiSchema, toOaiMessages } from '@/agents/openai-compatible';
import { zodToJsonSchema } from '@/agents/jsonschema';
import { AGENT_LIST } from '@/agents/registry';
import { toolSpecs } from '@/agents/tools';
import { __resetEnv } from '@/lib/env';
import { __setProvider, getProvider } from '@/agents/provider';

process.env.DATABASE_URL ??= 'postgresql://unused';
process.env.SESSION_SECRET ??= 'test-session-secret-at-least-32-characters-long';

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ['AI_PROVIDER', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'ANTHROPIC_API_KEY']) delete process.env[k];
  __resetEnv();
  __setProvider(null);
});

function provider(dialect: 'gemini' | 'json-schema' = 'gemini') {
  return new OpenAiCompatibleProvider({
    name: dialect === 'gemini' ? 'gemini' : 'groq',
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key-0123456789',
    model: 'test-model',
    timeoutMs: 5_000,
    schemaDialect: dialect,
  });
}

function stubFetch(reply: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(reply), { status });
  }));
  return calls;
}

describe('provider selection', () => {
  it('AI_PROVIDER=gemini with a key selects Gemini', () => {
    process.env.AI_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'gemini-test-key-123456';
    __resetEnv();
    const p = getProvider();
    expect(p.name).toBe('gemini');
    expect(p.state).toBe('CONNECTED');
  });

  it('AI_PROVIDER=groq with a key selects Groq', () => {
    process.env.AI_PROVIDER = 'groq';
    process.env.GROQ_API_KEY = 'groq-test-key-1234567';
    __resetEnv();
    expect(getProvider().name).toBe('groq');
  });

  it('a selected provider without its key is unconfigured — an Anthropic key does not stand in', () => {
    process.env.AI_PROVIDER = 'gemini';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-unrelated-0123456789';
    __resetEnv();
    const p = getProvider();
    expect(p.state).toBe('NOT_CONFIGURED');
    return expect(p.complete({ system: '', messages: [] })).rejects.toThrow(/GEMINI_API_KEY/);
  });
});

describe('Gemini schema dialect', () => {
  it('rewrites nullable unions and drops additionalProperties', () => {
    const out = toGeminiSchema({
      type: 'object',
      additionalProperties: false,
      required: ['a'],
      properties: { a: { type: ['string', 'null'] }, b: { enum: ['x', 'y', null] } },
    });
    expect(out).toEqual({
      type: 'object',
      required: ['a'],
      properties: {
        a: { type: 'string', nullable: true },
        b: { type: 'string', enum: ['x', 'y'], nullable: true },
      },
    });
  });

  it('every real agent tool and submit schema converts with no unsupported keys left', () => {
    const banned = (node: unknown): string[] => {
      if (!node || typeof node !== 'object') return [];
      const found: string[] = [];
      for (const [k, v] of Object.entries(node)) {
        if (k === 'additionalProperties') found.push(k);
        if (k === 'type' && Array.isArray(v)) found.push('type[]');
        found.push(...banned(v));
      }
      return found;
    };
    for (const agent of AGENT_LIST) {
      const schemas = [zodToJsonSchema(agent.outputSchema), ...toolSpecs(agent.tools).map((t) => t.input_schema)];
      for (const s of schemas) expect(banned(toGeminiSchema(s)), agent.key).toEqual([]);
    }
  });
});

describe('message translation', () => {
  it('maps tool use and tool results to OpenAI tool_calls and tool messages, in order', () => {
    const out = toOaiMessages('SYS', [
      { role: 'user', content: 'task' },
      { role: 'assistant', content: [
        { type: 'text', text: 'reading' },
        { type: 'tool_use', id: 'c1', name: 'read_doc', input: { id: 7 } },
      ] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'c1', content: 'doc text' },
        { type: 'text', text: 'now submit' },
      ] },
    ]);
    expect(out).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'task' },
      { role: 'assistant', content: 'reading', tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'read_doc', arguments: '{"id":7}' } },
      ] },
      { role: 'tool', tool_call_id: 'c1', content: 'doc text' },
      { role: 'user', content: 'now submit' },
    ]);
  });

  it('marks error tool results so the model sees the failure', () => {
    const out = toOaiMessages('S', [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'bad input', is_error: true }] },
    ]);
    expect(out[1]).toEqual({ role: 'tool', tool_call_id: 'x', content: 'ERROR: bad input' });
  });
});

describe('complete()', () => {
  it('sends tools in the dialect, bearer auth, and parses tool calls and usage', async () => {
    const calls = stubFetch({
      model: 'test-model-001',
      choices: [{
        finish_reason: 'tool_calls',
        message: { content: null, tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'submit_x', arguments: '{"score":3}' } },
        ] },
      }],
      usage: { prompt_tokens: 120, completion_tokens: 30 },
    });

    const res = await provider('gemini').complete({
      system: 'S',
      messages: [{ role: 'user', content: 'go' }],
      tools: [{ name: 'submit_x', description: 'd', input_schema: {
        type: 'object', additionalProperties: false, required: ['score'],
        properties: { score: { type: ['number', 'null'] } },
      } }],
    });

    expect(calls[0].url).toBe('https://example.test/v1/chat/completions');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer test-key-0123456789');
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.tools[0].function.parameters).toEqual({
      type: 'object', required: ['score'], properties: { score: { type: 'number', nullable: true } },
    });

    expect(res.toolUses).toEqual([{ id: 'call_1', name: 'submit_x', input: { score: 3 } }]);
    expect(res.stopReason).toBe('tool_use');
    expect(res.usage).toEqual({ input: 120, output: 30 });
    expect(res.model).toBe('test-model-001');
  });

  it('Groq gets the JSON Schema unchanged', async () => {
    const calls = stubFetch({ choices: [{ finish_reason: 'stop', message: { content: 'hi' } }] });
    const schema = { type: 'object', additionalProperties: false, properties: {} };
    const res = await provider('json-schema').complete({
      system: 'S', messages: [{ role: 'user', content: 'go' }],
      tools: [{ name: 't', description: 'd', input_schema: schema }],
    });
    expect(JSON.parse(String(calls[0].init.body)).tools[0].function.parameters).toEqual(schema);
    expect(res.text).toBe('hi');
    expect(res.stopReason).toBe('end_turn');
  });

  it('fills a missing tool-call id and passes unparsable arguments through for repair', async () => {
    stubFetch({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [
      { type: 'function', function: { name: 'submit_x', arguments: '{not json' } },
    ] } }] });
    const res = await provider().complete({ system: 'S', messages: [{ role: 'user', content: 'go' }] });
    expect(res.toolUses[0].id).toMatch(/^call_/);
    expect(res.toolUses[0].input).toEqual({ __unparsable_arguments: '{not json' });
  });

  it('an HTTP error becomes PROVIDER_ERROR, not a crash or an invented answer', async () => {
    stubFetch({ error: { message: 'quota exceeded' } }, 429);
    await expect(provider().complete({ system: 'S', messages: [{ role: 'user', content: 'go' }] }))
      .rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
  });
});

describe('Gemini 3 thought signatures', () => {
  it('keeps the signature from a tool call and sends it back on the next turn', async () => {
    const calls = stubFetch({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [
      { id: 'sig_call_1', type: 'function', function: { name: 'read_doc', arguments: '{}' },
        extra_content: { google: { thought_signature: 'SIG-abc123' } } },
    ] } }] });
    const p = provider('gemini');
    const first = await p.complete({ system: 'S', messages: [{ role: 'user', content: 'go' }] });
    expect(__signatureFor('sig_call_1')).toEqual({ google: { thought_signature: 'SIG-abc123' } });

    await p.complete({ system: 'S', messages: [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: first.toolUses.map((u) => ({ type: 'tool_use' as const, ...u })) },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'sig_call_1', content: 'text' }] },
    ] });
    const sent = JSON.parse(String(calls[1].init.body));
    expect(sent.messages[2].tool_calls[0].extra_content).toEqual({ google: { thought_signature: 'SIG-abc123' } });
  });

  it('sends the documented skip value when no signature is known', () => {
    const out = toOaiMessages('S', [{ role: 'assistant', content: [
      { type: 'tool_use', id: 'never_seen', name: 't', input: {} },
    ] }], 'gemini') as { tool_calls?: { extra_content?: unknown }[] }[];
    expect(out[1].tool_calls?.[0].extra_content).toEqual({ google: { thought_signature: SKIP_SIGNATURE } });
  });

  it('Groq gets no Gemini-specific fields', () => {
    const out = toOaiMessages('S', [{ role: 'assistant', content: [
      { type: 'tool_use', id: 'x1', name: 't', input: {} },
    ] }], 'json-schema') as { tool_calls?: Record<string, unknown>[] }[];
    expect(out[1].tool_calls?.[0]).not.toHaveProperty('extra_content');
  });

  it('sends reasoning_effort when configured', async () => {
    const calls = stubFetch({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] });
    const p = new OpenAiCompatibleProvider({
      name: 'gemini', baseUrl: 'https://example.test/v1', apiKey: 'k-0123456789ab', model: 'm',
      timeoutMs: 5000, schemaDialect: 'gemini', reasoningEffort: 'low',
    });
    await p.complete({ system: 'S', messages: [{ role: 'user', content: 'go' }] });
    expect(JSON.parse(String(calls[0].init.body)).reasoning_effort).toBe('low');
  });
});
