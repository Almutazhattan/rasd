/**
 * The agent output contracts are sent to the model as JSON Schema derived from
 * the same zod declaration that validates the reply. These tests cover that
 * derivation, because a wrong schema means the model is asked for one shape
 * and judged against another.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from '@/agents/jsonschema';
import { AGENT_LIST } from '@/agents/registry';
import { compatibilityOutput, complianceOutput } from '@/agents/contracts';

describe('zodToJsonSchema', () => {
  it('marks optional and defaulted fields as not required', () => {
    const s = zodToJsonSchema(
      z.object({ a: z.string(), b: z.string().optional(), c: z.number().default(3) }),
    );
    expect(s.required).toEqual(['a']);
    expect(s.properties?.c?.type).toBe('number');
  });

  it('allows null on nullable fields', () => {
    const s = zodToJsonSchema(z.object({ page: z.number().int().nullable() }));
    expect(s.properties?.page?.type).toEqual(['integer', 'null']);
  });

  it('carries enums, integer bounds and descriptions through', () => {
    const s = zodToJsonSchema(
      z.object({
        kind: z.enum(['a', 'b']),
        n: z.number().int().min(1).max(5).describe('one to five'),
      }),
    );
    expect(s.properties?.kind?.enum).toEqual(['a', 'b']);
    expect(s.properties?.n).toMatchObject({ type: 'integer', minimum: 1, maximum: 5, description: 'one to five' });
  });

  it('closes objects so unexpected keys cannot slip in', () => {
    expect(zodToJsonSchema(z.object({ a: z.string() })).additionalProperties).toBe(false);
  });

  it('refuses types it cannot represent instead of emitting a permissive schema', () => {
    expect(() => zodToJsonSchema(z.map(z.string(), z.string()))).toThrow(/unsupported/i);
  });

  it('converts every agent contract', () => {
    for (const agent of AGENT_LIST) {
      const schema = zodToJsonSchema(agent.outputSchema);
      expect(schema.type, agent.key).toBe('object');
      expect(Object.keys(schema.properties ?? {}).length, agent.key).toBeGreaterThan(0);
    }
  });

  it('requires all six dimensions in the compatibility contract', () => {
    const bad = compatibilityOutput.safeParse({
      dimensions: [], strengths: [], gaps: [], missingInformation: [], confidence: 0.5,
    });
    expect(bad.success).toBe(false);
  });

  it('rejects a compliance item with an invented status', () => {
    const bad = complianceOutput.safeParse({
      items: [{
        requirementText: 'ISO 27001 certificate', label: 'ISO 27001', category: 'administrative',
        mandatory: true, status: 'PROBABLY_FINE', blocking: true, note: null,
        matchedDocument: null, provenance: 'AI_INFERRED',
      }],
      missingDocuments: [], expiringDocuments: [], confidence: 0.6,
    });
    expect(bad.success).toBe(false);
  });
});
