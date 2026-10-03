/**
 * FSRS-4.5 (Free Spaced Repetition Scheduler), with its published default
 * weights. A card's memory is two numbers: stability S (days until recall
 * falls to 90%) and difficulty D (1..10). Each review updates both from the
 * grade and from how likely recall was at that moment; the next interval is
 * the wait until recall is predicted to fall to the desired retention.
 * Pure: no `$` here.
 */

import type { Grade } from '../types'

/** FSRS-4.5 default parameters (w0..w16). */
export const W = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246,
  1.587, 0.2272, 2.8755,
] as const

const DECAY = -0.5
/** Chosen so that recall is 90% after S days: 0.9^(1/DECAY) - 1. */
const FACTOR = 19 / 81

const G: Record<Grade, 1 | 2 | 3 | 4> = { again: 1, hard: 2, good: 3, easy: 4 }
const w = (n: number) => W[n]!
const clampD = (d: number) => Math.min(10, Math.max(1, d))

export type Memory = { stability: number; difficulty: number }

/** Predicted chance of recall `days` after the last review. */
export function retrievability(days: number, stability: number): number {
  return Math.pow(1 + (FACTOR * Math.max(0, days)) / stability, DECAY)
}

/** Days until recall falls to `retention`. */
export function intervalFor(stability: number, retention: number): number {
  return (stability / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1)
}

/** The memory after a card's first grade. */
export function initialMemory(grade: Grade): Memory {
  return { stability: w(G[grade] - 1), difficulty: clampD(w(4) - (G[grade] - 3) * w(5)) }
}

/** The memory after a review `days` after the last one. */
export function nextMemory(m: Memory, grade: Grade, days: number): Memory {
  const g = G[grade]
  const r = retrievability(days, m.stability)
  // Difficulty moves with the grade, then reverts a little toward a good first grade's.
  const d0 = w(4)
  const moved = m.difficulty - w(6) * (g - 3)
  const difficulty = clampD(w(7) * d0 + (1 - w(7)) * moved)

  if (g === 1) {
    const stability =
      w(11) * Math.pow(difficulty, -w(12)) * (Math.pow(m.stability + 1, w(13)) - 1) * Math.exp(w(14) * (1 - r))
    return { stability: Math.min(stability, m.stability), difficulty }
  }
  const hard = g === 2 ? w(15) : 1
  const easy = g === 4 ? w(16) : 1
  const growth =
    Math.exp(w(8)) * (11 - difficulty) * Math.pow(m.stability, -w(9)) * (Math.exp(w(10) * (1 - r)) - 1) * hard * easy
  return { stability: m.stability * (growth + 1), difficulty }
}
