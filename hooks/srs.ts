import type { Algorithm, Card, Grade } from '../types'
import { initialMemory, intervalFor, nextMemory, type Memory } from './fsrs'
import { isWeakFront } from './prompts'

export const DAY = 24 * 60 * 60 * 1000
const MATURE_DAYS = 21

export type SchedOptions = { algorithm: Algorithm; retention: number }
export const SM2: SchedOptions = { algorithm: 'sm2', retention: 0.9 }

/**
 * Reschedules `card` after the learner graded their recall, with SM-2 or FSRS.
 * Returns a new card; never mutates the input. `jitter` scales the interval;
 * left out, it is ±5% so cards made together do not stay due together.
 */
export function schedule(card: Card, grade: Grade, now: number, jitter = fuzz(), opts: SchedOptions = SM2): Card {
  const next = opts.algorithm === 'fsrs' ? scheduleFsrs(card, grade, now, jitter, opts.retention) : scheduleSm2(card, grade, now, jitter)
  return { ...next, lastReviewAt: now }
}

/** The card's FSRS memory: its own, else one seeded from its SM-2 interval, else none yet. */
function memoryOf(card: Card): Memory | undefined {
  if (card.stability !== undefined && card.difficulty !== undefined) {
    return { stability: card.stability, difficulty: card.difficulty }
  }
  if (card.intervalDays > 0) return { stability: card.intervalDays, difficulty: initialMemory('good').difficulty }
  return undefined
}

function scheduleFsrs(card: Card, grade: Grade, now: number, jitter: number, retention: number): Card {
  const before = memoryOf(card)
  const last = card.lastReviewAt ?? card.due - card.intervalDays * DAY
  const m = before === undefined ? initialMemory(grade) : nextMemory(before, grade, (now - last) / DAY)
  const base = { ...card, stability: m.stability, difficulty: m.difficulty }
  if (grade === 'again') {
    return { ...base, reps: 0, lapses: card.lapses + 1, intervalDays: 0, due: now + RELEARN_MS }
  }
  const intervalDays = Math.max(1, Math.round(intervalFor(m.stability, retention) * jitter))
  return { ...base, reps: card.reps + 1, intervalDays, due: now + intervalDays * DAY }
}

function scheduleSm2(card: Card, grade: Grade, now: number, jitter: number): Card {
  if (grade === 'again') {
    // A lapse: relearn soon, in this session if possible.
    const ease = Math.max(MIN_EASE, card.ease - 0.2)
    return { ...card, ease, reps: 0, lapses: card.lapses + 1, intervalDays: 0, due: now + RELEARN_MS }
  }

  const ease = Math.max(MIN_EASE, card.ease + EASE_DELTA[grade])
  const base =
    card.reps === 0 ? 1 : card.reps === 1 ? 3 : Math.max(1, card.intervalDays) * card.ease
  const intervalDays = Math.max(1, Math.round(base * GRADE_FACTOR[grade] * jitter))

  return { ...card, ease, reps: card.reps + 1, intervalDays, due: now + intervalDays * DAY }
}

const MIN_EASE = 1.3
const RELEARN_MS = 10 * 60 * 1000
const EASE_DELTA: Record<Exclude<Grade, 'again'>, number> = { hard: -0.15, good: 0, easy: 0.15 }
const GRADE_FACTOR: Record<Exclude<Grade, 'again'>, number> = { hard: 0.6, good: 1, easy: 1.3 }

function fuzz(): number {
  return 0.95 + Math.random() * 0.1
}

/** How long until `card` comes back if graded `grade` at `now`: the schedule without its jitter. */
export function previewInterval(card: Card, grade: Grade, now = 0, opts: SchedOptions = SM2): number {
  return schedule(card, grade, now, 1, opts).due - now
}

/** `10m`, `3h`, `4d`, `2mo`: a short wait for a button label. */
export function shortWait(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  return days < 60 ? `${days}d` : `${Math.round(days / 30)}mo`
}

/** A card nobody has seen the answer of yet: it is taught on the learn screen before it is tested. */
export function isToLearn(c: Card): boolean {
  return c.reps === 0 && c.learnedAt === undefined
}

/**
 * Cards due now: topics in `boost` first, then most overdue first. Never makes
 * a card due early, and never tests a card whose answer was not shown yet.
 */
export function dueCards(deck: Card[], now: number, boost?: ReadonlySet<string>): Card[] {
  const rank = (c: Card) => (boost?.has(c.topic) ? 0 : 1)
  return deck.filter(c => c.due <= now && !isToLearn(c)).sort((a, b) => rank(a) - rank(b) || a.due - b.due)
}

