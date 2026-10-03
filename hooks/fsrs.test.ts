import { expect, mock, test } from 'claude-code/testing'

import type { Card } from '../types'
import { W, initialMemory, intervalFor, nextMemory, retrievability } from './fsrs'
import { DAY, previewInterval, schedule, type SchedOptions } from './srs'

const FSRS: SchedOptions = { algorithm: 'fsrs', retention: 0.9 }

function card(over: Partial<Card> = {}): Card {
  return {
    id: 'c', topic: 'redis', front: 'Why can Redis lose writes with everysec?', back: 'fsync runs once per second.',
    choices: [], answer: -1, source: 'interest', createdAt: 0, ease: 2.5, intervalDays: 0,
    reps: 0, lapses: 0, due: 0, seen: 0, correct: 0, learnedAt: 0, ...over,
  }
}

test('the memory model: 90% recall after S days; intervals follow the target', async () => {
  expect(retrievability(0, 5)).toBe(1)
  expect(Math.round((retrievability(5, 5)) * 1e6)).toBe(Math.round((0.9) * 1e6))
  expect(Math.round((intervalFor(5, 0.9)) * 1e6)).toBe(Math.round((5) * 1e6))
  expect(intervalFor(5, 0.95)).toBeLessThan(5)
  expect(intervalFor(5, 0.85)).toBeGreaterThan(5)
})

test('first grade sets the memory from the defaults; easier grades last longer', async () => {
  expect(initialMemory('good')).toEqual({ stability: W[2], difficulty: W[4] })
  const s = (g: 'again' | 'hard' | 'good' | 'easy') => initialMemory(g).stability
  expect(s('again') < s('hard') && s('hard') < s('good') && s('good') < s('easy')).toBe(true)
  expect(initialMemory('again').difficulty).toBeGreaterThan(initialMemory('easy').difficulty)
})

test('a review on time grows stability; a lapse shrinks it and raises difficulty', async () => {
  const m = initialMemory('good')
  const recalled = nextMemory(m, 'good', m.stability)
  expect(recalled.stability).toBeGreaterThan(m.stability)
  const lapsed = nextMemory(recalled, 'again', recalled.stability)
  expect(lapsed.stability).toBeLessThan(recalled.stability)
  expect(lapsed.difficulty).toBeGreaterThan(recalled.difficulty)
  // Recalling late (lower retrievability) grows stability more than recalling early.
  expect(nextMemory(m, 'good', 3 * m.stability).stability).toBeGreaterThan(nextMemory(m, 'good', 0.2 * m.stability).stability)
})

test('schedule with FSRS: first good waits ~4 days, intervals grow, again relearns in minutes', async () => {
  const first = schedule(card(), 'good', 0, 1, FSRS)
  expect(first.intervalDays).toBe(4) // round(W[2] = 3.71)
  expect(Math.round((first.stability ?? 0) * 1e6)).toBe(Math.round((W[2]) * 1e6))
  expect(first.lastReviewAt).toBe(0)

  const second = schedule(first, 'good', first.due, 1, FSRS)
  expect(second.intervalDays).toBeGreaterThan(first.intervalDays)

  const lapse = schedule(second, 'again', second.due, 1, FSRS)
  expect(lapse.due - second.due).toBeLessThan(DAY)
  expect(lapse.lapses).toBe(1)

  // A card scheduled by SM-2 carries over: its interval seeds the stability.
  const migrated = schedule(card({ reps: 3, intervalDays: 10, due: 10 * DAY }), 'good', 10 * DAY, 1, FSRS)
  expect(migrated.intervalDays).toBeGreaterThan(10)
})

test('the buttons preview what the chosen scheduler will do', async () => {
  const c = card({ reps: 2, intervalDays: 6, due: 6 * DAY, lastReviewAt: 0, stability: 6, difficulty: 5 })
  for (const g of ['again', 'hard', 'good', 'easy'] as const) {
    expect(previewInterval(c, g, 6 * DAY, FSRS)).toBe(schedule(c, g, 6 * DAY, 1, FSRS).due - 6 * DAY)
  }
  expect(previewInterval(c, 'good', 6 * DAY, { ...FSRS, retention: 0.95 })).toBeLessThan(
    previewInterval(c, 'good', 6 * DAY, FSRS),
  )
})

test('settings: pick FSRS and a target; the next grade uses it', async ($, on) => {
  mock.clock(on)
  mock.store(on, { deck: [card()], settings: { autoPeriod: 'off' } })
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.focus', async () => ({}))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const pane = {
    component: 'Pane', requestId: 'maxlearn',
    props: { title: 'maxlearn', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as const
  const ui = await $.ui.mount({ plugin: 'maxlearn', surface: 'terminal', ...pane })

  await ui.press({ key: 'tab-settings' })
  expect(await ui.find({ key: 'retention-0.9' })).toBeUndefined() // only with FSRS
  await ui.press({ key: 'algorithm-fsrs' })
  expect((await ui.find({ key: 'algorithm-fsrs' }))?.props.dimColor).toBe(false)
  expect((await ui.find({ key: 'retention-0.9' }))?.props.dimColor).toBe(false)

  await ui.press({ key: 'tab-review' })
  await ui.press({ key: 'reveal' })
  expect((await ui.find({ key: 'grade-good' }))?.props.label).toBe('good · 4d') // FSRS, not SM-2's 1d
  await ui.unmount()
})
