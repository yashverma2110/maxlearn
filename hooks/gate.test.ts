import { expect, mock, test } from 'claude-code/testing'

import { gateDigest, gatePrompt, parseGate, type GateRow } from './gate'

const EXECUTION: GateRow[] = [
  { role: 'user', text: 'push it' },
  { role: 'assistant', text: 'Pushed.', toolUses: [{ tool: 'Bash', input: { command: 'git push origin main' } }] },
]
const LEARNING: GateRow[] = [
  { role: 'user', text: 'why does the ALTER hang?' },
  { role: 'assistant', text: 'ALTER TABLE needs an ACCESS EXCLUSIVE lock, so it queues behind the long SELECT and every new query waits behind it.' },
]

test('the digest names tools, keeps the newest text within the budget', async () => {
  expect(gateDigest(EXECUTION)).toBe('user: push it\nassistant: Pushed. [tools: Bash(git push origin main)]')
  const long = gateDigest([{ role: 'user', text: 'old '.repeat(500) }, ...LEARNING], 200)
  expect(long).toContain('ACCESS EXCLUSIVE')
  expect(long).not.toContain('old old')
  expect(gateDigest([{ role: 'assistant', text: '  ' }])).toBe('')
  expect(gatePrompt('x')).toContain('"execution"')
})

test('parseGate reads the verdict and its topics; anything else is unreadable', async () => {
  expect(parseGate('{"kind":"execution","topics":["Git","git"]}')).toEqual({ kind: 'execution', topics: ['git'] })
  expect(parseGate('Here: {"kind":"learning","topics":["PostgreSQL"]}')).toEqual({ kind: 'learning', topics: ['postgres'] })
  expect(parseGate('{"kind":"maybe"}')).toBeUndefined()
  expect(parseGate('execution')).toBeUndefined()
})

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const reply = (text: string) => ({ value: { isAnswered: true as const, text, usage: USAGE } })

async function session($: any, on: any, rows: GateRow[], verdict: string) {
  const clock = mock.clock(on)
  const calls = { gate: 0, forks: 0 }
  mock.store(on, { settings: { autoPeriod: 'off' } })
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('session.messages', async () => ({ value: rows.map(r => ({ toolUses: [], ...r })) }))
  on('session.id', async () => ({ value: 's1' }))
  on('session.cwd', async () => ({ value: '/tmp/proj' }))
  on('model.complete', async (_$: unknown, e: { prompt: string }) => {
    if (e.prompt.includes('Classify the recent work')) calls.gate += 1
    return reply(verdict)
  })
  on('model.fork', async () => {
    calls.forks += 1
    return reply('{"topics":["postgres"],"cards":[{"topic":"postgres","front":"Why does a queued ALTER TABLE block new SELECTs?","back":"Locks are granted in queue order."}]}')
  })
  on('turn.complete', async () => ({ text: 'ok' }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  for (let n = 0; n < 3; n++) {
    await $.turn.complete({ answer: 'ok', durationMs: 60_000, isAborted: false, turnId: `t${n}`, reason: 'end_turn' } as never)
  }
  for (let n = 0; n < 5; n++) await clock.advance(10)
  return calls
}

test('execution-only turns: the gate stops the card writer, topics still count', async ($, on) => {
  const calls = await session($, on, EXECUTION, '{"kind":"execution","topics":["git"]}')
  expect(calls).toEqual({ gate: 1, forks: 0 })
  const stats = (await $.command.run({ command: 'study', args: 'stats' } as never)) as { text: string }
  expect(stats.text).toContain('git') // filed under this week's work and time spent
})

test('learning turns pass the gate and get their cards', async ($, on) => {
  const calls = await session($, on, LEARNING, '{"kind":"learning","topics":["postgres"]}')
  expect(calls).toEqual({ gate: 1, forks: 1 })
})

test('an unreadable verdict fails open to the card writer', async ($, on) => {
  const calls = await session($, on, LEARNING, 'not sure')
  expect(calls).toEqual({ gate: 1, forks: 1 })
})
