import { expect, mock, test } from 'claude-code/testing'

import type { Card, ReviewEvent } from '../types'
import { dayKey, heatLevel, heatmap, improve, sessionSummary, streakMilestone, topicInsights, overview } from './analytics'
import { ROOMY_FROM, density } from './layout'
import { DAY, previewInterval, schedule, shortWait } from './srs'
import { TIPS, orderedTips, tipFor, type TipContext } from './tips'

const NOW = new Date(2026, 9, 3, 12).getTime() // a Saturday

function card(over: Partial<Card> = {}): Card {
  return {
    id: 'c1', topic: 'postgres', front: 'Why VACUUM?', back: 'To reclaim dead tuples.',
    choices: [], answer: -1, source: 'interest', createdAt: 0, ease: 2.5, intervalDays: 0,
    reps: 0, lapses: 0, due: 0, seen: 0, correct: 0, learnedAt: 0, ...over,
  }
}
const review = (daysAgo: number, grade: ReviewEvent['grade'] = 'good', topic = 'postgres'): ReviewEvent => ({
  t: NOW - daysAgo * DAY, cardId: 'c1', topic, grade, mode: 'review',
})

test('density switches at the roomy threshold', async () => {
  expect(density(ROOMY_FROM - 1)).toBe('compact')
  expect(density(ROOMY_FROM)).toBe('roomy')
  expect(density(undefined)).toBe('compact')
})

test('heatmap: 7 × 12, today in the last column on its weekday, future days -1', async () => {
  const grid = heatmap([review(0), review(0), review(7)], NOW)
  expect(grid.length).toBe(7)
  expect(grid.every(row => row.length === 12)).toBe(true)
  const saturday = 5 // Monday is row 0
  expect(grid[saturday]?.[11]).toBe(2)
  expect(grid[saturday]?.[10]).toBe(1)
  expect(grid[6]?.[11]).toBe(-1) // Sunday has not come yet
  expect(heatLevel(0, 4)).toBe(0)
  expect(heatLevel(1, 4)).toBe(1)
  expect(heatLevel(4, 4)).toBe(4)
})

test('previewInterval is the schedule without jitter; shortWait reads well', async () => {
  const c = card({ reps: 2, intervalDays: 3 })
  for (const g of ['again', 'hard', 'good', 'easy'] as const) {
    expect(previewInterval(c, g)).toBe(schedule(c, g, 0, 1).due)
  }
  expect(shortWait(10 * 60_000)).toBe('10m')
  expect(shortWait(3 * DAY)).toBe('3d')
  expect(shortWait(90 * DAY)).toBe('3mo')
})

test('improve leaves out a topic held well, even when it is the only one', async () => {
  const held = [1, 2, 3].map(n => card({ id: `h${n}`, front: `q${n}`, intervalDays: 21, seen: 5, correct: 5 }))
  const t = topicInsights(held, [], {}, [], NOW)
  expect(improve(t, new Set()).length).toBe(0)
})

test('session summary and streak milestones', async () => {
  const o = overview([card()], [review(0), review(1), review(2)], NOW)
  expect(sessionSummary({ reviewed: 4, correct: 3, startedAt: 0 }, o)).toBe('4 reviewed · 75% recall · 🔥 3-day streak')
  expect(streakMilestone(3, [], NOW)).toBe(`${dayKey(NOW)}:3`)
  expect(streakMilestone(3, [`${dayKey(NOW)}:3`], NOW)).toBeUndefined()
  expect(streakMilestone(4, [], NOW)).toBeUndefined()
})

test('tips: the ones that fit first, every tip reachable', async () => {
  const ctx: TipContext = {
    cards: 0, due: 0, interests: 0, retention: null, thinWorkTopics: 0, focus: 'balanced', streakDays: 0,
  }
  expect(tipFor(ctx).id).toBe('start')
  expect(orderedTips(ctx).length).toBeGreaterThan(5)
  expect(tipFor({ ...ctx, cards: 5, retention: 0.99, interests: 3, streakDays: 2 }).id).toBe('honest')
  expect(new Set(TIPS.map(t => t.id)).size).toBe(TIPS.length)
})

const pane = (bodyColumns: number) =>
  ({
    component: 'Pane',
    requestId: 'maxlearn',
    props: {
      title: 'maxlearn', isFocused: true, bodyColumns, placement: 'dock',
      scroll: { offset: 0, bodyRows: 60 }, view: {},
    },
  }) as const

async function start($: any, on: any, store: Record<string, unknown>) {
  mock.clock(on)
  mock.store(on, store)
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.focus', async () => ({}))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
}

