import type { Register } from 'claude-code'
import {
  HEARTBEAT_INTERVAL_MS,
  INBOX_POLL_INTERVAL_MS,
  deliveredFileName,
  parseReviewDelivery,
  parseSessionRecord,
  reviewFileName,
  reviewIdOf,
  sessionFileName,
  sessionInboxDir,
  sessionsDir,
  type DeliveryOutcome,
  type SessionRecord,
} from './protocol.ts'

/** This session as the extension sees it: its record in the sessions directory. */
type Announcement = {
  home: string
  record: SessionRecord
}

export const register: Register = on => {
  let announcement: Announcement | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
    if (home === undefined) {
      $.ui.log(`${$.plugin.name}: neither HOME nor USERPROFILE is set, so reviews cannot find this session.`)
      return started
    }

    const sessionId = await $.session.id()
    // A reload of the mod keeps what this session announced before it.
    const previous = await $.fs.read(recordPath(home, sessionId)).then(parseSessionRecord, () => undefined)
    const startedAt = await $.clock.now()
    announcement = {
      home,
      record: { ...(previous ?? { id: sessionId, root: '', startedAt, heartbeatAt: startedAt }), endedAt: undefined },
    }

    const heartbeat = async (current: Announcement) => {
      current.record = beat(current.record, await $.session.id(), await $.session.root(), await $.clock.now())
      await $.fs.write(recordPath(current.home, current.record.id), JSON.stringify(current.record))
    }

    const logFailure = (error: unknown) => $.ui.log(`${$.plugin.name}: ${String(error)}`, { to: 'debug' })

    let isPolling = false
    const pollInbox = async (current: Announcement) => {
      // A slow file system must not let two ticks take the same review.
      if (isPolling) return
      isPolling = true
      try {
        const dir = sessionInboxDir(current.home, current.record.id)
        // The inbox appears with the first review sent here.
        const entries = await $.fs.list(dir).catch(() => [])
        for (const reviewId of pendingReviewIds(entries.map(entry => entry.name))) {
          const delivery = parseReviewDelivery(await $.fs.read(`${dir}/${reviewFileName(reviewId)}`))
          const markDelivered = (outcome: DeliveryOutcome) =>
            $.fs.write(`${dir}/${deliveredFileName(reviewId)}`, outcome)
          if (delivery === undefined) {
            $.ui.log(`${$.plugin.name}: review ${reviewId} is malformed and was dropped.`)
            await markDelivered('dropped')
            continue
          }
          if (delivery.mode === 'send') {
            // Marked before submitting, so a reload while the prompt waits never submits it twice.
            await markDelivered('submitted')
            // Not awaited: it resolves once the session is idle, and reviews sent meanwhile must still be marked.
            void $.prompt.submit({ text: delivery.text, asUser: true }).catch(logFailure)
            continue
          }
          const isDraftEmpty = (await $.prompt.read()).text.trim() === ''
          const fill = isDraftEmpty
            ? { text: delivery.text, mode: 'replace' as const }
            : { text: `\n\n${delivery.text}`, mode: 'append' as const }
          const filled = await $.prompt.fill(fill)
          if (filled.isFilled) await markDelivered('filled')
          else if (filled.refusal === 'no_composer') await markDelivered('noPromptBox')
          // Otherwise a dialog holds the keys: the next tick tries again.
        }
      } finally {
        isPolling = false
      }
    }

    const current = announcement
    await heartbeat(current)
    $.clock.every(HEARTBEAT_INTERVAL_MS, () => void heartbeat(current).catch(logFailure))
    $.clock.every(INBOX_POLL_INTERVAL_MS, () => void pollInbox(current).catch(logFailure))
    return started
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (announcement !== undefined) {
      const { record } = announcement
      announcement.record = { ...record, title: e.session_title ?? record.title, lastPromptAt: await $.clock.now() }
      await $.fs.write(recordPath(announcement.home, record.id), JSON.stringify(announcement.record))
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (announcement !== undefined) {
      announcement.record = { ...announcement.record, endedAt: await $.clock.now() }
      await $.fs.write(recordPath(announcement.home, announcement.record.id), JSON.stringify(announcement.record))
    }
    return next(e)
  })
}

function recordPath(home: string, sessionId: string): string {
  return `${sessionsDir(home)}/${sessionFileName(sessionId)}`
}

function beat(record: SessionRecord, sessionId: string, root: string, now: number): SessionRecord {
  // After a /clear the process goes on under a new session id.
  const isSameSession = sessionId === record.id
  return isSameSession
    ? { ...record, root, heartbeatAt: now }
    : { id: sessionId, root, startedAt: now, heartbeatAt: now }
}

/** The reviews not yet delivered, oldest first: review ids sort by the time they were made. */
function pendingReviewIds(fileNames: readonly string[]): string[] {
  const names = new Set(fileNames)
  return fileNames
    .map(reviewIdOf)
    .filter((id): id is string => id !== undefined && !names.has(deliveredFileName(id)))
    .sort()
}
