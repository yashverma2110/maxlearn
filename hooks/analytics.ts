import type { Card, ChatTopics, Focus, ReviewEvent, SessionTally } from '../types'
import { dueCards, topicStats, type TopicStats } from './srs'

const KEEP_CHAT_DAYS = 30
const MATURE_DAYS = 21
const THIN_CARDS = 3
/** Added to a favored topic's weakness score, so the focus wins a near tie. */
const FOCUS_BONUS = 0.25

/** The local calendar day of `t`, as `YYYY-MM-DD`. */
export function dayKey(t: number): string {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The day keys of the last `count` days, oldest first, ending today. */
export function lastDays(now: number, count: number): string[] {
  const keys: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    keys.push(dayKey(d.getTime()))
  }
  return keys
}

/** Adds one mention per topic to today's bucket and drops days past the window. */
export function recordChatTopics(chat: ChatTopics, topics: string[], now: number): ChatTopics {
  const today = dayKey(now)
  const bucket = { ...chat[today] }
  for (const topic of topics) bucket[topic] = (bucket[topic] ?? 0) + 1

  const keep = new Set(lastDays(now, KEEP_CHAT_DAYS))
  const next: ChatTopics = {}
  for (const [day, counts] of Object.entries({ ...chat, [today]: bucket })) {
    if (keep.has(day)) next[day] = counts
  }
  return next
}

export type Overview = {
  streakDays: number
  reviewsToday: number
  /** Reviews per day, oldest first, today last. */
  reviews7d: number[]
  /** 0..1, or null with no reviews in 30 days. */
  retention30d: number | null
  matureCards: number
  totalCards: number
  dueNow: number
}

export function overview(deck: Card[], reviews: ReviewEvent[], now: number): Overview {
  const perDay = new Map<string, number>()
  for (const r of reviews) perDay.set(dayKey(r.t), (perDay.get(dayKey(r.t)) ?? 0) + 1)

  // A streak survives until the end of the day after the last review.
  const days = lastDays(now, 400).reverse()
  const from = (perDay.get(days[0] ?? '') ?? 0) > 0 ? 0 : 1
  let streakDays = 0
  for (const day of days.slice(from)) {
    if ((perDay.get(day) ?? 0) === 0) break
    streakDays += 1
  }

  const window = new Set(lastDays(now, 30))
  const recent = reviews.filter(r => window.has(dayKey(r.t)))
  return {
    streakDays,
    reviewsToday: perDay.get(dayKey(now)) ?? 0,
    reviews7d: lastDays(now, 7).map(day => perDay.get(day) ?? 0),
    retention30d:
      recent.length === 0 ? null : recent.filter(r => r.grade !== 'again').length / recent.length,
    matureCards: deck.filter(c => c.intervalDays >= MATURE_DAYS).length,
    totalCards: deck.length,
    dueNow: dueCards(deck, now).length,
  }
}

export type TopicInsight = TopicStats & {
  lapses: number
  /** Recall over the last 14 days, 0..1, or null with no reviews there. */
  recentAccuracy: number | null
  /** Days in the last 7 on which chat touched the topic. */
  chatDays7: number
  chatMentions7: number
  chatMentions30: number
  reviews30: number
  isInterest: boolean
}

/** Every topic in the deck, the chat window or the interests, with its signals. */
export function topicInsights(
  deck: Card[],
  reviews: ReviewEvent[],
  chat: ChatTopics,
  interests: string[],
  now: number,
): TopicInsight[] {
  const stats = new Map(topicStats(deck, now).map(s => [s.topic, s]))
  const week = lastDays(now, 7)
  const days14 = new Set(lastDays(now, 14))
  const days30 = new Set(lastDays(now, 30))
  const saved = new Set(interests)

  const topics = new Set([...stats.keys(), ...interests])
  for (const counts of Object.values(chat)) for (const topic of Object.keys(counts)) topics.add(topic)

  return [...topics].map(topic => {
    const base = stats.get(topic) ?? { topic, cards: 0, due: 0, mastery: 0, accuracy: null }
    const recent = reviews.filter(r => r.topic === topic && days14.has(dayKey(r.t)))
    return {
      ...base,
      lapses: deck.filter(c => c.topic === topic).reduce((n, c) => n + c.lapses, 0),
      recentAccuracy:
        recent.length === 0 ? null : recent.filter(r => r.grade !== 'again').length / recent.length,
      chatDays7: week.filter(day => (chat[day]?.[topic] ?? 0) > 0).length,
      chatMentions7: week.reduce((n, day) => n + (chat[day]?.[topic] ?? 0), 0),
      chatMentions30: Object.entries(chat)
        .filter(([day]) => days30.has(day))
        .reduce((n, [, counts]) => n + (counts[topic] ?? 0), 0),
      reviews30: reviews.filter(r => r.topic === topic && days30.has(dayKey(r.t))).length,
      isInterest: saved.has(topic),
    }
  })
}

export type Ranked = TopicInsight & { reason: string }

const pct = (x: number) => `${Math.round(x * 100)}%`

/** Topics used in chat this week, most days first; thin ones need cards. */
export function workTopics(insights: TopicInsight[]): (TopicInsight & { isThin: boolean })[] {
  return insights
    .filter(t => t.chatDays7 > 0)
    .sort((a, b) => b.chatDays7 - a.chatDays7 || b.chatMentions7 - a.chatMentions7)
    .map(t => ({ ...t, isThin: t.cards < THIN_CARDS }))
}

