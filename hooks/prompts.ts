/**
 * What makes a good card, as the model reads it and as the local filter
 * enforces it. Pure: no `$` here.
 */

export type Level = 'intro' | 'mid' | 'senior' | 'staff'

const LEVELS: Level[] = ['intro', 'mid', 'senior', 'staff']

export const LEVEL_BRIEF: Record<Level, string> = {
  intro: 'someone new to the topic: explain each term, one step at a time, with an everyday comparison',
  mid: 'a mid-level engineer: solid on fundamentals, learning how things work under the hood',
  senior:
    'a senior engineer: knows the basics well; wants internals, trade-offs, failure modes and production gotchas',
  staff:
    'a staff engineer: wants system-level trade-offs, scaling limits, design decisions and their second-order effects',
}

/** What the topic's record says about how hard its next cards should be. */
export type LevelSignal = {
  cards: number
  mastery: number
  /** Recall, recent where known, 0..1, or null before any review. */
  recall: number | null
  /** Reviews behind `recall`. */
  reviews: number
  /** Times the learner asked for a simpler lesson on this topic. */
  simplified?: number
}

/**
 * Starts at the learner's chosen level (senior unless they picked another);
 * one step down when recall is poor on enough reviews, one step up once the
 * topic is mastered and recalled well. Each Simplify steps one further down.
 */
export function levelFor(s: LevelSignal | undefined, simplified = s?.simplified ?? 0, start: Level = 'senior'): Level {
  const step =
    s === undefined || s.recall === null || s.reviews < 5
      ? 0
      : s.recall < 0.6
        ? -1
        : s.mastery >= 0.7 && s.recall >= 0.85
          ? 1
          : 0
  const at = LEVELS.indexOf(start) + step - simplified
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, at))]!
}

/** The ask for a simpler version of a lesson the learner found too hard. */
export function simplifyPrompt(lesson: { topic: string; title: string; body: string; example?: string }, cards: { front: string; back: string }[]): string {
  return `A learner found this lesson on "${lesson.topic}" too hard. Rewrite it to teach the SAME idea more simply:
- Assume less background. Explain every technical term the first time you use it.
- Use one everyday comparison, then tie it back to the real mechanism.
- Use shorter sentences: 3-5 of them.
- Keep it correct: do not leave out the part that makes the idea true.
Also rewrite its flashcards so they test the simpler lesson.

The lesson:
Title: ${lesson.title}
${lesson.body}${lesson.example ? `\nExample: ${lesson.example}` : ''}

Its cards:
${cards.map(c => `- Q: ${c.front}\n  A: ${c.back}`).join('\n') || '(none)'}

Reply with ONLY a JSON array with one lesson:
[{"topic": "${lesson.topic}", "title": "...", "body": "...", "example": "...", "cards": [{"front": "...", "back": "...", "choices": ["...", "...", "...", "..."], "answer": 0}]}]`
}

/**
 * ASD-STE100 Simplified Technical English, as the model can follow it without
 * the dictionary: every text field of a lesson or card, not only the cards.
 */
export const STE_RULES = `Write ALL text ("title", "body", "example", "front", "back", "choices") in ASD-STE100 Simplified Technical English:
Words
- Use simple, common words. Use each word with one meaning only (for example, "test" is a check, never an exam).
- Technical names are allowed: commands, APIs, types, settings, tools and units (lock_timeout, ACCESS EXCLUSIVE, 2s).
- Use the same word for the same thing each time. Do not use synonyms for variety.
- Do not use phrasal verbs ("set up", "look into", "fill up"). Use one verb ("configure", "examine", "fill").
- Do not use "-ing" words as nouns or adjectives, except in technical names.
- Do not use noun clusters of more than 3 words.
- Write "to", not "in order to". Write "if", not "in case". Write "can" for ability and "must" for a requirement; do not use "may" or "might" for these.
Sentences
- Keep each sentence to 20 words or fewer for an instruction, 25 or fewer for a description.
- Write one instruction or one idea in each sentence.
- Use the active voice. Use the simple tenses: present, past and future.
- Do not leave out "the", "a" or verbs to make text shorter.
- Write instructions as commands ("Set lock_timeout before the ALTER.").
- Put a condition before the action it controls ("If the lock is busy, the ALTER waits.").
- Put a warning or caution before the step it is about.
Paragraphs
- Give each paragraph one topic. Keep a paragraph to 6 sentences or fewer.
- Give numbers with their units, exactly ("10 minutes", "2 s", "8 GB").`

export const CARD_RUBRIC = `What makes a good card (follow all):
- One idea per card. The answer fits in 1-3 sentences. No lists of more than 3 items.
- Be specific: name the mechanism, command, setting, data structure, number or failure mode.
- Ask about why, how or what-happens-when. Do not ask for definitions or "when should you use X".
- The back gives the answer first, then the reason (the mechanism), then one concrete detail or example.
- The answer must be checkable: a reader can say if their recall was right or wrong.
- Quiz choices: one correct, three plausible distractors of similar length; no "all of the above".

Bad: "When should you use Redis instead of a relational database?" (generic, no mechanism, any answer is half right)
Good: "Why can Redis lose up to one second of writes with appendfsync everysec?"
  → "Redis calls fsync on the AOF once per second in a background thread. A crash before the next fsync loses the writes still in the OS buffer."
Bad: "What is a B-tree index?"
Good: "Why does a Postgres index on (a, b) not help a query that filters only on b?"`

const WEAK_STEMS = [
  /^what (is|are) (a |an |the )?[\w\s-]{1,30}\?$/i,
  /^when should (you|i|we) use\b/i,
  /^what are the (benefits|advantages|disadvantages|pros|cons)\b/i,
  /^(define|explain|describe) [\w\s-]{1,30}\.?\??$/i,
  /^why (is|should) [\w\s-]{1,20} (good|useful|important|popular)\b/i,
]

/** A question too generic to test real recall. */
export function isWeakFront(front: string): boolean {
  const q = front.trim()
  return q.length < 20 || WEAK_STEMS.some(stem => stem.test(q))
}
