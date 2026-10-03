export type Grade = 'again' | 'hard' | 'good' | 'easy'

export type Card = {
  id: string
  topic: string
  front: string
  back: string
  /** Multiple-choice options for quiz mode; `answer` indexes the right one. */
  choices: string[]
  answer: number
  source: 'chat' | 'interest'
  createdAt: number
  /** Spaced-repetition fields (SM-2 style). */
  ease: number
  intervalDays: number
  reps: number
  lapses: number
  due: number
  /** Proficiency counters. */
  seen: number
  correct: number
  /** FSRS memory: days until recall falls to 90%, and how hard the card is (1..10). */
  stability?: number
  difficulty?: number
  /** When it was last graded. */
  lastReviewAt?: number
  /** When its answer was first shown on the learn screen; unset means still to learn. */
  learnedAt?: number
}

export type Mode = 'learn' | 'review' | 'quiz' | 'progress' | 'add' | 'settings'

/** `session` forks the session's own model (prompt-cached); the rest are model aliases. */
export type ChatModel = 'session' | 'opus' | 'sonnet' | 'haiku'
export type InterestModel = 'opus' | 'sonnet' | 'haiku'

/** Which topics review order, the improve list and suggestions favor. */
export type Focus = 'work' | 'balanced' | 'interests'

/** How often the status line swaps in a takeaway from a reviewed card. */
export type InsightPace = 'off' | '30s' | '2m'

/** How often each interest gets new cards on its own. */
export type AutoPeriod = 'off' | '12h' | '24h' | '3d' | '7d'

/** Which scheduler sets the next review. */
export type Algorithm = 'sm2' | 'fsrs'

/** FSRS: the chance of recall a review is planned at. */
export type Retention = '0.85' | '0.9' | '0.95'

export type StudySettings = {
  chatModel: ChatModel
  interestModel: InterestModel
  focus: Focus
  insightPace: InsightPace
  autoPeriod: AutoPeriod
  /** Make an interest's cards when the chat touches it. */
  autoOnChat: 'on' | 'off'
  algorithm: Algorithm
  retention: Retention
}

/** One graded recall, kept for the insights history. */
export type ReviewEvent = {
  t: number
  cardId: string
  topic: string
  grade: Grade
  mode: 'review' | 'quiz'
  /** How long the card was on screen before the grade, capped. */
  ms?: number
}

/** One chat and the time it spent on each topic. */
export type ChatSession = {
  id: string
  label: string
  startedAt: number
  lastAt: number
  /** Chat time per topic, in milliseconds. */
  topics: Record<string, number>
}

/** Topic mentions in chat per local day: `{ "2026-10-03": { postgres: 2 } }`. */
export type ChatTopics = Record<string, Record<string, number>>

export type InsightsView = 'overview' | 'topics' | 'work' | 'chats'

/** Cards being written now: what for, and since when. */
export type Generating = { label: string; startedAt: number; noun?: 'card' | 'lesson' }

/**
 * Something to read before reviewing: a generated lesson that carries its
 * own cards, or (id `card:<cardId>`) a card not yet learned, shown with its answer.
 */
export type Lesson = {
  id: string
  topic: string
  title: string
  body: string
  example?: string
  /** Cards that join the deck once the lesson is learned. Empty for a card lesson. */
  cards: Card[]
  createdAt: number
}

/** Grades since the session started; not kept across sessions. */
export type SessionTally = { reviewed: number; correct: number; startedAt: number }

export type View = {
  mode: Mode
  cardId?: string
  isRevealed: boolean
  feedback?: string
  insights?: InsightsView
  /** The highlighted quiz choice. */
  cursor?: number
  /** Cards skipped without a grade until the tab changes. */
  skipped?: string[]
  isHelp?: boolean
  /** Which tip the tip line shows, counted through tipFor's order. */
  tipIndex?: number
  /** The more tab's sub-view. */
  more?: 'actions' | 'tips'
}

/** The one grade `u` can take back: the card as it was, and its log entry. */
export type LastAnswer = { before: Card; t: number }

declare module 'claude-code' {
  interface PluginState {
    'maxlearn': {
      deck: Card[]
      interests: string[]
      view: View
      generating: Generating | null
      settings: StudySettings
      reviews: ReviewEvent[]
      chatTopics: ChatTopics
      lastAnswer: LastAnswer | null
      session: SessionTally
      /** Generated lessons, shown or waiting; card lessons are built from the deck. */
      lessons: Lesson[]
      /** Generated lessons not shown yet, in order: the one waiting for the next Next. */
      lessonQueue: string[]
      /** The learn tab's lesson; `pending` while one is being written. */
      lessonNow: string | null
      /** Each `/study learn` row by run number: its lesson, or `pending`. */
      chatRuns: Record<string, string>
      /** Recent chats, newest first, with the topics each touched and for how long. */
      chatSessions: ChatSession[]
      /** Time reading lessons, per topic. */
      learnTime: Record<string, number>
    }
  }
}
