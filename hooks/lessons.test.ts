import { expect, mock, test } from 'claude-code/testing'

import type { Card } from '../types'
import { FIRST_REVIEW_MS, cardLesson, learn, lessonTopics, nextCardToLearn, parseLessons } from './lessons'
import { dueCards, isToLearn } from './srs'

const NOW = 1_000_000

function card(id: string, over: Partial<Card> = {}): Card {
  return {
    id, topic: 'postgres', front: `Why does VACUUM matter in case ${id}?`, back: `Because ${id}.`,
    choices: [], answer: -1, source: 'interest', createdAt: 0, ease: 2.5, intervalDays: 0,
    reps: 0, lapses: 0, due: 0, seen: 0, correct: 0, ...over,
  }
}

const TWO_LESSONS = JSON.stringify([
  {
    topic: 'Redis', title: 'AOF everysec can lose one second of writes', body: 'Redis fsyncs the AOF once per second.',
    example: 'appendfsync everysec',
    cards: [{ front: 'Why can appendfsync everysec lose writes on a crash?', back: 'fsync runs once per second.' }],
  },
  {
    topic: 'postgres', title: 'Long transactions block VACUUM', body: 'Old snapshots keep dead tuples alive.',
    cards: [{ front: 'Why does a long transaction stop VACUUM from cleaning a table?', back: 'Its snapshot still needs the old rows.' }],
  },
])

test('a new card is taught before it is tested; learning schedules its first review', async () => {
  const fresh = card('a')
  expect(isToLearn(fresh)).toBe(true)
  expect(dueCards([fresh], NOW).length).toBe(0)

  const [learned] = learn(cardLesson(fresh), [fresh], NOW)
  expect(learned?.learnedAt).toBe(NOW)
  expect(learned?.due).toBe(NOW + FIRST_REVIEW_MS)
  expect(dueCards([learned!], NOW + FIRST_REVIEW_MS).length).toBe(1)
})

test('parseLessons: two lessons with their cards; repeats dropped', async () => {
  const lessons = parseLessons(TWO_LESSONS, [], [], NOW)
  expect(lessons.map(l => l.topic)).toEqual(['redis', 'postgres'])
  expect(lessons[0]?.cards[0]?.topic).toBe('redis')
  expect(lessons[0]?.example).toBe('appendfsync everysec')
  expect(parseLessons(TWO_LESSONS, [], lessons, NOW).length).toBe(0) // same titles again
  expect(parseLessons('not json', [], [], NOW)).toEqual([])

  // Learning a written lesson adds its cards, already learned.
  const deck = learn(lessons[0]!, [], NOW)
  expect(deck.length).toBe(1)
  expect(isToLearn(deck[0]!)).toBe(false)
})

test('what to teach: oldest unseen card first; topics taught least recently first', async () => {
  const deck = [card('b', { createdAt: 5 }), card('a', { createdAt: 1 }), card('c', { reps: 2 })]
  expect(nextCardToLearn(deck, new Set())?.id).toBe('a')
  expect(nextCardToLearn(deck, new Set(['card:a']))?.id).toBe('b')

  const recent = parseLessons(TWO_LESSONS, [], [], NOW) // redis, then postgres
  expect(lessonTopics(['postgres', 'redis', 'kafka'], recent)).toEqual(['kafka', 'redis'])
  expect(lessonTopics(['redis'], [])).toEqual(['redis', 'redis'])
  expect(lessonTopics([], [])).toEqual([])
})

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const PANE = {
  component: 'Pane',
  requestId: 'maxlearn',
  props: { title: 'maxlearn', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('learn tab: free card lessons first, then two lessons per model call', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on, { deck: [card('a')], interests: ['redis'], settings: { autoPeriod: 'off' } })
  let calls = 0
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.focus', async () => ({}))
  on('model.complete', async () => {
    calls += 1
    return { value: { isAnswered: true, text: TWO_LESSONS, usage: USAGE } }
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'maxlearn', surface: 'terminal', ...PANE })
  // The unseen card is not in review yet; review points to learn.
  await ui.press({ key: 'tab-review' })
  expect(await ui.find({ key: 'go-learn' })).toBeDefined()
  await ui.press({ key: 'go-learn' })

  // Lesson 1: the card, with its answer. Free.
  expect(await ui.find({ text: /Because a\./ })).toBeDefined()
  expect(calls).toBe(0)
  expect((await ui.find({ key: 'learn-next' }))?.props.label).toBe('Next')

  // Skip does not add it to review: still nothing due, still one to learn.
  await ui.press({ key: 'learn-skip' })
  await ui.press({ key: 'tab-review' })
  expect(await ui.find({ key: 'go-learn' })).toBeDefined()
  await ui.press({ key: 'go-learn' })
  expect(await ui.find({ text: /Because a\./ })).toBeDefined()

  // Next: the card joins review; nothing unseen is left, so two lessons are written in one call.
  await ui.press({ key: 'learn-next' })
  for (let n = 0; n < 4; n++) await clock.advance(10)
  expect(calls).toBe(1)
  expect(await ui.find({ text: /AOF everysec/ })).toBeDefined()
  expect(await ui.find({ text: /1 lesson ready/ })).toBeDefined()

  // Next: the second lesson was already written. Still one call.
  await ui.press({ key: 'learn-next' })
  for (let n = 0; n < 4; n++) await clock.advance(10)
  expect(calls).toBe(1)
  expect(await ui.find({ text: /Long transactions block VACUUM/ })).toBeDefined()
  await ui.unmount()
})

test('/study learn posts a lesson row; Next swaps the next one into the same row', async ($, on) => {
  mock.clock(on)
  mock.store(on, { deck: [card('a', { createdAt: 1 }), card('b', { createdAt: 2 })], settings: { autoPeriod: 'off' } })
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.focus', async () => ({}))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const ran = await $.command.run({ command: 'study', args: 'learn' } as never)
  const text = (ran as { text: string }).text
  expect(text).toContain('📖 Lesson #1')
  expect(text).toContain('Because a.')

  const row = await $.ui.mount({
    plugin: 'maxlearn',
    surface: 'terminal',
    component: 'CommandOutput',
    requestId: 'run-1',
    props: { command: 'study', args: 'learn', text, isErrored: false },
  } as never)
  expect(await row.find({ text: /Because a\./ })).toBeDefined()
  await row.press({ key: 'chat-next-1' })
  expect(await row.find({ text: /Because b\./ })).toBeDefined()
  await row.unmount()
})
