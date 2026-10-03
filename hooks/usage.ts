import type { ChatSession, ReviewEvent } from '../types'

/** Chats kept for the chats view and the time totals. */
export const KEEP_CHATS = 30
/** One grade or lesson counts at most this long, so a card left open overnight does not. */
export const MAX_STUDY_MS = 5 * 60 * 1000

/**
 * Adds `ms` of chat time to this chat, split evenly over the topics it touched;
 * the chat goes first in the list, which keeps the newest `KEEP_CHATS`.
 */
export function attributeChat(
  chats: ChatSession[],
  id: string,
  label: string,
  topics: string[],
  ms: number,
  now: number,
): ChatSession[] {
  if (topics.length === 0) return chats
  const found = chats.find(c => c.id === id)
  const chat: ChatSession = found
    ? { ...found, topics: { ...found.topics } }
    : { id, label, startedAt: now, lastAt: now, topics: {} }
  chat.lastAt = now
  const share = Math.max(0, ms) / topics.length
  for (const topic of topics) chat.topics[topic] = (chat.topics[topic] ?? 0) + share
  return [chat, ...chats.filter(c => c.id !== id)].slice(0, KEEP_CHATS)
}

export type TopicUsage = {
  topic: string
  /** Chat time on the topic, over the kept chats. */
  chatMs: number
  /** How many of the kept chats touched it. */
  chats: number
  /** Time grading its cards (reviews and quizzes). */
  reviewMs: number
  /** Time reading its lessons. */
  learnMs: number
}

/** Where your time went, per topic: most total time first. */
export function topicUsage(
  chats: ChatSession[],
  reviews: ReviewEvent[],
  learnTime: Record<string, number>,
): TopicUsage[] {
  const by = new Map<string, TopicUsage>()
  const at = (topic: string) => {
    let u = by.get(topic)
    if (u === undefined) {
      u = { topic, chatMs: 0, chats: 0, reviewMs: 0, learnMs: 0 }
      by.set(topic, u)
    }
    return u
  }
  for (const chat of chats) {
    for (const [topic, ms] of Object.entries(chat.topics)) {
      const u = at(topic)
      u.chatMs += ms
      u.chats += 1
    }
  }
  for (const r of reviews) if (r.ms) at(r.topic).reviewMs += r.ms
  for (const [topic, ms] of Object.entries(learnTime)) at(topic).learnMs += ms
  const total = (u: TopicUsage) => u.chatMs + u.reviewMs + u.learnMs
  return [...by.values()].filter(u => total(u) > 0).sort((a, b) => total(b) - total(a))
}

/** `<1m`, `15m`, `1h 20m`. */
export function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const rest = minutes % 60
  return rest === 0 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 60)}h ${rest}m`
}

/** How long something was on screen, capped so an idle card does not count. */
export function studyMs(shownAt: number | undefined, now: number): number {
  return shownAt === undefined ? 0 : Math.min(MAX_STUDY_MS, Math.max(0, now - shownAt))
}

/** A short name for a chat: its first prompt, cut on a word. */
export function chatLabel(firstPrompt: string | undefined, folder: string): string {
  const text = (firstPrompt ?? '').replace(/\s+/g, ' ').trim()
  if (text === '') return folder
  if (text.length <= 40) return text
  const cut = text.slice(0, 39)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 20)).trim()}…`
}
