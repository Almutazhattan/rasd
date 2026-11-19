/**
 * The scoring engine's two promises: the arithmetic is reconstructable, and a
 * blocking eligibility failure is never hidden by a high score.
 */
import { describe, expect, it } from 'vitest';
import {
  companyReadiness, computeScore, DEFAULT_WEIGHTS, deriveVerdict, DIMENSIONS,
  normalizeWeights, ScoringError, type DimensionInput, type Weights,
} from '@/lib/scoring';

const flat = (raw: number): DimensionInput[] => DIMENSIONS.map((key) => ({ key, raw }));

describe('computeScore', () => {
  it('is the weighted mean of the dimensions', () => {
    expect(computeScore(flat(100)).score).toBe(100);
    expect(computeScore(flat(0)).score).toBe(0);
    expect(computeScore(flat(70)).score).toBe(70);
  });

  it('weights each dimension as configured', () => {
    // All weight on technical fit: the score is that dimension alone.
    const w: Weights = {
      technicalFit: 100, experience: 0, complianceReadiness: 0,
      resources: 0, financialReadiness: 0, geographic: 0,
    };
    const dims = DIMENSIONS.map((key) => ({ key, raw: key === 'technicalFit' ? 90 : 10 }));
    expect(computeScore(dims, w).score).toBe(90);
  });

  it('normalizes weights that do not add up to 100', () => {
    const w: Weights = {
      technicalFit: 2, experience: 2, complianceReadiness: 2,
      resources: 2, financialReadiness: 2, geographic: 2,
    };
    const n = normalizeWeights(w);
    expect(Object.values(n).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    expect(computeScore(flat(50), w).score).toBe(50);
  });

  it('records a methodology that reproduces the score', () => {
    const res = computeScore(DIMENSIONS.map((key, i) => ({ key, raw: 40 + i * 10 })));
    const rebuilt = res.methodology.dimensions.reduce((a, d) => a + d.contribution, 0);
    expect(Math.round(rebuilt)).toBe(res.score);
    expect(res.methodology.engineVersion).toBeTruthy();
    expect(Object.keys(res.methodology.weightsNormalized)).toHaveLength(6);
  });

  it('refuses to score a partial assessment instead of filling the gap', () => {
    const partial = flat(80).slice(0, 4);
    expect(() => computeScore(partial)).toThrow(ScoringError);
    expect(() => computeScore(partial)).toThrow(/financialReadiness/);
  });

  it('rejects impossible weights rather than silently defaulting', () => {
    const zero = Object.fromEntries(DIMENSIONS.map((k) => [k, 0])) as Weights;
    expect(() => computeScore(flat(50), zero)).toThrow(ScoringError);
    expect(() => normalizeWeights({ ...DEFAULT_WEIGHTS, experience: -5 })).toThrow(ScoringError);
  });

  it('clamps out-of-range dimension scores', () => {
    expect(computeScore(flat(160)).score).toBe(100);
    expect(computeScore(flat(-20)).score).toBe(0);
  });
});

describe('deriveVerdict', () => {
  const confident = { confidence: 0.9 };

  it('bands a clean analysis by score', () => {
    expect(deriveVerdict({ score: 88, blockingGaps: 0, ...confident }).verdict).toBe('STRONG_OPPORTUNITY');
    expect(deriveVerdict({ score: 68, blockingGaps: 0, ...confident }).verdict).toBe('POTENTIAL_OPPORTUNITY');
    expect(deriveVerdict({ score: 47, blockingGaps: 0, ...confident }).verdict).toBe('REQUIRES_FURTHER_REVIEW');
    expect(deriveVerdict({ score: 12, blockingGaps: 0, ...confident }).verdict).toBe('NOT_RECOMMENDED');
  });

  it('never calls an opportunity strong while a mandatory requirement is unmet', () => {
    const r = deriveVerdict({ score: 94, blockingGaps: 1, ...confident });
    expect(r.verdict).toBe('REQUIRES_FURTHER_REVIEW');
    expect(r.capped).toBe(true);
    expect(r.reasons[0]!.en).toMatch(/mandatory/i);
  });

  it('drops to not-recommended when a blocking gap meets a weak score', () => {
    expect(deriveVerdict({ score: 50, blockingGaps: 2, ...confident }).verdict).toBe('NOT_RECOMMENDED');
  });

  it('treats undetermined mandatory items as an open question', () => {
    const r = deriveVerdict({ score: 91, blockingGaps: 0, unknownMandatory: 3, ...confident });
    expect(r.verdict).toBe('REQUIRES_FURTHER_REVIEW');
    expect(r.reasons.some((x) => /could not be determined/i.test(x.en))).toBe(true);
  });

  it('downgrades on low confidence and never upgrades on high', () => {
    expect(deriveVerdict({ score: 88, blockingGaps: 0, confidence: 0.2 }).verdict).toBe('POTENTIAL_OPPORTUNITY');
    expect(deriveVerdict({ score: 88, blockingGaps: 0, confidence: 0.55 }).verdict).toBe('POTENTIAL_OPPORTUNITY');
    expect(deriveVerdict({ score: 30, blockingGaps: 0, confidence: 1 }).verdict).toBe('NOT_RECOMMENDED');
  });

  it('honours a quality-assurance review flag at any score', () => {
    const r = deriveVerdict({ score: 97, blockingGaps: 0, confidence: 0.95, qaRequiresReview: true });
    expect(r.verdict).toBe('REQUIRES_FURTHER_REVIEW');
    expect(r.capped).toBe(true);
  });

  it('always explains itself', () => {
    for (const score of [0, 41, 61, 81, 100]) {
      const r = deriveVerdict({ score, blockingGaps: 0, confidence: 0.8 });
      expect(r.reasons.length).toBeGreaterThan(0);
      expect(r.reasons[0]!.ar.length).toBeGreaterThan(5);
    }
  });
});

describe('companyReadiness', () => {
  it('reports an empty company as unready, with findings', () => {
    const r = companyReadiness({
      hasConfirmedProfile: false, capabilities: 0, certifications: 0, validCertifications: 0,
      pastProjects: 0, documents: 0, extractedDocuments: 0, expiringSoon: 0,
    });
    expect(r.score).toBe(0);
    expect(r.findings.length).toBeGreaterThanOrEqual(3);
  });

  it('names expired certificates and unextracted documents', () => {
    const r = companyReadiness({
      hasConfirmedProfile: true, capabilities: 5, certifications: 4, validCertifications: 2,
      pastProjects: 3, documents: 6, extractedDocuments: 4, expiringSoon: 1,
    });
    expect(r.score).toBeGreaterThan(50);
    expect(r.findings.some((f) => /expired/i.test(f.en))).toBe(true);
    expect(r.findings.some((f) => /extracted text/i.test(f.en))).toBe(true);
    expect(r.findings.some((f) => /60 days/i.test(f.en))).toBe(true);
  });
});
