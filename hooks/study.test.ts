import { expect, mock, test } from 'claude-code/testing'

import { DAY, dueCards, parseCards, schedule, topicStats, isToLearn } from './srs'

const REPLY = `Here you go:
[{"topic":"system design","front":"Why use idempotency keys?","back":"So retries don't double-apply.","choices":["Speed","Safe retries","Auth","Caching"],"answer":1},
 {"topic":"system design","front":"why use idempotency keys?","back":"dup"},
 {"front":42}]`

test('parses cards, drops duplicates and malformed rows', async () => {
  const cards = parseCards(REPLY, [], 'chat', 1000)
  expect(cards.length).toBe(1)
  expect(cards[0]?.answer).toBe(1)
  expect(cards[0]?.due).toBe(1000)
  expect(parseCards('no json here', [], 'chat', 0).length).toBe(0)
})

test('new cards are taught before they are tested, and count toward topic stats', async () => {
  const cards = parseCards(REPLY, [], 'interest', 1000)
  expect(cards.every(isToLearn)).toBe(true)
  expect(dueCards(cards, 1000).length).toBe(0) // not reviewable until learned
  expect(dueCards(cards.map(c => ({ ...c, learnedAt: 1000 })), 1000).length).toBe(1)
  const [stats] = topicStats(cards, 1000)
  expect(stats?.topic).toBe('system design')
  expect(stats?.accuracy).toBe(null)
})

test('pane draws on terminal and desktop', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'maxlearn', surface, component: 'Pane', requestId: 'maxlearn', props: { bodyColumns: 40 } } as never)
    expect(await ui.find({ key: 'tab-review' })).toBeDefined()
    await ui.unmount()
  }
})

test('schedule: good grades grow the interval, again resets it', async () => {
  const [card] = parseCards(REPLY, [], 'chat', 0)
  if (card === undefined) throw new Error('no card')

  const first = schedule(card, 'good', 0)
  expect(first.intervalDays).toBe(1)
  const second = schedule(first, 'good', 0)
  expect(second.intervalDays).toBe(3)
  const third = schedule(second, 'good', 0)
  expect(third.intervalDays).toBeGreaterThanOrEqual(7)
  expect(third.due).toBe(third.intervalDays * DAY)

  const lapse = schedule(third, 'again', 0)
  expect(lapse.reps).toBe(0)
  expect(lapse.lapses).toBe(1)
  expect(lapse.due).toBeLessThan(DAY)
  expect(lapse.ease).toBeLessThan(third.ease)
})

test('schedule: ease never drops below 1.3', async () => {
  let [card] = parseCards(REPLY, [], 'chat', 0)
  if (card === undefined) throw new Error('no card')
  for (let i = 0; i < 20; i++) card = schedule(card, i % 2 ? 'again' : 'hard', 0)
  expect(card.ease).toBeGreaterThanOrEqual(1.3)
})

test('settings tab picks the models on every surface', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const pane = {
    component: 'Pane',
    requestId: 'maxlearn',
    props: {
      title: 'maxlearn',
      isFocused: true,
      bodyColumns: 40,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  } as const

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'maxlearn', surface, ...pane })
    await ui.press({ key: 'tab-settings' })
    // Option buttons, never a Select: a focused Select would keep the tab keys for itself.
    expect(await ui.find({ type: 'Select' })).toBeUndefined()
    await ui.press({ key: 'chat-model-haiku' })
    await ui.press({ key: 'interest-model-opus' })
    await ui.press({ key: 'focus-work' })
    expect((await ui.find({ key: 'chat-model-haiku' }))?.props.label).toBe('•haiku')
    expect((await ui.find({ key: 'chat-model-sonnet' }))?.props.label).toBe('sonnet')
    expect((await ui.find({ key: 'interest-model-opus' }))?.props.label).toBe('•opus')
    expect((await ui.find({ key: 'focus-work' }))?.props.label).toBe('•daily work')
    // Leaving settings by its tab key works.
    await ui.press({ key: 'tab-review' })
    expect((await ui.find({ key: 'tab-review' }))?.props.label).toBe('•rev')
    await ui.unmount()
  }
})

test('insights tab: sub-views on every surface, +3 for a thin work topic', async ($, on) => {
  const clock = mock.clock(on)
  const today = new Date(await clock.now())
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  mock.store(on, { chatTopics: { [key]: { kafka: 2 } } })
  // Nothing sits beneath the plugin in a test: answer what its session.start calls.
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const pane = {
    component: 'Pane',
    requestId: 'maxlearn',
    props: {
      title: 'maxlearn',
      isFocused: true,
      bodyColumns: 40,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  } as const

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'maxlearn', surface, ...pane })
    await ui.press({ key: 'tab-progress' })
    expect((await ui.find({ key: 'tab-progress' }))?.props.label).toBe('•ins')
    await ui.press({ key: 'ins-topics' })
    expect(await ui.find({ text: /Improve/ })).toBeDefined()
    await ui.press({ key: 'ins-work' })
    expect(await ui.find({ key: 'work-kafka' })).toBeDefined()
    expect(await ui.find({ key: 'work-more-kafka' })).toBeDefined()
    await ui.press({ key: 'ins-overview' })
    expect(await ui.find({ text: /Trends show up once you learn/ })).toBeDefined()
    await ui.unmount()
  }
})
