/**
 * WCRS Confidence Scorer (Module 2 — UI State Mapper)
 * Calculates confidence scores for state graph edges based on how many
 * independent recordings confirm the transition.
 *
 * Bible spec:
 *   "Confidence scores reflect number of corroborating recordings."
 *   "Multi-trace merge with confidence scoring."
 */

import type { TraceTransition } from '../types/index.js';

// ── Confidence Calculation ─────────────────────────────────────────────────

/**
 * Calculate edge confidence from recordings_seen / total_traces.
 *
 * Formula uses a smoothed ratio that:
 * - Gives 1.0 when seen in all traces
 * - Gives a meaningful score even when seen in only 1 trace
 * - Penalizes transitions seen in very few recordings
 *
 * @param recordingsSeen - Number of traces that include this transition
 * @param totalTraces - Total number of traces in the corpus
 * @returns Confidence score 0.0 – 1.0
 */
export function calculateConfidence(recordingsSeen: number, totalTraces: number): number {
  if (totalTraces <= 0) return 0;
  if (recordingsSeen <= 0) return 0;

  // Simple ratio with Laplace smoothing (+1/+2) to avoid 0/1 extremes
  const smoothed = (recordingsSeen + 0.5) / (totalTraces + 1);

  // Bonus for high confirmation rates
  const bonus = recordingsSeen >= totalTraces ? 0.05 : 0;

  return Math.min(1.0, smoothed + bonus);
}

/**
 * Get a human-readable confidence label.
 *
 * @param confidence - Score 0.0 – 1.0
 * @returns Label string
 */
export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.90) return 'VERY_HIGH';
  if (confidence >= 0.70) return 'HIGH';
  if (confidence >= 0.50) return 'MEDIUM';
  if (confidence >= 0.30) return 'LOW';
  return 'VERY_LOW';
}

/**
 * Score a complete set of transitions.
 * Updates confidence in-place and returns a summary.
 *
 * @param transitions - All transitions in the graph
 * @param totalTraces - Total recording count
 * @returns Summary statistics
 */
export function scoreAllTransitions(
  transitions: TraceTransition[],
  totalTraces: number
): ConfidenceSummary {
  let sum = 0;
  let min = 1;
  let max = 0;

  for (const t of transitions) {
    t.confidence = calculateConfidence(t.recordings_seen, totalTraces);
    sum += t.confidence;
    if (t.confidence < min) min = t.confidence;
    if (t.confidence > max) max = t.confidence;
  }

  const avg = transitions.length > 0 ? sum / transitions.length : 0;

  return {
    total_transitions: transitions.length,
    average_confidence: Math.round(avg * 1000) / 1000,
    min_confidence: Math.round(min * 1000) / 1000,
    max_confidence: Math.round(max * 1000) / 1000,
    distribution: buildDistribution(transitions)
  };
}

export interface ConfidenceSummary {
  total_transitions: number;
  average_confidence: number;
  min_confidence: number;
  max_confidence: number;
  distribution: Record<string, number>;
}

function buildDistribution(transitions: TraceTransition[]): Record<string, number> {
  const dist: Record<string, number> = {
    VERY_HIGH: 0, HIGH: 0, MEDIUM: 0, LOW: 0, VERY_LOW: 0
  };
  for (const t of transitions) {
    dist[confidenceLabel(t.confidence)]++;
  }
  return dist;
}
