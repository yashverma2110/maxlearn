import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface, Timer } from 'claude-code'

import type {
  AutoPeriod,
  Algorithm,
  Card,
  ChatModel,
  ChatSession,
  ChatTopics,
  Focus,
  Generating,
  Grade,
  InsightPace,
  InterestModel,
  LastAnswer,
  Retention,
  Lesson,
  Mode,
  ReviewEvent,
  SessionTally,
  StudySettings,
  View,
} from '../types'
import {
  dots,
  focusTopics,
  heatLevel,
  heatmap,
  improve,
  interestRank,
  overview,
  recordChatTopics,
  sessionSummary,
  sparkline,
  streakMilestone,
  strong,
  topicInsights,
  workTopics,
} from './analytics'
import {
  HELP_LINES,
  TAB_ORDER,
  arrowCell,
  arrowLines,
  arrowMap,
  focusOrder,
  keyAction,
  keyHint,
  mainElement,
  ringStep,
  type KeyAction,
  type KeyContext,
} from './keymap'
import { TAB_LABELS, bar, density, masteryColor, pct, type Density } from './layout'
import {
  ALGORITHMS,
  AUTO_PERIODS,
  CHAT_CONTEXT_CHARS,
  CHAT_EVERY_TURNS,
  CHAT_MODELS,
  DEFAULT_SETTINGS,
  FOCUS_OPTIONS,
  INSIGHT_PACES,
  INTEREST_MODELS,
  MASTERED,
  MAX_DECK,
  MAX_REVIEWS,
  ON_OFF,
  RETENTIONS,
  TAB_KEYS,
  TITLE,
} from './constants'
import { dueCards, grade, isToLearn, normTopic, parseCards, parseChatReply, previewInterval, shortWait, topicStats, type SchedOptions } from './srs'
import { AUTO_CHECK_MS, chatMatches, periodDue, seedAutoAt, type AutoAt } from './auto'
import { gateDigest, gatePrompt, parseGate } from './gate'
import { pickInsight, statusLine } from './insight'
import { attributeChat, chatLabel, duration, studyMs, topicUsage } from './usage'
import {
  LESSONS_PER_CALL,
  cardLesson,
  findLesson,
  isCardLesson,
  learn,
  lessonMarkdown,
  lessonTopics,
  nextCardToLearn,
  parseLessons,
} from './lessons'
import { CARD_RUBRIC, LEVEL_BRIEF, STE_RULES, levelFor, simplifyPrompt } from './prompts'
import { orderedTips, tipFor, type TipContext } from './tips'

// Everything that takes `$` lives in this file: the engine follows `$` into
// functions declared here and never across an import. The pure parts (state,
// layout, tips, analytics, srs, keymap) are their own modules.

const PANE = 'maxlearn'
/** The key strip's Client key. */
const KEYS = 'keys'

// ── State: atoms the scan reads, so declared here ───────────────────────

const deck = atom({ plugin: 'maxlearn', key: 'deck' } as const, [] as Card[])
const interests = atom({ plugin: 'maxlearn', key: 'interests' } as const, [] as string[])
const view = atom({ plugin: 'maxlearn', key: 'view' } as const, {
  mode: 'review',
  isRevealed: false,
} as View)
const generating = atom({ plugin: 'maxlearn', key: 'generating' } as const, null as Generating | null)
const settings = atom({ plugin: 'maxlearn', key: 'settings' } as const, DEFAULT_SETTINGS)
const reviews = atom({ plugin: 'maxlearn', key: 'reviews' } as const, [] as ReviewEvent[])
const chatTopics = atom({ plugin: 'maxlearn', key: 'chatTopics' } as const, {} as ChatTopics)
const lastAnswer = atom({ plugin: 'maxlearn', key: 'lastAnswer' } as const, null as LastAnswer | null)
const lessons = atom({ plugin: 'maxlearn', key: 'lessons' } as const, [] as Lesson[])
const lessonQueue = atom({ plugin: 'maxlearn', key: 'lessonQueue' } as const, [] as string[])
const lessonNow = atom({ plugin: 'maxlearn', key: 'lessonNow' } as const, null as string | null)
const chatRuns = atom({ plugin: 'maxlearn', key: 'chatRuns' } as const, {} as Record<string, string>)
const chatSessions = atom({ plugin: 'maxlearn', key: 'chatSessions' } as const, [] as ChatSession[])
const learnTime = atom({ plugin: 'maxlearn', key: 'learnTime' } as const, {} as Record<string, number>)
const session = atom({ plugin: 'maxlearn', key: 'session' } as const, {
  reviewed: 0,
  correct: 0,
  startedAt: 0,
} as SessionTally)

// ── Actions ────────────────────────────────────────────────────────────────

type $ = EngineInterface

const CARD_ITEM = `{"topic": short category such as "system design" or "TypeScript",
 "front": one specific question about a mechanism, trade-off or failure mode,
 "back": the answer first, then why, then one concrete detail (1-3 sentences),
 "choices": exactly 4 short options for a multiple-choice quiz,
 "answer": the 0-based index of the correct choice}`


const CARD_SHAPE = `Reply with ONLY a JSON array, no prose. Each item:
${CARD_ITEM}

${CARD_RUBRIC}

${STE_RULES}`

const CHAT_SHAPE = `Reply with ONLY a JSON object, no prose:
{"topics": up to 5 short engineering topics this work touched, even when no card is worth making,
 "cards": an array of 0-2 cards}
Each card:
${CARD_ITEM}

${CARD_RUBRIC}

${STE_RULES}`

/** Asks the model to reuse names already in use, so one topic keeps one name. */
function topicHint(cards: Card[], extra: string[] = []): string {
  const names = [...new Set([...cards.map(c => c.topic), ...extra])].slice(0, 40)
  return names.length === 0 ? '' : `Reuse one of these topic names when it fits: ${names.join(', ')}.`
}

export async function saveDeck($: $, change: (cards: Card[]) => Card[]): Promise<Card[]> {
  const next = await update($, deck, cards => change(cards).slice(-MAX_DECK))
  await $.store.set('deck', next)
  await showStatus($)
  return next
}

/** `📚 4 due · 🔥 6` under the prompt; nothing before the first card. */
const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

/** `Writing cards on postgres` or `Writing cards from this chat`. */
const writingWhat = (label: string) => (label === 'this chat' ? 'from this chat' : `on ${label}`)

/** The line under the prompt: a spinner while cards are written, else `📚 4 due · 🔥 6`. */
export async function showStatus($: $) {
  const now = await $.clock.now()
  const busy = await read($, generating)
  if (busy !== null) {
    const elapsed = Math.max(0, now - busy.startedAt)
    const frame = SPINNER[Math.floor(elapsed / 120) % SPINNER.length]
    $.ui.status(`${frame} Writing ${busy.noun ?? 'card'}s ${writingWhat(busy.label)} · ${Math.round(elapsed / 1000)}s`)
    return
  }
  const cards = await read($, deck)
  if (cards.length === 0) {
    $.ui.status(undefined)
    return
  }
  const o = overview(cards, await read($, reviews), now)
  const shown = cards.find(c => c.id === insightId)
  $.ui.status(statusLine(`📚 ${o.dueNow} due${o.streakDays > 0 ? ` · 🔥 ${o.streakDays}` : ''}`, shown))
}

// The takeaway on the status line and the timer that swaps it. Module state:
// a reload drops both, and session.start starts them again.
let insightId: string | undefined
let insightTimer: Timer | undefined

/** Shows a takeaway from another reviewed, not-due card. */
async function rotateInsight($: $) {
  const card = pickInsight(await read($, deck), await $.clock.now(), insightId, Math.random())
  insightId = card?.id
  await showStatus($)
}

/** (Re)starts the rotation at the pace the settings ask for; `off` clears it. */
async function startInsights($: $, pace: InsightPace) {
  insightTimer?.cancel()
  insightTimer = undefined
  const ms = INSIGHT_PACES.find(p => p.value === pace)?.ms ?? 0
  if (ms === 0) {
    insightId = undefined
    await showStatus($)
    return
  }
  await rotateInsight($)
  insightTimer = $.clock.every(ms, () => void rotateInsight($))
}

async function addCards($: $, text: string, source: Card['source']): Promise<number> {
  const now = await $.clock.now()
  let added = 0
  await saveDeck($, cards => {
    const fresh = parseCards(text, cards, source, now)
    added = fresh.length
    return [...cards, ...fresh]
  })
  return added
}

/** Records the topics the chat touched today, then adds its cards. */
// ── Where time goes ──
// Chat time since the last topic check, and when each card or lesson came on
// screen. Module state: a reload starts both over, losing at most a few turns.
let pendingChatMs = 0
const shownAt = new Map<string, number>()

/** Files the chat time since the last check under this chat, split over the topics it touched. */
async function recordChatTime($: $, topics: string[]) {
  if (topics.length === 0 || pendingChatMs === 0) return
  const id = await $.session.id()
  const first = (await $.session.messages()).find(m => m.role === 'user')?.text
  const folder = (await $.session.cwd()).split('/').pop() ?? 'chat'
  const now = await $.clock.now()
  const ms = pendingChatMs
  pendingChatMs = 0
  const next = await update($, chatSessions, list => attributeChat(list, id, chatLabel(first, folder), topics, ms, now))
  await $.store.set('chatSessions', next)
}

/** Notes when `id` came on screen, once; the grade or Next measures from here. */
function markShown(id: string, now: number) {
  if (!shownAt.has(id)) shownAt.set(id, now)
}

/** How long `id` was on screen, and forgets it. */
function takeShown(id: string, now: number): number {
  const ms = studyMs(shownAt.get(id), now)
  shownAt.delete(id)
  return ms
}

/** Files the topics the chat touched: today's counts, this chat's time, and interests to top up. */
async function recordTopics($: $, topics: string[]) {
  if (topics.length === 0) return
  const now = await $.clock.now()
  const next = await update($, chatTopics, chat => recordChatTopics(chat, topics, now))
  await $.store.set('chatTopics', next)
  await recordChatTime($, topics)
  await onChatTopics($, topics)
}

async function addChatReply($: $, text: string): Promise<number> {
  const now = await $.clock.now()
  const { topics, cards } = parseChatReply(text, await read($, deck), now)
  await recordTopics($, topics)
  if (cards.length > 0) await saveDeck($, existing => [...existing, ...cards])
  return cards.length
}

// Rows the gate has already read: the next check reads only what came after.
// Module state: a reload reads the recent chat once more, newest kept.
let gatedRows = 0

/**
 * The automatic chat check: the learning gate first (one cheap call over the
 * turns since the last check); execution-only work files its topics and stops.
 */
