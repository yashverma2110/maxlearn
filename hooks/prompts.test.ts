import { expect, test } from 'claude-code/testing'

import { STE_RULES, isWeakFront, levelFor } from './prompts'
import { parseCards } from './srs'

test('generic questions are weak; specific ones pass', async () => {
  expect(isWeakFront('When should you use Redis instead of a relational database for your application?')).toBe(true)
  expect(isWeakFront('What is a B-tree index?')).toBe(true)
  expect(isWeakFront('What are the benefits of Kafka?')).toBe(true)
  expect(isWeakFront('Explain caching.')).toBe(true)
  expect(isWeakFront('Why?')).toBe(true)
  expect(isWeakFront('Why can Redis lose up to one second of writes with appendfsync everysec?')).toBe(false)
  expect(isWeakFront('Why does a Postgres index on (a, b) not help a query that filters only on b?')).toBe(false)
  expect(isWeakFront('What happens to writes during a Redis BGSAVE fork?')).toBe(false)
})

test('parseCards drops weak questions', async () => {
  const text = JSON.stringify([
    { topic: 'redis', front: 'When should you use Redis instead of a relational database?', back: 'For caches.' },
    { topic: 'redis', front: 'Why can Redis lose writes with appendfsync everysec?', back: 'fsync runs once per second.' },
  ])
  const cards = parseCards(text, [], 'interest', 0)
  expect(cards.map(c => c.front)).toEqual(['Why can Redis lose writes with appendfsync everysec?'])
})

test('level starts senior, steps down on poor recall, up once mastered', async () => {
  expect(levelFor(undefined)).toBe('senior')
  expect(levelFor({ cards: 3, mastery: 0.1, recall: 0.2, reviews: 3 })).toBe('senior') // too few reviews to judge
  expect(levelFor({ cards: 6, mastery: 0.2, recall: 0.4, reviews: 8 })).toBe('mid')
  expect(levelFor({ cards: 6, mastery: 0.8, recall: 0.9, reviews: 12 })).toBe('staff')
  expect(levelFor({ cards: 6, mastery: 0.5, recall: 0.9, reviews: 12 })).toBe('senior')
})

test('each Simplify steps the level down, to intro at the lowest', async () => {
  const strong = { cards: 6, mastery: 0.8, recall: 0.9, reviews: 12 }
  expect(levelFor(strong)).toBe('staff')
  expect(levelFor(strong, 1)).toBe('senior')
  expect(levelFor(undefined, 1)).toBe('mid')
  expect(levelFor(undefined, 2)).toBe('intro')
  expect(levelFor(undefined, 9)).toBe('intro')
})

test('the STE rules cover every text field of lessons and cards', async () => {
  for (const field of ['"title"', '"body"', '"example"', '"front"', '"back"', '"choices"']) {
    expect(STE_RULES).toContain(field)
  }
  expect(STE_RULES).toContain('ASD-STE100')
  expect(STE_RULES).toContain('20 words or fewer')
})
