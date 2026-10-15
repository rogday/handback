// Hands a finished review to the chat the person picks, and tells them how it went.

import * as vscode from 'vscode'
import { PROTOCOL_VERSION, isDeliveryMode, type DeliveryMode, type SessionRecord } from '../../plugin/hooks/protocol.ts'
import { isCopilotChatReady, sendToCopilotChat } from './copilotChat.ts'
import { deliver, sessionsFor, type DeliveryResult } from './delivery.ts'

const STATUS_MESSAGE_TIMEOUT_MS = 4_000
const INSTALL_URL = 'https://github.com/rogday/handback#install'
/** The Claude Code extension's "Focus input" command. */
const CLAUDE_FOCUS_INPUT = 'claude-vscode.focus'
const PASTE_KEY = process.platform === 'darwin' ? 'Cmd+V' : 'Ctrl+V'
const COPY_REVIEW = 'Copy review'
const INSTALL_MOD = 'Install the mod'
const LAST_AGENT_KEY = 'handback.lastAgent'

const AGENTS = ['claudeCode', 'copilotChat'] as const
type Agent = (typeof AGENTS)[number]
/** Comes first in the picker until the person sends a review anywhere. */
const FIRST_AGENT: Agent = 'claudeCode'
const AGENT_NAMES: Record<Agent, string> = { claudeCode: 'Claude Code', copilotChat: 'Copilot Chat' }
/** `handback.agent`: `any` offers every agent that can take the review. */
const AGENT_SETTINGS = ['any', ...AGENTS] as const
type AgentSetting = (typeof AGENT_SETTINGS)[number]

/** Where a review can go: a Claude Code session running the mod, or this window's Copilot Chat. */
type Target = { agent: 'claudeCode'; session: SessionRecord } | { agent: 'copilotChat' }

/** How far a send got before anything more is asked of the person. */
type Attempt =
  | { outcome: 'noTarget'; allowed: AgentSetting }
  | { outcome: 'otherProtocol'; isModOlder: boolean }
  | { outcome: 'notPicked' }
  | { outcome: 'copilotChatRefused'; reason: string }
  | { outcome: DeliveryResult; target: Target }

type TargetItem = vscode.QuickPickItem & { target?: Target }

export class ReviewSender {
  readonly #memento: vscode.Memento
  // Set while a review is on its way, so pressing Finish again then cannot send it twice. Released before anything
  // waits on the person: VS Code keeps an unanswered notification pending, which would hold every later send.
  #isSending = false

  constructor(memento: vscode.Memento) {
    this.#memento = memento
  }

  /** Sends the review to a chat the person picks; true once it is out of the editor's hands. */
  async send(text: string, paths: readonly string[]): Promise<boolean> {
    if (this.#isSending) {
      void vscode.window.showInformationMessage('A review is already on its way.')
      return false
    }
    this.#isSending = true
    let attempt: Attempt
    try {
      attempt = await this.#attemptDelivery(text, paths)
    } finally {
      this.#isSending = false
    }
    return settle(attempt, text)
  }

  async #attemptDelivery(text: string, paths: readonly string[]): Promise<Attempt> {
    const allowed = agentSetting()
    const workspacePaths = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? []
    const [candidates, isCopilotReady] = await Promise.all([
      allowed === 'copilotChat' ? [] : sessionsFor(paths.length > 0 ? paths : workspacePaths),
      allowed === 'claudeCode' ? false : isCopilotChatReady(),
    ])
    const sessions = candidates.filter(session => session.protocol === PROTOCOL_VERSION)
    const [other] = candidates.filter(session => session.protocol !== PROTOCOL_VERSION)
    // Said even when Copilot Chat could take the review: someone running the mod meant it for Claude Code.
    if (sessions.length === 0 && other !== undefined) {
      return { outcome: 'otherProtocol', isModOlder: other.protocol < PROTOCOL_VERSION }
    }
    const targets: Target[] = sessions.map(session => ({ agent: 'claudeCode', session }))
    if (isCopilotReady) targets.push({ agent: 'copilotChat' })
    if (targets.length === 0) return { outcome: 'noTarget', allowed }

    const target = await pickTarget(targets, this.#lastAgent())
    if (target === undefined) return { outcome: 'notPicked' }
    await this.#memento.update(LAST_AGENT_KEY, target.agent)
    return target.agent === 'copilotChat' ? deliverToCopilotChat(text) : deliverToClaudeCode(target, text)
  }

  #lastAgent(): Agent {
    const saved = this.#memento.get<unknown>(LAST_AGENT_KEY)
    return AGENTS.find(agent => agent === saved) ?? FIRST_AGENT
  }
}

async function deliverToClaudeCode(target: Target & { agent: 'claudeCode' }, text: string): Promise<Attempt> {
  const progress = { location: vscode.ProgressLocation.Window, title: 'Sending the review to Claude Code' }
  const result = await vscode.window.withProgress(progress, () => deliver(target.session.id, text, deliveryMode()))
  return { outcome: result, target }
}

