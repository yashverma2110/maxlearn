import { expect, mock, test } from 'claude-code/testing'

import type { Card } from '../types'
import { arrowLines, arrowMap, focusOrder, keyAction, keyHint, mainElement, ringStep, type KeyContext } from './keymap'

const review: KeyContext = { mode: 'review', isRevealed: false, choices: 0, cursor: 0, hasCard: true }
const quiz: KeyContext = { mode: 'quiz', isRevealed: false, choices: 4, cursor: 1, hasCard: true }

test('review keys: space reveals, arrows grade, right skips while hidden', async () => {
  expect(keyAction({ key: ' ' }, review)).toEqual({ type: 'reveal' })
  expect(keyAction({ key: 'return' }, review)).toEqual({ type: 'reveal' })
  expect(keyAction({ key: 'right' }, review)).toEqual({ type: 'skip' })
  const shown = { ...review, isRevealed: true }
  // Arrows move the highlight across the grades; digits and enter grade.
  expect(keyAction({ key: 'left' }, shown)).toEqual({ type: 'ring', step: -1 })
  expect(keyAction({ key: 'up' }, shown)).toEqual({ type: 'ring', step: -1 })
  expect(keyAction({ key: 'right' }, shown)).toEqual({ type: 'ring', step: 1 })
  expect(keyAction({ key: 'down' }, shown)).toEqual({ type: 'ring', step: 1 })
  expect(keyAction({ key: ' ' }, shown)).toEqual({ type: 'grade', grade: 'good' })
  expect(keyAction({ key: '1' }, shown)).toEqual({ type: 'grade', grade: 'again' })
  expect(keyAction({ key: '4' }, shown)).toEqual({ type: 'grade', grade: 'easy' })
})

test('quiz keys: cursor stays in range, confirm picks the cursor, letters pick directly', async () => {
  expect(keyAction({ key: 'up' }, quiz)).toEqual({ type: 'cursor', index: 0 })
  expect(keyAction({ key: 'up' }, { ...quiz, cursor: 0 })).toEqual({ type: 'cursor', index: 0 })
  expect(keyAction({ key: 'k' }, { ...quiz, cursor: 3 })).toEqual({ type: 'cursor', index: 3 })
  expect(keyAction({ key: ' ' }, quiz)).toEqual({ type: 'choose', index: 1 })
  expect(keyAction({ key: 'c' }, quiz)).toEqual({ type: 'choose', index: 2 })
  expect(keyAction({ key: 'd' }, { ...quiz, choices: 3 })).toBeUndefined()
  expect(keyAction({ key: 'return' }, { ...quiz, isRevealed: true })).toEqual({ type: 'next' })
})

test('global keys work with no card; modified keys are left alone', async () => {
  const none = { ...review, hasCard: false }
  expect(keyAction({ key: ']' }, none)).toEqual({ type: 'tab', mode: 'quiz' })
  expect(keyAction({ key: 'left', shift: true }, none)).toEqual({ type: 'tab', mode: 'learn' })
  expect(keyAction({ key: 'u' }, none)).toEqual({ type: 'undo' })
  expect(keyAction({ key: '?' }, none)).toEqual({ type: 'help' })
  expect(keyAction({ key: ' ' }, none)).toBeUndefined()
  expect(keyAction({ key: 'u', ctrl: true }, review)).toBeUndefined()
  expect(keyHint(review)).toContain('reveals the answer')
  // i j k l sit like the arrows: i ↑ easy, j ← again, k ↓ hard, l → good.
  const shownCard = { ...review, isRevealed: true }
  // i j k l move the highlight across the grades, as the arrows do.
  expect(keyAction({ key: 'j' }, shownCard)).toEqual({ type: 'ring', step: -1 })
  expect(keyAction({ key: 'i' }, shownCard)).toEqual({ type: 'ring', step: -1 })
  expect(keyAction({ key: 'l' }, shownCard)).toEqual({ type: 'ring', step: 1 })
  expect(keyAction({ key: 'k' }, shownCard)).toEqual({ type: 'ring', step: 1 })
  expect(keyAction({ key: 'i' }, quiz)).toEqual({ type: 'cursor', index: 0 })
  expect(keyAction({ key: 'k' }, quiz)).toEqual({ type: 'cursor', index: 2 })
  expect(keyAction({ key: 'h' }, shownCard)).toEqual({ type: 'help' })
  expect(keyAction({ key: 'l' }, quiz)).toEqual({ type: 'choose', index: 1 })

  expect(mainElement(review)).toBe('reveal')
  expect(mainElement({ ...review, isRevealed: true })).toBe('grade-good')
  expect(mainElement(quiz)).toBe('choice-1')
  expect(mainElement({ ...quiz, isRevealed: true })).toBe('next')
  expect(mainElement(none)).toBeUndefined()
})