async function autoChatCheck($: $): Promise<number> {
  const rows = await $.session.messages()
  const fresh = rows.slice(Math.min(gatedRows, rows.length))
  gatedRows = rows.length
  const digest = gateDigest(fresh)
  if (digest === '') return 0
  const reply = await $.model.complete({ model: 'haiku', effort: 'low', maxTokens: 200, timeoutMs: 30_000, prompt: gatePrompt(digest) })
  const verdict = reply.isAnswered ? parseGate(reply.text) : undefined
  // An unreadable verdict fails open: the card writer has its own rule against execution-only work.
  if (verdict?.kind === 'execution') {
    await recordTopics($, verdict.topics)
    return 0
  }
  return fromChat($)
}

export async function fromChat($: $): Promise<number> {
  const cards = await read($, deck)
  const known = cards.slice(-40).map(c => `- ${c.front}`).join('\n')
  const { chatModel } = await read($, settings)
  const ask = `[maxlearn] Step outside the task for a moment. Name the engineering topics the recent work in this conversation touched. Then, from its engineering or design concepts, pick at most 2 that a software engineer would benefit from remembering long-term: principles, patterns, trade-offs, language or API semantics. Skip anything specific to this one codebase. If the recent work only executed tasks (ran commands, renamed or moved files, edited config, committed, formatted) and explained no reusable idea, give "cards": []. Give "cards": [] if nothing qualifies.
${topicHint(cards, await read($, interests))}
Do not repeat these existing cards:
${known || '(none)'}

${CHAT_SHAPE}`

  if (chatModel === 'session') {
    const reply = await $.model.fork({ prompt: ask })
    return reply.isAnswered ? addChatReply($, reply.text) : 0
  }

  const transcript = await recentChat($)
  if (transcript === '') return 0
  const reply = await $.model.complete({
    model: chatModel,
    maxTokens: 2048,
    timeoutMs: 60_000,
    prompt: `<conversation>\n${transcript}\n</conversation>\n\n${ask.replace('this conversation', 'the conversation above')}`,
  })
  return reply.isAnswered ? addChatReply($, reply.text) : 0
}

/** The newest chat rows as plain text, newest kept when it runs long. */
async function recentChat($: $): Promise<string> {
  const rows = await $.session.messages()
  const lines: string[] = []
  let size = 0
  for (const row of [...rows].reverse()) {
    const line = `${row.role}: ${row.text}`
    if (row.text.trim() === '') continue
    if (size + line.length > CHAT_CONTEXT_CHARS) break
    lines.unshift(line)
    size += line.length
  }
  return lines.join('\n\n')
}

export async function fromInterest($: $, topic: string): Promise<number> {
  await stampAuto($, topic)
  const now = await $.clock.now()
  const cards = await read($, deck)
  const log = await read($, reviews)
  const t = topicInsights(cards, log, await read($, chatTopics), await read($, interests), now).find(
    x => x.topic === topic,
  )
  const recall = t?.recentAccuracy ?? t?.accuracy ?? null
  const reviewsOfTopic = log.filter(r => r.topic === topic).length
  const level = levelFor(t && { cards: t.cards, mastery: t.mastery, recall, reviews: reviewsOfTopic }, (await readSimpler($))[topic] ?? 0)
  const known = cards
    .filter(c => c.topic === topic)
    .slice(-30)
    .map(c => `- ${c.front}`)
    .join('\n')

  const reply = await $.model.complete({
    model: (await read($, settings)).interestModel,
    maxTokens: 4096,
    timeoutMs: 120_000,
    effort: 'high',
    prompt: `Write flashcards on "${topic}" for ${LEVEL_BRIEF[level]}. Set "topic" to "${topic}".

Draft 6 candidate cards in your head. Check each against the rubric below. Reply with only the 3 best.
${known === '' ? '' : `\nThe learner already has these cards. Do not repeat them; go deeper or cover a different part of ${topic}:\n${known}\n`}
${CARD_SHAPE}`,
  })
  return reply.isAnswered ? addCards($, reply.text, 'interest') : 0
}

// Requests made while cards are being written wait here, one per label, and
// run in turn. Module state: a reload drops the queue with the work in flight.
type Noun = 'card' | 'lesson' | 'simpler lesson'
const queue: { label: string; work: () => Promise<number>; isAuto: boolean; noun: Noun; lessonId?: string }[] = []

/** Runs generation off the current dispatch so a turn never waits on it; one at a time, the rest queued. */
export function generate($: $, label: string, work: () => Promise<number>, isAuto = false, noun: Noun = 'card', lessonId?: string) {
  $.clock.after(0, async () => {
    const busy = await read($, generating)
    if (busy !== null) {
      if ((busy.label === label && busy.noun === noun) || queue.some(q => q.label === label && q.noun === noun)) return
      queue.push({ label, work, isAuto, noun, lessonId })
      if (!isAuto) $.ui.toast(`📚 Queued: ${noun}s ${writingWhat(label)}`)
      return
    }
    const startedAt = await $.clock.now()
    await update($, generating, () => ({ label, startedAt, noun, lessonId }))
    await showStatus($)
    // Animate the status line; a reload drops the timer and session.start clears the state.
    const spinner = $.clock.every(120, () => void showStatus($))
    try {
      const n = await work()
      const auto = isAuto ? ' (auto)' : ''
      if (n > 0) $.ui.toast(`📚 ${n} new ${noun}${n === 1 ? '' : 's'} ${writingWhat(label)}${auto}`)
      else if (!isAuto) $.ui.toast(`📚 No new ${noun}s ${writingWhat(label)}`)
    } finally {
      spinner.cancel()
      await update($, generating, () => null)
      await showStatus($)
      const nextUp = queue.shift()
      if (nextUp !== undefined) generate($, nextUp.label, nextUp.work, nextUp.isAuto, nextUp.noun, nextUp.lessonId)
    }
  })
}

// ── Learning: lessons before flashcards ──

const PENDING = 'pending'

/** Topics in order of need: weak first, then this week's work, interests, the rest of the deck. */
async function lessonCandidates($: $): Promise<string[]> {
  const i = await readInsights($)
  const deckTopics = (await read($, deck)).map(c => c.topic)
  return [...new Set([...i.improve.map(t => t.topic), ...i.work.map(w => w.topic), ...i.savedInterests, ...deckTopics])]
}

/**
 * One model call that writes `LESSONS_PER_CALL` lessons, each with its cards:
 * the first goes to whoever is waiting, the rest wait for the next Next.
 */
async function writeLessons($: $, aim?: string[]): Promise<number> {
  const known = await read($, lessons)
  const topics = aim ?? lessonTopics(await lessonCandidates($), known)
  if (topics.length === 0) {
    $.ui.toast('📖 Add an interest first: /study <topic>')
    return 0
  }
  const now = await $.clock.now()
  const cards = await read($, deck)
  const log = await read($, reviews)
  const insights = topicInsights(cards, log, await read($, chatTopics), await read($, interests), now)
  const simpler = await readSimpler($)
  const brief = topics
    .map((topic, n) => {
      const t = insights.find(x => x.topic === topic)
      const recall = t?.recentAccuracy ?? t?.accuracy ?? null
      const level = levelFor(
        t && { cards: t.cards, mastery: t.mastery, recall, reviews: log.filter(r => r.topic === topic).length },
        simpler[topic] ?? 0,
      )
      return `${n + 1}. "${topic}" for ${LEVEL_BRIEF[level]}`
    })
    .join('\n')
  const taught = known.slice(-20).map(l => `- ${l.title}`).join('\n')

  const reply = await $.model.complete({
    model: (await read($, settings)).interestModel,
    maxTokens: 4096,
    timeoutMs: 120_000,
    prompt: `Teach ${topics.length} short lessons, one per topic, in this order:
${brief}
${taught === '' ? '' : `\nDo not repeat these lessons:\n${taught}\n`}
A lesson teaches ONE idea a learner can use: the mechanism, why it matters, and what goes wrong without it.
- "title": the idea as a short statement, not a question.
- "body": 3-5 sentences.
- "example": one concrete case: a command, a number, a query or a failure.
- "cards": 1 or 2 flashcards that test exactly what the lesson taught.

Reply with ONLY a JSON array, no prose:
[{"topic": "...", "title": "...", "body": "...", "example": "...", "cards": [${CARD_ITEM}]}]

${CARD_RUBRIC}

${STE_RULES}`,
  })
  if (!reply.isAnswered) return 0
  const fresh = parseLessons(reply.text, cards, known, now)
  if (fresh.length === 0) return 0
  const all = await update($, lessons, list => [...list, ...fresh].slice(-100))
  await $.store.set('lessons', all)
  const queued = await update($, lessonQueue, q => [...q, ...fresh.map(l => l.id)])
  await $.store.set('lessonQueue', queued)
  await fillWaiting($)
  return fresh.length
}

/** Hands queued lessons to the learn tab and the chat rows waiting for one. */
async function fillWaiting($: $) {
  if ((await read($, lessonNow)) === PENDING) {
    const id = await takeQueued($)
    if (id !== undefined) await update($, lessonNow, () => id)
  }
  const runs = await read($, chatRuns)
  for (const [run, id] of Object.entries(runs).sort(([a], [b]) => Number(a) - Number(b))) {
    if (id !== PENDING) continue
    const next = await takeQueued($)
    if (next === undefined) break
    await update($, chatRuns, r => ({ ...r, [run]: next }))
  }
}

async function takeQueued($: $): Promise<string | undefined> {
  const [first, ...rest] = await read($, lessonQueue)
  if (first === undefined) return undefined
  await update($, lessonQueue, () => rest)
  await $.store.set('lessonQueue', rest)
  return first
}

/**
 * The next lesson to show: a card still to learn (free), else a written
 * lesson waiting in the queue (free), else `pending` while two are written,
 * or undefined when `mayWrite` is false.
 */
// Card lessons skipped on the learn tab: they go to the back of the line until
// every other card and queued lesson has had its turn. Module state.
const skippedCards = new Set<string>()

async function takeNextLesson($: $, mayWrite: boolean): Promise<string | undefined> {
  const shown = new Set([await read($, lessonNow), ...Object.values(await read($, chatRuns))].filter((x): x is string => typeof x === 'string'))
  const cards = await read($, deck)
  const card = nextCardToLearn(cards, new Set([...shown, ...skippedCards]))
  if (card !== undefined) return cardLesson(card).id
  const queued = await takeQueued($)
  if (queued !== undefined) return queued
  // Only skipped cards are left: start them over, oldest first.
  const again = nextCardToLearn(cards, shown)
  if (again !== undefined) {
    skippedCards.clear()
    return cardLesson(again).id
  }
  if (!mayWrite) return undefined
  const [topic] = lessonTopics(await lessonCandidates($), await read($, lessons))
  generate($, topic ?? 'your interests', () => writeLessons($), false, 'lesson')
  return PENDING
}

