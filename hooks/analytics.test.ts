import { expect, test } from 'claude-code/testing'

import type { Card, ChatTopics, ReviewEvent } from '../types'
import {
  dayKey,
  focusTopics,
  improve,
  interestRank,
  overview,
  recordChatTopics,
  sparkline,
  strong,
  topicInsights,
  workTopics,
} from './analytics'
import { DAY, dueCards, normTopic, parseChatReply } from './srs'

const NOW = new Date(2026, 9, 3, 12).getTime()
const daysAgo = (n: number) => NOW - n * DAY

function card(topic: string, over: Partial<Card> = {}): Card {
  return {
    id: `${topic}-${Math.random()}`,
    topic,
    front: `${topic} ${Math.random()}`,
    back: 'b',
    choices: [],
    answer: -1,
    source: 'chat',
    createdAt: 0,
    ease: 2.5,
    intervalDays: 0,
    reps: 0,
    learnedAt: 0,
    lapses: 0,
    due: NOW + DAY,
    seen: 0,
    correct: 0,
    ...over,
  }
}

const review = (topic: string, ago: number, grade: ReviewEvent['grade'] = 'good'): ReviewEvent => ({
  t: daysAgo(ago),
  cardId: 'x',
  topic,
  grade,
  mode: 'review',
})

test('normTopic merges spellings and aliases', async () => {
  expect(normTopic('  PostgreSQL ')).toBe('postgres')
  expect(normTopic('K8s')).toBe('kubernetes')
  expect(normTopic('System   Design')).toBe('system design')
  expect(normTopic('')).toBe('general')
})

test('parseChatReply reads the object shape and a bare array', async () => {
  const obj = parseChatReply(
    '{"topics":["PostgreSQL","Indexes","postgres"],"cards":[{"topic":"Postgres","front":"Why does Postgres need VACUUM after updates?","back":"Updates leave dead tuples; VACUUM reclaims them."}]}',
    [],
    NOW,
  )
  expect(obj.topics).toEqual(['postgres', 'indexes'])
  expect(obj.cards[0]?.topic).toBe('postgres')

  const bare = parseChatReply('[{"front":"Why does a Redis fork double memory?","back":"Copy-on-write."}]', [], NOW)
  expect(bare.topics).toEqual([])
  expect(bare.cards.length).toBe(1)

  expect(parseChatReply('{"topics":["react"],"cards":[]}', [], NOW)).toEqual({ topics: ['react'], cards: [] })
})

test('recordChatTopics counts today and drops days past 30', async () => {
  const old: ChatTopics = { [dayKey(daysAgo(40))]: { react: 9 }, [dayKey(NOW)]: { postgres: 1 } }
  const next = recordChatTopics(old, ['postgres', 'react'], NOW)
  expect(next[dayKey(NOW)]).toEqual({ postgres: 2, react: 1 })
  expect(next[dayKey(daysAgo(40))]).toBeUndefined()
})

test('overview: streak survives until the day after, gaps break it', async () => {
  const log = [review('a', 1), review('a', 2), review('a', 4), review('a', 1, 'again')]
  const o = overview([card('a', { intervalDays: 30, due: daysAgo(1) }), card('a')], log, NOW)
  expect(o.streakDays).toBe(2)
  expect(o.reviewsToday).toBe(0)
  expect(o.reviews7d.length).toBe(7)
  expect(o.reviews7d[5]).toBe(2)
  expect(o.retention30d).toBe(0.75)
  expect(o.matureCards).toBe(1)
  expect(o.dueNow).toBe(1)
  expect(sparkline([0, 1, 2])).toBe('▁▅█')
})

test('improve, strong and interests rank topics', async () => {
  const deck = [
    ...[1, 2, 3].map(() => card('typescript', { intervalDays: 21, seen: 5, correct: 5 })),
    card('postgres', { lapses: 2, seen: 4, correct: 1 }),
    card('postgres', { seen: 2, correct: 1 }),
    card('react', { seen: 2, correct: 1 }),
    card('react', { seen: 2, correct: 1, lapses: 2 }),
  ]
  const chat: ChatTopics = { [dayKey(NOW)]: { react: 3 }, [dayKey(daysAgo(2))]: { react: 1, kafka: 1 } }
  const t = topicInsights(deck, [review('typescript', 0)], chat, ['postgres'], NOW)

  expect(strong(t).map(r => r.topic)).toEqual(['typescript'])
  expect(improve(t, new Set()).map(r => r.topic).slice(0, 2).sort()).toEqual(['postgres', 'react'])
  expect(improve(t, new Set())[0]?.reason).toContain('recall')

  // react and postgres are equally weak; the focus decides which comes first.
  expect(improve(t, new Set(['react']))[0]?.topic).toBe('react')
  expect(improve(t, new Set(['postgres']))[0]?.topic).toBe('postgres')

  const ranked = interestRank(t)
  expect(ranked[0]?.topic).toBe('postgres')
  expect(ranked.find(r => r.topic === 'react')?.reason).toBe('chat')

  const work = workTopics(t)
  expect(work.map(w => w.topic)).toEqual(['react', 'kafka'])
  expect(work.find(w => w.topic === 'kafka')?.isThin).toBe(true)
  expect(work.find(w => w.topic === 'react')?.chatDays7).toBe(2)
})

test('focusTopics picks work, interests or both', async () => {
  const chat: ChatTopics = { [dayKey(NOW)]: { react: 1 } }
  const t = topicInsights([], [], chat, ['postgres'], NOW)
  expect([...focusTopics('work', t, ['postgres'])]).toEqual(['react'])
  expect([...focusTopics('interests', t, ['postgres'])]).toEqual(['postgres'])
  expect([...focusTopics('balanced', t, ['postgres'])].sort()).toEqual(['postgres', 'react'])
})

test('dueCards boost orders due cards only', async () => {
  const deck = [
    card('a', { due: daysAgo(3) }),
    card('react', { due: daysAgo(1) }),
    card('react', { due: NOW + DAY }),
  ]
  const due = dueCards(deck, NOW, new Set(['react']))
  expect(due.map(c => c.topic)).toEqual(['react', 'a'])
  expect(dueCards(deck, NOW).map(c => c.topic)).toEqual(['a', 'react'])
})
