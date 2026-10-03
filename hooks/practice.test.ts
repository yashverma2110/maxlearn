import { expect, mock, test } from 'claude-code/testing'

import type { Card } from '../types'
import { teachPrompt } from './lessons'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const PANE = {
  component: 'Pane',
  requestId: 'maxlearn',
  props: { title: 'maxlearn', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

const QUIZ = JSON.stringify([
  { topic: 'redis', front: 'Why can Redis lose writes with appendfsync everysec?', back: 'fsync runs once per second.', choices: ['Speed', 'fsync once a second', 'Auth', 'Logs'], answer: 1 },
  { topic: 'redis', front: 'Why does a Redis BGSAVE fork use more memory under heavy writes?', back: 'Copy-on-write duplicates pages.' }, // no choices: not a quiz question
])
const TEACH = JSON.stringify([
  {
    topic: 'redis', title: 'fsync decides how much an AOF can lose', body: 'Redis writes the AOF to the OS buffer; fsync forces it to disk.',
    cards: [{ front: 'Why does appendfsync always make Redis writes slower?', back: 'Each write waits for the disk.' }],
  },
])

function card(over: Partial<Card> = {}): Card {
  return {
    id: 'c1', topic: 'redis', front: 'Why can Redis lose the last second of writes?', back: 'fsync runs once per second.',
    choices: ['Speed', 'fsync once a second', 'Auth', 'Logs'], answer: 1, source: 'interest', createdAt: 0, ease: 2.5,
    intervalDays: 0, reps: 0, lapses: 0, due: 0, seen: 0, correct: 0, learnedAt: 0, ...over,
  }
}

async function start($: any, on: any, store: Record<string, unknown>) {
  const clock = mock.clock(on)
  mock.store(on, { settings: { autoPeriod: 'off' }, onboarded: true, ...store })
  const prompts: string[] = []
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.focus', async () => ({}))
  on('model.complete', async (_$: unknown, e: { prompt: string }) => {
    prompts.push(e.prompt)
    const text = e.prompt.includes('wants to understand the idea behind it') ? TEACH : QUIZ
    return { value: { isAnswered: true as const, text, usage: USAGE } }
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'maxlearn', surface: 'terminal', ...PANE })
  const settle = async () => {
    for (let n = 0; n < 5; n++) await clock.advance(10)
  }
  return { prompts, ui, settle }
}

test('teachPrompt carries the card, and its choices for a quiz question', async () => {
  const p = teachPrompt(card())
  expect(p).toContain('Question: Why can Redis lose the last second of writes?')
  expect(p).toContain('why the wrong choices are wrong')
  expect(teachPrompt(card({ choices: [] }))).not.toContain('Quiz choices')
})

test('empty quiz: a topic chip writes quiz questions that are ready right away', async ($, on) => {
  const { prompts, ui, settle } = await start($, on, { interests: ['redis'] })
  await ui.press({ key: 'tab-quiz' })
  expect((await ui.find({ key: 'next-topic' }))?.props.label).toBe('+ redis')
  expect(await ui.find({ text: /quiz questions, ready now/ })).toBeDefined()
  await ui.press({ key: 'next-topic' })
  await settle()
  expect(prompts.at(-1)).toContain('Write multiple-choice quiz questions on "redis"')
  // The one with choices is in the quiz now; the one without was dropped.
  expect(String((await ui.find({ key: 'choice-1' }))?.props.label)).toContain('fsync once a second')
  await ui.unmount()
})

test('empty review: a topic chip writes flashcards that go to learn first', async ($, on) => {
  const { prompts, ui, settle } = await start($, on, { interests: ['redis'] })
  await ui.press({ key: 'tab-review' })
  expect(await ui.find({ text: /you learn them first/ })).toBeDefined()
  await ui.press({ key: 'next-topic' })
  await settle()
  expect(prompts.at(-1)).toContain('Write flashcards on "redis"')
  expect(await ui.find({ key: 'go-learn' })).toBeDefined() // 2 new cards to learn, none to review yet
  await ui.unmount()
})

test('Teach me on a revealed flashcard: a lesson now, then back to review', async ($, on) => {
  const { prompts, ui, settle } = await start($, on, { deck: [card({ choices: [], answer: -1 })] })
  await ui.press({ key: 'tab-review' })
  await ui.press({ key: 'reveal' })
  expect((await ui.find({ key: 'teach' }))?.props.hotkey).toBe('t')
  await ui.press({ key: 'teach' })
  expect((await ui.find({ key: 'tab-learn' }))?.props.label).toBe('•learn')
  await settle()
  expect(prompts.at(-1)).toContain('Question: Why can Redis lose the last second of writes?')
  expect(await ui.find({ text: /fsync decides how much an AOF can lose/ })).toBeDefined()

  await ui.press({ key: 'learn-next' })
  expect((await ui.find({ key: 'tab-review' }))?.props.label).toBe('•review')
  expect(await ui.find({ key: 'reveal' })).toBeDefined() // the same card, face down, to grade
  await ui.unmount()
})

test('Teach me after a quiz answer returns to the quiz', async ($, on) => {
  const { ui, settle } = await start($, on, { deck: [card()] })
  await ui.press({ key: 'tab-quiz' })
  await ui.press({ key: 'choice-1' })
  expect(await ui.find({ text: /Correct/ })).toBeDefined()
  await ui.press({ key: 'teach' })
  await settle()
  await ui.press({ key: 'learn-skip' })
  expect((await ui.find({ key: 'tab-quiz' }))?.props.label).toBe('•quiz')
  await ui.unmount()
})