function card(over: Partial<Card>): Card {
  return {
    id: 'c1', topic: 'postgres', front: 'Why VACUUM?', back: 'To reclaim dead tuples.',
    choices: [], answer: -1, source: 'interest', createdAt: 0, ease: 2.5, intervalDays: 0,
    reps: 0, lapses: 0, due: 0, seen: 0, correct: 0, learnedAt: 0, ...over,
  }
}

const PANE = {
  component: 'Pane',
  requestId: 'maxlearn',
  props: {
    title: 'maxlearn', isFocused: true, bodyColumns: 50, placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 }, view: {},
  },
} as const

async function start($: any, on: any, deck: Card[]) {
  mock.clock(on)
  mock.store(on, { deck })
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.focus', async () => ({}))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
}

test('keyboard through the key strip: reveal, grade, undo', async ($, on) => {
  await start($, on, [card({})])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'maxlearn', surface, ...PANE })
    await ui.key({ key: ' ', in: 'keys' })
    expect(await ui.find({ key: 'grade-good' })).toBeDefined()
    await ui.key({ key: 'right', in: 'keys' }) // moves the highlight, grades nothing
    expect(await ui.find({ key: 'grade-good' })).toBeDefined()
    await ui.key({ key: '3', in: 'keys' })
    expect(await ui.find({ text: /Session done/ })).toBeDefined()
    await ui.key({ key: 'u', in: 'keys' })
    expect(await ui.find({ key: 'reveal' })).toBeDefined()
    await ui.press({ key: 'help' })
    expect(await ui.find({ text: /undo the last grade/ })).toBeDefined()
    await ui.press({ key: 'help' })
    await ui.unmount()
  }
})

test('keyboard quiz: arrows move the ▸ cursor, enter answers', async ($, on) => {
  await start($, on, [card({ choices: ['Speed', 'Dead tuples', 'Auth', 'Logs'], answer: 1 })])
  const ui = await $.ui.mount({ plugin: 'maxlearn', surface: 'terminal', ...PANE })
  await ui.key({ key: ']', in: 'keys' })
  expect((await ui.find({ key: 'tab-quiz' }))?.props.dimColor).toBe(false)
  await ui.key({ key: 'down', in: 'keys' })
  expect(String((await ui.find({ key: 'choice-1' }))?.props.label)).toContain('▸')
  await ui.key({ key: 'return', in: 'keys' })
  expect(await ui.find({ text: /Correct/ })).toBeDefined()
  await ui.unmount()
})

test('surfaces without a Client keep hotkey buttons and a text hint', async ($, on) => {
  await start($, on, [card({})])
  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'maxlearn', surface, ...PANE })
    // State outlives a mount: a tab change puts the card face down again.
    await ui.press({ key: 'tab-quiz' })
    await ui.press({ key: 'tab-review' })
    expect(await ui.find({ text: /reveals the answer/ })).toBeDefined()
    await ui.press({ key: 'reveal' })
    expect(await ui.find({ key: 'grade-good' })).toBeDefined()
    await ui.unmount()
  }
})

