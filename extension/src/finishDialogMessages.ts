// The messages between the "Finish your review" webview and the extension.

import { isVerdict, type Verdict } from './format.ts'

export type FinishChoice = {
  verdict: Verdict
  summary: string
}

export type FromWebview =
  { type: 'ready' } | ({ type: 'draft' } & FinishChoice) | ({ type: 'submit' } & FinishChoice) | { type: 'discard' }

export type ToWebview =
  ({ type: 'init'; pendingCount: number } & FinishChoice) | { type: 'pending'; count: number } | { type: 'idle' }

/** Checked before use: the page is ours, but it holds text the person typed and a script runs in it. */
export function parseFromWebview(value: unknown): FromWebview | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { type, verdict, summary } = value as Record<string, unknown>
  if (type === 'ready' || type === 'discard') return { type }
  const isChoice = isVerdict(verdict) && typeof summary === 'string'
  if ((type === 'draft' || type === 'submit') && isChoice) return { type, verdict, summary }
  return undefined
}
