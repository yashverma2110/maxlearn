/**
 * When interest cards are made without being asked: the chat touched the
 * interest, or its period ran out. Pure: the hooks module owns the timers.
 */

/** When each interest last got cards, by any route: `{ redis: 1730000000000 }`. */
export type AutoAt = Record<string, number>

/** How long ago `topic` last got cards; never is forever. */
const since = (autoAt: AutoAt, topic: string, now: number) =>
  autoAt[topic] === undefined ? Infinity : now - autoAt[topic]

/** A chat that keeps touching an interest makes cards for it at most this often. */
export const CHAT_COOLDOWN_MS = 4 * 60 * 60 * 1000

/** How often the period is checked while a session runs. */
export const AUTO_CHECK_MS = 15 * 60 * 1000

/** Saved interests the chat touched that may get cards now, in the chat's order. */
export function chatMatches(topics: string[], interests: string[], autoAt: AutoAt, now: number): string[] {
  const saved = new Set(interests)
  return topics.filter(t => saved.has(t) && since(autoAt, t, now) >= CHAT_COOLDOWN_MS)
}

/**
 * The one interest whose period ran out longest ago, or none. One per check,
 * so many interests spread their model calls out instead of firing at once.
 */
export function periodDue(interests: string[], autoAt: AutoAt, now: number, periodMs: number): string | undefined {
  if (periodMs <= 0) return undefined
  return interests
    .filter(t => since(autoAt, t, now) >= periodMs)
    // Two topics that never had cards compare as Infinity - Infinity: NaN, read as a tie.
    .sort((a, b) => since(autoAt, b, now) - since(autoAt, a, now) || 0)[0]
}

/**
 * Stamps interests the record has never seen with `now`, so turning the
 * feature on (or a reload of an older store) starts their period instead of
 * firing them all at once.
 */
export function seedAutoAt(interests: string[], autoAt: AutoAt, now: number): AutoAt {
  const missing = interests.filter(t => autoAt[t] === undefined)
  return missing.length === 0 ? autoAt : { ...autoAt, ...Object.fromEntries(missing.map(t => [t, now])) }
}