// ── Simplify ──

/** How many times each topic was simplified: each one steps its next lessons down a level. */
async function readSimpler($: $): Promise<Record<string, number>> {
  return ((await $.store.get('simpler')) as Record<string, number> | undefined) ?? {}
}

/** Queues a simpler rewrite of lesson `id`, in place; the topic's later lessons start a level lower. */
function simplify($: $, id: string) {
  void (async () => {
    const lesson = findLesson(id, await read($, deck), await read($, lessons))
    if (lesson === undefined) return
    generate($, lesson.topic, () => simplifyLesson($, id), false, 'simpler lesson', id)
  })()
}

async function simplifyLesson($: $, id: string): Promise<number> {
  const deckNow = await read($, deck)
  const lesson = findLesson(id, deckNow, await read($, lessons))
  if (lesson === undefined) return 0
  const cardId = isCardLesson(id) ? id.slice('card:'.length) : undefined
  const cards = cardId !== undefined ? deckNow.filter(c => c.id === cardId) : lesson.cards
  const reply = await $.model.complete({
    model: (await read($, settings)).interestModel,
    maxTokens: 2048,
    timeoutMs: 90_000,
    prompt: `${simplifyPrompt(lesson, cards)}\n\n${STE_RULES}`,
  })
  if (!reply.isAnswered) return 0
  const now = await $.clock.now()
  // Parse against a deck without the old cards, so their fronts do not count as repeats.
  const others = deckNow.filter(c => !cards.some(o => o.id === c.id))
  const [simpler] = parseLessons(reply.text, others, [], now)
  if (simpler === undefined) return 0

  if (cardId !== undefined) {
    // A card lesson is the card itself: keep its id and schedule, take the simpler words.
    const words = simpler.cards[0] ?? { front: simpler.title, back: simpler.body, choices: [], answer: -1 }
    await saveDeck($, list =>
      list.map(c => (c.id === cardId ? { ...c, front: words.front, back: words.back, choices: words.choices, answer: words.answer } : c)),
    )
  } else {
    const next = await update($, lessons, list =>
      list.map(l => (l.id === id ? { ...simpler, id: l.id, createdAt: l.createdAt, topic: l.topic } : l)),
    )
    await $.store.set('lessons', next)
  }
  const counts = await readSimpler($)
  await $.store.set('simpler', { ...counts, [lesson.topic]: (counts[lesson.topic] ?? 0) + 1 })
  return 1
}

/** Reading a lesson is learning it: its card is marked learned, or its cards join the deck. */
async function markLearned($: $, id: string | null | undefined) {
  if (!id || id === PENDING) return
  const lesson = findLesson(id, await read($, deck), await read($, lessons))
  if (lesson === undefined) return
  const now = await $.clock.now()
  await saveDeck($, cards => learn(lesson, cards, now))
  const ms = takeShown(id, now)
  if (ms > 0) {
    const next = await update($, learnTime, t => ({ ...t, [lesson.topic]: (t[lesson.topic] ?? 0) + ms }))
    await $.store.set('learnTime', next)
  }
}

/** The learn tab's Next (`isLearned`) or skip: learn the one shown only on Next, then show the next (writing two when none waits). */
async function nextOnLearnTab($: $, isLearned: boolean) {
  // Skipped, a card lesson stays to learn; a written lesson is let go and its cards never join.
  const current = await read($, lessonNow)
  if (isLearned) await markLearned($, current)
  else if (current !== null && isCardLesson(current)) skippedCards.add(current)
  await update($, lessonNow, () => null)
  const next = await takeNextLesson($, true)
  await update($, lessonNow, () => next ?? null)
}

/**
 * Adds an interest and shows it at once: saved (insights and more list it on
 * the next draw), the learn tab waiting on it, and two lessons on it queued.
 */
async function addInterest($: $, raw: string): Promise<string | undefined> {
  const topic = normTopic(raw)
  if (topic === 'general' || raw.trim() === '') return undefined
  const saved = await update($, interests, list => (list.includes(topic) ? list : [...list, topic]))
  await $.store.set('interests', saved)
  await stampAuto($, topic)
  // The learn tab shows the spinner now and the first lesson the moment it lands.
  const now = await read($, lessonNow)
  if (now === null || now === PENDING) await update($, lessonNow, () => PENDING)
  await setMode($, 'learn')
  generate($, topic, () => writeLessons($, Array.from({ length: LESSONS_PER_CALL }, () => topic)), false, 'lesson')
  return topic
}

// ── Automatic interest cards ──

async function readAutoAt($: $): Promise<AutoAt> {
  return ((await $.store.get('autoAt')) as AutoAt | undefined) ?? {}
}

/** Notes that `topic` got cards now, by any route, so its period starts over. */
async function stampAuto($: $, topic: string) {
  const at = await readAutoAt($)
  await $.store.set('autoAt', { ...at, [topic]: await $.clock.now() })
}

/** Queues an interest's cards on its own; stamped now, so a second trigger in the meantime is a no-op. */
async function autoInterest($: $, topic: string) {
  await stampAuto($, topic)
  generate($, topic, () => fromInterest($, topic), true)
}

/** The chat touched these topics: make cards for the saved interests among them, within the cooldown. */
async function onChatTopics($: $, topics: string[]) {
  if ((await read($, settings)).autoOnChat !== 'on') return
  const matches = chatMatches(topics, await read($, interests), await readAutoAt($), await $.clock.now())
  for (const topic of matches.slice(0, 2)) await autoInterest($, topic)
}

/** One interest whose period ran out gets cards; the next check takes the next one. */
async function checkPeriod($: $) {
  const { autoPeriod } = await read($, settings)
  const ms = AUTO_PERIODS.find(p => p.value === autoPeriod)?.ms ?? 0
  const topic = periodDue(await read($, interests), await readAutoAt($), await $.clock.now(), ms)
  if (topic !== undefined) await autoInterest($, topic)
}

let autoTimers: Timer[] = []

/** (Re)starts the period checks: soon after start, then every 15 minutes; `off` stops them. */
async function startAuto($: $, period: AutoPeriod) {
  for (const t of autoTimers) t.cancel()
  autoTimers = []
  if (period === 'off') return
  const at = await readAutoAt($)
  const seeded = seedAutoAt(await read($, interests), at, await $.clock.now())
  if (seeded !== at) await $.store.set('autoAt', seeded)
  autoTimers = [
    $.clock.after(30_000, () => void checkPeriod($)),
    $.clock.every(AUTO_CHECK_MS, () => void checkPeriod($)),
  ]
}

/** Everything insights draws, read once per draw. */
export async function readInsights($: $) {
  const now = await $.clock.now()
  const cards = await read($, deck)
  const log = await read($, reviews)
  const saved = await read($, interests)
  const { focus } = await read($, settings)
  const topics = topicInsights(cards, log, await read($, chatTopics), saved, now)
  const favored = focusTopics(focus, topics, saved)
  return {
    now,
    log,
    focus,
    favored,
    savedInterests: saved,
    overview: overview(cards, log, now),
    improve: improve(topics, favored),
    strong: strong(topics),
    interests: interestRank(topics),
    work: workTopics(topics),
    busy: await read($, generating),
    settings: await read($, settings),
    chats: await read($, chatSessions),
    usage: topicUsage(await read($, chatSessions), log, await read($, learnTime)),
  }
}

export type Insights = Awaited<ReturnType<typeof readInsights>>

export function tipContext(i: Insights): TipContext {
  return {
    cards: i.overview.totalCards,
    due: i.overview.dueNow,
    interests: i.savedInterests.length,
    retention: i.overview.retention30d,
    thinWorkTopics: i.work.filter(w => w.isThin).length,
    focus: i.focus,
    streakDays: i.overview.streakDays,
  }
}

export const focusLabel = (focus: StudySettings['focus']) =>
  FOCUS_OPTIONS.find(f => f.value === focus)?.label ?? focus

export async function statsText($: $): Promise<string> {
  const i = await readInsights($)
  const busy = await read($, generating)
  const writing = busy === null ? [] : [`⟳ Writing ${busy.noun ?? 'card'}s ${writingWhat(busy.label)}…`]
  if (i.overview.totalCards === 0 && i.work.length === 0) {
    if (i.savedInterests.length === 0) return 'No cards or interests yet. Add one: /study <topic>'
    return [...writing, `Interests: ${i.savedInterests.join(', ')}`, 'No cards yet: they arrive with your first lessons (/study learn).'].join('\n')
  }
  const o = i.overview
  const list = (title: string, rows: { topic: string; reason: string }[]) =>
    rows.length === 0 ? [] : [title, ...rows.map(r => `  ${r.topic}: ${r.reason}`)]
  return [
    ...writing,
    `Streak ${o.streakDays}d · ${o.reviewsToday} today · ${sparkline(o.reviews7d)} · retention ${pct(o.retention30d)} · mature ${o.matureCards}/${o.totalCards} · ${o.dueNow} due`,
    `Focus: ${focusLabel(i.focus)}`,
    ...list('Improve', i.improve),
    ...list('Strong', i.strong),
    ...list(
      'Work this week',
      i.work.map(w => ({ topic: w.topic, reason: `${w.chatDays7}d · ${w.cards} cards${w.isThin ? ' · thin' : ''}` })),
    ),
    ...list('Interests', i.interests),
    ...list(
      'Time spent (chat · review · learn)',
      i.usage.slice(0, 8).map(u => ({
        topic: u.topic,
        reason: `${duration(u.chatMs)} in ${u.chats} chat${u.chats === 1 ? '' : 's'} · ${duration(u.reviewMs)} · ${duration(u.learnMs)}`,
      })),
    ),
  ].join('\n')
}

export async function tipsText($: $): Promise<string> {
  const tips = orderedTips(tipContext(await readInsights($)))
  return ['Tips for maxlearn', ...tips.map(t => `• ${t.text}`)].join('\n')
}

export async function saveSettings($: $, change: Partial<StudySettings>) {
  const next = await update($, settings, s => ({ ...s, ...change }))
  await $.store.set('settings', next)
  if (change.insightPace !== undefined) await startInsights($, next.insightPace)
  if (change.autoPeriod !== undefined) await startAuto($, next.autoPeriod)
}

