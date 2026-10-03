/**
 * What makes a good card, as the model reads it and as the local filter
 * enforces it. Pure: no `$` here.
 */

export type Level = 'mid' | 'senior' | 'staff'

export const LEVEL_BRIEF: Record<Level, string> = {
  mid: 'a mid-level engineer: solid on fundamentals, learning how things work under the hood',
  senior:
    'a senior engineer: knows the basics well; wants internals, trade-offs, failure modes and production gotchas',
  staff:
    'a staff engineer: wants system-level trade-offs, scaling limits, design decisions and their second-order effects',
}

/** What the topic's record says about how hard its next cards should be. */
export type LevelSignal = {
  cards: number
  mastery: number
  /** Recall, recent where known, 0..1, or null before any review. */
  recall: number | null
  /** Reviews behind `recall`. */
  reviews: number
}

/**
 * Starts senior; steps down to mid when recall is poor on enough reviews,
 * up to staff once the topic is mastered and recalled well.
 */
export function levelFor(s: LevelSignal | undefined): Level {
  if (s === undefined || s.recall === null || s.reviews < 5) return 'senior'
  if (s.recall < 0.6) return 'mid'
  if (s.mastery >= 0.7 && s.recall >= 0.85) return 'staff'
  return 'senior'
}

export const CARD_RUBRIC = `What makes a good card (follow all):
- One idea per card. The answer fits in 1-3 sentences. No lists of more than 3 items.
- Be specific: name the mechanism, command, setting, data structure, number or failure mode.
- Ask about why, how or what-happens-when. Do not ask for definitions or "when should you use X".
- The back gives the answer first, then the reason (the mechanism), then one concrete detail or example.
- The answer must be checkable: a reader can say if their recall was right or wrong.
- Quiz choices: one correct, three plausible distractors of similar length; no "all of the above".

Bad: "When should you use Redis instead of a relational database?" (generic, no mechanism, any answer is half right)
Good: "Why can Redis lose up to one second of writes with appendfsync everysec?"
  → "Redis calls fsync on the AOF once per second in a background thread. A crash before the next fsync loses the writes still in the OS buffer."
Bad: "What is a B-tree index?"
Good: "Why does a Postgres index on (a, b) not help a query that filters only on b?"`

const WEAK_STEMS = [
  /^what (is|are) (a |an |the )?[\w\s-]{1,30}\?$/i,
  /^when should (you|i|we) use\b/i,
  /^what are the (benefits|advantages|disadvantages|pros|cons)\b/i,
  /^(define|explain|describe) [\w\s-]{1,30}\.?\??$/i,
  /^why (is|should) [\w\s-]{1,20} (good|useful|important|popular)\b/i,
]

/** A question too generic to test real recall. */
export function isWeakFront(front: string): boolean {
  const q = front.trim()
  return q.length < 20 || WEAK_STEMS.some(stem => stem.test(q))
}
