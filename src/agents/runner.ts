/**
 * Agent runner — the execution loop every agent goes through.
 *
 * Responsibilities, in the order they happen:
 *   1. Refuse to start when no AI provider is configured, recording the run as
 *      PROVIDER_UNCONFIGURED. Nothing is simulated.
 *   2. Persist an agent_runs row, then an agent_steps row per tool call and per
 *      validation failure, so a run is auditable after the fact.
 *   3. Offer the agent only its own tools, validating each tool input against
 *      the tool's schema before the tool body runs.
 *   4. Take the result only through the submit tool, validated against the
 *      agent's zod contract. A malformed result is returned to the agent with
 *      the validation error, up to maxRepairs times.
 *   5. Retry transient provider failures with backoff, up to maxAttempts, and
 *      enforce a wall-clock timeout per run.
 */
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { scoped, type Ctx } from '@/lib/tenancy';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { zodToJsonSchema } from './jsonschema';
import { getProvider, type LlmContent, type LlmMessage, type LlmToolSpec } from './provider';
import { TOOLS, toolSpecs, type ToolContext } from './tools';
import type { AgentDefinition } from './registry';
import { aiKeyName } from '@/lib/env';

export interface RunOptions {
  ctx: Ctx;
  agent: AgentDefinition;
  /** The task, already assembled. Document text is never pasted here — agents fetch it. */
  input: Record<string, unknown>;
  analysisId?: string;
  tenderId?: string;
  parentRunId?: string;
  /**
   * Hard wall-clock limit from the host (a serverless invocation's end). The
   * run's budget is the earlier of this and the agent's own timeoutMs.
   */
  deadlineAt?: number;
}

export interface RunOutcome<T = unknown> {
  runId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'PROVIDER_UNCONFIGURED';
  output: T | null;
  error: string | null;
  usage: { input: number; output: number };
  model: string | null;
  steps: number;
}

const SUBMIT_PREFIX = 'submit_';

function submitSpec(agent: AgentDefinition): LlmToolSpec {
  return {
    name: `${SUBMIT_PREFIX}${agent.key}`,
    description:
      'Submit your complete, final result. Call this exactly once, when you have gathered ' +
      'everything you need. The result is validated against a strict schema.',
    input_schema: zodToJsonSchema(agent.outputSchema),
  };
}