/** Switches tab; each tab starts face down, sub-views and toggles kept. */
export async function setMode($: $, mode: Mode) {
  if (mode === 'learn' && (await read($, lessonNow)) === null) {
    // Entering is free: a card to learn or a queued lesson; writing waits for a press.
    const next = await takeNextLesson($, false)
    if (next !== undefined) await update($, lessonNow, () => next)
  }
  await update($, view, v => ({
    mode,
    isRevealed: false,
    insights: v.insights,
    more: v.more,
    isHelp: v.isHelp,
    tipIndex: v.tipIndex,
  }))
}

export async function setView($: $, change: Partial<View>) {
  await update($, view, v => ({ ...v, ...change }))
}

/** The card the current mode shows: the pinned one, else favored topics first, then the most overdue. */
function currentCard(cards: Card[], v: View, now: number, favored: ReadonlySet<string>): Card | undefined {
  const pinned = cards.find(c => c.id === v.cardId)
  if (pinned) return pinned
  const skipped = new Set(v.skipped ?? [])
  const due = dueCards(cards, now, favored).filter(c => !skipped.has(c.id))
  return v.mode === 'quiz' ? due.find(c => c.choices.length > 0) : due[0]
}

/** The card review or quiz shows now, and the context keys are read in. */
export async function activeCard($: $) {
  const now = await $.clock.now()
  const cards = await read($, deck)
  const v = await read($, view)
  const { favored } = await readInsights($)
  const card = currentCard(cards, v, now, favored)
  const ctx: KeyContext = {
    mode: v.mode,
    isRevealed: v.isRevealed,
    choices: card?.choices.length ?? 0,
    cursor: Math.max(0, Math.min((card?.choices.length ?? 1) - 1, v.cursor ?? 0)),
    hasCard: card !== undefined,
  }
  return { card, v, ctx }
}

/** Runs one action from any input (button, hotkey, ⌨ strip), then moves the ring to what comes next. */
export async function runKey($: $, action: KeyAction, card: Card | undefined) {
  await applyKey($, action, card)
  // A ring move is itself the focus change; refocusing the main button would undo it.
  if (action.type !== 'ring') await focusMain($)
}

/**
 * Puts the pane's focus ring on the button Enter should press now. Only lands
 * while the pane holds the keys; otherwise the engine says no and nothing moves.
 */
export async function focusMain($: $) {
  const { ctx } = await activeCard($)
  const key = mainElement(ctx)
  if (key === undefined) return
  try {
    await $.ui.focus({ requestId: PANE, key })
  } catch {
    // Best effort: the grade or reveal already happened; a failed move must not undo it.
  }
}

/** j/k in the quiz: moves the ▸ cursor and the focus ring together. */
export async function moveCursor($: $, card: Card, step: number) {
  await update($, view, x => ({
    ...x,
    cursor: Math.max(0, Math.min(card.choices.length - 1, (x.cursor ?? 0) + step)),
  }))
  await focusMain($)
}

async function applyKey($: $, action: KeyAction, card: Card | undefined) {
  switch (action.type) {
    case 'tab':
      return setMode($, action.mode)
    case 'help':
      return update($, view, v => ({ ...v, isHelp: !v.isHelp }))
    case 'undo':
      return undoLast($)
    case 'cursor':
      return update($, view, v => ({ ...v, cursor: action.index }))
    case 'ring':
      return moveRing($, action.step)
    case 'next':
      return update($, view, v => ({ ...faceDown(v) }))
  }
  if (card === undefined) return
  switch (action.type) {
    case 'reveal':
      return update($, view, v => ({ ...v, cardId: card.id, isRevealed: true }))
    case 'skip':
      return update($, view, v => ({ ...faceDown(v), skipped: [...(v.skipped ?? []), card.id] }))
    case 'grade':
      return answer($, card, action.grade)
    case 'choose':
      return action.index === card.answer
        ? answer($, card, 'good', '✓ Correct')
        : answer($, card, 'again', `✗ It was: ${card.choices[card.answer]}`)
  }
}

/** The next card face down: the current card's pin, feedback and cursor dropped. */
function faceDown(v: View): View {
  return {
    mode: v.mode,
    isRevealed: false,
    skipped: v.skipped,
    insights: v.insights,
    more: v.more,
    isHelp: v.isHelp,
    tipIndex: v.tipIndex,
  }
}

export async function answer($: $, card: Card, g: Grade, feedback?: string) {
  const now = await $.clock.now()
  const cardsBefore = await read($, deck)
  const before = cardsBefore.find(c => c.id === card.id) ?? card
  const masteryBefore = topicStats(cardsBefore, now).find(s => s.topic === card.topic)?.mastery ?? 0

  const opts = schedOptions(await read($, settings))
  const cards = await saveDeck($, list => list.map(c => (c.id === card.id ? grade(c, g, now, opts) : c)))
  await update($, lastAnswer, () => ({ before, t: now }))
  const event: ReviewEvent = {
    t: now,
    cardId: card.id,
    topic: card.topic,
    grade: g,
    mode: feedback === undefined ? 'review' : 'quiz',
    ms: takeShown(card.id, now),
  }
  const log = await update($, reviews, list => [...list, event].slice(-MAX_REVIEWS))
  await $.store.set('reviews', log)
  await update($, session, s => ({
    reviewed: s.reviewed + 1,
    correct: s.correct + (g === 'again' ? 0 : 1),
    startedAt: s.startedAt || now,
  }))
  await update($, view, v =>
    feedback === undefined ? faceDown(v) : { ...v, cardId: card.id, isRevealed: true, feedback },
  )
  await showStatus($)
  await celebrate($, cards, log, card.topic, masteryBefore, now)
}

/** Toasts for a streak milestone reached today and a topic crossing into mastered. */
async function celebrate($: $, cards: Card[], log: ReviewEvent[], topic: string, before: number, now: number) {
  const after = topicStats(cards, now).find(s => s.topic === topic)?.mastery ?? 0
  if (before < MASTERED && after >= MASTERED) $.ui.toast(`🏆 Topic mastered: ${topic}`)

  const { streakDays } = overview(cards, log, now)
  const shown = ((await $.store.get('milestones')) as string[] | undefined) ?? []
  const key = streakMilestone(streakDays, shown, now)
  if (key !== undefined) {
    await $.store.set('milestones', [...shown, key].slice(-50))
    $.ui.toast(`🔥 ${streakDays}-day streak!`)
  }
}

/** Removes a card for good: for one that is wrong, vague or not worth learning. */
export async function dropCard($: $, card: Card) {
  await saveDeck($, cards => cards.filter(c => c.id !== card.id))
  await update($, view, v => faceDown(v))
  $.ui.toast('🗑 Card removed')
  await focusMain($)
}

/** Takes back the last grade: the card as it was, its log entry and tally gone, shown again. */
export async function undoLast($: $) {
  const last = await read($, lastAnswer)
  if (last === null) {
    $.ui.toast('Nothing to undo')
    return
  }
  const undone = (await read($, reviews)).find(r => r.cardId === last.before.id && r.t === last.t)
  await saveDeck($, cards => cards.map(c => (c.id === last.before.id ? last.before : c)))
  const log = await update($, reviews, list =>
    list.filter(r => !(r.cardId === last.before.id && r.t === last.t)),
  )
  await $.store.set('reviews', log)
  if (undone !== undefined) {
    await update($, session, s => ({
      ...s,
      reviewed: Math.max(0, s.reviewed - 1),
      correct: Math.max(0, s.correct - (undone.grade === 'again' ? 0 : 1)),
    }))
  }
  await update($, lastAnswer, () => null)
  await update($, view, v => ({ ...faceDown(v), cardId: last.before.id }))
  await showStatus($)
  $.ui.toast('Undid the last grade')
}

// ── Views ──────────────────────────────────────────────────────────────────

/** What every drawing function needs: the surface's elements and how much room there is. */
export type Draw = {
  // The surface's element table; its exact type differs per surface.
  ui: any
  surface: RenderSurface
  density: Density
  width: number
}

const isRoomy = (d: Draw) => d.density === 'roomy'

/** A titled block: a rounded frame with room to spare, a plain heading without. */
function section(d: Draw, key: string, title: string, children: unknown) {
  const { Box, Text } = d.ui
  return isRoomy(d) ? (
    <Box key={key} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} gap={1}>
      <Text bold color="cyan">
        {title}
      </Text>
      {children}
    </Box>
  ) : (
    <Box key={key} flexDirection="column" gap={1}>
      <Text bold color="cyan">
        {title}
      </Text>
      {children}
    </Box>
  )
}

function subTabs<T extends string>($: $, d: Draw, prefix: string, names: T[], current: T, pick: (name: T) => Partial<View>) {
  const { Box, Button } = d.ui
  return (
    <Box gap={1} flexWrap="wrap">
      {names.map(name => (
        <Button
          key={`${prefix}-${name}`}
          label={name === current ? `•${name}` : name}
          plain
          dimColor={name !== current}
          onPress={() => setView($, pick(name))}
        />
      ))}
    </Box>
  )
}

// 1-4 grade at once; i j k l move the highlight across these, as arrows would
// (bare arrows belong to the prompt's keybindings), and enter grades.
const GRADES: [Grade, string][] = [
  ['again', '1'],
  ['hard', '2'],
  ['good', '3'],
  ['easy', '4'],
]
const GRADE_KEYS = GRADES.map(([g]) => `grade-${g}`)

/** The card's frame: the one bordered thing at the top of the study tabs. */
function cardFrame(d: Draw, key: string, children: unknown) {
  const { Box } = d.ui
  return (
    <Box key={key} flexDirection="column" borderStyle="round" paddingX={1} gap={1}>
      {children}
    </Box>
  )
}

/** The card and its main actions; every key binding lives in the footer. */
function ReviewCard($: $, d: Draw, card: Card, v: View, now: number, opts: SchedOptions) {
  const { Box, Text, Button } = d.ui
  return cardFrame(
    d,
    'card',
    <Box flexDirection="column" gap={1}>
      <Text dimColor>
        {card.topic} · {card.source}
      </Text>
      <Text bold wrap="wrap">
        {card.front}
      </Text>
      {v.isRevealed ? (
        <Box flexDirection="column" gap={1}>
          <Text wrap="wrap">{card.back}</Text>
          <Box gap={1} flexWrap="wrap">
            {GRADES.map(([g, key]) => {
              const wait = shortWait(previewInterval(card, g, now, opts))
              return (
                <Button
                  key={`grade-${g}`}
                  label={isRoomy(d) ? `${g} · ${wait}` : `${g} ${wait}`}
                  hotkey={key}
                  autoFocus={g === 'good' ? true : undefined}
                  onPress={() => runKey($, { type: 'grade', grade: g }, card)}
                />
              )
            })}
          </Box>
        </Box>
      ) : (
        <Button
          key="reveal"
          label="Show answer"
          hotkey="s"
          variant="primary"
          autoFocus
          onPress={() => runKey($, { type: 'reveal' }, card)}
        />
      )}
    </Box>,
  )
}

