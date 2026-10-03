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

type RawLesson = { topic?: unknown; title?: unknown; body?: unknown; example?: unknown; terms?: unknown; cards?: unknown }

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
      terms: cleanTerms(r.terms),
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

/** The longest term Explain takes: a word or a short phrase, not a passage. */
export const MAX_TERM = 40

/** A term as typed, pasted or selected: trimmed, unquoted, one line; undefined when empty or too long. */
export function cleanTerm(raw: string): string | undefined {
  const t = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'`“”‘’(\[]+|["'`“”‘’)\].,;:?!]+$/g, '')
    .trim()
  return t === '' || t.length > MAX_TERM ? undefined : t
}

/** Up to 4 distinct terms from the model's list. */
function cleanTerms(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<string>()
  const terms: string[] = []
  for (const r of raw) {
    const t = typeof r === 'string' ? cleanTerm(r) : undefined
    if (t === undefined || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    terms.push(t)
  }
  return terms.length === 0 ? undefined : terms.slice(0, 4)
}

/** Adds `term` under `topic`, once, case-insensitively; newest last. */
export function addSubtopic(map: Record<string, string[]>, topic: string, term: string): Record<string, string[]> {
  const list = map[topic] ?? []
  if (list.some(t => t.toLowerCase() === term.toLowerCase())) return map
  return { ...map, [topic]: [...list, term].slice(-20) }
}

/** The ask for a lesson that explains `term`, a word a learner met in a lesson on `topic`. */
export function termPrompt(term: string, topic: string, context: string | undefined): string {
  return `A learner reading about "${topic}" met the term "${term}" and does not know it.
Write ONE short lesson that explains "${term}" as it is used in ${topic}:
- "title": what ${term} is, in one short statement (spell out an abbreviation).
- "body": 3-5 sentences: what it is, why it exists, and how it connects to ${topic}. Explain every other technical term you use.
- "example": one concrete case.
- "terms": up to 3 other terms in your lesson that the learner may not know.
- "cards": 1 flashcard that tests the main idea.
${context ? `\nThe lesson where the learner met it:\n${context}\n` : ''}
Reply with ONLY a JSON array with one lesson:
[{"topic": "${topic}", "title": "...", "body": "...", "example": "...", "terms": ["..."], "cards": [{"front": "...", "back": "...", "choices": ["...", "...", "...", "..."], "answer": 0}]}]`
}

/** The ask for a lesson that teaches the idea behind a flashcard or quiz question in depth. */
export function teachPrompt(card: { topic: string; front: string; back: string; choices: string[] }): string {
  return `A learner is practising this flashcard on "${card.topic}" and wants to understand the idea behind it.

Question: ${card.front}
Answer: ${card.back}${card.choices.length > 0 ? `\nQuiz choices: ${card.choices.join(' | ')}` : ''}

Write ONE lesson that teaches the idea in depth:
- "title": the idea as a short statement.
- "body": 3-5 sentences: how it works, why it is true, and what goes wrong without it.${card.choices.length > 0 ? ' Say briefly why the wrong choices are wrong.' : ''}
- "example": one concrete case: a command, a number, a query or a failure.
- "terms": up to 3 terms in your lesson that the learner may not know.
- "cards": 1 new flashcard that goes one step further. Do not repeat the question above.

Reply with ONLY a JSON array with one lesson:
[{"topic": "${card.topic}", "title": "...", "body": "...", "example": "...", "terms": ["..."], "cards": [{"front": "...", "back": "...", "choices": ["...", "...", "...", "..."], "answer": 0}]}]`
}