const TOPIC_ALIASES: Record<string, string> = {
  postgresql: 'postgres',
  pg: 'postgres',
  ts: 'typescript',
  js: 'javascript',
  k8s: 'kubernetes',
  'distributed system': 'distributed systems',
}

/** One spelling per topic, so "PostgreSQL" and "postgres" count together. */
export function normTopic(topic: string): string {
  const key = topic.trim().toLowerCase().replace(/\s+/g, ' ')
  return TOPIC_ALIASES[key] ?? (key || 'general')
}

/** Records a recall attempt for the proficiency counters, then reschedules. */
export function grade(card: Card, g: Grade, now: number, opts: SchedOptions = SM2): Card {
  const isCorrect = g !== 'again'
  return schedule(
    { ...card, seen: card.seen + 1, correct: card.correct + (isCorrect ? 1 : 0) },
    g,
    now,
    undefined,
    opts,
  )
}

export type TopicStats = {
  topic: string
  cards: number
  due: number
  /** 0..1: how far the topic's cards are toward a mature (21-day) interval. */
  mastery: number
  /** 0..1, or null before any attempt. */
  accuracy: number | null
}

export function topicStats(deck: Card[], now: number): TopicStats[] {
  const byTopic = new Map<string, Card[]>()
  for (const c of deck) byTopic.set(c.topic, [...(byTopic.get(c.topic) ?? []), c])

  return [...byTopic.entries()]
    .map(([topic, cards]) => {
      const seen = cards.reduce((n, c) => n + c.seen, 0)
      const correct = cards.reduce((n, c) => n + c.correct, 0)
      return {
        topic,
        cards: cards.length,
        due: cards.filter(c => c.due <= now).length,
        mastery:
          cards.reduce((n, c) => n + Math.min(1, c.intervalDays / MATURE_DAYS), 0) /
          cards.length,
        accuracy: seen === 0 ? null : correct / seen,
      }
    })
    .sort((a, b) => a.mastery - b.mastery)
}

type RawCard = {
  topic?: unknown
  front?: unknown
  back?: unknown
  choices?: unknown
  answer?: unknown
}

/** Parses the model's JSON reply into new cards, dropping malformed ones and duplicates. */
export function parseCards(
  text: string,
  existing: Card[],
  source: Card['source'],
  now: number,
): Card[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return []

  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  return toCards(raw, existing, source, now)
}

/**
 * Parses a chat reply: `{ "topics": [...], "cards": [...] }`, or a bare card array
 * (older replies, and the interest path).
 */
export function parseChatReply(
  text: string,
  existing: Card[],
  now: number,
): { topics: string[]; cards: Card[] } {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  const isObject = start >= 0 && end > start && (text.indexOf('[') < 0 || start < text.indexOf('['))
  if (!isObject) return { topics: [], cards: parseCards(text, existing, 'chat', now) }

  let raw: { topics?: unknown; cards?: unknown }
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return { topics: [], cards: [] }
  }
  const topics = Array.isArray(raw.topics)
    ? [...new Set(raw.topics.filter((t): t is string => typeof t === 'string').map(normTopic))].slice(0, 5)
    : []
  const cards = Array.isArray(raw.cards) ? toCards(raw.cards, existing, 'chat', now) : []
  return { topics, cards }
}

export function toCards(raw: unknown[], existing: Card[], source: Card['source'], now: number): Card[] {
  const seenFronts = new Set(existing.map(c => c.front.trim().toLowerCase()))
  const cards: Card[] = []
  for (const r of raw as RawCard[]) {
    if (typeof r.front !== 'string' || typeof r.back !== 'string') continue
    // A generic question tests nothing; keep the deck to cards worth reviewing.
    if (isWeakFront(r.front)) continue
    const key = r.front.trim().toLowerCase()
    if (seenFronts.has(key)) continue
    seenFronts.add(key)

    const choices = Array.isArray(r.choices)
      ? r.choices.filter((x): x is string => typeof x === 'string').slice(0, 4)
      : []
    const answer = typeof r.answer === 'number' ? r.answer : -1
    const hasQuiz = choices.length >= 2 && answer >= 0 && answer < choices.length

    cards.push({
      id: `${now.toString(36)}-${cards.length}-${Math.random().toString(36).slice(2, 6)}`,
      topic: typeof r.topic === 'string' ? normTopic(r.topic) : 'general',
      front: r.front.trim(),
      back: r.back.trim(),
      choices: hasQuiz ? choices : [],
      answer: hasQuiz ? answer : -1,
      source,
      createdAt: now,
      ease: 2.5,
      intervalDays: 0,
      reps: 0,
      lapses: 0,
      due: now,
      seen: 0,
      correct: 0,
    })
  }
  return cards
}
