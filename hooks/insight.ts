import type { Card } from '../types'

/** Longest takeaway on its own, in characters. */
export const INSIGHT_CHARS = 90
/** The whole status line's budget: short enough to sit beside the engine's own notices. */
export const STATUS_CHARS = 72
/** Below this much room a takeaway says too little; leave it out. */
const MIN_TAKEAWAY = 18

/**
 * Cards whose answer may be shown passively: reviewed at least once and not
 * due, so seeing the answer reinforces it without spoiling a recall test.
 */
export function insightCards(deck: Card[], now: number): Card[] {
  return deck.filter(c => c.reps > 0 && c.due > now)
}

/**
 * The answer's first sentence within `max` characters: whole when it fits,
 * else up to a clause break (, ; : —) that keeps most of the room, else cut on a word.
 */
export function takeaway(back: string, max = INSIGHT_CHARS): string {
  const first = (back.match(/^.*?[.!?](\s|$)/)?.[0] ?? back).trim()
  if (first.length <= max) return first
  const room = first.slice(0, max - 1)
  const clause = Math.max(...[',', ';', ':', ' —'].map(mark => room.lastIndexOf(mark)))
  if (clause >= max * 0.6) return `${room.slice(0, clause).trim()}…`
  return `${room.slice(0, Math.max(room.lastIndexOf(' '), max / 2)).trim()}…`
}

/**
 * A random card to show, never the one shown last when another exists.
 * `random` is a number in [0, 1), so tests can pin it.
 */
export function pickInsight(deck: Card[], now: number, lastId: string | undefined, random: number): Card | undefined {
  const pool = insightCards(deck, now)
  const fresh = pool.length > 1 ? pool.filter(c => c.id !== lastId) : pool
  return fresh[Math.floor(random * fresh.length)]
}

export function insightText(card: Card, max = INSIGHT_CHARS): string {
  const head = `💡 ${card.topic}: `
  return `${head}${takeaway(card.back, max - head.length)}`
}

/**
 * The status line: `prefix`, then the takeaway in whatever room is left of
 * `max`; the prefix alone when too little is left.
 */
export function statusLine(prefix: string, card: Card | undefined, max = STATUS_CHARS): string {
  const room = max - prefix.length - ' · '.length
  if (card === undefined || room - `💡 ${card.topic}: `.length < MIN_TAKEAWAY) return prefix
  return `${prefix} · ${insightText(card, room)}`
}
