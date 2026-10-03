import type { Focus } from '../types'

/** What a tip may look at to decide if it fits now. */
export type TipContext = {
  cards: number
  due: number
  interests: number
  /** Recall over the last 30 days, 0..1, or null. */
  retention: number | null
  thinWorkTopics: number
  focus: Focus
  streakDays: number
}

export type Tip = { id: string; text: string; when?: (ctx: TipContext) => boolean }

/** Plain words, short sentences: the same STE style as the cards. */
export const TIPS: Tip[] = [
  {
    id: 'start',
    text: 'Type /study <topic> to add an interest. Each one gives you 3 cards.',
    when: c => c.cards === 0,
  },
  {
    id: 'honest',
    text: 'Grade honestly. "again" brings a card back soon, and that is how you learn it.',
    when: c => c.retention !== null && c.retention > 0.95,
  },
  {
    id: 'daily',
    text: 'Review a few cards each day. Spaced practice keeps knowledge longer than one long session.',
    when: c => c.streakDays === 0 && c.cards > 0,
  },
  {
    id: 'focus-work',
    text: 'Your chat has topics with few cards. Set Focus to "daily work" and press +3 cards on insights → work.',
    when: c => c.thinWorkTopics > 0 && c.focus === 'interests',
  },
  {
    id: 'thin',
    text: 'Open insights → work. Topics marked "thin" need more cards; press +3 cards.',
    when: c => c.thinWorkTopics > 0,
  },
  {
    id: 'interests',
    text: 'Add 2 or 3 interests. The card level goes up when your mastery goes up.',
    when: c => c.interests < 2,
  },
  { id: 'keys', text: 'Keys: s shows the answer. j l move across the grades, enter or 1-4 grades. h shows all keys. esc closes the pane.' },
  { id: 'undo', text: 'Press u to undo a wrong grade. Undo also removes it from your stats.' },
  { id: 'chat', text: 'Cards from chat appear every 3 turns. Type /study chat to make them now.' },
  { id: 'focus', text: 'Use Focus "daily work" while you ship. Use "my interests" while you learn.' },
  { id: 'quiz', text: 'Use the quiz tab to test recall without the answer in view. Your answer grades the card.' },
  { id: 'stats', text: 'Type /study stats for a text summary of your progress.' },
]

/** The tips that fit now, then the ones that always fit. */
export function orderedTips(ctx: TipContext): Tip[] {
  const fitting = TIPS.filter(t => t.when?.(ctx) ?? false)
  return [...fitting, ...TIPS.filter(t => t.when === undefined)]
}

/** One tip for the tip line; `index` walks `orderedTips`. */
export function tipFor(ctx: TipContext, index = 0): Tip {
  const order = orderedTips(ctx)
  return order[((index % order.length) + order.length) % order.length] ?? TIPS[0]!
}
