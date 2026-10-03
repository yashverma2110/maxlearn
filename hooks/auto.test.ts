import { expect, mock, test } from 'claude-code/testing'

import { CHAT_COOLDOWN_MS, chatMatches, periodDue, seedAutoAt } from './auto'

const HOUR = 3_600_000
const NOW = 1_000 * HOUR

test('chatMatches: saved interests the chat touched, outside the cooldown', async () => {
  const at = { redis: NOW - 1 * HOUR, kafka: NOW - 5 * HOUR }
  expect(chatMatches(['redis', 'kafka', 'react'], ['redis', 'kafka'], at, NOW)).toEqual(['kafka'])
  expect(chatMatches(['redis'], ['redis'], {}, NOW)).toEqual(['redis'])
  expect(chatMatches(['redis'], ['redis'], { redis: NOW - CHAT_COOLDOWN_MS }, NOW)).toEqual(['redis'])
})

test('periodDue: the longest-waiting interest past its period, one at a time', async () => {
  const at = { redis: NOW - 30 * HOUR, kafka: NOW - 50 * HOUR, rust: NOW - 2 * HOUR }
  expect(periodDue(['redis', 'kafka', 'rust'], at, NOW, 24 * HOUR)).toBe('kafka')
  expect(periodDue(['rust'], at, NOW, 24 * HOUR)).toBeUndefined()
  expect(periodDue(['new-topic'], at, NOW, 24 * HOUR)).toBe('new-topic') // never had cards
  expect(periodDue(['redis'], at, NOW, 0)).toBeUndefined() // off
  expect(periodDue(['x', 'y'], {}, NOW, HOUR)).toBe('x') // two never-had-cards: a stable tie
  expect(seedAutoAt(['redis', 'new'], { redis: 5 }, NOW)).toEqual({ redis: 5, new: NOW })
})

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const answer = (text: string) => ({ value: { isAnswered: true as const, text, usage: USAGE } })

async function start($: any, on: any, store: Record<string, unknown>) {
  const clock = mock.clock(on)
  mock.store(on, store)
  const asked: string[] = []
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.focus', async () => ({}))
  on('model.complete', async (_$: unknown, e: { prompt: string }) => {
    asked.push(e.prompt)
    return answer('[]')
  })
  on('model.fork', async () => answer('{"topics":["Redis","indexes"],"cards":[]}'))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  return { clock, asked }
}

const askedAbout = (asked: string[], topic: string) => asked.filter(p => p.includes(`flashcards on "${topic}"`)).length

test('the period gives the longest-waiting interest its cards, then the next', async ($, on) => {
  const now = 0 // the mocked clock starts here
  const { clock, asked } = await start($, on, {
    interests: ['redis', 'kafka'],
    autoAt: { redis: now - 30 * HOUR, kafka: now - 1 * HOUR },
  })
  expect(asked.length).toBe(0) // nothing at start itself

  await clock.advance(30_000)
  await clock.advance(10)
  expect(askedAbout(asked, 'redis')).toBe(1)
  expect(askedAbout(asked, 'kafka')).toBe(0) // its 24h has not run out

  // Redis is fresh now: the next check finds nothing.
  await clock.advance(15 * 60_000)
  await clock.advance(10)
  expect(askedAbout(asked, 'redis')).toBe(1)
})

test('a chat that touches an interest queues its cards behind the chat run', async ($, on) => {
  const { clock, asked } = await start($, on, {
    interests: ['redis'],
    settings: { autoPeriod: 'off' },
  })
  const pane = {
    component: 'Pane',
    requestId: 'maxlearn',
    props: { title: 'maxlearn', isFocused: true, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as const
  const ui = await $.ui.mount({ plugin: 'maxlearn', surface: 'terminal', ...pane })
  await ui.press({ key: 'next-chat' }) // the empty deck offers "cards from chat"
  await clock.advance(10)
  await clock.advance(10)
  await clock.advance(10)
  expect(askedAbout(asked, 'redis')).toBe(1)

  // Within the 4h cooldown, the same chat topic does not ask again.
  await ui.press({ key: 'next-chat' })
  await clock.advance(10)
  await clock.advance(10)
  await clock.advance(10)
  expect(askedAbout(asked, 'redis')).toBe(1)
  await ui.unmount()
})

test('turning the feature on starts each interest\'s period instead of firing at once', async ($, on) => {
  const { clock, asked } = await start($, on, { interests: ['postgres', 'redis'] }) // no autoAt yet
  await clock.advance(30_000)
  await clock.advance(15 * 60_000)
  expect(asked.length).toBe(0)
  await clock.advance(24 * HOUR)
  await clock.advance(10)
  // Many checks ran in that jump; each took one due interest, so each got one run.
  expect(askedAbout(asked, 'postgres')).toBe(1)
  expect(askedAbout(asked, 'redis')).toBe(1)
})

test('cards from chat off: finished turns never fork the chat', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on, { settings: { autoPeriod: 'off', chatCards: 'off' } })
  let forks = 0
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('model.fork', async () => {
    forks += 1
    return answer('{"topics":[],"cards":[]}')
  })
  on('turn.complete', async () => ({ text: 'ok' }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  for (let n = 0; n < 6; n++) {
    await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: `t${n}`, reason: 'end_turn' } as never)
    await clock.advance(10)
  }
  expect(forks).toBe(0)
})
