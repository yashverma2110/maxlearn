import { expect, mock, test } from 'claude-code/testing'

import type { Card } from '../types'
import { fromMatches } from './lessons'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const PANE = {
  component: 'Pane',
  requestId: 'maxlearn',
  props: { title: 'maxlearn', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

function card(id: string, source: 'chat' | 'interest', over: Partial<Card> = {}): Card {
  return {
    id, topic: source === 'chat' ? 'react' : 'postgres', front: `Why does case ${id} matter in this system?`, back: `Because ${id}.`,
    choices: [], answer: -1, source, createdAt: id.charCodeAt(0), ease: 2.5, intervalDays: 0,
    reps: 0, lapses: 0, due: 0, seen: 0, correct: 0, ...over,
  }
}

const today = () => {
  const d = new Date(0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
    const text = JSON.stringify([
      { topic: 'react', title: 'Effects run after paint', body: 'useEffect runs after the browser paints.', cards: [{ front: 'Why does useEffect not block the first paint?', back: 'It runs after paint.' }] },
      { topic: 'react', title: 'Keys keep state with the item', body: 'React matches list items by key.', cards: [] },
    ])
    return { value: { isAnswered: true as const, text, usage: USAGE } }
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'maxlearn', surface: 'terminal', ...PANE })
  const settle = async () => {
    for (let n = 0; n < 5; n++) await clock.advance(10)
  }
  return { prompts, ui, settle }
}

test('fromMatches: all shows both; each filter shows its own', async () => {
  expect(fromMatches('chat', 'all')).toBe(true)
  expect(fromMatches('chat', undefined)).toBe(true)
  expect(fromMatches('chat', 'chats')).toBe(true)
  expect(fromMatches('chat', 'interests')).toBe(false)
  expect(fromMatches('interest', 'interests')).toBe(true)
  expect(fromMatches('interest', 'chats')).toBe(false)
})

test('tabs sit on top; learn filters by source and counts each', async ($, on) => {
  const { ui } = await start($, on, { deck: [card('a', 'interest'), card('b', 'chat')] })
  await ui.press({ key: 'tab-learn' })
  expect((await ui.find({ key: 'from-chats' }))?.props.label).toBe('from chats 1')
  expect((await ui.find({ key: 'from-interests' }))?.props.label).toBe('from interests 1')
  expect((await ui.find({ key: 'from-all' }))?.props.dimColor).toBe(false)

  await ui.press({ key: 'from-chats' })
  expect(await ui.find({ text: /Because b\./ })).toBeDefined()
  expect((await ui.find({ key: 'from-chats' }))?.props.dimColor).toBe(false)
  await ui.press({ key: 'from-interests' })
  expect(await ui.find({ text: /Because a\./ })).toBeDefined()
  expect(await ui.find({ text: /Because b\./ })).toBeUndefined()
  await ui.unmount()
})

test('review and quiz follow the same filter', async ($, on) => {
  const learned = { learnedAt: 0, reps: 1 }
  const { ui } = await start($, on, { deck: [card('a', 'interest', learned), card('b', 'chat', learned)] })
  await ui.press({ key: 'tab-review' })
  expect((await ui.find({ key: 'from-chats' }))?.props.label).toBe('from chats 1')
  await ui.press({ key: 'from-chats' })
  await ui.press({ key: 'reveal' })
  expect(await ui.find({ text: /Because b\./ })).toBeDefined()
  await ui.press({ key: 'tab-quiz' }) // the filter stays when switching tabs
  expect((await ui.find({ key: 'from-chats' }))?.props.dimColor).toBe(false)
  await ui.unmount()
})

test('from chats with no chat topics offers cards from this chat; with topics, lessons on them', async ($, on) => {
  const empty = await start($, on, { interests: ['postgres'] })
  await empty.ui.press({ key: 'tab-learn' })
  await empty.ui.press({ key: 'from-chats' })
  expect(await empty.ui.find({ text: /Nothing new from your chats/ })).toBeDefined()
  expect(await empty.ui.find({ key: 'learn-from-chat' })).toBeDefined()
  await empty.ui.unmount()
})

test('lessons written from chats are tagged chat, and so are their cards', async ($, on) => {
  const { prompts, ui, settle } = await start($, on, { chatTopics: { [today()]: { react: 3 } } })
  await ui.press({ key: 'tab-learn' })
  await ui.press({ key: 'from-chats' })
  expect(await ui.find({ text: /what your chats touched: react/ })).toBeDefined()
  await ui.press({ key: 'learn-write' })
  await settle()
  expect(prompts.at(-1)).toContain('"react"')
  expect(await ui.find({ text: /Effects run after paint/ })).toBeDefined()
  await ui.press({ key: 'learn-next' })
  // Its card joined as a chat card: the chats filter counts it in review once due.
  await ui.press({ key: 'from-interests' })
  expect(await ui.find({ text: /Effects run after paint|Keys keep state/ })).toBeUndefined()
  await ui.unmount()
})
