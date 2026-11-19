/**
 * Compatibility scoring — deterministic, explainable, and computed here rather
 * than by a language model.
 *
 * Two properties this module exists to guarantee:
 *
 *   • A score never hides a mandatory eligibility failure. Blocking compliance
 *     items are counted separately and cap the verdict regardless of how high
 *     the weighted score is. A 94 with an expired mandatory certificate is not
 *     a strong opportunity, and the engine will not call it one.
 *
 *   • Every number is reconstructable. computeScore returns the methodology it
 *     used — weights as given, weights as normalized, each dimension's raw and
 *     weighted contribution — and that record is persisted with the analysis.
 *
 * Covered by tests/scoring.test.ts.
 */
import type { Verdict } from './db/types';

export const DIMENSIONS = [
  'technicalFit', 'experience', 'complianceReadiness', 'resources', 'financialReadiness', 'geographic',
] as const;

export type DimensionKey = (typeof DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<DimensionKey, { ar: string; en: string }> = {
  technicalFit: { ar: 'الملاءمة الفنية', en: 'Technical fit' },
  experience: { ar: 'الخبرة السابقة', en: 'Relevant experience' },
  complianceReadiness: { ar: 'جاهزية الالتزام', en: 'Compliance readiness' },
  resources: { ar: 'الموارد', en: 'Resources' },
  financialReadiness: { ar: 'الجاهزية المالية', en: 'Financial readiness' },
  geographic: { ar: 'النطاق الجغرافي', en: 'Geographic coverage' },
};

export type Weights = Record<DimensionKey, number>;

export const DEFAULT_WEIGHTS: Weights = {
  technicalFit: 25,
  experience: 20,
  complianceReadiness: 20,
  resources: 15,
  financialReadiness: 10,
  geographic: 10,
};

/** Database column names for the weights table, in dimension order. */
export const WEIGHT_COLUMNS: Record<DimensionKey, string> = {
  technicalFit: 'technical_fit',
  experience: 'experience',
  complianceReadiness: 'compliance_readiness',
  resources: 'resources',
  financialReadiness: 'financial_readiness',
  geographic: 'geographic',
};

export interface DimensionInput {
  key: DimensionKey;
  /** 0–100. An absent fact scores low; it is not neutral. */
  raw: number;
  rationale?: string;
}

export interface DimensionResult extends DimensionInput {
  label: { ar: string; en: string };
  weight: number;
  normalizedWeight: number;
  contribution: number;
}

export interface Methodology {
  formula: string;
  weightsGiven: Weights;
  weightsNormalized: Record<DimensionKey, number>;
  dimensions: { key: DimensionKey; raw: number; weight: number; contribution: number }[];
  computedAt: string;
  engineVersion: string;
}

export interface ScoreResult {
  score: number;
  dimensions: DimensionResult[];
  methodology: Methodology;
}

const ENGINE_VERSION = '1.0.0';

export class ScoringError extends Error {}

/**
 * Normalize weights to sum to 100 while preserving their ratios. A workspace
 * may set any positive numbers; the engine does not require them to add up.
 */
export function normalizeWeights(weights: Weights): Record<DimensionKey, number> {
  const entries = DIMENSIONS.map((k) => [k, Number(weights[k])] as const);
  for (const [k, v] of entries) {
    if (!Number.isFinite(v) || v < 0) throw new ScoringError(`Weight for ${k} must be a non-negative number.`);
  }
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (total <= 0) throw new ScoringError('At least one dimension must carry a non-zero weight.');
  return Object.fromEntries(entries.map(([k, v]) => [k, (v / total) * 100])) as Record<DimensionKey, number>;
}

export function computeScore(inputs: DimensionInput[], weights: Weights = DEFAULT_WEIGHTS): ScoreResult {
  const seen = new Set(inputs.map((d) => d.key));
  const missing = DIMENSIONS.filter((d) => !seen.has(d));
  if (missing.length) {
    // A partial assessment must not be presented as a complete score.
    throw new ScoringError(`Cannot score: no assessment for ${missing.join(', ')}.`);
  }
  if (inputs.length !== DIMENSIONS.length) {
    throw new ScoringError('Duplicate dimension assessments.');
  }

  const normalized = normalizeWeights(weights);
  const dimensions: DimensionResult[] = DIMENSIONS.map((key) => {
    const input = inputs.find((d) => d.key === key)!;
    const raw = clampRaw(input.raw, key);
    const normalizedWeight = normalized[key];
    return {
      ...input,
      raw,
      label: DIMENSION_LABELS[key],
      weight: weights[key],
      normalizedWeight,
      contribution: (raw * normalizedWeight) / 100,
    };
  });

  const score = Math.round(dimensions.reduce((a, d) => a + d.contribution, 0));

  return {
    score: Math.max(0, Math.min(100, score)),
    dimensions,
    methodology: {
      formula: 'score = Σ(dimension_raw × normalized_weight) / 100, rounded to the nearest integer',
      weightsGiven: { ...weights },
      weightsNormalized: normalized,
      dimensions: dimensions.map((d) => ({
        key: d.key, raw: d.raw, weight: Number(d.normalizedWeight.toFixed(4)),
        contribution: Number(d.contribution.toFixed(4)),
      })),
      computedAt: new Date().toISOString(),
      engineVersion: ENGINE_VERSION,
    },
  };
}

function clampRaw(raw: number, key: DimensionKey): number {
  if (!Number.isFinite(raw)) throw new ScoringError(`Dimension ${key} has a non-numeric score.`);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// ───────────────────────────────── verdict ─────────────────────────────────

export interface VerdictInput {
  score: number;
  /** Unmet mandatory requirements. Any of these caps the verdict. */
  blockingGaps: number;
  /** 0–1 from the agents; low confidence downgrades, never upgrades. */
  confidence: number;
  /** Compliance items the agents could not determine either way. */
  unknownMandatory?: number;
  /** Set by the QA agent. Forces a review verdict. */
  qaRequiresReview?: boolean;
}

export interface VerdictResult {
  verdict: Verdict;
  /** Plain-language reasons, in the order they were applied. */
  reasons: { ar: string; en: string }[];
  /** True when a rule overrode what the raw score alone would have produced. */
  capped: boolean;
}

const BANDS: { min: number; verdict: Verdict }[] = [
  { min: 80, verdict: 'STRONG_OPPORTUNITY' },
  { min: 60, verdict: 'POTENTIAL_OPPORTUNITY' },
  { min: 40, verdict: 'REQUIRES_FURTHER_REVIEW' },
  { min: 0, verdict: 'NOT_RECOMMENDED' },
];

const ORDER: Verdict[] = [
  'NOT_RECOMMENDED', 'REQUIRES_FURTHER_REVIEW', 'POTENTIAL_OPPORTUNITY', 'STRONG_OPPORTUNITY',
];

const downgrade = (v: Verdict, steps = 1): Verdict => {
  const i = ORDER.indexOf(v);
  return ORDER[Math.max(0, i - steps)]!;
};

const cap = (v: Verdict, ceiling: Verdict): Verdict =>
  ORDER.indexOf(v) > ORDER.indexOf(ceiling) ? ceiling : v;

/**
 * Derive the verdict from the score and the things a score cannot express.
 * The order of the rules is deliberate: eligibility first, then certainty.
 */
export function deriveVerdict(input: VerdictInput): VerdictResult {
  const reasons: VerdictResult['reasons'] = [];
  const fromScore = BANDS.find((b) => input.score >= b.min)!.verdict;
  let verdict = fromScore;

  // 1. A blocking gap is an eligibility failure. It caps the verdict outright:
  //    a high score does not make a disqualified bid a good opportunity.
  if (input.blockingGaps > 0) {
    const ceiling: Verdict = input.score >= 55 ? 'REQUIRES_FURTHER_REVIEW' : 'NOT_RECOMMENDED';
    verdict = cap(verdict, ceiling);
    reasons.push({
      ar: `يوجد ${input.blockingGaps} متطلب إلزامي غير مستوفى — قد يؤدي إلى الاستبعاد، ولا تُخفيه الدرجة.`,
      en: `${input.blockingGaps} unmet mandatory requirement(s) — a potential disqualifier, which the score does not offset.`,
    });
  }

  // 2. Undetermined mandatory items mean the eligibility question is open.
  if ((input.unknownMandatory ?? 0) > 0) {
    verdict = cap(verdict, 'REQUIRES_FURTHER_REVIEW');
    reasons.push({
      ar: `${input.unknownMandatory} متطلب إلزامي لم يُحدَّد موقف المنشأة منه بعد.`,
      en: `${input.unknownMandatory} mandatory requirement(s) could not be determined from available records.`,
    });
  }

  // 3. Low confidence downgrades: the analysis rests on inference.
  if (input.confidence < 0.45) {
    const before = verdict;
    verdict = downgrade(verdict);
    if (before !== verdict) {
      reasons.push({
        ar: 'ثقة التحليل منخفضة لاعتماده على استنتاجات لا على أدلة موثّقة.',
        en: 'Low analysis confidence: the assessment rests on inference rather than documented evidence.',
      });
    }
  } else if (input.confidence < 0.65) {
    verdict = cap(verdict, 'POTENTIAL_OPPORTUNITY');
  }

  // 4. The quality-assurance agent can always force a human review.
  if (input.qaRequiresReview) {
    verdict = cap(verdict, 'REQUIRES_FURTHER_REVIEW');
    reasons.push({
      ar: 'وكيل ضبط الجودة طلب مراجعة بشرية قبل اعتماد النتيجة.',
      en: 'Quality assurance flagged this analysis for human review before it is relied on.',
    });
  }

  if (reasons.length === 0) {
    reasons.push({
      ar: `الدرجة الموزونة ${input.score} من 100 دون متطلبات إلزامية ناقصة.`,
      en: `Weighted score ${input.score}/100 with no unmet mandatory requirements.`,
    });
  }

  return { verdict, reasons, capped: verdict !== fromScore };
}

export const VERDICT_LABELS: Record<Verdict, { ar: string; en: string }> = {
  STRONG_OPPORTUNITY: { ar: 'فرصة قوية', en: 'Strong opportunity' },
  POTENTIAL_OPPORTUNITY: { ar: 'فرصة واعدة', en: 'Potential opportunity' },
  REQUIRES_FURTHER_REVIEW: { ar: 'تحتاج مراجعة إضافية', en: 'Requires further review' },
  NOT_RECOMMENDED: { ar: 'غير موصى بها', en: 'Not recommended' },
};

/**
 * Company readiness, independent of any single tender: how much of the
 * company's own record is in place. Used by the readiness report and the
 * dashboard, and deliberately not a prediction of anything.
 */
export interface ReadinessInput {
  hasConfirmedProfile: boolean;
  capabilities: number;
  certifications: number;
  validCertifications: number;
  pastProjects: number;
  documents: number;
  extractedDocuments: number;
  expiringSoon: number;
}

export function companyReadiness(i: ReadinessInput): { score: number; findings: { ar: string; en: string }[] } {
  const findings: { ar: string; en: string }[] = [];
  let score = 0;

  score += i.hasConfirmedProfile ? 25 : 0;
  if (!i.hasConfirmedProfile) {
    findings.push({ ar: 'ملف المنشأة لم يُعتمد بشرياً بعد.', en: 'The company profile has not been confirmed by a person yet.' });
  }

  score += Math.min(15, i.capabilities * 3);
  score += Math.min(20, i.validCertifications * 5);
  if (i.certifications > i.validCertifications) {
    findings.push({
      ar: `${i.certifications - i.validCertifications} شهادة منتهية أو بلا تاريخ انتهاء.`,
      en: `${i.certifications - i.validCertifications} certification(s) expired or without an expiry date.`,
    });
  }
  score += Math.min(20, i.pastProjects * 5);
  if (i.pastProjects === 0) {
    findings.push({ ar: 'لا توجد مشاريع مرجعية موثّقة.', en: 'No documented reference projects.' });
  }
  score += Math.min(20, i.extractedDocuments * 4);
  if (i.documents === 0) {
    findings.push({
      ar: 'لا توجد وثائق مرفوعة للمنشأة — لا يمكن إثبات أي متطلب إلزامي دونها.',
      en: 'No company documents on file — no mandatory requirement can be evidenced without them.',
    });
  }
  if (i.documents > i.extractedDocuments) {
    findings.push({
      ar: `${i.documents - i.extractedDocuments} وثيقة لم يُستخرج نصّها ولا يمكن الاستناد إليها كدليل.`,
      en: `${i.documents - i.extractedDocuments} document(s) have no extracted text and cannot be cited as evidence.`,
    });
  }
  if (i.expiringSoon > 0) {
    findings.push({
      ar: `${i.expiringSoon} وثيقة تنتهي خلال 60 يوماً.`,
      en: `${i.expiringSoon} document(s) expire within 60 days.`,
    });
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), findings };
}
