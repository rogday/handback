import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { INBOX_POLL_INTERVAL_MS, sessionInboxDir } from './protocol.ts'

const HOME = '/home/reviewer'
const SESSION_ID = 'this-session'
const ROOT = '/work'

test('a review sent to this session is submitted once, as the person', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const inbox = sessionInboxDir(HOME, SESSION_ID)
  const files = new Map([[`${inbox}/r1.json`, JSON.stringify({ id: 'r1', text: 'Rename `x`.', mode: 'send' })]])
  const prompts = startSession(on, files)

  await $.session.start({ cwd: ROOT, surface: null, isInteractive: true })
  await clock.advance(3 * INBOX_POLL_INTERVAL_MS)

  expect(prompts).toEqual(['Rename `x`.'])
  expect(files.get(`${inbox}/r1.delivered`)).toBe('submitted')
})

test('a review sent to another session is left alone', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const otherInbox = sessionInboxDir(HOME, 'other-session')
  const files = new Map([[`${otherInbox}/r1.json`, JSON.stringify({ id: 'r1', text: 'Not for you.', mode: 'send' })]])
  const prompts = startSession(on, files)

  await $.session.start({ cwd: ROOT, surface: null, isInteractive: true })
  await clock.advance(3 * INBOX_POLL_INTERVAL_MS)

  expect(prompts).toEqual([])
  expect(files.has(`${otherInbox}/r1.delivered`)).toBe(false)
})

test('a review to fill goes into the prompt box and is not sent', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const inbox = sessionInboxDir(HOME, SESSION_ID)
  const files = new Map([[`${inbox}/r1.json`, JSON.stringify({ id: 'r1', text: 'Rename `x`.', mode: 'fill' })]])
  const prompts = startSession(on, files)
  const fills: { text: string; mode: string }[] = []
  on('prompt.read', () => ({ value: { text: 'and also', cursor: 8 } }))
  on('prompt.fill', ($, e) => {
    fills.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })

  await $.session.start({ cwd: ROOT, surface: null, isInteractive: true })
  await clock.advance(3 * INBOX_POLL_INTERVAL_MS)

  expect(fills).toEqual([{ text: '\n\nRename `x`.', mode: 'append' }])
  expect(files.get(`${inbox}/r1.delivered`)).toBe('filled')
  expect(prompts).toEqual([])
})

/** Answers the session, the environment and the file system from memory; returns the prompts submitted as the person. */
function startSession(on: On, files: Map<string, string>): string[] {
  mock.env(on, { HOME })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SESSION_ID }))
  on('session.root', () => ({ value: ROOT }))
  on('fs.read', ($, e) => {
    const text = files.get(e.path)
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', ($, e) => {
    const prefix = `${e.path}/`
    const names = [...files.keys()].filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length))
    if (names.length === 0) return { deny: `ENOENT: ${e.path}` }
    return { value: names.map(name => ({ name, kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })) }
  })

  const prompts: string[] = []
  on('prompt.submit', ($, e) => {
    if (e.origin.kind === 'plugin' && e.origin.asUser === true) prompts.push(e.text)
    return { text: e.text }
  })
  return prompts
}
