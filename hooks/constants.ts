import type {
  Algorithm,
  Retention,
  AutoPeriod,
  ChatModel,
  Focus,
  InsightPace,
  InterestModel,
  Mode,
  StudySettings,
} from '../types'

export const TITLE = 'maxlearn'
/** Mine the chat for new concepts every this many finished turns. */
export const CHAT_EVERY_TURNS = 3
export const MAX_DECK = 500
export const MAX_REVIEWS = 5000
/** How much recent chat a non-session model reads, in characters. */
export const CHAT_CONTEXT_CHARS = 16_000
/** A topic counts as mastered from here. */
export const MASTERED = 0.7

export const TAB_KEYS: Record<Mode, string> = { learn: 'e', review: 'r', quiz: 'q', progress: 'p', add: 'm', settings: 'o' }

export const CHAT_MODELS: { value: ChatModel; label: string }[] = [
  { value: 'session', label: 'session model (cached)' },
  { value: 'opus', label: 'opus' },
  { value: 'sonnet', label: 'sonnet' },
  { value: 'haiku', label: 'haiku' },
]
export const INTEREST_MODELS: { value: InterestModel; label: string }[] = [
  { value: 'opus', label: 'opus' },
  { value: 'sonnet', label: 'sonnet' },
  { value: 'haiku', label: 'haiku' },
]
export const FOCUS_OPTIONS: { value: Focus; label: string }[] = [
  { value: 'work', label: 'daily work' },
  { value: 'balanced', label: 'balanced' },
  { value: 'interests', label: 'my interests' },
]
export const DEFAULT_SETTINGS: StudySettings = {
  chatModel: 'session',
  interestModel: 'sonnet',
  focus: 'balanced',
  insightPace: '30s',
  autoPeriod: '24h',
  autoOnChat: 'on',
  chatCards: 'on',
  algorithm: 'sm2',
  retention: '0.9',
}

export const INSIGHT_PACES: { value: InsightPace; label: string; ms: number }[] = [
  { value: 'off', label: 'off', ms: 0 },
  { value: '30s', label: 'every 30s', ms: 30_000 },
  { value: '2m', label: 'every 2m', ms: 120_000 },
]

const HOUR = 60 * 60 * 1000
export const AUTO_PERIODS: { value: AutoPeriod; label: string; ms: number }[] = [
  { value: 'off', label: 'off', ms: 0 },
  { value: '12h', label: '12h', ms: 12 * HOUR },
  { value: '24h', label: '24h', ms: 24 * HOUR },
  { value: '3d', label: '3 days', ms: 72 * HOUR },
  { value: '7d', label: 'week', ms: 168 * HOUR },
]
export const ON_OFF: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'on' },
  { value: 'off', label: 'off' },
]

export const ALGORITHMS: { value: Algorithm; label: string }[] = [
  { value: 'sm2', label: 'SM-2' },
  { value: 'fsrs', label: 'FSRS' },
]
export const RETENTIONS: { value: Retention; label: string }[] = [
  { value: '0.85', label: '85%' },
  { value: '0.9', label: '90%' },
  { value: '0.95', label: '95%' },
]
