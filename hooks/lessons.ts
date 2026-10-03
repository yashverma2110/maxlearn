import type { Card, Lesson } from '../types'
import { isToLearn, normTopic, toCards } from './srs'

/** The first review after learning: soon enough to catch what did not stick. */
export const FIRST_REVIEW_MS = 10 * 60 * 1000

/** Lessons one model call writes: one to show now, one to keep for the next Next. */
export const LESSONS_PER_CALL = 2

const CARD_PREFIX = 'card:'

export const isCardLesson = (id: string) => id.startsWith(CARD_PREFIX)

/** A card not learned yet, taught by showing its answer: no model call. */
export function cardLesson(card: Card): Lesson {
  return { id: `${CARD_PREFIX}${card.id}`, topic: card.topic, title: card.front, body: card.back, cards: [], createdAt: card.createdAt }
}

/** The lesson `id` names: a card lesson from the deck, else a generated one. */
export function findLesson(id: string, deck: Card[], lessons: Lesson[]): Lesson | undefined {
  if (isCardLesson(id)) {
    const card = deck.find(c => c.id === id.slice(CARD_PREFIX.length))
    return card && cardLesson(card)
  }
  return lessons.find(l => l.id === id)
}

/** The oldest card still to learn that no surface shows right now. */
export function nextCardToLearn(deck: Card[], shown: ReadonlySet<string>): Card | undefined {
  return deck
    .filter(c => isToLearn(c) && !shown.has(`${CARD_PREFIX}${c.id}`))
    .sort((a, b) => a.createdAt - b.createdAt)[0]
}

/**
 * The deck once `lesson` is learned: a card lesson's card is marked learned; a
 * generated lesson's cards join, marked learned. Either way the first review
 * comes `FIRST_REVIEW_MS` later.
 */
export function learn(lesson: Lesson, deck: Card[], now: number): Card[] {
  const due = now + FIRST_REVIEW_MS
  if (isCardLesson(lesson.id)) {
    const id = lesson.id.slice(CARD_PREFIX.length)
    return deck.map(c => (c.id === id && isToLearn(c) ? { ...c, learnedAt: now, due } : c))
  }
  const fronts = new Set(deck.map(c => c.front.trim().toLowerCase()))
  const fresh = lesson.cards
    .filter(c => !fronts.has(c.front.trim().toLowerCase()))
    .map(c => ({ ...c, learnedAt: now, due }))
  return [...deck, ...fresh]
}

type RawLesson = { topic?: unknown; title?: unknown; body?: unknown; example?: unknown; cards?: unknown }

/** Parses the model's lessons; drops malformed ones and lessons whose title repeats one already known. */
export function parseLessons(text: string, deck: Card[], known: Lesson[], now: number): Lesson[] {
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

  const titles = new Set(known.map(l => l.title.trim().toLowerCase()))
  const lessons: Lesson[] = []
  for (const [n, r] of (raw as RawLesson[]).entries()) {
    if (typeof r.title !== 'string' || typeof r.body !== 'string' || typeof r.topic !== 'string') continue
    if (titles.has(r.title.trim().toLowerCase())) continue
    titles.add(r.title.trim().toLowerCase())
    const topic = normTopic(r.topic)
    const cards = Array.isArray(r.cards)
      ? toCards(r.cards.map(c => ({ topic, ...(c as object) })), deck, 'interest', now).slice(0, 2)
      : []
    lessons.push({
      id: `l-${now.toString(36)}-${n}-${Math.random().toString(36).slice(2, 6)}`,
      topic,
      title: r.title.trim(),
      body: r.body.trim(),
      example: typeof r.example === 'string' && r.example.trim() !== '' ? r.example.trim() : undefined,
      cards,
      createdAt: now,
    })
  }
  return lessons.slice(0, LESSONS_PER_CALL)
}

/**
 * Which topics the next lessons teach: the candidates in their order of need,
 * those taught least recently first, `count` of them (repeating when short).
 */
export function lessonTopics(candidates: string[], recent: Lesson[], count = LESSONS_PER_CALL): string[] {
  if (candidates.length === 0) return []
  const lastTaught = (t: string) => {
    for (let n = recent.length - 1; n >= 0; n--) if (recent[n]!.topic === t) return n
    return -1
  }
  const order = [...candidates].sort((a, b) => lastTaught(a) - lastTaught(b))
  return Array.from({ length: count }, (_, n) => order[n % order.length]!)
}

/** A lesson as markdown: the chat row's text where the drawing is not used. */
export function lessonMarkdown(lesson: Lesson): string {
  const parts = [`**${lesson.title}**`, lesson.body]
  if (lesson.example) parts.push(`_Example:_ ${lesson.example}`)
  return parts.join('\n\n')
}
