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

test('adding an interest shows at once and queues two lessons on it', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on, { settings: { autoPeriod: 'off' } })
  const prompts: string[] = []
  let finish: () => void = () => {}
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.focus', async () => ({}))
  on('model.complete', (_$: unknown, e: { prompt: string }) => {
    prompts.push(e.prompt)
    return new Promise(resolve => {
      finish = () => resolve({ value: { isAnswered: true, text: TWO_LESSONS.replaceAll('postgres', 'redis'), usage: USAGE } })
    })
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'maxlearn', surface: 'terminal', ...PANE })

  const ran = (await $.command.run({ command: 'study', args: 'Redis' } as never)) as { text: string }
  expect(ran.text).toContain('Added "redis"')

  // At once, before the model answers: learn tab, spinner, interest on the dashboard.
  expect((await ui.find({ key: 'tab-learn' }))?.props.dimColor).toBe(false)
  expect(await ui.find({ text: /Writing 2 lessons/ })).toBeDefined()
  await clock.advance(10)
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('1. "redis"')
  expect(prompts[0]).toContain('2. "redis"')
  expect(prompts[0]).toContain('Write ALL text ("title", "body", "example"')
  await ui.press({ key: 'tab-progress' })
  await ui.press({ key: 'ins-overview' })
  expect((await ui.find({ key: 'interest-chip-redis' }))?.props.label).toBe('redis')
  expect(await ui.find({ text: /Writing lessons on redis/ })).toBeDefined()
  const stats = (await $.command.run({ command: 'study', args: 'stats' } as never)) as { text: string }
  expect(stats.text).toContain('Interests: redis')

  // The lessons land and the learn tab shows the first; the second waits.
  finish()
  for (let n = 0; n < 4; n++) await clock.advance(10)
  await ui.press({ key: 'tab-learn' })
  expect(await ui.find({ text: /AOF everysec/ })).toBeDefined()
  expect(await ui.find({ text: /1 lesson ready/ })).toBeDefined()
  await ui.unmount()
})

test('the more tab adds an interest from its field', async ($, on) => {
  mock.clock(on)
  mock.store(on, { settings: { autoPeriod: 'off' } })
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.focus', async () => ({}))
  on('model.complete', async () => ({ value: { isAnswered: true, text: '[]', usage: USAGE } }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'maxlearn', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-add' })
  await ui.input({ key: 'add-interest', text: 'Kafka' })
  expect((await ui.find({ key: 'tab-learn' }))?.props.dimColor).toBe(false)
  await ui.press({ key: 'tab-add' })
  expect(await ui.find({ key: 'more-kafka' })).toBeDefined()
  await ui.unmount()
})

test('the lesson card carries its own Skip, next to Next', async ($, on) => {
  mock.clock(on)
  mock.store(on, { deck: [card('a'), card('b', { createdAt: 5 })], settings: { autoPeriod: 'off' } })
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.focus', async () => ({}))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'maxlearn', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-learn' })

  const tree = JSON.stringify(await ui.drawn())
  const frame = tree.slice(tree.indexOf('"borderStyle":"round"'), tree.indexOf('── Shortcuts'))
  expect(frame).toContain('"key":"learn-next"')
  expect(frame).toContain('"key":"learn-skip"') // in the card, not only the footer
  expect((await ui.find({ key: 'learn-skip' }))?.props.label).toBe('Skip')
  expect((await ui.findAll({ key: 'learn-skip' })).length).toBe(1)

  await ui.press({ key: 'learn-skip' })
  expect(await ui.find({ text: /Because b\./ })).toBeDefined()
  await ui.unmount()
})

test('skipped cards wait their turn, then come around again', async ($, on) => {
  mock.clock(on)
  mock.store(on, { deck: [card('a', { createdAt: 1 }), card('b', { createdAt: 2 })], settings: { autoPeriod: 'off' } })
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.focus', async () => ({}))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'maxlearn', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-learn' })
  expect(await ui.find({ text: /Because a\./ })).toBeDefined()
  await ui.press({ key: 'learn-skip' })
  expect(await ui.find({ text: /Because b\./ })).toBeDefined()
  await ui.press({ key: 'learn-skip' })
  expect(await ui.find({ text: /Because a\./ })).toBeDefined() // both skipped: back to the oldest
  await ui.press({ key: 'learn-next' })
  expect(await ui.find({ text: /Because b\./ })).toBeDefined()
  await ui.unmount()
})

const SIMPLER = JSON.stringify([
  {
    topic: 'redis', title: 'Redis saves to disk once a second', body: 'Think of a notebook you copy to a safe each second.',
    cards: [{ front: 'Why can Redis lose the last second of writes?', back: 'It copies to disk only once each second.' }],
  },
])

test('Simplify rewrites the same lesson in place, and later lessons start a level lower', async ($, on) => {
  const clock = mock.clock(on)
  const store = mock.store
  store(on, { settings: { autoPeriod: 'off' } })
  const prompts: string[] = []
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.focus', async () => ({}))
  on('model.complete', async (_$: unknown, e: { prompt: string }) => {
    prompts.push(e.prompt)
    const text = e.prompt.includes('too hard') ? SIMPLER : TWO_LESSONS
    return { value: { isAnswered: true, text, usage: USAGE } }
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'maxlearn', surface: 'terminal', ...PANE })
  await $.command.run({ command: 'study', args: 'redis' } as never)
  for (let n = 0; n < 4; n++) await clock.advance(10)
  expect(await ui.find({ text: /AOF everysec/ })).toBeDefined()
  expect(prompts[0]).toContain('a senior engineer')

  await ui.press({ key: 'learn-simplify' })
  for (let n = 0; n < 4; n++) await clock.advance(10)
  expect(prompts[1]).toContain('too hard')
  expect(prompts[1]).toContain('AOF everysec can lose one second of writes')
  expect(await ui.find({ text: /once a second/ })).toBeDefined()
  expect(await ui.find({ text: /AOF everysec/ })).toBeUndefined()
  expect(await ui.find({ text: /Adds 1 card|add 1 card/ })).toBeDefined()

  // Learn it: the simpler card joins, not the old one.
  await ui.press({ key: 'learn-next' })
  await ui.press({ key: 'learn-next' }) // the second queued lesson (postgres)
  for (let n = 0; n < 4; n++) await clock.advance(10)
  // The next lessons on redis are written one level lower.
  expect(prompts.at(-1)).toContain('"redis" for a mid-level engineer')
  await ui.unmount()
})

test('Simplify on a new card rewrites the card itself, keeping its place', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on, { deck: [card('a', { topic: 'redis' })], settings: { autoPeriod: 'off' } })
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.focus', async () => ({}))
  on('model.complete', async () => ({ value: { isAnswered: true, text: SIMPLER, usage: USAGE } }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'maxlearn', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-learn' })
  expect(await ui.find({ text: /Because a\./ })).toBeDefined()
  await ui.press({ key: 'learn-simplify' })
  for (let n = 0; n < 4; n++) await clock.advance(10)
  expect(await ui.find({ text: /copies to disk only once each second/ })).toBeDefined()
  expect(await ui.find({ text: /Because a\./ })).toBeUndefined()
  await ui.unmount()
})