function QuizCard($: $, d: Draw, card: Card, v: View) {
  const { Box, Text, Button } = d.ui
  const letters = ['a', 'b', 'c', 'd']
  const cursor = Math.min(card.choices.length - 1, v.cursor ?? 0)
  return cardFrame(
    d,
    'card',
    <Box flexDirection="column" gap={1}>
      <Text dimColor>{card.topic} · quiz</Text>
      <Text bold wrap="wrap">
        {card.front}
      </Text>
      {v.isRevealed ? (
        <Box flexDirection="column" gap={1}>
          <Text wrap="wrap">{v.feedback}</Text>
          <Text dimColor wrap="wrap">
            {card.back}
          </Text>
          <Button key="next" label="Next" hotkey="l" variant="primary" autoFocus onPress={() => runKey($, { type: 'next' }, card)} />
        </Box>
      ) : (
        <Box flexDirection="column">
          {card.choices.map((choice, i) => (
            <Button
              key={`choice-${i}`}
              label={`${i === cursor ? '▸' : ' '} ${choice}`}
              hotkey={letters[i]}
              plain
              autoFocus={i === cursor ? true : undefined}
              onPress={() => runKey($, { type: 'choose', index: i }, card)}
            />
          ))}
        </Box>
      )}
    </Box>,
  )
}

/** The scheduler the settings ask for. */
function schedOptions(s: StudySettings): SchedOptions {
  return { algorithm: s.algorithm, retention: Number(s.retention) }
}

async function closePane($: $) {
  await $.ui.close({ id: PANE })
}

// The ring outside the card tabs: what this draw made focusable, in order, and
// where the ring is now (kept by the ui.focus hook). Module state: a reload
// draws again and the next focus move sets it.
let ringOrder: string[] = []
let ringAt: string | undefined

/** i j k l outside the card tabs: walk the highlight back or forward, as the arrows would. */
async function moveRing($: $, step: -1 | 1) {
  // On the grades, an unfocused walk starts from good, the button focus starts on.
  const from = ringAt !== undefined && ringOrder.includes(ringAt) ? ringAt : ringOrder === GRADE_KEYS ? 'grade-good' : undefined
  const target = ringStep(ringOrder, from, step)
  if (target === undefined) return
  try {
    await $.ui.focus({ requestId: PANE, key: target })
    ringAt = target
  } catch {
    // The pane does not hold the keys; nothing to move.
  }
}

/**
 * Every key binding, in one grey block at the bottom: the hint, the actions
 * that are only keys (skip, drop, quiz moves, undo, the key list, close), the
 * tabs and the due count. A hotkey lives on a drawn Button, so these stay
 * Buttons; plain and dim, they read as text.
 */
