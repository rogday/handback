// Hands a finished review to the Claude Code session the person picks, and tells them how it went.

import * as vscode from 'vscode'
import { isDeliveryMode, type DeliveryMode, type SessionRecord } from '../../plugin/hooks/protocol.ts'
import { deliver, sessionsFor, type DeliveryResult } from './delivery.ts'

const STATUS_MESSAGE_TIMEOUT_MS = 4_000
const INSTALL_URL = 'https://github.com/rogday/handback#install'
/** The Claude Code extension's "Focus input" command. */
const CLAUDE_FOCUS_INPUT = 'claude-vscode.focus'
const PASTE_KEY = process.platform === 'darwin' ? 'Cmd+V' : 'Ctrl+V'
const COPY_REVIEW = 'Copy review'
const INSTALL_MOD = 'Install the mod'

// Set while a review is on its way, so pressing Finish again then cannot send it twice. Released before anything
// waits on the person: VS Code keeps an unanswered notification pending, which would hold every later send.
let isSending = false

/** How far a send got before anything more is asked of the person. */
type Attempt = { outcome: 'noSession' } | { outcome: 'notPicked' } | { outcome: DeliveryResult; session: SessionRecord }

/** Sends the review to a session the person picks; true once it is out of the editor's hands. */
export async function send(text: string, paths: readonly string[]): Promise<boolean> {
  if (isSending) {
    void vscode.window.showInformationMessage('A review is already on its way to Claude.')
    return false
  }
  isSending = true
  let attempt: Attempt
  try {
    attempt = await attemptDelivery(text, paths)
  } finally {
    isSending = false
  }
  return settle(attempt, text)
}

async function attemptDelivery(text: string, paths: readonly string[]): Promise<Attempt> {
  const workspacePaths = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? []
  const sessions = await sessionsFor(paths.length > 0 ? paths : workspacePaths)
  if (sessions.length === 0) return { outcome: 'noSession' }
  const session = await pickSession(sessions)
  if (session === undefined) return { outcome: 'notPicked' }

  const progress = { location: vscode.ProgressLocation.Window, title: 'Sending the review to Claude' }
  const result = await vscode.window.withProgress(progress, () => deliver(session.id, text, deliveryMode()))
  return { outcome: result, session }
}

async function settle(attempt: Attempt, text: string): Promise<boolean> {
  if (attempt.outcome === 'noSession') {
    return offerCopy(text, 'No Claude Code session running the Handback mod is open on this workspace.')
  }
  if (attempt.outcome === 'notPicked') return false
  return reportDelivery(attempt.outcome, text, attempt.session)
}

/**
 * Asks only when there is a choice. Claude Code hands mods a session's title only once the person renamed it, so a
 * session is told apart by when it started and when it was last messaged.
 */
async function pickSession(sessions: readonly SessionRecord[]): Promise<SessionRecord | undefined> {
  if (sessions.length === 1) return sessions[0]
  const now = Date.now()
  const items = sessions.map(session => {
    const started = `started ${startTime(session.startedAt, now)}`
    const lastMessage =
      session.lastPromptAt === undefined ? 'no messages yet' : `last message ${timeAgo(session.lastPromptAt, now)}`
    return {
      label: session.title ?? `Session ${started}`,
      description: session.title === undefined ? lastMessage : `${started} · ${lastMessage}`,
      detail: session.root,
      session,
    }
  })
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Send the review to which Claude Code session?',
    placeHolder: 'The one you messaged last comes first',
  })
  return picked?.session
}

const clockTime = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const dayAndClockTime = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function startTime(time: number, now: number): string {
  const isToday = new Date(time).toDateString() === new Date(now).toDateString()
  return (isToday ? clockTime : dayAndClockTime).format(time)
}

const TIME_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]
const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

function timeAgo(time: number, now: number): string {
  const elapsed = now - time
  const unit = TIME_UNITS.find(([, unitMs]) => elapsed >= unitMs)
  if (unit === undefined) return 'just now'
  const [name, unitMs] = unit
  return relativeTime.format(-Math.floor(elapsed / unitMs), name)
}

async function reportDelivery(result: DeliveryResult, text: string, session: SessionRecord): Promise<boolean> {
  switch (result) {
    case 'submitted':
      vscode.window.setStatusBarMessage('$(check) Review sent to Claude', STATUS_MESSAGE_TIMEOUT_MS)
      return true
    case 'filled':
      vscode.window.setStatusBarMessage('$(check) Review is in the Claude Code prompt box', STATUS_MESSAGE_TIMEOUT_MS)
      return true
    case 'noPromptBox':
      await handToClaudeChat(text)
      return true
    case 'dropped':
      void vscode.window.showErrorMessage(
        'The Claude Code mod could not read the review: update the extension and the mod to the same version.',
      )
      return false
    case 'timedOut':
      return offerCopy(text, `Claude Code session "${session.title ?? session.id}" did not take the review.`)
  }
}

/**
 * The VS Code chat draws its own prompt box, which nothing but a paste can fill. The person pastes: a paste command
 * run while the focus missed the chat would land in their code.
 */
async function handToClaudeChat(text: string): Promise<void> {
  await vscode.env.clipboard.writeText(text)
  await Promise.resolve(vscode.commands.executeCommand(CLAUDE_FOCUS_INPUT)).catch(() => undefined)
  void vscode.window.showInformationMessage(
    `The review is on your clipboard: press ${PASTE_KEY} in Claude Code to add it.`,
  )
}

function deliveryMode(): DeliveryMode {
  const mode = vscode.workspace.getConfiguration('handback').get<unknown>('delivery')
  return isDeliveryMode(mode) ? mode : 'send'
}

async function offerCopy(text: string, problem: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(problem, COPY_REVIEW, INSTALL_MOD)
  if (choice === INSTALL_MOD) void vscode.env.openExternal(vscode.Uri.parse(INSTALL_URL))
  if (choice !== COPY_REVIEW) return false
  await vscode.env.clipboard.writeText(text)
  vscode.window.setStatusBarMessage('$(check) Review copied: paste it into Claude Code', STATUS_MESSAGE_TIMEOUT_MS)
  return true
}