test('every surface at both widths: header, grade intervals, summary, insights, tips', async ($, on) => {
  await start($, on, { deck: [card()], interests: ['postgres'] })

  for (const columns of [40, 60]) {
    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ plugin: 'maxlearn', surface, ...pane(columns) })
      const roomy = columns >= ROOMY_FROM

      // Header: tabs, short or long, and the due count on one row.
      await ui.press({ key: 'tab-review' })
      expect((await ui.find({ key: 'tab-progress' }))?.props.label).toBe(roomy ? 'insights' : 'ins')
      expect(await ui.find({ text: /\d+ due/ })).toBeDefined()

      // Insights overview: a Raster heat map only on a roomy terminal.
      await ui.press({ key: 'tab-progress' })
      await ui.press({ key: 'ins-overview' })
      const heat = await ui.find({ key: 'heatmap' })
      if (!roomy) expect(heat).toBeUndefined()
      else expect(heat?.type).toBe(surface === 'terminal' ? 'Raster' : 'Box')

      // Tips under more.
      await ui.press({ key: 'tab-add' })
      await ui.press({ key: 'more-tips' })
      expect(await ui.find({ text: /\/study chat/ })).toBeDefined()
      await ui.press({ key: 'more-actions' })
      await ui.unmount()
    }
  }

  // Review the one due card: the grade buttons say when it comes back, then the summary.
  const ui = await $.ui.mount({ plugin: 'maxlearn', surface: 'terminal', ...pane(60) })
  await ui.press({ key: 'tab-review' })
  await ui.press({ key: 'reveal' })
  expect((await ui.find({ key: 'grade-good' }))?.props.label).toBe('good · 1d')
  expect((await ui.find({ key: 'grade-again' }))?.props.label).toBe('again · 10m')
  expect(await ui.find({ text: /💡/ })).toBeDefined()

  // The card comes first, framed; every key binding sits in the footer after it.
  const tree = JSON.stringify(await ui.drawn())
  const cardAt = tree.indexOf('"borderStyle":"round"')
  expect(cardAt).toBeGreaterThan(-1)
  expect(cardAt).toBeLessThan(tree.indexOf('Why VACUUM'))
  // Tabs and the source filter on top, the card in the middle, the keys in the footer.
  expect(tree.indexOf('"key":"tab-review"')).toBeLessThan(cardAt)
  expect(tree.indexOf('"key":"from-chats"')).toBeLessThan(cardAt)
  for (const footerKey of ['"key":"undo"', '"key":"drop"']) {
    expect(tree.indexOf(footerKey)).toBeGreaterThan(tree.indexOf('"key":"grade-easy"'))
  }
  // The active tab is bright, the rest dim: no marker needed.
  expect((await ui.find({ key: 'tab-review' }))?.props.dimColor).toBe(false)
  expect((await ui.find({ key: 'tab-quiz' }))?.props.dimColor).toBe(true)

  // The footer sits at the bottom of the pane: the root fills the body's rows
  // and pushes its last child (the footer) down.
  type El = { props: Record<string, unknown>; children: El[] }
  const root = (await ui.drawn()) as El
  const kids = root.children.filter(Boolean)
  expect(root.props.minHeight).toBe(60)
  // Tabs on top, then spacer, card, spacer, footer: the card in the middle, the footer at the bottom.
  expect(kids[0]?.props.key).toBe('top')
  expect(JSON.stringify(kids[0])).toContain('"key":"tab-learn"')
  expect(kids[1]?.props.key).toBe('space-above')
  expect(kids[1]?.props.flexGrow).toBe(1)
  expect(JSON.stringify(kids[2])).toContain('"borderStyle":"round"')
  expect(kids[3]?.props.key).toBe('space-below')
  expect(JSON.stringify(kids.at(-1))).not.toContain('"key":"tab-review"') // tabs live on top now
  expect(JSON.stringify(kids.at(-1))).toContain('── Shortcuts ──')
  await ui.press({ key: 'grade-good' })
  expect(await ui.find({ text: /Session done/ })).toBeDefined()
  expect(await ui.find({ text: /1 reviewed · 100% recall/ })).toBeDefined()
  expect(await ui.find({ key: 'next-topic' })).toBeDefined()

  // Undo takes the review back out of the tally.
  await ui.press({ key: 'undo' })
  expect(await ui.find({ key: 'reveal' })).toBeDefined()
  await ui.unmount()
})

test('the line under the prompt spins with the topic while cards are written', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on, { deck: [card()], interests: ['postgres'] })
  const statuses: (string | undefined)[] = []
  let finish: (text: string) => void = () => {}
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.status', async (_$: unknown, e: { text: string | undefined }) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.focus', async () => ({}))
  // The model answers only when the test says so, so the spinner has time to run.
  on('model.complete', () =>
    new Promise(resolve => {
      finish = text =>
        resolve({
          value: {
            isAnswered: true,
            text,
            usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
        })
    }),
  )
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'maxlearn', surface: 'terminal', ...pane(60) })
  await ui.press({ key: 'tab-add' })
  await ui.press({ key: 'more-postgres' })
  await clock.advance(1)
  await clock.advance(2000)

  const writing = statuses.filter(s => s?.includes('Writing cards on postgres'))
  expect(writing.length).toBeGreaterThan(1)
  expect(writing.at(-1)).toContain('· 2s')
  expect(new Set(writing.map(s => s?.[0])).size).toBeGreaterThan(1) // the spinner moves
  expect(await ui.find({ text: /⟳ postgres/ })).toBeDefined()

  finish('[{"topic":"postgres","front":"What does MVCC keep?","back":"Old row versions."}]')
  await clock.advance(200)
  expect(statuses.at(-1)).toMatch(/^📚 \d+ due/)
  expect(await ui.find({ text: /⟳/ })).toBeUndefined()
  await ui.unmount()
})

test('off the terminal the footer is one framed block: no drawn rule, status beside the title', async ($, on) => {
  await start($, on, { deck: [card({ learnedAt: 0 })] })
  const desk = await $.ui.mount({ plugin: 'maxlearn', surface: 'desktop', ...pane(60) })
  type El = { type: string; props: Record<string, unknown>; children: El[] }
  const root = (await desk.drawn()) as El
  const footer = root.children.filter(Boolean).at(-1)!
  expect(footer.props.borderStyle).toBe('round')
  const tree = JSON.stringify(footer)
  expect(tree).not.toContain('──')
  const title = footer.children[0]!
  expect(JSON.stringify(title)).toContain('Shortcuts')
  expect(JSON.stringify(title)).toMatch(/\d+ due/)
  expect((await desk.find({ key: 'tab-review' }))?.props.hotkey).toBe('r')
  await desk.unmount()

  const term = await $.ui.mount({ plugin: 'maxlearn', surface: 'terminal', ...pane(60) })
  expect(await term.find({ text: /── Shortcuts ──/ })).toBeDefined()
  await term.unmount()
})
