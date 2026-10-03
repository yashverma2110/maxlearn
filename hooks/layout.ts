import type { Mode } from '../types'

/** Below this many body columns the pane draws its compact layout. */
export const ROOMY_FROM = 44

export type Density = 'compact' | 'roomy'

export function density(bodyColumns: number | undefined): Density {
  return (bodyColumns ?? 40) >= ROOMY_FROM ? 'roomy' : 'compact'
}

export const TAB_LABELS: Record<Density, Record<Mode, string>> = {
  roomy: { learn: 'learn', review: 'review', quiz: 'quiz', progress: 'insights', add: 'more', settings: 'settings' },
  compact: { learn: 'learn', review: 'rev', quiz: 'quiz', progress: 'ins', add: 'more', settings: 'set' },
}

/** Mastery color: red while weak, yellow while growing, green once held. */
export function masteryColor(mastery: number): string {
  return mastery < 0.3 ? 'red' : mastery < 0.7 ? 'yellow' : 'green'
}

/** `███░░░` at `cells` wide. */
export function bar(fraction: number, cells: number): { filled: string; empty: string } {
  const n = Math.round(Math.max(0, Math.min(1, fraction)) * cells)
  return { filled: '█'.repeat(n), empty: '░'.repeat(cells - n) }
}

export const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`)
