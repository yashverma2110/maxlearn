import { expect, test } from 'claude-code/testing'

import type { ReviewEvent } from '../types'
import { KEEP_CHATS, MAX_STUDY_MS, attributeChat, chatLabel, duration, studyMs, topicUsage } from './usage'

const MIN = 60_000

test('chat time splits over the topics a chat touched, newest chat first', async () => {
  let chats = attributeChat([], 's1', 'fix redis cache', ['redis', 'postgres'], 20 * MIN, 1)
  chats = attributeChat(chats, 's2', 'react hooks', ['react'], 10 * MIN, 2)
  chats = attributeChat(chats, 's1', 'fix redis cache', ['redis'], 5 * MIN, 3)
  expect(chats.map(c => c.id)).toEqual(['s1', 's2'])
  expect(chats[0]?.topics).toEqual({ redis: 15 * MIN, postgres: 10 * MIN })
  expect(attributeChat(chats, 's3', 'x', [], MIN, 4)).toBe(chats) // no topics, nothing filed
  const many = Array.from({ length: KEEP_CHATS + 5 }, (_, n) => n).reduce(
    (list, n) => attributeChat(list, `c${n}`, 'x', ['a'], MIN, n),
    chats,
  )
  expect(many.length).toBe(KEEP_CHATS)
})

test('time per topic adds chat, review and learning time', async () => {
  const chats = attributeChat([], 's1', 'x', ['redis'], 30 * MIN, 1)
  const reviews: ReviewEvent[] = [{ t: 1, cardId: 'c', topic: 'redis', grade: 'good', mode: 'review', ms: 2 * MIN }]
  const [redis, kafka] = topicUsage(chats, reviews, { redis: MIN, kafka: 3 * MIN })
  expect(redis).toEqual({ topic: 'redis', chatMs: 30 * MIN, chats: 1, reviewMs: 2 * MIN, learnMs: MIN })
  expect(kafka?.learnMs).toBe(3 * MIN)
})

test('durations and labels read well; idle time is capped', async () => {
  expect(duration(20_000)).toBe('<1m')
  expect(duration(15 * MIN)).toBe('15m')
  expect(duration(80 * MIN)).toBe('1h 20m')
  expect(duration(120 * MIN)).toBe('2h')
  expect(studyMs(0, 60 * MIN)).toBe(MAX_STUDY_MS)
  expect(studyMs(undefined, 5)).toBe(0)
  expect(chatLabel('  fix the redis   cache  ', 'proj')).toBe('fix the redis cache')
  expect(chatLabel(undefined, 'proj')).toBe('proj')
  expect(chatLabel('a '.repeat(40), 'proj').endsWith('…')).toBe(true)
})
