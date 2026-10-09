import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { beforeEach, test } from 'node:test'
import {
  PROTOCOL_VERSION,
  SESSION_STALE_AFTER_MS,
  deliveredFileName,
  reviewIdOf,
  sessionFileName,
  sessionInboxDir,
  sessionsDir,
  type SessionRecord,
} from '../../plugin/hooks/protocol.ts'
import { deliver, sessionsFor } from './delivery.ts'

const MOD_POLL_MS = 50

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'handback-'))
  process.env.HOME = home
})

test('offers the live sessions holding the files, the one used last first, and forgets gone ones', async () => {
  // A record naming an id that is no path segment is never offered, so nothing is written outside the inbox.
  const now = Date.now()
  await announce({
    id: 'older',
    protocol: PROTOCOL_VERSION,
    root: '/work',
    startedAt: now - 60_000,
    heartbeatAt: now,
    lastPromptAt: now - 30_000,
  })
  await announce({
    id: 'newer',
    protocol: PROTOCOL_VERSION,
    root: '/work',
    startedAt: now - 60_000,
    heartbeatAt: now,
    lastPromptAt: now - 1_000,
  })
  await announce({ id: 'elsewhere', protocol: PROTOCOL_VERSION, root: '/other', startedAt: now, heartbeatAt: now })
  await announce({
    id: 'gone',
    protocol: PROTOCOL_VERSION,
    root: '/work',
    startedAt: now,
    heartbeatAt: now - 2 * SESSION_STALE_AFTER_MS,
  })
  await announce(
    { id: '../../escape', protocol: PROTOCOL_VERSION, root: '/work', startedAt: now, heartbeatAt: now },
    'crafted',
  )

  const sessions = await sessionsFor(['/work/src/a.ts', '/work/b.ts'])

  assert.deepEqual(
    sessions.map(session => session.id),
    ['newer', 'older'],
  )
  assert.deepEqual((await readdir(sessionsDir(home))).sort(), [
    'crafted.json',
    'elsewhere.json',
    'newer.json',
    'older.json',
  ])
})

test('a record from a mod older than protocol versions reads as protocol 0, never as the current one', async () => {
  const now = Date.now()
  const unversioned = { id: 'old-mod', root: '/work', startedAt: now, heartbeatAt: now }
  await mkdir(sessionsDir(home), { recursive: true })
  await writeFile(`${sessionsDir(home)}/${sessionFileName(unversioned.id)}`, JSON.stringify(unversioned))

  const [session] = await sessionsFor(['/work/a.ts'])

  assert.equal(session?.protocol, 0)
})

test('a review the mod takes is delivered and leaves nothing behind', async () => {
  const inbox = sessionInboxDir(home, 'listening')
  const mod = takeFirstReview(inbox)

  assert.equal(await deliver('listening', 'Rename x.', 'send'), 'submitted')
  await mod
  assert.deepEqual(await readdir(inbox), [])
})

async function announce(record: SessionRecord, fileId = record.id): Promise<void> {
  await mkdir(sessionsDir(home), { recursive: true })
  await writeFile(`${sessionsDir(home)}/${sessionFileName(fileId)}`, JSON.stringify(record))
}

/** Plays the mod: marks the first review that shows up in the inbox as submitted. */
async function takeFirstReview(inbox: string): Promise<void> {
  for (;;) {
    const names = await readdir(inbox).catch(() => [])
    const reviewId = names.map(reviewIdOf).find(id => id !== undefined)
    if (reviewId !== undefined) return writeFile(`${inbox}/${deliveredFileName(reviewId)}`, 'submitted')
    await sleep(MOD_POLL_MS)
  }
}
