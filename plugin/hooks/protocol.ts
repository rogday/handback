// The file protocol between the VS Code extension and the mod: the one place its paths and shapes are written.
// Both sides import this file, so it imports nothing.

/** Under the user's home directory. */
const PROTOCOL_DIR = '.claude/handback'
const SESSIONS_DIR = 'sessions'
const INBOX_DIR = 'inbox'

const REVIEW_SUFFIX = '.json'
/** Beside a review, holding its DeliveryOutcome: the mod took it, and the extension may delete both. */
const DELIVERED_SUFFIX = '.delivered'

export const HEARTBEAT_INTERVAL_MS = 5_000
/** Three missed heartbeats and the session is taken for gone. */
export const SESSION_STALE_AFTER_MS = 3 * HEARTBEAT_INTERVAL_MS
export const INBOX_POLL_INTERVAL_MS = 1_000

/** A running Claude Code session the mod announced, at `sessionsDir/<id>.json`. */
export type SessionRecord = {
  id: string
  /** The session's project root, absolute. */
  root: string
  /** The session's title as Claude Code shows it, once it has one. */
  title?: string
  startedAt: number
  /** When the person last sent a prompt there: the most recent one is the default target. */
  lastPromptAt?: number
  heartbeatAt: number
  endedAt?: number
}

const DELIVERY_MODES = ['send', 'fill'] as const

/** `send` submits the review as the person's next message; `fill` puts it in the prompt box for them to send. */
export type DeliveryMode = (typeof DELIVERY_MODES)[number]

/** A finished review addressed to one session, at `inboxDir/<session id>/<review id>.json`. */
export type ReviewDelivery = {
  id: string
  /** The prompt, formatted by the extension. */
  text: string
  mode: DeliveryMode
}

const DELIVERY_OUTCOMES = ['submitted', 'filled', 'noPromptBox', 'dropped'] as const

/**
 * What the mod did with a review, written into its delivered marker. `noPromptBox`: the session's surface draws its
 * own prompt box (the VS Code chat does), so the extension fills it instead. `dropped`: the review was unreadable.
 */
export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number]

// Joined with '/', which both Node and Claude Code accept on Windows too.
export function sessionsDir(home: string): string {
  return [home, PROTOCOL_DIR, SESSIONS_DIR].join('/')
}

export function sessionInboxDir(home: string, sessionId: string): string {
  return [home, PROTOCOL_DIR, INBOX_DIR, sessionId].join('/')
}

export function sessionFileName(sessionId: string): string {
  return sessionId + '.json'
}

export function reviewFileName(reviewId: string): string {
  return reviewId + REVIEW_SUFFIX
}

export function deliveredFileName(reviewId: string): string {
  return reviewId + DELIVERED_SUFFIX
}

/** The review id a file name holds, or undefined when the file is no review. */
export function reviewIdOf(fileName: string): string | undefined {
  return fileName.endsWith(REVIEW_SUFFIX) ? fileName.slice(0, -REVIEW_SUFFIX.length) : undefined
}

export function isLive(session: SessionRecord, now: number): boolean {
  return session.endedAt === undefined && now - session.heartbeatAt < SESSION_STALE_AFTER_MS
}

/** What Claude Code's session ids are made of; an id is a path segment, so nothing else is taken. */
const SESSION_ID = /^[A-Za-z0-9_-]+$/

export function parseSessionRecord(text: string): SessionRecord | undefined {
  const value = parseObject(text)
  const isRecord =
    typeof value?.id === 'string' &&
    SESSION_ID.test(value.id) &&
    typeof value.root === 'string' &&
    typeof value.startedAt === 'number' &&
    typeof value.heartbeatAt === 'number'
  return isRecord ? (value as SessionRecord) : undefined
}

export function parseReviewDelivery(text: string): ReviewDelivery | undefined {
  const value = parseObject(text)
  const isDelivery =
    typeof value?.id === 'string' && typeof value.text === 'string' && isOneOf(DELIVERY_MODES, value.mode)
  return isDelivery ? (value as ReviewDelivery) : undefined
}

export function parseDeliveryOutcome(text: string): DeliveryOutcome | undefined {
  return isOneOf(DELIVERY_OUTCOMES, text) ? text : undefined
}

export function isDeliveryMode(value: unknown): value is DeliveryMode {
  return isOneOf(DELIVERY_MODES, value)
}

function isOneOf<T>(values: readonly T[], value: unknown): value is T {
  return values.some(known => known === value)
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}