export async function runAgent<T = unknown>(opts: RunOptions): Promise<RunOutcome<T>> {
  const { ctx, agent } = opts;
  const s = scoped(ctx);
  const provider = getProvider();

  const runRow = await s
    .insert('agent_runs', {
      analysis_id: opts.analysisId ?? null,
      agent_key: agent.key,
      parent_run_id: opts.parentRunId ?? null,
      status: 'PENDING',
      input: JSON.stringify(opts.input),
      plan: JSON.stringify([]),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const runId = (runRow as { id: string }).id;

  // An unconfigured provider is a recorded state, not an exception swallowed
  // into a fake result.
  if (provider.state !== 'CONNECTED') {
    await s
      .update('agent_runs')
      .set({
        status: 'PROVIDER_UNCONFIGURED',
        error:
          `No AI provider is configured for this deployment. Set ${aiKeyName()} to enable ` +
          'agent execution. No analysis was performed.',
        finished_at: new Date(),
      })
      .where('id' as never, '=', runId as never)
      .execute();
    return {
      runId, status: 'PROVIDER_UNCONFIGURED', output: null,
      error: 'AI provider not configured.', usage: { input: 0, output: 0 }, model: null, steps: 0,
    };
  }

  const tc: ToolContext = { ctx, analysisId: opts.analysisId, tenderId: opts.tenderId };
  const specs = [...toolSpecs(agent.tools), submitSpec(agent)];
  const deadline = Math.min(Date.now() + agent.timeoutMs, opts.deadlineAt ?? Infinity);

  let ordinal = 0;
  let usage = { input: 0, output: 0 };
  let model: string | null = null;

  const step = async (
    label: string,
    status: 'SUCCEEDED' | 'FAILED' | 'INVALID_OUTPUT' | 'RETRYING' | 'SKIPPED',
    extra: Partial<{ toolKey: string; toolInput: unknown; toolOutput: unknown; message: string; durationMs: number; attempt: number }> = {},
  ) => {
    ordinal += 1;
    await s
      .insert('agent_steps', {
        run_id: runId,
        ordinal,
        label,
        status,
        attempt: extra.attempt ?? 1,
        tool_key: extra.toolKey ?? null,
        tool_input: extra.toolInput === undefined ? null : JSON.stringify(extra.toolInput),
        tool_output: extra.toolOutput === undefined ? null : JSON.stringify(truncate(extra.toolOutput)),
        message: extra.message ?? null,
        duration_ms: extra.durationMs ?? null,
      })
      .execute();
  };

  await s.update('agent_runs').set({ status: 'RUNNING', started_at: new Date() })
    .where('id' as never, '=', runId as never).execute();

  let lastError: string | null = null;

  for (let attempt = 1; attempt <= agent.maxAttempts; attempt++) {
    if (Date.now() > deadline) {
      lastError = `Run exceeded its ${agent.timeoutMs} ms budget.`;
      break;
    }

    const messages: LlmMessage[] = [
      { role: 'user', content: buildTask(opts.input) },
    ];
    let repairs = 0;

    try {
      for (let iteration = 0; iteration < agent.maxIterations; iteration++) {
        const remaining = deadline - Date.now();
        if (remaining <= 1000) {
          throw new AppError('TIMEOUT', `Run exceeded its ${agent.timeoutMs} ms budget.`);
        }

        const res = await provider.complete({
          system: agent.system,
          messages,
          tools: specs,
          deadlineMs: remaining,
        });
        usage = { input: usage.input + res.usage.input, output: usage.output + res.usage.output };
        model = res.model;

        if (res.toolUses.length === 0) {
          // No tool call and no submission: nudge once, then give up this attempt.
          if (repairs >= agent.maxRepairs) {
            throw new AppError('PROVIDER_ERROR', 'Agent finished without submitting a result.');
          }
          repairs += 1;
          await step('no submission', 'INVALID_OUTPUT', { attempt, message: res.text.slice(0, 500) });
          messages.push({ role: 'assistant', content: res.text || '(no content)' });
          messages.push({
            role: 'user',
            content:
              `You must finish by calling ${SUBMIT_PREFIX}${agent.key} with your complete result. ` +
              'If information is missing, submit it as missing rather than omitting the field.',
          });
          continue;
        }

        const assistantBlocks: LlmContent[] = [];
        if (res.text) assistantBlocks.push({ type: 'text', text: res.text });
        for (const u of res.toolUses) {
          assistantBlocks.push({ type: 'tool_use', id: u.id, name: u.name, input: u.input });
        }
        messages.push({ role: 'assistant', content: assistantBlocks });

        const results: LlmContent[] = [];
        let submitted: { ok: true; value: unknown } | { ok: false; error: string } | null = null;

        for (const use of res.toolUses) {
          // ── submission ──
          if (use.name === `${SUBMIT_PREFIX}${agent.key}`) {
            const parsed = agent.outputSchema.safeParse(use.input);
            if (parsed.success) {
              submitted = { ok: true, value: parsed.data };
              results.push({ type: 'tool_result', tool_use_id: use.id, content: 'accepted' });
            } else {
              const detail = formatZodError(parsed.error);
              submitted = { ok: false, error: detail };
              await step('result rejected by schema', 'INVALID_OUTPUT', { attempt, message: detail });
              results.push({
                type: 'tool_result',
                tool_use_id: use.id,
                is_error: true,
                content:
                  `Your result did not match the schema and was NOT stored. Fix exactly these ` +
                  `problems and call the submit tool again:\n${detail}`,
              });
            }
            continue;
          }

          // ── a tool the agent is not allowed to use ──
          if (!agent.tools.includes(use.name)) {
            await step(`refused tool ${use.name}`, 'FAILED', { attempt, toolKey: use.name, toolInput: use.input });
            results.push({
              type: 'tool_result', tool_use_id: use.id, is_error: true,
              content: `Tool "${use.name}" is not available to you. Available: ${agent.tools.join(', ')}.`,
            });
            continue;
          }

          const tool = TOOLS[use.name];
          if (!tool) {
            results.push({
              type: 'tool_result', tool_use_id: use.id, is_error: true,
              content: `Tool "${use.name}" does not exist.`,
            });
            continue;
          }

          const args = tool.input.safeParse(use.input ?? {});
          if (!args.success) {
            const detail = formatZodError(args.error);
            await step(`invalid input for ${use.name}`, 'FAILED', {
              attempt, toolKey: use.name, toolInput: use.input, message: detail,
            });
            results.push({
              type: 'tool_result', tool_use_id: use.id, is_error: true,
              content: `Invalid arguments:\n${detail}`,
            });
            continue;
          }

          const started = Date.now();
          try {
            const out = await tool.run(args.data, tc);
            const durationMs = Date.now() - started;
            await step(use.name, 'SUCCEEDED', {
              attempt, toolKey: use.name, toolInput: args.data, toolOutput: out, durationMs,
            });
            results.push({
              type: 'tool_result', tool_use_id: use.id,
              content: JSON.stringify(truncate(out)).slice(0, 180_000),
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await step(use.name, 'FAILED', { attempt, toolKey: use.name, toolInput: args.data, message });
            results.push({
              type: 'tool_result', tool_use_id: use.id, is_error: true,
              content: `The tool failed: ${message}`,
            });
          }
        }

        if (submitted?.ok) {
          await s
            .update('agent_runs')
            .set({
              status: 'SUCCEEDED',
              output: JSON.stringify(submitted.value),
              attempts: attempt,
              model,
              input_tokens: usage.input,
              out_tokens: usage.output,
              finished_at: new Date(),
            })
            .where('id' as never, '=', runId as never)
            .execute();
          await step('submitted', 'SUCCEEDED', { attempt });
          return {
            runId, status: 'SUCCEEDED', output: submitted.value as T,
            error: null, usage, model, steps: ordinal,
          };
        }

        if (submitted && !submitted.ok) {
          repairs += 1;
          if (repairs > agent.maxRepairs) {
            throw new AppError('PROVIDER_ERROR', `Result failed schema validation ${repairs} times.`);
          }
        }

        messages.push({ role: 'user', content: results });
      }

      throw new AppError('PROVIDER_ERROR', `Agent did not finish within ${agent.maxIterations} iterations.`);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      const timedOut = err instanceof AppError && err.code === 'TIMEOUT';
      logger.warn('agent attempt failed', { agent: agent.key, attempt, runId, error: lastError });

      if (timedOut || attempt >= agent.maxAttempts) break;

      await step(`attempt ${attempt} failed — retrying`, 'RETRYING', { attempt, message: lastError });
      await sleep(Math.min(8000, 400 * 2 ** (attempt - 1)));
    }
  }

  const timedOut = (lastError ?? '').includes('budget');
  await s
    .update('agent_runs')
    .set({
      status: timedOut ? 'TIMED_OUT' : 'FAILED',
      error: lastError,
      attempts: agent.maxAttempts,
      model,
      input_tokens: usage.input,
      out_tokens: usage.output,
      finished_at: new Date(),
    })
    .where('id' as never, '=', runId as never)
    .execute();

  return {
    runId, status: timedOut ? 'TIMED_OUT' : 'FAILED', output: null,
    error: lastError, usage, model, steps: ordinal,
  };
}

/** Record the orchestrator's plan on its run, so the UI can show it. */
export async function savePlan(ctx: Ctx, runId: string, plan: unknown) {
  await scoped(ctx)
    .update('agent_runs')
    .set({ plan: JSON.stringify(plan) })
    .where('id' as never, '=', runId as never)
    .execute();
}

export async function cancelRun(ctx: Ctx, runId: string) {
  await scoped(ctx)
    .update('agent_runs')
    .set({ status: 'CANCELLED', finished_at: new Date() })
    .where('id' as never, '=', runId as never)
    .where('status' as never, 'in' as never, ['PENDING', 'RUNNING'] as never)
    .execute();
}

export async function runTree(ctx: Ctx, analysisId: string) {
  const s = scoped(ctx);
  const runs = await s
    .from('agent_runs')
    .select(['id', 'agent_key', 'status', 'parent_run_id', 'plan', 'error', 'model',
      'input_tokens', 'out_tokens', 'started_at', 'finished_at', 'created_at'])
    .where('analysis_id' as never, '=', analysisId as never)
    .orderBy('created_at')
    .execute();
  const ids = (runs as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return { runs: [], steps: [] };
  const steps = await getDb()
    .selectFrom('agent_steps')
    .select(['id', 'run_id', 'ordinal', 'label', 'status', 'tool_key', 'message', 'duration_ms', 'created_at'])
    .where('org_id', '=', ctx.orgId)
    .where('run_id', 'in', ids)
    .orderBy('run_id')
    .orderBy('ordinal')
    .execute();
  return { runs, steps };
}

// ───────────────────────────────── helpers ─────────────────────────────────

function buildTask(input: Record<string, unknown>): string {
  return [
    'TASK CONTEXT (platform data, trusted):',
    '```json',
    JSON.stringify(input, null, 2).slice(0, 60_000),
    '```',
    '',
    'Gather what you need with your tools, then submit your result.',
  ].join('\n');
}

function formatZodError(err: z.ZodError): string {
  return err.issues
    .slice(0, 25)
    .map((i) => `• ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
}

/** Keep tool output and step records a sane size in the database and the prompt. */
function truncate(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[deep]';
  if (typeof value === 'string') return value.length > 20_000 ? `${value.slice(0, 20_000)}…[truncated]` : value;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => truncate(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = truncate(v, depth + 1);
    return out;
  }
  return value;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
