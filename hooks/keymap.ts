import type { Grade, Mode } from '../types'

/** Tab order for `[`, `]` and shift+arrows. */
export const TAB_ORDER: Mode[] = ['learn', 'review', 'quiz', 'progress', 'add', 'settings']

export type KeyContext = {
  mode: Mode
  isRevealed: boolean
  /** Choices on the current quiz card; 0 when none. */
  choices: number
  /** The highlighted choice in quiz mode. */
  cursor: number
  hasCard: boolean
}

export type KeyAction =
  | { type: 'reveal' }
  | { type: 'grade'; grade: Grade }
  | { type: 'skip' }
  | { type: 'choose'; index: number }
  | { type: 'cursor'; index: number }
  | { type: 'next' }
  | { type: 'tab'; mode: Mode }
  | { type: 'undo' }
  | { type: 'help' }
  /** Move the highlight back (-1) or forward (1), as an arrow key would. */
  | { type: 'ring'; step: -1 | 1 }

export type Key = { key: string; shift?: boolean; ctrl?: boolean; meta?: boolean }

const isConfirm = (k: string) => k === ' ' || k === 'space' || k === 'return' || k === 'enter'
const GRADE_DIGITS: Record<string, Grade> = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' }
const CHOICE_KEYS = ['a', 'b', 'c', 'd']

/** What one key does in this context, or undefined to ignore it. */
export function keyAction(k: Key, ctx: KeyContext): KeyAction | undefined {
  if (k.ctrl || k.meta) return undefined

  // Anywhere in the pane.
  const tab = TAB_ORDER.indexOf(ctx.mode)
  const step = (d: number) => TAB_ORDER[(tab + d + TAB_ORDER.length) % TAB_ORDER.length] ?? 'review'
  if (k.key === ']' || (k.shift && k.key === 'right')) return { type: 'tab', mode: step(1) }
  if (k.key === '[' || (k.shift && k.key === 'left')) return { type: 'tab', mode: step(-1) }
  if (k.key === '?' || k.key === 'h') return { type: 'help' }
  if (k.key === 'u') return { type: 'undo' }
  if (!ctx.hasCard) return undefined

  if (ctx.mode === 'review') {
    if (!ctx.isRevealed) {
      if (isConfirm(k.key) || k.key === 's' || k.key === 'l') return { type: 'reveal' }
      if (k.key === 'right' || k.key === 'n') return { type: 'skip' }
      return undefined
    }
    const digit = GRADE_DIGITS[k.key]
    if (digit) return { type: 'grade', grade: digit }
    // i j k l sit like the arrows: i ↑, j ←, k ↓, l →.
    // Arrows and i j k l move the highlight across the grades; 1-4 and enter grade.
    if (['left', 'up', 'j', 'i'].includes(k.key)) return { type: 'ring', step: -1 }
    if (['right', 'down', 'l', 'k'].includes(k.key)) return { type: 'ring', step: 1 }
    if (isConfirm(k.key)) return { type: 'grade', grade: 'good' }
    return undefined
  }

  if (ctx.mode === 'quiz') {
    if (ctx.isRevealed) {
      return isConfirm(k.key) || k.key === 'right' || k.key === 'l' || k.key === 'n' ? { type: 'next' } : undefined
    }
    const last = ctx.choices - 1
    if (k.key === 'up' || k.key === 'i') return { type: 'cursor', index: Math.max(0, ctx.cursor - 1) }
    if (k.key === 'down' || k.key === 'k') return { type: 'cursor', index: Math.min(last, ctx.cursor + 1) }
    if (isConfirm(k.key) || k.key === 'l') return { type: 'choose', index: ctx.cursor }
    const direct = CHOICE_KEYS.indexOf(k.key) >= 0 ? CHOICE_KEYS.indexOf(k.key) : Number(k.key) - 1
    if (Number.isInteger(direct) && direct >= 0 && direct <= last) return { type: 'choose', index: direct }
    if (k.key === 'right' || k.key === 'n') return { type: 'skip' }
  }
  return undefined
}

/**
 * The element that should hold the pane's focus ring now, so Enter does the
 * obvious thing and the arrows start from it; undefined when nothing to act on.
 */
export function mainElement(ctx: KeyContext): string | undefined {
  if (!ctx.hasCard) return undefined
  if (ctx.mode === 'review') return ctx.isRevealed ? 'grade-good' : 'reveal'
  if (ctx.mode === 'quiz') return ctx.isRevealed ? 'next' : `choice-${ctx.cursor}`
  return undefined
}