function Footer($: $, d: Draw, v: View, ctx: KeyContext, card: Card | undefined, due: number, busy: Generating | null, toLearn = 0) {
  const { Box, Text, Button } = d.ui
  const Client = d.surface === 'terminal' || d.surface === 'desktop' ? d.ui.Client : undefined
  const roomy = isRoomy(d)
  const isTerminal = d.surface === 'terminal'
  const key = (k: string, label: string, onPress: () => unknown, extra: Record<string, unknown> = {}) => (
    <Button key={k} label={label} plain dimColor onPress={onPress} {...extra} />
  )
  const isStudy = v.mode === 'review' || v.mode === 'quiz'
  const cursor = Math.min((card?.choices.length ?? 1) - 1, v.cursor ?? 0)

  const actions = []
  if (isStudy && card !== undefined) {
    if (!v.isRevealed) actions.push(key('skip', 'skip', () => runKey($, { type: 'skip' }, card), { hotkey: 'n' }))
    else actions.push(key('drop', 'drop', () => dropCard($, card), { hotkey: 'd' }))
  }
  actions.push(
    key('undo', 'undo', () => undoLast($), { hotkey: 'u' }),
    key('help', 'keys', () => runKey($, { type: 'help' }, card), { hotkey: 'h' }),
    key('close', 'close', () => closePane($), { hotkey: 'x', role: 'dismiss' }),
  )

  // The i j k l map, shaped like the keys. Where the keys only move or pick (other
  // tabs, the quiz) the map's cells are the Buttons that carry them; on a revealed
  // card the grade buttons above own those hotkeys, so the map is text.
  const map = arrowMap(ctx)
  let arrows
  {
    const isQuizPick = v.mode === 'quiz' && !v.isRevealed && card !== undefined
    const isFaceDown = v.mode === 'review' && !v.isRevealed && card !== undefined
    const isGrading = v.mode === 'review' && v.isRevealed && card !== undefined
    const press: Partial<Record<'i' | 'j' | 'k' | 'l', () => unknown>> = !isStudy || card === undefined || isGrading
      ? { i: () => moveRing($, -1), j: () => moveRing($, -1), k: () => moveRing($, 1), l: () => moveRing($, 1) }
      : isFaceDown
        ? { l: () => runKey($, { type: 'reveal' }, card) }
        : isQuizPick
        ? {
            i: () => moveCursor($, card, -1),
            k: () => moveCursor($, card, 1),
            l: () => runKey($, { type: 'choose', index: cursor }, card),
          }
        : {}
    const cell = (k: 'i' | 'j' | 'k' | 'l') => {
      const word = map[k]
      if (word === undefined) return null
      const onPress = press[k]
      const navKey = isFaceDown ? 'show-key' : isStudy && card !== undefined && !isGrading ? `quiz-${{ i: 'up', j: 'left', k: 'down', l: 'choose' }[k]}` : `nav-${{ i: 'up', j: 'left', k: 'down', l: 'right' }[k]}`
      // A plain Button draws `k: label`, so its label is the cell without the key.
      return onPress
        ? key(navKey, arrowCell(k, word).slice(3), onPress, { hotkey: k })
        : <Text key={`map-${k}`} dimColor>{arrowCell(k, word)}</Text>
    }
    const [top] = arrowLines(map)
    const indent = top.length - top.trimStart().length
    arrows = isTerminal ? (
      <Box flexDirection="column">
        <Box marginLeft={indent}>{cell('i')}</Box>
        <Box gap={2}>
          {cell('j')}
          {cell('k')}
          {cell('l')}
        </Box>
      </Box>
    ) : (
      // A proportional font cannot line `i` up over `k`: one row, in arrow order.
      <Box gap={2}>
        {cell('j')}
        {cell('i')}
        {cell('k')}
        {cell('l')}
      </Box>
    )
  }

  const status = `${due} due${toLearn > 0 ? ` · ${toLearn} to learn` : ''}${busy === null ? '' : ` · ⟳ ${busy.label}`}`
  const hint =
    isStudy && Client ? (
      <Client key={KEYS} module="./keys.tsx" props={{ hint: keyHint(ctx) }} />
    ) : (
      <Text dimColor wrap="truncate-end">
        {keyHint(ctx)}
      </Text>
    )
  const tabs = TAB_ORDER.map((mode: Mode) =>
    key(
      `tab-${mode}`,
      mode === v.mode ? `•${TAB_LABELS[d.density][mode]}` : TAB_LABELS[d.density][mode],
      () => setMode($, mode),
      { hotkey: TAB_KEYS[mode] },
    ),
  )
  const help = v.isHelp && (
    <Box flexDirection="column" marginTop={1}>
      {HELP_LINES.map(([keys, what]) => (
        <Text key={`help-${keys}`} dimColor wrap="truncate-end">
          {keys.padEnd(roomy ? 15 : 10)}
          {what}
        </Text>
      ))}
    </Box>
  )

  if (!isTerminal) {
    // Desktop, VS Code, mobile: draw keycaps for hotkeys in a proportional font, so a
    // drawn rule wraps and spaces do not align. One framed block, four short rows.
    return (
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
        <Box justifyContent="space-between">
          <Text dimColor bold>
            Shortcuts
          </Text>
          <Text dimColor>{status}</Text>
        </Box>
        {hint}
        <Box gap={2} flexWrap="wrap">
          {arrows}
          <Box gap={1} flexWrap="wrap">
            {actions}
          </Box>
        </Box>
        <Box gap={1} flexWrap="wrap">
          {tabs}
        </Box>
        {help}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text dimColor>{`── Shortcuts ${'─'.repeat(Math.max(0, d.width - 13))}`}</Text>
      {arrows}
      {isStudy && Client ? (
        <Client key={KEYS} module="./keys.tsx" props={{ hint: keyHint(ctx) }} />
      ) : (
        <Text dimColor wrap="truncate-end">
          {keyHint(ctx)}
        </Text>
      )}
      <Box gap={1} flexWrap="wrap">
        {actions}
      </Box>
      <Box gap={1} flexWrap="wrap">
        {TAB_ORDER.map((mode: Mode) =>
          key(
            `tab-${mode}`,
            mode === v.mode ? `•${TAB_LABELS[d.density][mode]}` : TAB_LABELS[d.density][mode],
            () => setMode($, mode),
            { hotkey: TAB_KEYS[mode] },
          ),
        )}
      </Box>
      <Text dimColor>
        {due} due{toLearn > 0 ? ` · ${toLearn} to learn` : ''}{busy === null ? '' : ` · ⟳ ${busy.label}`}
      </Text>
      {v.isHelp && (
        <Box flexDirection="column" marginTop={1}>
          {HELP_LINES.map(([keys, what]) => (
            <Text key={`help-${keys}`} dimColor wrap="truncate-end">
              {keys.padEnd(roomy ? 15 : 10)}
              {what}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}

/** One dimmed tip and a way to the next; roomy layout only. */
function TipLine($: $, d: Draw, v: View, i: Insights) {
  const { Box, Text, Button } = d.ui
  const tip = tipFor(tipContext(i), v.tipIndex ?? 0)
  return (
    <Box gap={1}>
      <Text dimColor wrap="wrap">
        💡 {tip.text}
      </Text>
      <Button key="tip-next" label="next tip" plain dimColor onPress={() => setView($, { tipIndex: (v.tipIndex ?? 0) + 1 })} />
    </Box>
  )
}

/** The next things to do when no card is due: a weak topic's cards, or cards from chat. */
function NextSteps($: $, d: Draw, i: Insights) {
  const { Box, Button, Text } = d.ui
  const topic = i.improve[0]?.topic ?? i.work.find(w => w.isThin)?.topic ?? i.savedInterests[0]
  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={1} flexWrap="wrap">
        {topic !== undefined && (
          <Button key="next-topic" label={`+3 ${topic}`} variant="primary" onPress={() => generate($, topic, () => fromInterest($, topic))} />
        )}
        <Button key="next-chat" label="cards from chat" onPress={() => generate($, 'this chat', () => fromChat($))} />
      </Box>
      {i.savedInterests.length === 0 && (
        <Text dimColor wrap="wrap">
          Add an interest: /study &lt;topic&gt;
        </Text>
      )}
    </Box>
  )
}

/** The learn tab: one lesson to read before its cards are tested. */
function LearnTab($: $, d: Draw, id: string | null, lesson: Lesson | undefined, waiting: number, busy: Generating | null) {
  const { Box, Text, Button } = d.ui
  if (id === PENDING || (id === null && busy?.noun === 'lesson')) {
    return cardFrame(
      d,
      'lesson',
      <Box flexDirection="column" gap={1}>
        <Text bold>⟳ Writing {LESSONS_PER_CALL} lessons…</Text>
        <Text dimColor wrap="wrap">
          One model call writes two: one for now, one for your next Next.
        </Text>
      </Box>,
    )
  }
  if (lesson === undefined) {
    return cardFrame(
      d,
      'lesson',
      <Box flexDirection="column" gap={1}>
        <Text bold>Nothing new to learn 🎉</Text>
        <Text dimColor wrap="wrap">
          Every card has been taught. Get new lessons on your weakest topics and interests.
        </Text>
        <Button key="learn-write" label={`Get ${LESSONS_PER_CALL} lessons`} variant="primary" autoFocus onPress={() => nextOnLearnTab($, false)} />
      </Box>,
    )
  }
  const isCard = lesson.cards.length === 0
  const joins = isCard
    ? 'Press Next to add this card to your review. Skip keeps it here for later.'
    : `Press Next to add ${lesson.cards.length} card${lesson.cards.length === 1 ? '' : 's'} to your review. Skip drops this lesson.`
  return (
    <Box flexDirection="column" gap={1}>
      {cardFrame(
        d,
        'lesson',
        <Box flexDirection="column" gap={1}>
          <Text dimColor>
            📖 {lesson.topic} · {isCard ? 'new card' : 'lesson'}
          </Text>
          <Text bold wrap="wrap">
            {lesson.title}
          </Text>
          <Text wrap="wrap">{lesson.body}</Text>
          {lesson.example !== undefined && (
            <Text dimColor wrap="wrap">
              e.g. {lesson.example}
            </Text>
          )}
          <Text dimColor wrap="wrap">
            {joins}
          </Text>
          <Box gap={1}>
            <Button key="learn-next" label="Next" variant="primary" autoFocus onPress={() => nextOnLearnTab($, true)} />
            <Button key="learn-skip" label="Skip" hotkey="n" onPress={() => nextOnLearnTab($, false)} />
            <Button
              key="learn-simplify"
              label={busy?.lessonId === lesson.id ? '⟳ Simplifying…' : 'Simplify'}
              hotkey="z"
              dimColor
              onPress={() => (busy?.lessonId === lesson.id ? undefined : simplify($, lesson.id))}
            />
          </Box>
        </Box>,
      )}
      {waiting > 0 && (
        <Text dimColor>
          {waiting} lesson{waiting === 1 ? '' : 's'} ready, no wait on the next one.
        </Text>
      )}
    </Box>
  )
}

/** The review and quiz tabs: the card in its frame, or what to do now that none is due. */
export function StudyTab($: $, d: Draw, v: View, card: Card | undefined, i: Insights, cards: Card[], tally: SessionTally) {
  const { Box, Text, Button } = d.ui
  if (card !== undefined) {
    return (
      <Box flexDirection="column" gap={1}>
        {v.mode === 'quiz' ? QuizCard($, d, card, v) : ReviewCard($, d, card, v, i.now, schedOptions(i.settings))}
        {isRoomy(d) && TipLine($, d, v, i)}
      </Box>
    )
  }
  const nextDue = cards.reduce((min, c) => Math.min(min, c.due), Infinity)
  const nextLine = Number.isFinite(nextDue) ? `Next card in ${shortWait(nextDue - i.now)}.` : ''
  const isDone = tally.reviewed > 0
  const toLearn = cards.filter(isToLearn).length
  return cardFrame(
    d,
    'card',
    <Box flexDirection="column" gap={1}>
      <Text bold>{isDone ? 'Session done 🎉' : cards.length === 0 ? 'No cards yet.' : 'Nothing due 🎉'}</Text>
      {toLearn > 0 && (
        <Button
          key="go-learn"
          label={`Learn ${toLearn} new card${toLearn === 1 ? '' : 's'} first`}
          variant="primary"
          autoFocus
          onPress={() => setMode($, 'learn')}
        />
      )}
      {isDone && <Text>{sessionSummary(tally, i.overview)}</Text>}
      {nextLine !== '' && <Text dimColor>{nextLine}</Text>}
      {NextSteps($, d, i)}
    </Box>,
  )
}

// GitHub's green ramp: empty day, then four levels.
const HEAT_RAMP = [0x30363d, 0x0e4429, 0x006d32, 0x26a641, 0x39d353]
const TERMINAL_DEFAULT = 0x01000000
const HEAT_CHARS = '·░▒▓█'

/** The last 12 weeks of reviews: a Raster on the terminal, a text grid elsewhere. */
function Heatmap(d: Draw, i: Insights) {
  const { Box, Text } = d.ui
  const grid = heatmap(i.log, i.now)
  const max = Math.max(0, ...grid.flat())
  const weeks = grid[0]?.length ?? 0
  const labels = ['M', '', 'W', '', 'F', '', '']

  let cells
  if (d.surface === 'terminal' && d.ui.Raster) {
    const Raster = d.ui.Raster
    const columns = weeks * 2 - 1
    const words = new Uint32Array(columns * 7 * 3)
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < columns; col++) {
        const at = (row * columns + col) * 3
        const count = col % 2 === 0 ? (grid[row]?.[col / 2] ?? -1) : -1
        words[at] = count < 0 ? 0x20 : 0x2588
        words[at + 1] = count < 0 ? TERMINAL_DEFAULT : (HEAT_RAMP[heatLevel(count, max)] ?? TERMINAL_DEFAULT)
        words[at + 2] = TERMINAL_DEFAULT
      }
    }
    const bytes = new Uint8Array(words.buffer)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    cells = <Raster key="heatmap" columns={columns} rows={7} cells={btoa(binary)} />
  } else {
    cells = (
      <Box key="heatmap" flexDirection="column">
        {grid.map((row, r) => (
          <Text key={`heat-${r}`} color="green">
            {row.map(count => (count < 0 ? ' ' : HEAT_CHARS[heatLevel(count, max)])).join(' ')}
          </Text>
        ))}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Box flexDirection="column">
          {labels.map((l, r) => (
            <Text key={`heat-label-${r}`} dimColor>
              {l || ' '}
            </Text>
          ))}
        </Box>
        {cells}
      </Box>
      <Text dimColor>
        {weeks} weeks · less {HEAT_CHARS} more
      </Text>
    </Box>
  )
}

function masteryBar(d: Draw, mastery: number) {
  const { Text } = d.ui
  const { filled, empty } = bar(mastery, isRoomy(d) ? 10 : 6)
  return (
    <Text>
      <Text color={masteryColor(mastery)}>{filled}</Text>
      <Text dimColor>{empty}</Text> {pct(mastery)}
    </Text>
  )
}

function topicRow(d: Draw, i: Insights, r: { topic: string; mastery: number; reason: string }, key: string) {
  const { Box, Text } = d.ui
  return (
    <Box key={key} flexDirection="column">
      <Text bold wrap="truncate-end">
        {i.favored.has(r.topic) ? '★ ' : ''}
        {r.topic}
      </Text>
      {masteryBar(d, r.mastery)}
      <Text dimColor>{r.reason}</Text>
    </Box>
  )
}

/** Three numbers side by side with room, one per row without. */
function StatTiles(d: Draw, tiles: [string, string][]) {
  const { Box, Text } = d.ui
  if (!isRoomy(d)) {
    return (
      <Box flexDirection="column">
        {tiles.map(([value, label]) => (
          <Text key={`tile-${label}`}>
            <Text bold>{value}</Text> <Text dimColor>{label}</Text>
          </Text>
        ))}
      </Box>
    )
  }
  return (
    <Box gap={1}>
      {tiles.map(([value, label]) => (
        <Box key={`tile-${label}`} flexDirection="column" flexGrow={1} borderStyle="round" borderDimColor paddingX={1}>
          <Text bold>{value}</Text>
          <Text dimColor wrap="truncate-end">
            {label}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

export function InsightsTab($: $, d: Draw, v: View, i: Insights) {
  const { Box, Text, Button } = d.ui
  const sub = v.insights ?? 'overview'
  const tabs = (
    <Box gap={1} flexWrap="wrap">
      {subTabs($, d, 'ins', ['overview', 'topics', 'work', 'chats'], sub, name => ({ insights: name }))}
      <Button key="ins-focus" label={`focus: ${focusLabel(i.focus)}`} plain dimColor onPress={() => setMode($, 'settings')} />
    </Box>
  )

  let content
  if (sub === 'overview') {
    const o = i.overview
    content =
      o.totalCards === 0 ? (
        <Box flexDirection="column" gap={1}>
          {i.busy !== null && <Text>⟳ Writing {i.busy.noun ?? 'card'}s {writingWhat(i.busy.label)}…</Text>}
          <Text>
            Interests: {i.savedInterests.length === 0 ? <Text dimColor>none yet</Text> : i.savedInterests.join(', ')}
          </Text>
          <Text dimColor wrap="wrap">
            Trends show up once you learn and review a few cards.
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" gap={1}>
          {StatTiles(d, [
            [`🔥 ${o.streakDays}d`, 'streak'],
            [pct(o.retention30d), 'recall 30d'],
            [`${o.matureCards}/${o.totalCards}`, 'mature'],
          ])}
          <Text>
            {o.reviewsToday} today · {o.dueNow} due
          </Text>
          {isRoomy(d) ? (
            Heatmap(d, i)
          ) : (
            <Text>
              <Text color="green">{sparkline(o.reviews7d)}</Text>
              <Text dimColor> 7 days</Text>
            </Text>
          )}
        </Box>
      )
  } else if (sub === 'topics') {
    content = (
      <Box flexDirection="column" gap={1}>
        {section(
          d,
          'improve',
          'Improve',
          i.improve.length === 0 ? (
            <Text dimColor wrap="wrap">
              Nothing weak with 2+ cards. 🎉
            </Text>
          ) : (
            i.improve.map(r => topicRow(d, i, r, `improve-${r.topic}`))
          ),
        )}
        {section(
          d,
          'strong',
          'Strong',
          i.strong.length === 0 ? (
            <Text dimColor wrap="wrap">
              None yet: 3+ cards, 60% mastery, 80% recall.
            </Text>
          ) : (
            i.strong.map(r => topicRow(d, i, r, `strong-${r.topic}`))
          ),
        )}
        {section(
          d,
          'interests',
          'Interests',
          i.interests.length === 0 ? (
            <Text dimColor>None yet. /study &lt;topic&gt;</Text>
          ) : (
            i.interests.map(r => (
              <Text key={`interest-${r.topic}`} wrap="truncate-end">
                {r.topic} <Text dimColor>{r.reason}</Text>
              </Text>
            ))
          ),
        )}
        {section(
          d,
          'time',
          'Time spent',
          i.usage.length === 0 ? (
            <Text dimColor wrap="wrap">
              Time shows up after a few chat turns or reviews.
            </Text>
          ) : (
            i.usage.slice(0, 8).map(u => (
              <Box key={`time-${u.topic}`} flexDirection="column">
                <Text bold wrap="truncate-end">
                  {u.topic} <Text dimColor>{duration(u.chatMs + u.reviewMs + u.learnMs)}</Text>
                </Text>
                <Text dimColor wrap="truncate-end">
                  chat {duration(u.chatMs)} ({u.chats}) · review {duration(u.reviewMs)} · learn {duration(u.learnMs)}
                </Text>
              </Box>
            ))
          ),
        )}
      </Box>
    )
  } else if (sub === 'chats') {
    content =
      i.chats.length === 0 ? (
        <Text dimColor wrap="wrap">
          Chats show up here once a few turns have topics.
        </Text>
      ) : (
        section(
          d,
          'chats',
          'Recent chats',
          <Box flexDirection="column" gap={1}>
            {i.chats.slice(0, 10).map(c => {
              const topics = Object.entries(c.topics).sort(([, a], [, b]) => b - a)
              const total = topics.reduce((n, [, ms]) => n + ms, 0)
              return (
                <Box key={`chat-${c.id}`} flexDirection="column">
                  <Text wrap="truncate-end">
                    <Text bold>{c.label}</Text> <Text dimColor>{duration(total)}</Text>
                  </Text>
                  <Text dimColor wrap="wrap">
                    {topics.map(([t, ms]) => `${t} ${duration(ms)}`).join(' · ')}
                  </Text>
                </Box>
              )
            })}
          </Box>,
        )
      )
  } else {
    content =
      i.work.length === 0 ? (
        <Text dimColor wrap="wrap">
          Chat a few turns; topics appear here.
        </Text>
      ) : (
        section(
          d,
          'work',
          'Last 7 days of chat',
          <Box flexDirection="column" gap={1}>
            {i.work.map(w => (
              <Box key={`work-${w.topic}`} flexDirection="column">
                <Text wrap="truncate-end">
                  <Text bold>{w.topic}</Text> <Text color="yellow">{dots(w.chatDays7)}</Text> {w.chatDays7}d
                </Text>
                <Box gap={1}>
                  <Text dimColor>
                    {w.cards} card{w.cards === 1 ? '' : 's'} · {w.due} due{w.isThin ? ' · thin' : ''}
                  </Text>
                  {w.isThin && i.favored.has(w.topic) && (
                    <Button
                      key={`work-more-${w.topic}`}
                      label="+3 cards"
                      dimColor
                      onPress={() => generate($, w.topic, () => fromInterest($, w.topic))}
                    />
                  )}
                </Box>
              </Box>
            ))}
            <Text dimColor wrap="wrap">
              {i.focus === 'interests'
                ? 'Focus is on interests: work topics are not reviewed first.'
                : 'Due work cards are reviewed first.'}
            </Text>
          </Box>,
        )
      )
  }

  return (
    <Box flexDirection="column" gap={1}>
      {tabs}
      {content}
    </Box>
  )
}

export function SettingsTab($: $, d: Draw, s: StudySettings) {
  const { Box, Text, Button } = d.ui
  // A row of option buttons, not a Select: a focused Select keeps letter keys for
  // itself, so the tab keys (r q p m o) and i j k l would stop working here.
  const picker = (
    key: string,
    label: string,
    value: string,
    options: { value: string; label: string }[],
    onPick: (value: string) => void,
  ) =>
    (
      <Box flexDirection="column">
        <Text>{label}</Text>
        <Box gap={1} flexWrap="wrap">
          {options.map(o => (
            <Button
              key={`${key}-${o.value}`}
              label={o.value === value ? `•${o.label}` : o.label}
              plain
              dimColor={o.value !== value}
              onPress={() => onPick(o.value)}
            />
          ))}
        </Box>
      </Box>
    )

  return (
    <Box flexDirection="column" gap={1}>
      {section(
        d,
        'models',
        'Models',
        <Box flexDirection="column" gap={1}>
          {picker('chat-model', 'Chat cards: ', s.chatModel, CHAT_MODELS, value =>
            saveSettings($, { chatModel: value as ChatModel }),
          )}
          <Text dimColor wrap="wrap">
            {s.chatModel === 'session'
              ? 'Forks this session and reuses its prompt cache.'
              : 'Sends the most recent chat to this model, without the cache.'}
          </Text>
          {picker('interest-model', 'Interest cards: ', s.interestModel, INTEREST_MODELS, value =>
            saveSettings($, { interestModel: value as InterestModel }),
          )}
        </Box>,
      )}
      {section(
        d,
        'focus-section',
        'Focus',
        <Box flexDirection="column" gap={1}>
          {picker('focus', 'Focus: ', s.focus, FOCUS_OPTIONS, value => saveSettings($, { focus: value as Focus }))}
          <Text dimColor wrap="wrap">
            {s.focus === 'work'
              ? 'Skills from your daily chat come first in review, improve and suggestions.'
              : s.focus === 'interests'
                ? 'Your saved interests come first in review, improve and suggestions.'
                : 'Daily-work topics and saved interests both come first.'}
          </Text>
        </Box>,
      )}
      {section(
        d,
        'scheduler-section',
        'Scheduler',
        <Box flexDirection="column" gap={1}>
          {picker('algorithm', 'Algorithm: ', s.algorithm, ALGORITHMS, value =>
            saveSettings($, { algorithm: value as Algorithm }),
          )}
          {s.algorithm === 'fsrs' &&
            picker('retention', 'Target recall: ', s.retention, RETENTIONS, value =>
              saveSettings($, { retention: value as Retention }),
            )}
          <Text dimColor wrap="wrap">
            {s.algorithm === 'fsrs'
              ? 'FSRS models each card\'s memory and plans the review for when recall drops to your target. Higher targets mean more reviews.'
              : 'SM-2: the classic rule. Each good grade multiplies the interval by the card\'s ease.'}
          </Text>
        </Box>,
      )}
      {section(
        d,
        'auto-section',
        'Auto cards',
        <Box flexDirection="column" gap={1}>
          {picker('auto-period', 'Each interest every: ', s.autoPeriod, AUTO_PERIODS, value =>
            saveSettings($, { autoPeriod: value as AutoPeriod }),
          )}
          {picker('auto-chat', 'When chat touches an interest: ', s.autoOnChat, ON_OFF, value =>
            saveSettings($, { autoOnChat: value as 'on' | 'off' }),
          )}
          {picker('chat-cards', `Cards from chat every ${CHAT_EVERY_TURNS} turns: `, s.chatCards, ON_OFF, value =>
            saveSettings($, { chatCards: value as 'on' | 'off' }),
          )}
          <Text dimColor wrap="wrap">
            3 new cards per interest each period, one interest at a time. From chat, at most once every 4h per interest.
          </Text>
        </Box>,
      )}
      {section(
        d,
        'status-section',
        'Status line',
        <Box flexDirection="column" gap={1}>
          {picker('insight-pace', 'Takeaways: ', s.insightPace, INSIGHT_PACES, value =>
            saveSettings($, { insightPace: value as InsightPace }),
          )}
          <Text dimColor wrap="wrap">
            Shows one line from a card you already reviewed and that is not due, so it never gives away a recall test.
          </Text>
        </Box>,
      )}
    </Box>
  )
}

export function MoreTab($: $, d: Draw, v: View, i: Insights) {
  const { Box, Text, Button } = d.ui
  const sub = v.more ?? 'actions'
  let content
  if (sub === 'tips') {
    content = section(
      d,
      'tips',
      'Tips',
      <Box flexDirection="column" gap={1}>
        {orderedTips(tipContext(i)).map(t => (
          <Text key={`tip-${t.id}`} wrap="wrap">
            • {t.text}
          </Text>
        ))}
      </Box>,
    )
  } else {
    content = (
      <Box flexDirection="column" gap={1}>
        {section(
          d,
          'interests-actions',
          'Interests',
          <Box flexDirection="column" gap={1}>
            {i.savedInterests.length === 0 && <Text dimColor>None yet.</Text>}
            <Box gap={1} flexWrap="wrap">
              {i.savedInterests.map(topic => (
                <Button key={`more-${topic}`} label={`+3 ${topic}`} dimColor onPress={() => generate($, topic, () => fromInterest($, topic))} />
              ))}
            </Box>
            {d.ui.Input ? (
              <d.ui.Input
                key="add-interest"
                label="+ "
                placeholder="add an interest, e.g. kafka"
                submitLabel="add"
                onSubmit={(value: string) => addInterest($, value)}
              />
            ) : (
              <Text dimColor wrap="wrap">
                Add one with /study &lt;topic&gt;.
              </Text>
            )}
          </Box>,
        )}
        {section(
          d,
          'chat-actions',
          'From chat',
          <Box flexDirection="column" gap={1}>
            <Button key="from-chat" label="Cards from this chat" variant="primary" onPress={() => generate($, 'this chat', () => fromChat($))} />
            <Text dimColor wrap="wrap">
              Runs every 3 turns by itself.
            </Text>
          </Box>,
        )}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" gap={1}>
      {subTabs($, d, 'more', ['actions', 'tips'], sub, name => ({ more: name }))}
      {content}
    </Box>
  )
}

// ── Hooks ──────────────────────────────────────────────────────────────────

/** Words `/study` takes as commands; anything else is a topic to learn. */
const STATS_WORDS = new Set(['stats', 'stat', 'statistics', 'progress'])

export const register: Register = on => {
  let turns = 0

  on('session.start', async ($, e, next) => {
    // Older decks hold topics as the model spelled them; give each one name.
    const savedDeck = ((await $.store.get('deck')) as Card[] | undefined) ?? []
    await update($, deck, () => savedDeck.map(c => ({ ...c, topic: normTopic(c.topic) })))
    const savedInterests = ((await $.store.get('interests')) as string[] | undefined) ?? []
    await update($, interests, () => [...new Set(savedInterests.map(normTopic))])
    const savedReviews = ((await $.store.get('reviews')) as ReviewEvent[] | undefined) ?? []
    await update($, reviews, () => savedReviews)
    const savedChats = ((await $.store.get('chatSessions')) as ChatSession[] | undefined) ?? []
    await update($, chatSessions, () => savedChats)
    const savedLearnTime = ((await $.store.get('learnTime')) as Record<string, number> | undefined) ?? {}
    await update($, learnTime, () => savedLearnTime)
    const savedLessons = ((await $.store.get('lessons')) as Lesson[] | undefined) ?? []
    await update($, lessons, () => savedLessons)
    const savedQueue = ((await $.store.get('lessonQueue')) as string[] | undefined) ?? []
    await update($, lessonQueue, () => savedQueue.filter(id => savedLessons.some(l => l.id === id)))
    // Writing that was in flight died with the last load: nothing is pending now.
    await update($, lessonNow, id => (id === 'pending' ? null : (id ?? null)))
    await update($, chatRuns, runs => Object.fromEntries(Object.entries(runs ?? {}).filter(([, id]) => id !== 'pending')))
    const savedChat = ((await $.store.get('chatTopics')) as ChatTopics | undefined) ?? {}
    await update($, chatTopics, () => savedChat)
    const savedSettings = (await $.store.get('settings')) as Partial<StudySettings> | undefined
    await update($, settings, () => ({ ...DEFAULT_SETTINGS, ...savedSettings }))
    await update($, session, s => (s.startedAt === 0 ? { ...s, startedAt: Date.now() } : s))
    // A reload mid-generation dropped its timer and its work; do not show it spinning forever.
    await update($, generating, () => null)
    // The diagnostics trace is gone; drop what it left behind.
    await $.store.delete('trace')
    await showStatus($)

    await $.command.register({
      name: 'study',
      description: 'maxlearn: open the flashcard pane, or add an interest to learn',
      argumentHint: '[topic | learn | review | quiz | chat | stats | tips]',
    })
    void $.ui.open({ id: PANE, title: TITLE, closeOnEscape: true })
    await startInsights($, (await read($, settings)).insightPace)
    await startAuto($, (await read($, settings)).autoPeriod)

    return next(e)
  })

  on('command.run', { command: 'study' }, async ($, e) => {
    const arg = e.args.trim()
    const word = arg.toLowerCase()

    if (word === 'chat') {
      generate($, 'this chat', () => fromChat($))
      await $.ui.open({ id: PANE, title: TITLE, closeOnEscape: true })
      return { text: 'Looking for concepts in this conversation…' }
    }

    if (word === 'review' || word === 'quiz') {
      await setMode($, word)
      await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
      const { ctx } = await activeCard($)
      const key = mainElement(ctx)
      const moved =
        key === undefined
          ? { deny: 'nothing due' }
          : await $.ui.focus({ requestId: PANE, key }).catch(() => ({ deny: 'no site' }))
      return {
        text:
          'deny' in moved && moved.deny !== undefined
            ? 'maxlearn opened. Press ctrl+x tab to give it the keys.'
            : 'The pane has the keys: s reveals, j l move across the grades, enter or 1-4 grades, h lists every key, esc closes the pane.',
      }
    }

    if (word === 'learn' || word === 'lesson') {
      // Each run is a numbered row; its lesson lives in chatRuns so Next can swap it in place.
      const run = String(Math.max(0, ...Object.keys(await read($, chatRuns)).map(Number)) + 1)
      const id = (await takeNextLesson($, true)) ?? PENDING
      await update($, chatRuns, runs => ({ ...runs, [run]: id }))
      const lesson = id === PENDING ? undefined : findLesson(id, await read($, deck), await read($, lessons))
      return {
        text: `📖 Lesson #${run}\n\n${lesson ? lessonMarkdown(lesson) : `Writing ${LESSONS_PER_CALL} lessons…`}`,
      }
    }

    if (STATS_WORDS.has(word)) return { text: await statsText($) }
    if (word === 'tips' || word === 'help') return { text: await tipsText($) }

    if (arg !== '') {
      const topic = await addInterest($, arg)
      await $.ui.open({ id: PANE, title: TITLE, closeOnEscape: true })
      if (topic === undefined) return { text: 'Name a topic: /study <topic>' }
      return { text: `Added "${topic}" to your interests. Writing ${LESSONS_PER_CALL} lessons on it now; the learn tab shows them as they land.` }
    }

    await $.ui.open({ id: PANE, title: TITLE, closeOnEscape: true })
    return { text: 'maxlearn opened.' }
  })

  // Keep the pane's ring off the engine's own stops, so a key that walks the
  // ring never hands the keys back by accident; esc closes the pane, as does x.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person' && e.element === undefined) return {}
    const choice = /^choice-(\d)$/.exec(e.element ?? '')
    if (choice) await update($, view, v => ({ ...v, cursor: Number(choice[1]) }))
    const moved = await next(e)
    if (!('deny' in moved && moved.deny !== undefined)) ringAt = e.element
    return moved
  })

  // Keys from the ⌨ strip once it is clicked.
  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE || e.element !== KEYS) return next(e)
    const data = e.data as { key?: unknown; shift?: boolean; ctrl?: boolean; meta?: boolean }
    if (typeof data.key !== 'string') return {}
    const { card, ctx } = await activeCard($)
    const action = keyAction({ ...data, key: data.key }, ctx)
    if (action !== undefined) await runKey($, action, card)
    return {}
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && !e.isAborted) {
      pendingChatMs += e.durationMs
      turns += 1
      if (turns % CHAT_EVERY_TURNS === 0 && (await read($, settings)).chatCards !== 'off') {
        generate($, 'this chat', () => autoChatCheck($), true)
      }
    }
    return result
  })

  // `/study learn` rows: the lesson in a frame with Next, which swaps the next one in place.
  on('ui.render', { component: 'CommandOutput', props: { command: 'study' } }, async ($, e, next) => {
    const run = /^📖 Lesson #(\d+)/.exec(e.props.text)?.[1]
    if (run === undefined) return next(e)
    const id = (await read($, chatRuns))[run]
    if (id === undefined) return next(e) // a row from before a reload: its text says it all
    const { Box, Text, Button } = $.ui.resolve(e)
    const lesson = id === PENDING ? undefined : findLesson(id, await read($, deck), await read($, lessons))
    const busy = await read($, generating)
    const onNext = async () => {
      await markLearned($, id)
      await update($, chatRuns, r => ({ ...r, [run]: PENDING }))
      const nextId = (await takeNextLesson($, true)) ?? PENDING
      // Writing fills this row when the lessons arrive; a free lesson fills it now.
      if (nextId !== PENDING) await update($, chatRuns, r => ({ ...r, [run]: nextId }))
    }
    if (lesson === undefined) {
      return (
        <Box borderStyle="round" borderDimColor paddingX={1}>
          <Text dimColor>⟳ Writing {LESSONS_PER_CALL} lessons… one for now, one for your next Next.</Text>
        </Box>
      )
    }
    markShown(lesson.id, await $.clock.now())
    const isCard = lesson.cards.length === 0
    return (
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} gap={1}>
        <Text dimColor>
          📖 {lesson.topic} · {isCard ? 'new card' : 'lesson'}
        </Text>
        <Text bold wrap="wrap">
          {lesson.title}
        </Text>
        <Text wrap="wrap">{lesson.body}</Text>
        {lesson.example !== undefined && (
          <Text dimColor wrap="wrap">
            e.g. {lesson.example}
          </Text>
        )}
        <Box gap={1}>
          <Button key={`chat-next-${run}`} label="Next" variant="primary" onPress={onNext} />
          <Button
            key={`chat-simplify-${run}`}
            label={busy?.lessonId === lesson.id ? '⟳ Simplifying…' : 'Simplify'}
            onPress={() => (busy?.lessonId === lesson.id ? undefined : simplify($, lesson.id))}
          />
          <Text dimColor>
            {isCard ? 'Next adds this card to your review.' : `Next adds ${lesson.cards.length} card${lesson.cards.length === 1 ? '' : 's'} to your review.`}
          </Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const columns = e.props.bodyColumns ?? 40
    const d: Draw = {
      ui: $.ui.resolve(e),
      surface: e.surface,
      density: density(columns),
      width: Math.max(20, columns - 2),
    }
    const { Box } = d.ui
    const v = await read($, view)
    const i = await readInsights($)
    const { card, ctx } = await activeCard($)

    const cards = await read($, deck)
    let body
    if (v.mode === 'learn') {
      const id = await read($, lessonNow)
      const lesson = id === null || id === PENDING ? undefined : findLesson(id, cards, await read($, lessons))
      if (lesson !== undefined) markShown(lesson.id, await $.clock.now())
      body = LearnTab($, d, id, lesson, (await read($, lessonQueue)).length, await read($, generating))
    } else if (v.mode === 'progress') {
      body = InsightsTab($, d, v, i)
    } else if (v.mode === 'settings') {
      body = SettingsTab($, d, await read($, settings))
    } else if (v.mode === 'add') {
      body = MoreTab($, d, v, i)
    } else {
      if (card !== undefined) markShown(card.id, await $.clock.now())
      body = StudyTab($, d, v, card, i, cards, await read($, session))
    }

    // Where i j k l walk the highlight: other tabs, and a study tab with nothing due.
    ringOrder =
      v.mode === 'review' && v.isRevealed && card !== undefined
        ? GRADE_KEYS
        : (v.mode === 'review' || v.mode === 'quiz') && card !== undefined
          ? []
          : focusOrder(body)

    // Content on top, the grey footer pinned to the bottom of the pane: the box is
    // at least as tall as the rows the pane shows, and space-between pushes the
    // footer down. Taller content grows the box and the pane scrolls as before.
    // On the study tabs the card sits in the middle: two empty boxes above and
    // below share the free rows, and shrink to nothing when the content is taller.
    const rows = e.props.scroll?.bodyRows ?? 0
    const isCentered = v.mode === 'learn' || v.mode === 'review' || v.mode === 'quiz'
    return (
      <Box flexDirection="column" minHeight={rows} width={d.width}>
        {isCentered && <Box key="space-above" flexGrow={1} />}
        <Box flexDirection="column" gap={1} flexShrink={0}>
          {body}
        </Box>
        <Box key="space-below" flexGrow={1} />
        {Footer($, d, v, ctx, card, i.overview.dueNow, await read($, generating), cards.filter(isToLearn).length)}
      </Box>
    )
  })
}
