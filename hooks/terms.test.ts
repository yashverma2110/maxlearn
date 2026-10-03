import { expect, mock, test } from 'claude-code/testing'

import { addSubtopic, cleanTerm, parseLessons, termPrompt } from './lessons'

test('terms are cleaned: quotes and punctuation off, one line, 40 characters at most', async () => {
  expect(cleanTerm('  "MVCC",  ')).toBe('MVCC')
  expect(cleanTerm('(DDL)')).toBe('DDL')
  expect(cleanTerm('access\n exclusive   lock')).toBe('access exclusive lock')
  expect(cleanTerm('   ')).toBeUndefined()
  expect(cleanTerm('x'.repeat(41))).toBeUndefined()
})

test('lessons carry up to 4 distinct terms; subtopics are filed once per topic', async () => {
  const [lesson] = parseLessons(
    JSON.stringify([{ topic: 'postgres', title: 'Queued ALTER blocks reads', body: 'b', terms: ['DDL', 'ddl', 'MVCC', 'WAL', 'TOAST', 'HOT'] }]),
    [], [], 0,
  )
  expect(lesson?.terms).toEqual(['DDL', 'MVCC', 'WAL', 'TOAST'])
  let map = addSubtopic({}, 'postgres', 'MVCC')
  map = addSubtopic(map, 'postgres', 'mvcc')
  map = addSubtopic(map, 'postgres', 'DDL')
  expect(map).toEqual({ postgres: ['MVCC', 'DDL'] })
  expect(termPrompt('MVCC', 'postgres', 'ctx')).toContain('met the term "MVCC"')
})

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const PANE = {
  component: 'Pane',
  requestId: 'maxlearn',
  props: { title: 'maxlearn', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

const LESSON = JSON.stringify([
  {
    topic: 'postgres', title: 'A queued ALTER TABLE blocks all reads', body: 'DDL takes an ACCESS EXCLUSIVE lock; MVCC cannot help it.',
    terms: ['DDL', 'MVCC'],
    cards: [{ front: 'Why does a queued ALTER TABLE block new SELECTs?', back: 'Locks are granted in queue order.' }],
  },
])
const TERM = JSON.stringify([
  {
    topic: 'postgres', title: 'MVCC keeps old row versions so readers never wait', body: 'Multi-version concurrency control keeps several versions of a row.',
    terms: ['snapshot'],
    cards: [{ front: 'Why do readers not block writers under MVCC in Postgres?', back: 'Each reads its own snapshot of row versions.' }],
  },
])

async function start($: any, on: any) {
  const clock = mock.clock(on)
  mock.store(on, { settings: { autoPeriod: 'off' }, onboarded: true })
  const prompts: string[] = []
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.focus', async () => ({}))
  on('ui.selection', async () => ({ value: { text: ' "DDL" ' } }))
  on('model.complete', async (_$: unknown, e: { prompt: string }) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true as const, text: e.prompt.includes('met the term') ? TERM : LESSON, usage: USAGE } }
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'maxlearn', surface: 'terminal', ...PANE })
  const settle = async () => {
    for (let n = 0; n < 5; n++) await clock.advance(10)
  }
  await $.command.run({ command: 'study', args: 'postgres' } as never)
  await settle()
  return { prompts, ui, settle }
}

test('a term chip explains the word now, files a subtopic, then returns to the lesson', async ($, on) => {
  const { prompts, ui, settle } = await start($, on)
  expect(await ui.find({ text: /queued ALTER TABLE/ })).toBeDefined()
  expect(prompts[0]).toContain('"terms"')

  await ui.press({ key: 'term-MVCC' })
  await settle()
  expect(prompts.at(-1)).toContain('met the term "MVCC"')
  expect(prompts.at(-1)).toContain('DDL takes an ACCESS EXCLUSIVE lock') // the lesson as context
  expect(await ui.find({ text: /MVCC keeps old row versions/ })).toBeDefined()
  expect(await ui.find({ text: /› MVCC/ })).toBeDefined()

  // Next: the explained term's card joins; the lesson it came from is back.
  await ui.press({ key: 'learn-next' })
  expect(await ui.find({ text: /queued ALTER TABLE/ })).toBeDefined()

  await ui.press({ key: 'tab-progress' })
  await ui.press({ key: 'ins-topics' })
  expect(await ui.find({ key: 'sub-postgres-MVCC' })).toBeDefined()
  await ui.unmount()
})

test('paste a term, or select one and press w', async ($, on) => {
  const { prompts, ui, settle } = await start($, on)
  await ui.input({ key: 'explain-term', text: '  (MVCC)  ' })
  await settle()
  expect(prompts.at(-1)).toContain('met the term "MVCC"')
  await ui.press({ key: 'learn-skip' }) // skip the explanation: back to the lesson
  expect(await ui.find({ text: /queued ALTER TABLE/ })).toBeDefined()

  expect((await ui.find({ key: 'explain-selection' }))?.props.hotkey).toBe('w')
  await ui.press({ key: 'explain-selection' })
  await settle()
  expect(prompts.at(-1)).toContain('met the term "DDL"')
  await ui.unmount()
})

test('overview shows interests as chips: subtopic count, a press writes lessons on it', async ($, on) => {
  const { prompts, ui, settle } = await start($, on)
  await ui.press({ key: 'term-MVCC' })
  await settle()
  await ui.press({ key: 'tab-progress' })
  await ui.press({ key: 'ins-overview' })
  expect((await ui.find({ key: 'interest-chip-postgres' }))?.props.label).toBe('postgres · 1')
  expect(await ui.find({ key: 'interest-chip-add' })).toBeDefined()

  const before = prompts.length
  await ui.press({ key: 'interest-chip-postgres' })
  await settle()
  expect(prompts.length).toBe(before + 1)
  expect(prompts.at(-1)).toContain('1. "postgres"')
  expect((await ui.find({ key: 'tab-learn' }))?.props.dimColor).toBe(false)
  await ui.unmount()
})

test('the full overview shows the interest chips too', async ($, on) => {
  const { ui } = await start($, on)
  await ui.press({ key: 'learn-next' }) // learn the lesson: cards exist now
  await ui.press({ key: 'tab-progress' })
  await ui.press({ key: 'ins-overview' })
  expect(await ui.find({ text: /today ·/ })).toBeDefined()
  expect(await ui.find({ key: 'interest-chip-postgres' })).toBeDefined()
  await ui.unmount()
})
