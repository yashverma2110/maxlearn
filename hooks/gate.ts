/**
 * The learning gate: before the chat check writes cards, one cheap call asks
 * whether the turns since the last check taught anything, or only executed
 * (ran commands, renamed, committed, formatted). Pure: no `$` here.
 */

import { normTopic } from './srs'

/** How much of the recent turns the gate reads, newest kept. */
export const GATE_CHARS = 6000

export type GateRow = {
  role: 'user' | 'assistant'
  text: string
  toolUses?: { tool: string; input: Record<string, unknown> }[]
}

export type GateVerdict = { kind: 'learning' | 'execution'; topics: string[] }

/** A tool use in a few words: `Bash(git push origin main)`, `Edit(src/app.ts)`. */
function toolLine(t: { tool: string; input: Record<string, unknown> }): string {
  const arg = t.input.command ?? t.input.file_path ?? t.input.path ?? t.input.pattern ?? t.input.url ?? ''
  const short = String(arg).replace(/\s+/g, ' ').slice(0, 60)
  return short === '' ? t.tool : `${t.tool}(${short})`
}

/** The turns as plain lines, tools named, cut to `max` characters with the newest kept. */
export function gateDigest(rows: GateRow[], max = GATE_CHARS): string {
  const lines: string[] = []
  let size = 0
  for (const row of [...rows].reverse()) {
    const tools = (row.toolUses ?? []).map(toolLine)
    const text = row.text.replace(/\s+/g, ' ').trim()
    if (text === '' && tools.length === 0) continue
    const line = `${row.role}: ${text}${tools.length > 0 ? ` [tools: ${tools.join(', ')}]` : ''}`
    if (size + line.length > max) {
      if (lines.length === 0) lines.unshift(line.slice(line.length - max))
      break
    }
    lines.unshift(line)
    size += line.length
  }
  return lines.join('\n')
}

export function gatePrompt(digest: string): string {
  return `Classify the recent work in a coding chat for a study app.

"learning": the chat explains or works out something a software engineer can reuse later: how a system works, why a fix works, a design trade-off, a language or API behavior, a debugging insight.
"execution": the chat only does tasks: runs commands, renames or moves files, edits config, commits, pushes, installs, formats, or repeats known steps. No reusable idea is explained.
If both happen, choose "learning".

Also name up to 5 short engineering topics the work touched (for example "postgres", "react hooks", "git"), even for execution.

Reply with ONLY JSON: {"kind": "learning" | "execution", "topics": ["..."]}

<chat>
${digest}
</chat>`
}

/** The gate's reply; undefined when it cannot be read, so the caller fails open. */
export function parseGate(text: string): GateVerdict | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let raw: { kind?: unknown; topics?: unknown }
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (raw.kind !== 'learning' && raw.kind !== 'execution') return undefined
  const topics = Array.isArray(raw.topics)
    ? [...new Set(raw.topics.filter((t): t is string => typeof t === 'string').map(normTopic))].slice(0, 5)
    : []
  return { kind: raw.kind, topics }
}
