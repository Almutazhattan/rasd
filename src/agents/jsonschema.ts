/**
 * A minimal zod → JSON Schema converter.
 *
 * Agent output contracts are declared once, in zod, and the schema sent to the
 * model is derived from the same declaration. Writing both by hand is how the
 * two drift apart and how "schema-validated output" quietly stops being true.
 *
 * Supports the subset the agents use: object, string, number, integer, boolean,
 * array, enum, literal, optional, nullable, default, union of literals.
 */
import { z } from 'zod';

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: (string | number | boolean | null)[];
  additionalProperties?: boolean;
  minimum?: number;
  maximum?: number;
  anyOf?: JsonSchema[];
}

function unwrapDescription(def: z.ZodTypeAny): string | undefined {
  return def.description;
}

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const described = unwrapDescription(schema);
  const out = convert(schema);
  if (described && !out.description) out.description = described;
  return out;
}

function convert(schema: z.ZodTypeAny): JsonSchema {
  // Unwrap wrappers that do not change the JSON shape.
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return convert((schema._def as { innerType: z.ZodTypeAny }).innerType);
  }
  if (schema instanceof z.ZodNullable) {
    const inner = convert((schema._def as { innerType: z.ZodTypeAny }).innerType);
    const t = inner.type;
    return { ...inner, type: Array.isArray(t) ? [...t, 'null'] : t ? [t, 'null'] : undefined };
  }
  if (schema instanceof z.ZodEffects) {
    return convert((schema._def as { schema: z.ZodTypeAny }).schema);
  }

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      const optional = value instanceof z.ZodOptional || value instanceof z.ZodDefault;
      if (!optional) required.push(key);
    }
    return { type: 'object', properties, required, additionalProperties: false };
  }

  if (schema instanceof z.ZodArray) {
    return { type: 'array', items: zodToJsonSchema((schema._def as { type: z.ZodTypeAny }).type) };
  }

  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: [...(schema._def as { values: string[] }).values] };
  }

  if (schema instanceof z.ZodLiteral) {
    const v = (schema._def as { value: string | number | boolean }).value;
    return { type: typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string', enum: [v] };
  }

  if (schema instanceof z.ZodUnion) {
    const opts = (schema._def as { options: z.ZodTypeAny[] }).options;
    // A union of literals is an enum; anything else becomes anyOf.
    if (opts.every((o) => o instanceof z.ZodLiteral)) {
      return {
        type: 'string',
        enum: opts.map((o) => (o._def as { value: string | number | boolean }).value),
      };
    }
    return { anyOf: opts.map(zodToJsonSchema) };
  }

  if (schema instanceof z.ZodNumber) {
    const checks = (schema._def as { checks: { kind: string; value?: number }[] }).checks ?? [];
    const isInt = checks.some((c) => c.kind === 'int');
    const min = checks.find((c) => c.kind === 'min')?.value;
    const max = checks.find((c) => c.kind === 'max')?.value;
    return { type: isInt ? 'integer' : 'number', ...(min !== undefined && { minimum: min }), ...(max !== undefined && { maximum: max }) };
  }

  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  if (schema instanceof z.ZodString) return { type: 'string' };
  if (schema instanceof z.ZodRecord) return { type: 'object' };

  // Anything unsupported is rejected loudly: a silently permissive schema
  // would let unvalidated model output through.
  throw new Error(`zodToJsonSchema: unsupported zod type ${schema.constructor.name}`);
}
