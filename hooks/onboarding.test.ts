import { expect, mock, test } from 'claude-code/testing'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const PANE = {
  component: 'Pane',
  requestId: 'maxlearn',
  props: { title: 'maxlearn', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

async function start($: any, on: any, store: Record<string, unknown>) {
  const clock = mock.clock(on)
  mock.store(on, { settings: { autoPeriod: 'off' }, ...store })
  const prompts: string[] = []
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.focus', async () => ({}))
  on('model.complete', async (_$: unknown, e: { prompt: string }) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true as const, text: '[]', usage: USAGE } }
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'maxlearn', surface: 'terminal', ...PANE })
  return { clock, prompts, ui }
}

test('a new learner picks interests and a level, then gets one lesson call over two picks', async ($, on) => {
  const { clock, prompts, ui } = await start($, on, {})
  expect(await ui.find({ text: /Welcome to maxlearn/ })).toBeDefined()

  await ui.press({ key: 'pick-postgres' })
  await ui.press({ key: 'pick-typescript' })
  await ui.input({ key: 'pick-own', text: 'Kafka' })
  await ui.press({ key: 'pick-typescript' }) // unpick
  expect((await ui.find({ key: 'pick-postgres' }))?.props.label).toBe('✓ postgres')
  expect(await ui.find({ text: /Picked: postgres, kafka/ })).toBeDefined()

  await ui.press({ key: 'welcome-next' })
  await ui.press({ key: 'level-mid' })
  expect((await ui.find({ key: 'level-mid' }))?.props.label).toBe('• Junior / mid')
  expect(await ui.find({ text: /cover postgres and kafka/ })).toBeDefined()
  await ui.press({ key: 'welcome-start' })
  for (let n = 0; n < 4; n++) await clock.advance(10)

  expect((await ui.find({ key: 'tab-learn' }))?.props.label).toBe('•learn')
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('1. "postgres" for a mid-level engineer')
  expect(prompts[0]).toContain('2. "kafka" for a mid-level engineer')
  const stats = (await $.command.run({ command: 'study', args: 'stats' } as never)) as { text: string }
  expect(stats.text).toContain('Interests: postgres, kafka')
  await ui.unmount()
})

test('skip: no interests, no model call, straight to learn', async ($, on) => {
  const { clock, prompts, ui } = await start($, on, {})
  await ui.press({ key: 'welcome-skip' })
  await clock.advance(10)
  expect((await ui.find({ key: 'tab-learn' }))?.props.label).toBe('•learn')
  expect(prompts.length).toBe(0)
  await ui.unmount()
})

test('someone with data never sees onboarding; /study welcome brings it back', async ($, on) => {
  const { ui } = await start($, on, { interests: ['redis'] })
  expect(await ui.find({ text: /Welcome to maxlearn/ })).toBeUndefined()
  await $.command.run({ command: 'study', args: 'welcome' } as never)
  expect(await ui.find({ text: /Welcome to maxlearn/ })).toBeDefined()
  await ui.unmount()
})

test('start over: two steps, then everything but the settings is gone and onboarding opens', async ($, on) => {
  const card = {
    id: 'c1', topic: 'redis', front: 'Why can Redis lose writes with everysec?', back: 'fsync runs once per second.',
    choices: [], answer: -1, source: 'interest', createdAt: 0, ease: 2.5, intervalDays: 3,
    reps: 1, lapses: 0, due: 0, seen: 1, correct: 1, learnedAt: 0,
  }
  const { ui } = await start($, on, {
    deck: [card],
    interests: ['redis'],
    onboarded: true,
    settings: { autoPeriod: 'off', algorithm: 'fsrs' },
  })
  await ui.press({ key: 'tab-settings' })
  expect(await ui.find({ key: 'reset-confirm' })).toBeUndefined()
  await ui.press({ key: 'reset' })
  expect(await ui.find({ text: /cannot be undone/ })).toBeDefined()

  // Cancel keeps everything.
  await ui.press({ key: 'reset-cancel' })
  expect(await ui.find({ key: 'reset-confirm' })).toBeUndefined()
  // Leaving the tab drops a pending confirm.
  await ui.press({ key: 'reset' })
  await ui.press({ key: 'tab-review' })
  await ui.press({ key: 'tab-settings' })
  expect(await ui.find({ key: 'reset-confirm' })).toBeUndefined()

  await ui.press({ key: 'reset' })
  await ui.press({ key: 'reset-confirm' })
  expect(await ui.find({ text: /Welcome to maxlearn/ })).toBeDefined()
  const stats = (await $.command.run({ command: 'study', args: 'stats' } as never)) as { text: string }
  expect(stats.text).toContain('No cards or interests yet')
  await ui.press({ key: 'welcome-skip' })
  await ui.press({ key: 'tab-settings' })
  expect((await ui.find({ key: 'algorithm-fsrs' }))?.props.label).toBe('•FSRS') // settings kept
  await ui.unmount()
})