async function deliverToCopilotChat(text: string): Promise<Attempt> {
  const mode = deliveryMode()
  const progress = { location: vscode.ProgressLocation.Window, title: 'Sending the review to Copilot Chat' }
  try {
    await vscode.window.withProgress(progress, () => sendToCopilotChat(text, mode))
  } catch (error) {
    return { outcome: 'copilotChatRefused', reason: error instanceof Error ? error.message : String(error) }
  }
  return { outcome: mode === 'send' ? 'submitted' : 'filled', target: { agent: 'copilotChat' } }
}

async function settle(attempt: Attempt, text: string): Promise<boolean> {
  if (attempt.outcome === 'noTarget') return reportNoTarget(attempt.allowed, text)
  if (attempt.outcome === 'otherProtocol') {
    const update = attempt.isModOlder
      ? 'runs an older Handback mod: update it with `claude plugin update handback`'
      : 'runs a newer Handback mod than this extension: update the extension'
    return offerCopyOrMod(text, `The Claude Code session on this workspace ${update}.`)
  }
  if (attempt.outcome === 'copilotChatRefused') {
    return offerCopy(text, `Copilot Chat did not take the review: ${attempt.reason}`)
  }
  if (attempt.outcome === 'notPicked') return false
  return reportDelivery(attempt.outcome, text, attempt.target)
}

async function reportNoTarget(allowed: AgentSetting, text: string): Promise<boolean> {
  const noSession = 'no Claude Code session running the Handback mod is open on this workspace'
  switch (allowed) {
    case 'any':
      return offerCopyOrMod(text, `No chat can take the review: ${noSession}, and Copilot is not signed in.`)
    case 'claudeCode':
      return offerCopyOrMod(text, `No Claude Code session can take the review: ${noSession}.`)
    case 'copilotChat':
      return offerCopy(text, 'Copilot Chat cannot take the review: sign in to Copilot.')
  }
}

/**
 * Asks only when there is a choice, the agent sent to last first. Claude Code hands mods a session's title only once
 * the person renamed it, so a session is told apart by when it started and when it was last messaged.
 */
async function pickTarget(targets: readonly Target[], lastAgent: Agent): Promise<Target | undefined> {
  if (targets.length === 1) return targets[0]
  const now = Date.now()
  const agents = [lastAgent, ...AGENTS.filter(agent => agent !== lastAgent)]
  const items = agents.flatMap(agent => {
    const ofAgent = targets.filter(target => target.agent === agent)
    if (ofAgent.length === 0) return []
    const separator: TargetItem = { label: AGENT_NAMES[agent], kind: vscode.QuickPickItemKind.Separator }
    return [separator, ...ofAgent.map(target => targetItem(target, now))]
  })
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Send the review to which chat?',
    placeHolder: 'The one you messaged last comes first',
  })
  return picked?.target
}

function targetItem(target: Target, now: number): TargetItem {
  if (target.agent === 'copilotChat') return { label: AGENT_NAMES.copilotChat, description: 'this window', target }
  const { session } = target
  const started = `started ${startTime(session.startedAt, now)}`
  const lastMessage =
    session.lastPromptAt === undefined ? 'no messages yet' : `last message ${timeAgo(session.lastPromptAt, now)}`
  return {
    label: session.title ?? `Session ${started}`,
    description: session.title === undefined ? lastMessage : `${started} · ${lastMessage}`,
    detail: session.root,
    target,
  }
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

async function reportDelivery(result: DeliveryResult, text: string, target: Target): Promise<boolean> {
  const name = AGENT_NAMES[target.agent]
  switch (result) {
    case 'submitted':
      vscode.window.setStatusBarMessage(`$(check) Review sent to ${name}`, STATUS_MESSAGE_TIMEOUT_MS)
      return true
    case 'filled':
      vscode.window.setStatusBarMessage(`$(check) Review is in the ${name} prompt box`, STATUS_MESSAGE_TIMEOUT_MS)
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
      return offerCopy(text, `${describe(target)} did not take the review.`)
  }
}

function describe(target: Target): string {
  if (target.agent === 'copilotChat') return AGENT_NAMES.copilotChat
  return `Claude Code session "${target.session.title ?? target.session.id}"`
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

function agentSetting(): AgentSetting {
  const value = vscode.workspace.getConfiguration('handback').get<unknown>('agent')
  return AGENT_SETTINGS.find(setting => setting === value) ?? 'any'
}

function deliveryMode(): DeliveryMode {
  const mode = vscode.workspace.getConfiguration('handback').get<unknown>('delivery')
  return isDeliveryMode(mode) ? mode : 'send'
}

/** For a problem the mod would solve: Claude Code sessions take reviews only through it. */
async function offerCopyOrMod(text: string, problem: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(problem, COPY_REVIEW, INSTALL_MOD)
  if (choice === INSTALL_MOD) void vscode.env.openExternal(vscode.Uri.parse(INSTALL_URL))
  return choice === COPY_REVIEW ? copyReview(text) : false
}

async function offerCopy(text: string, problem: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(problem, COPY_REVIEW)
  return choice === COPY_REVIEW ? copyReview(text) : false
}

async function copyReview(text: string): Promise<boolean> {
  await vscode.env.clipboard.writeText(text)
  vscode.window.setStatusBarMessage('$(check) Review copied: paste it into the chat', STATUS_MESSAGE_TIMEOUT_MS)
  return true
}