/** The topics the person's focus favors. */
export function focusTopics(focus: Focus, insights: TopicInsight[], interests: string[]): Set<string> {
  const work = workTopics(insights).map(t => t.topic)
  if (focus === 'work') return new Set(work)
  if (focus === 'interests') return new Set(interests)
  return new Set([...work, ...interests])
}

/** Weakest topics first; a favored topic gets a bonus. */
export function improve(insights: TopicInsight[], favored: ReadonlySet<string>, limit = 3): Ranked[] {
  const score = (t: TopicInsight) =>
    0.5 * (1 - t.mastery) +
    0.3 * (1 - (t.recentAccuracy ?? t.accuracy ?? 0.5)) +
    0.2 * Math.min(1, t.lapses / t.cards) +
    (favored.has(t.topic) ? FOCUS_BONUS : 0)

  // A topic held well is not one to improve, however few topics there are.
  const isHeld = (t: TopicInsight) =>
    t.mastery >= 0.6 && (t.recentAccuracy ?? t.accuracy ?? 0) >= 0.8
  return insights
    .filter(t => t.cards >= 2 && !isHeld(t))
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit)
    .map(t => {
      const recall = t.recentAccuracy ?? t.accuracy
      const parts = [recall === null ? 'new' : `${pct(recall)} recall`]
      if (t.lapses > 0) parts.push(`${t.lapses} lapse${t.lapses === 1 ? '' : 's'}`)
      return { ...t, reason: parts.join(' · ') }
    })
}

/** Topics held well: mature-ish, recalled, enough cards to trust it. */
export function strong(insights: TopicInsight[], limit = 3): Ranked[] {
  return insights
    .filter(t => t.cards >= 3 && t.mastery >= 0.6 && (t.recentAccuracy ?? t.accuracy ?? 0) >= 0.8)
    .sort((a, b) => b.mastery - a.mastery)
    .slice(0, limit)
    .map(t => ({ ...t, reason: `${pct(t.recentAccuracy ?? t.accuracy ?? 0)} recall` }))
}

/** What the person cares about: saved interests, chat mentions and study, each 0..1. */
export function interestRank(insights: TopicInsight[], limit = 5): Ranked[] {
  const maxChat = Math.max(1, ...insights.map(t => t.chatMentions30))
  const maxStudy = Math.max(1, ...insights.map(t => t.reviews30))
  const score = (t: TopicInsight) =>
    (t.isInterest ? 1 : 0) + t.chatMentions30 / maxChat + t.reviews30 / maxStudy

  return insights
    .filter(t => score(t) > 0)
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit)
    .map(t => {
      const tags = [t.isInterest && 'saved', t.chatMentions30 > 0 && 'chat', t.reviews30 > 0 && 'studied']
      return { ...t, reason: tags.filter(Boolean).join(' · ') }
    })
}

/** `▁▂▃▄▅▆▇█` scaled to the largest value; zero is the lowest bar. */
export function sparkline(values: number[]): string {
  const bars = '▁▂▃▄▅▆▇█'
  const max = Math.max(...values, 0)
  return values.map(v => bars[max === 0 ? 0 : Math.round((v / max) * (bars.length - 1))]).join('')
}

/** `●●●○○○○` for days active out of 7. */
export function dots(days: number): string {
  return '●'.repeat(days) + '○'.repeat(Math.max(0, 7 - days))
}

export const HEAT_WEEKS = 12

/**
 * Reviews per day over the last `weeks` weeks as rows Monday..Sunday and
 * columns oldest..this week; days after today are -1.
 */
export function heatmap(reviews: ReviewEvent[], now: number, weeks = HEAT_WEEKS): number[][] {
  const perDay = new Map<string, number>()
  for (const r of reviews) perDay.set(dayKey(r.t), (perDay.get(dayKey(r.t)) ?? 0) + 1)

  const today = new Date(now)
  const weekday = (today.getDay() + 6) % 7 // Monday 0
  const grid: number[][] = Array.from({ length: 7 }, () => new Array<number>(weeks).fill(-1))
  for (let col = 0; col < weeks; col++) {
    for (let row = 0; row < 7; row++) {
      const back = (weeks - 1 - col) * 7 + (weekday - row)
      if (back < 0) continue
      const d = new Date(now)
      d.setDate(d.getDate() - back)
      grid[row]![col] = perDay.get(dayKey(d.getTime())) ?? 0
    }
  }
  return grid
}

/** 0..4: how dark a heat-map cell is, against the busiest day shown. */
export function heatLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0
  return Math.max(1, Math.min(4, Math.ceil((count / max) * 4)))
}

export function sessionSummary(tally: SessionTally, o: Overview): string {
  const recall = tally.reviewed === 0 ? '' : ` · ${Math.round((tally.correct / tally.reviewed) * 100)}% recall`
  const streak = o.streakDays > 0 ? ` · 🔥 ${o.streakDays}-day streak` : ''
  return `${tally.reviewed} reviewed${recall}${streak}`
}

const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 365]

/**
 * The milestone `streakDays` reached today, unless already shown today; a
 * streak that breaks and grows back earns it again. Keys are `day:days`.
 */
export function streakMilestone(streakDays: number, shown: string[], now: number): string | undefined {
  const key = `${dayKey(now)}:${streakDays}`
  return STREAK_MILESTONES.includes(streakDays) && !shown.includes(key) ? key : undefined
}
