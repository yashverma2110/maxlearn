import { expect, mock, test } from 'claude-code/testing'

import type { Card } from '../types'
import { STATUS_CHARS, insightCards, insightText, pickInsight, statusLine, takeaway } from './insight'

const NOW = 1_000_000_000_000
const DAY = 86_400_000

function card(id: string, over: Partial<Card> = {}): Card {
  return {
    id, topic: 'redis', front: `Why does Redis case ${id} matter here?`, back: `Answer ${id}. More detail.`,
    choices: [], answer: -1, source: 'interest', createdAt: 0, ease: 2.5, intervalDays: 3,
    reps: 1, lapses: 0, due: NOW + DAY, seen: 1, correct: 1, ...over,
  }
}

test('only reviewed cards that are not due may show their answer', async () => {
  const deck = [card('ok'), card('due', { due: NOW - 1 }), card('new', { reps: 0 })]
  expect(insightCards(deck, NOW).map(c => c.id)).toEqual(['ok'])
})

test('takeaway: first sentence, cut on a word', async () => {
  expect(takeaway('Redis fsyncs once per second. A crash loses the rest.')).toBe('Redis fsyncs once per second.')
  const long = takeaway('word '.repeat(40).trim() + '.', 30)
  expect(long.length).toBeLessThanOrEqual(30)
  expect(long.endsWith('…')).toBe(true)
  expect(insightText(card('a'))).toBe('💡 redis: Answer a.')
})

test('pickInsight never repeats the last card when another exists', async () => {
  const deck = [card('a'), card('b')]
  for (const r of [0, 0.3, 0.99]) expect(pickInsight(deck, NOW, 'a', r)?.id).toBe('b')
  expect(pickInsight([card('a')], NOW, 'a', 0.5)?.id).toBe('a')
  expect(pickInsight([], NOW, undefined, 0.5)).toBeUndefined()
})

async function start($: any, on: any, store: Record<string, unknown>, statuses: (string | undefined)[]) {
  const clock = mock.clock(on)
  mock.store(on, store)
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.status', async (_$: unknown, e: { text: string | undefined }) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.focus', async () => ({}))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  return clock
}

test('the status line rotates takeaways and never shows a due card', async ($, on) => {
  const statuses: (string | undefined)[] = []
  const later = Date.now() + 30 * DAY
  const deck = [
    card('a', { due: later }),
    card('b', { due: later }),
    card('due', { due: 0, back: 'SECRET due answer.' }),
  ]
  const clock = await start($, on, { deck }, statuses)
  expect(statuses.at(-1)).toMatch(/^📚 1 due · 💡 redis: Answer [ab]\.$/)
  const first = statuses.at(-1)

  await clock.advance(30_000)
  expect(statuses.at(-1)).toMatch(/💡 redis: Answer [ab]\./)
  expect(statuses.at(-1)).not.toBe(first)
  expect(statuses.some(s => s?.includes('SECRET'))).toBe(false)
})

test('pace off: no takeaway on the status line', async ($, on) => {
  const statuses: (string | undefined)[] = []
  const deck = [card('a', { due: Date.now() + 30 * DAY })]
  await start($, on, { deck, settings: { insightPace: 'off' } }, statuses)
  expect(statuses.at(-1)).toBe('📚 0 due')
})

test('the status line stays within its budget and ends at a clean break', async () => {
  const redis = card('r', {
    back: 'Redis stores all data in memory, which makes it very fast but also means data will be lost on a crash without persistence.',
  })
  const line = statusLine('📚 2 due · 🔥 1', redis)
  expect(line.length).toBeLessThanOrEqual(STATUS_CHARS)
  expect(line).toBe('📚 2 due · 🔥 1 · 💡 redis: Redis stores all data in memory…')

  // A long prefix leaves too little room: the takeaway is left out, not mangled.
  expect(statusLine('x'.repeat(60), redis)).toBe('x'.repeat(60))
  // A short answer shows whole.
  expect(statusLine('📚 0 due', card('a'))).toBe('📚 0 due · 💡 redis: Answer a.')
  // No clause break: cut on a word.
  expect(takeaway('Each replica applies the primary write stream in order and never reorders it again later.', 40)).toBe(
    'Each replica applies the primary write…',
  )
})
