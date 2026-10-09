// Hands a finished review to a Claude Code session through the mod's file protocol.

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { relative, isAbsolute } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  INBOX_POLL_INTERVAL_MS,
  deliveredFileName,
  isLive,
  parseDeliveryOutcome,
  parseSessionRecord,
  reviewFileName,
  sessionFileName,
  sessionInboxDir,
  sessionsDir,
  type DeliveryMode,
  type DeliveryOutcome,
  type ReviewDelivery,
  type SessionRecord,
} from '../../plugin/hooks/protocol.ts'

/** A few missed polls of the mod before the review is taken back. */
const DELIVERY_TIMEOUT_MS = 5 * INBOX_POLL_INTERVAL_MS
const DELIVERY_CHECK_INTERVAL_MS = 100
// Reviews quote the person's code: theirs alone to read.
const PRIVATE_DIR_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600

export type DeliveryResult = DeliveryOutcome | 'timedOut'

/** The live sessions whose project holds every one of `paths`, the one the person used last first. */
export async function sessionsFor(paths: readonly string[]): Promise<SessionRecord[]> {
  const sessions = await readSessions()
  const now = Date.now()
  await forgetGoneSessions(sessions.filter(session => !isLive(session, now)))
  return sessions
    .filter(session => isLive(session, now) && paths.every(path => isInside(session.root, path)))
    .sort((a, b) => lastActivity(b) - lastActivity(a))
}

export async function deliver(sessionId: string, text: string, mode: DeliveryMode): Promise<DeliveryResult> {
  const home = homedir()
  const inbox = sessionInboxDir(home, sessionId)
  const delivery: ReviewDelivery = { id: `${Date.now()}-${randomUUID()}`, text, mode }
  const reviewPath = `${inbox}/${reviewFileName(delivery.id)}`
  const deliveredPath = `${inbox}/${deliveredFileName(delivery.id)}`

  await mkdir(inbox, { recursive: true, mode: PRIVATE_DIR_MODE })
  // Renamed into place so the mod never reads half a review.
  const partialPath = `${reviewPath}.partial`
  await writeFile(partialPath, JSON.stringify(delivery), { mode: PRIVATE_FILE_MODE })
  await rename(partialPath, reviewPath)

  const outcome = await waitForOutcome(deliveredPath)
  await rm(reviewPath, { force: true })
  await rm(deliveredPath, { force: true })
  return outcome ?? 'timedOut'
}

async function waitForOutcome(deliveredPath: string): Promise<DeliveryOutcome | undefined> {
  const deadline = Date.now() + DELIVERY_TIMEOUT_MS
  for (;;) {
    // Unreadable or still empty while the mod writes it: not there yet.
    const outcome = await readFile(deliveredPath, 'utf8').then(parseDeliveryOutcome, () => undefined)
    if (outcome !== undefined || Date.now() >= deadline) return outcome
    await sleep(DELIVERY_CHECK_INTERVAL_MS)
  }
}

async function readSessions(): Promise<SessionRecord[]> {
  const dir = sessionsDir(homedir())
  const names = await readdir(dir).catch(() => [])
  const records = await Promise.all(
    names.map(name => readFile(`${dir}/${name}`, 'utf8').then(parseSessionRecord, () => undefined)),
  )
  return records.filter(record => record !== undefined)
}

/** A gone session's record and inbox; a session that only missed heartbeats announces itself again. */
async function forgetGoneSessions(sessions: readonly SessionRecord[]): Promise<void> {
  const home = homedir()
  await Promise.all(
    sessions.flatMap(session => [
      rm(`${sessionsDir(home)}/${sessionFileName(session.id)}`, { force: true }),
      rm(sessionInboxDir(home, session.id), { recursive: true, force: true }),
    ]),
  )
}

function lastActivity(session: SessionRecord): number {
  return session.lastPromptAt ?? session.startedAt
}

function isInside(root: string, path: string): boolean {
  const fromRoot = relative(root, path)
  return fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot))
}