/** What i j k l do right now, as the arrows they stand in for; absent keys do nothing. */
export type ArrowMap = Partial<Record<'i' | 'j' | 'k' | 'l', string>>

const ARROW: Record<keyof ArrowMap, string> = { i: '↑', j: '←', k: '↓', l: '→' }

/** Shown in every state, so the keys are always in view. */
export function arrowMap(ctx: KeyContext): ArrowMap {
  // Other tabs, and a study tab with nothing due: the keys walk the highlight.
  if ((ctx.mode !== 'review' && ctx.mode !== 'quiz') || !ctx.hasCard) return { i: '', j: '', k: '', l: '' }
  if (ctx.mode === 'review') return ctx.isRevealed ? { i: '', j: '', k: '', l: '' } : { l: 'show' }
  return ctx.isRevealed ? { l: 'next' } : { i: 'up', k: 'down', l: 'choose' }
}

/** One key's cell in the map: `i: ↑ easy`, or `j: ←` with no word. */
export function arrowCell(key: keyof ArrowMap, word: string | undefined): string {
  return word === undefined ? '' : `${key}: ${ARROW[key]}${word === '' ? '' : ` ${word}`}`
}

/**
 * The map as two lines in the shape of the keys, an inverted T: `i` above `k`,
 * `j k l` below. The top line is padded so `i` sits over `k`.
 */
export function arrowLines(map: ArrowMap): [string, string] {
  const left = arrowCell('j', map.j)
  const bottom = [left, arrowCell('k', map.k), arrowCell('l', map.l)].filter(c => c !== '').join('  ')
  const over = map.k === undefined ? 0 : left === '' ? 0 : left.length + 2
  return [' '.repeat(over) + arrowCell('i', map.i), bottom]
}

/**
 * The hint beside the map: the keys that are not i j k l. It describes the
 * pane's focus ring (Enter presses); space needs the ⌨ strip clicked.
 */
export function keyHint(ctx: KeyContext): string {
  if (ctx.mode === 'learn') return 'enter: next, adds it to review'
  if (ctx.mode !== 'review' && ctx.mode !== 'quiz') return 'enter selects · esc closes'
  if (!ctx.hasCard) return 'enter selects · esc closes'
  if (ctx.mode === 'review') return ctx.isRevealed ? 'enter grades · 1 again 2 hard 3 good 4 easy' : 's or enter reveals the answer'
  return ctx.isRevealed ? 'enter: next card' : 'a–d pick · enter chooses'
}

export const HELP_LINES: [string, string][] = [
  ['s', 'reveal the answer'],
  ['j l  i k', 'move across the grades (← → ↑ ↓)'],
  ['1 2 3 4', 'grade again · hard · good · easy'],
  ['enter', 'grade the highlighted one'],
  ['i k', 'move up / down the quiz choices'],
  ['l', 'choose the quiz choice / next'],
  ['a–d', 'pick a quiz choice'],
  ['n', 'skip a card'],
  ['enter', 'press the highlighted button'],
  ['u', 'undo the last grade'],
  ['d', 'drop a bad card for good'],
  ['z', 'simplify the lesson shown'],
  ['r q p m o', 'review · quiz · insights · more · settings'],
  ['h', 'show or hide this list'],
  ['x', 'close the pane'],
  ['i j k l', 'move the highlight on insights, more, settings'],
  ['esc', 'close the pane (/study opens it again)'],
  ['click ⌨', 'arrows too, if no keybinding takes them'],
]

const FOCUSABLE = new Set(['Button', 'Input', 'Select'])

/** The keys of the focusable elements in a drawn tree, in draw order: the order the ring walks. */
export function focusOrder(tree: unknown): string[] {
  const keys: string[] = []
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (node === null || typeof node !== 'object') return
    const el = node as { type?: unknown; props?: { key?: unknown }; children?: unknown }
    if (typeof el.type === 'string' && FOCUSABLE.has(el.type) && typeof el.props?.key === 'string') {
      keys.push(el.props.key)
    }
    walk(el.children)
  }
  walk(tree)
  return keys
}

/**
 * Where i j k l move the highlight outside the card tabs: back (i, j) or
 * forward (k, l) through `order`, stopping at the ends. Nothing focused yet
 * starts at the first element going forward, the last going back.
 */
export function ringStep(order: string[], current: string | undefined, step: -1 | 1): string | undefined {
  if (order.length === 0) return undefined
  const at = current === undefined ? -1 : order.indexOf(current)
  if (at < 0) return step > 0 ? order[0] : order[order.length - 1]
  return order[Math.max(0, Math.min(order.length - 1, at + step))]
}