test('the focus ring moving onto a choice moves the ▸ cursor with it', async ($, on) => {
  await start($, on, [card({ choices: ['Speed', 'Dead tuples', 'Auth', 'Logs'], answer: 1 })])
  const ui = await $.ui.mount({ plugin: 'maxlearn', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-quiz' })
  expect(String((await ui.find({ key: 'choice-0' }))?.props.autoFocus)).toBe('true')
  // As the person's ↓↓ would: the ring lands on the third choice.
  await $.ui.focus({ component: 'Pane', requestId: 'maxlearn', element: 'choice-2', origin: { kind: 'person' } })
  expect(String((await ui.find({ key: 'choice-2' }))?.props.label)).toContain('▸')
  await ui.press({ key: 'choice-1' })
  expect(await ui.find({ text: /Correct/ })).toBeDefined()
  expect(String((await ui.find({ key: 'next' }))?.props.autoFocus)).toBe('true')
  await ui.unmount()
})

test('quiz with letter hotkeys only: j moves, l chooses, l goes on', async ($, on) => {
  await start($, on, [card({ choices: ['Speed', 'Dead tuples', 'Auth', 'Logs'], answer: 1 })])
  const ui = await $.ui.mount({ plugin: 'maxlearn', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-quiz' })
  await ui.press({ key: 'quiz-down' })
  expect(String((await ui.find({ key: 'choice-1' }))?.props.label)).toContain('▸')
  await ui.press({ key: 'quiz-choose' })
  expect(await ui.find({ text: /Correct/ })).toBeDefined()
  expect((await ui.find({ key: 'next' }))?.props.hotkey).toBe('l')
  await ui.unmount()
})

test('focusOrder walks a tree in draw order; ringStep stops at the ends', async () => {
  const tree = {
    type: 'Box',
    children: [
      { type: 'Text', children: ['x'] },
      { type: 'Button', props: { key: 'a' } },
      { type: 'Box', children: [[{ type: 'Button', props: { key: 'b' } }], { type: 'Select', props: { key: 'c' } }] },
    ],
  }
  const order = focusOrder(tree)
  expect(order).toEqual(['a', 'b', 'c'])
  expect(ringStep(order, undefined, 1)).toBe('a')
  expect(ringStep(order, undefined, -1)).toBe('c')
  expect(ringStep(order, 'b', 1)).toBe('c')
  expect(ringStep(order, 'c', 1)).toBe('c')
  expect(ringStep(order, 'a', -1)).toBe('a')
  expect(ringStep([], 'a', 1)).toBeUndefined()
})

test('i j k l move the highlight outside the card tabs; esc closes the pane', async ($, on) => {
  const opens: Record<string, unknown>[] = []
  mock.clock(on)
  mock.store(on, { deck: [card({})] })
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async (_$: unknown, e: Record<string, unknown>) => {
    opens.push(e)
    return { value: { isPlaced: true as const } }
  })
  on('ui.focus', async () => ({}))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect(opens.every(o => o.closeOnEscape === true)).toBe(true)

  const ui = await $.ui.mount({ plugin: 'maxlearn', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-settings' })
  // Nav keys sit in the footer here, and walk the settings' own buttons.
  expect((await ui.find({ key: 'nav-down' }))?.props.hotkey).toBe('k')
  for (const [nav, hotkey] of [['nav-up', 'i'], ['nav-left', 'j'], ['nav-down', 'k'], ['nav-right', 'l']]) {
    expect((await ui.find({ key: nav }))?.props.hotkey).toBe(hotkey)
  }
  // The kit has no site behind a plugin's own $.ui.focus, so the move itself is
  // covered by focusOrder/ringStep above; here pressing must be harmless.
  await ui.press({ key: 'nav-down' })
  await ui.press({ key: 'nav-up' })
  expect((await ui.find({ key: 'tab-settings' }))?.props.dimColor).toBe(false)

  // On the card tabs i j k l keep their card meanings: no nav buttons there.
  await ui.press({ key: 'tab-review' })
  expect(await ui.find({ key: 'nav-down' })).toBeUndefined()
  await ui.unmount()
})

test('the i j k l map: labels per state, shaped as an inverted T', async () => {
  const shownCard = { ...review, isRevealed: true }
  expect(arrowMap(shownCard)).toEqual({ i: '', j: '', k: '', l: '' })
  expect(arrowMap(review)).toEqual({ l: 'show' })
  expect(arrowMap({ ...review, hasCard: false })).toEqual({ i: '', j: '', k: '', l: '' })
  expect(arrowMap(quiz)).toEqual({ i: 'up', k: 'down', l: 'choose' })
  expect(arrowMap({ ...review, mode: 'settings' })).toEqual({ i: '', j: '', k: '', l: '' })

  const [top, bottom] = arrowLines(arrowMap(shownCard)!)
  expect(bottom).toBe('j: ←  k: ↓  l: →')
  expect(top.trimStart()).toBe('i: ↑')
  expect(top.indexOf('i:')).toBe(bottom.indexOf('k:')) // i sits over k
  const [qTop, qBottom] = arrowLines(arrowMap(quiz)!)
  expect(qTop.indexOf('i:')).toBe(qBottom.indexOf('k:'))
})

/** Every Button's hotkey in a drawn tree. */
function hotkeys(tree: unknown): string[] {
  const out: string[] = []
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (n === null || typeof n !== 'object') return
    const el = n as { type?: string; props?: { hotkey?: string }; children?: unknown }
    if (el.type === 'Button' && el.props?.hotkey) out.push(el.props.hotkey)
    walk(el.children)
  }
  walk(tree)
  return out
}

test('footer map on every tab, and no two buttons ever share a hotkey', async ($, on) => {
  await start($, on, [card({ choices: ['Speed', 'Dead tuples', 'Auth', 'Logs'], answer: 1 })])
  const ui = await $.ui.mount({ plugin: 'maxlearn', surface: 'terminal', ...PANE })
  const unique = async (where: string) => {
    const keys = hotkeys(await ui.drawn())
    expect({ where, dupes: keys.filter((k, n) => keys.indexOf(k) !== n) }).toEqual({ where, dupes: [] })
  }

  await ui.press({ key: 'tab-review' })
  await unique('review, face down')
  // The pane opens face down: the map is there too, and l shows the answer — on desktop as well.
  const desk = await $.ui.mount({ plugin: 'maxlearn', surface: 'desktop', ...PANE })
  expect((await desk.find({ key: 'show-key' }))?.props.label).toBe('→ show')
  await desk.unmount()
  expect((await ui.find({ key: 'show-key' }))?.props.hotkey).toBe('l')
  await ui.press({ key: 'show-key' })
  expect(await ui.find({ key: 'grade-good' })).toBeDefined()
  await ui.press({ key: 'tab-quiz' })
  await ui.press({ key: 'tab-review' })
  await ui.press({ key: 'reveal' })
  await unique('review, answer shown')
  // On a revealed card the map walks the grades: its cells are the nav buttons.
  expect((await ui.find({ key: 'nav-right' }))?.props.hotkey).toBe('l')
  expect((await ui.find({ key: 'grade-good' }))?.props.hotkey).toBe('3')

  await ui.press({ key: 'tab-quiz' })
  await unique('quiz')
  expect((await ui.find({ key: 'quiz-down' }))?.props.hotkey).toBe('k')
  expect((await ui.find({ key: 'quiz-choose' }))?.props.label).toBe('→ choose')

  for (const tab of ['tab-progress', 'tab-add', 'tab-settings']) {
    await ui.press({ key: tab })
    await unique(tab)
    expect((await ui.find({ key: 'nav-left' }))?.props.hotkey).toBe('j')
    expect((await ui.find({ key: 'nav-up' }))?.props.label).toBe('↑')
  }
  await ui.unmount()
})
