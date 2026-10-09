import { execFile } from 'node:child_process'
import { userInfo } from 'node:os'
import { promisify } from 'node:util'
import * as vscode from 'vscode'
import { isDeliveryMode, type DeliveryMode, type SessionRecord } from '../../plugin/hooks/protocol.ts'
import { deliver, sessionsFor, type DeliveryResult } from './delivery.ts'
import { FinishReviewPicker } from './finishPicker.ts'
import {
  commentedSpan,
  excerptSpan,
  formatComment,
  formatReview,
  suggestionBlock,
  type Excerpt,
  type LineSpan,
  type ReviewedThread,
  type Verdict,
} from './format.ts'
import { PendingReview, ReviewComment, parseSavedThreads, reviewComments } from './review.ts'

const CONTROLLER_ID = 'handback'
const REVIEW_IN_PROGRESS = 'handback.reviewInProgress'
const PENDING_REVIEW_KEY = 'handback.pendingReview'
/** Beside the other right-hand items, left of the notifications bell. */
const FINISH_BUTTON_PRIORITY = 100
const STATUS_MESSAGE_TIMEOUT_MS = 4_000
const INSTALL_URL = 'https://github.com/rogday/handback#install'
/** The Claude Code extension's "Focus input" command. */
const CLAUDE_FOCUS_INPUT = 'claude-vscode.focus'
const PASTE_KEY = process.platform === 'darwin' ? 'Cmd+V' : 'Ctrl+V'
const COPY_REVIEW = 'Copy review'
const INSTALL_MOD = 'Install the mod'

const execFileAsync = promisify(execFile)

export function activate(context: vscode.ExtensionContext): void {
  const controller = vscode.comments.createCommentController(CONTROLLER_ID, 'Handback')
  controller.commentingRangeProvider = { provideCommentingRanges: wholeFile }
  controller.options = { prompt: 'Leave a comment', placeHolder: 'Leave a comment' }

  const review = new PendingReview()
  const finishButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, FINISH_BUTTON_PRIORITY)
  finishButton.command = 'handback.finishReview'
  const picker = new FinishReviewPicker(context.globalState, {
    submit: ({ verdict, summary }) => finishReview(review, verdict, summary),
    discard: () => discardReview(review),
  })
  review.onDidChange(() => {
    showPendingCount(review.commentCount, finishButton)
    void context.workspaceState.update(PENDING_REVIEW_KEY, review.toSaved())
  })

  const author = reviewer()
  // A pending review outlives a window reload, as GitHub keeps one until it is submitted.
  const saved = parseSavedThreads(context.workspaceState.get<unknown>(PENDING_REVIEW_KEY))
  if (saved.length > 0) void author.then(reviewerInfo => review.restore(controller, saved, reviewerInfo))
  const addReviewComment = async (reply: vscode.CommentReply) => {
    review.addComment(reply, await author)
  }
  const addSingleComment = async (reply: vscode.CommentReply) => {
    const thread = review.addComment(reply, await author)
    if (thread !== undefined) await sendSingleComment(review, thread)
  }
  const suggestChange = async () => {
    const editor = vscode.window.activeTextEditor
    if (editor?.document.uri.scheme !== 'file') return
    const { range, lines } = selectedLines(editor)
    review.startDraft(controller, editor.document.uri, range, suggestionBlock(lines), await author)
  }
  const sendDraft = async (comment: ReviewComment) => {
    const thread = review.addDraft(comment)
    if (thread !== undefined) await sendSingleComment(review, thread)
  }

  context.subscriptions.push(
    controller,
    review,
    finishButton,
    vscode.commands.registerCommand('handback.startReview', addReviewComment),
    vscode.commands.registerCommand('handback.addReviewComment', addReviewComment),
    vscode.commands.registerCommand('handback.addSingleComment', addSingleComment),
    vscode.commands.registerCommand('handback.cancelThread', (reply: vscode.CommentReply) => reply.thread.dispose()),
    vscode.commands.registerCommand('handback.editComment', (comment: ReviewComment) => review.editComment(comment)),
    vscode.commands.registerCommand('handback.saveComment', (comment: ReviewComment) => review.saveComment(comment)),
    vscode.commands.registerCommand('handback.cancelEdit', (comment: ReviewComment) => review.cancelEdit(comment)),
    vscode.commands.registerCommand('handback.deleteComment', (comment: ReviewComment) =>
      review.deleteComment(comment),
    ),
    vscode.commands.registerCommand('handback.suggestChange', suggestChange),
    vscode.commands.registerCommand('handback.startReviewWithDraft', (comment: ReviewComment) => {
      review.addDraft(comment)
    }),
    vscode.commands.registerCommand('handback.addDraftToReview', (comment: ReviewComment) => {
      review.addDraft(comment)
    }),
    vscode.commands.registerCommand('handback.sendDraft', sendDraft),
    vscode.commands.registerCommand('handback.discardDraft', (comment: ReviewComment) => comment.thread.dispose()),
    vscode.commands.registerCommand('handback.finishReview', () => picker.show(review.commentCount)),
    vscode.commands.registerCommand('handback.discardReview', () => discardReview(review)),
  )
}

function wholeFile(document: vscode.TextDocument): vscode.Range[] | undefined {
  if (document.uri.scheme !== 'file') return undefined
  return [new vscode.Range(0, 0, document.lineCount - 1, 0)]
}

/** The selection grown to whole lines, as a comment takes them. */
function selectedLines(editor: vscode.TextEditor): { range: vscode.Range; lines: string[] } {
  const { start, end } = editor.selection
  const span = commentedSpan(start.line, end.line, end.character)
  const lines: string[] = []
  for (let line = span.start; line <= span.end; line++) lines.push(editor.document.lineAt(line - 1).text)
  const lastLineLength = lines.at(-1)?.length ?? 0
  return { range: new vscode.Range(span.start - 1, 0, span.end - 1, lastLineLength), lines }
}

function showPendingCount(count: number, finishButton: vscode.StatusBarItem): void {
  void vscode.commands.executeCommand('setContext', REVIEW_IN_PROGRESS, count > 0)
  finishButton.text = `$(comment-discussion) Finish your review (${count})`
  finishButton.tooltip = `${count} pending ${count === 1 ? 'comment' : 'comments'}`
  if (count > 0) finishButton.show()
  else finishButton.hide()
}

async function finishReview(review: PendingReview, verdict: Verdict, summary: string): Promise<boolean> {
  // An approval alone says something; an empty comment does not.
  if (review.threads.length === 0 && summary.trim() === '' && verdict !== 'approve') {
    void vscode.window.showInformationMessage('Nothing to send: leave a comment on a line or a summary first.')
    return false
  }
  const threads = await Promise.all(review.threads.map(reviewedThread))
  const paths = review.threads.map(thread => thread.uri.fsPath)
  const isSent = await send(formatReview({ verdict, summary, threads }), paths)
  if (isSent) review.clear()
  return isSent
}

/** Sends one thread at once; if it cannot be sent, it stays in the review as a pending comment. */
async function sendSingleComment(review: PendingReview, thread: vscode.CommentThread): Promise<void> {
  const isSent = await send(formatComment(await reviewedThread(thread)), [thread.uri.fsPath])
  if (isSent) review.removeThread(thread)
}

async function discardReview(review: PendingReview): Promise<boolean> {
  const count = review.commentCount
  const discard = 'Discard'
  const message = `Discard ${count} pending ${count === 1 ? 'comment' : 'comments'}?`
  const choice = await vscode.window.showWarningMessage(message, { modal: true }, discard)
  if (choice !== discard) return false
  review.clear()
  return true
}

async function reviewedThread(thread: vscode.CommentThread): Promise<ReviewedThread> {
  const { start, end } = thread.range
  const commented = commentedSpan(start.line, end.line, end.character)
  // A file deleted since the comment was left (a restored review) is still worth its comments.
  const document = await Promise.resolve(vscode.workspace.openTextDocument(thread.uri)).catch(() => undefined)
  return {
    path: vscode.workspace.asRelativePath(thread.uri, false),
    languageId: document?.languageId ?? 'plaintext',
    commented,
    excerpt: document === undefined ? { firstLine: commented.start, lines: [] } : excerptOf(document, commented),
    bodies: reviewComments(thread).map(comment => comment.text),
  }
}

function excerptOf(document: vscode.TextDocument, commented: LineSpan): Excerpt {
  const shown = excerptSpan(commented, document.lineCount)
  const lines: string[] = []
  for (let line = shown.start; line <= shown.end; line++) lines.push(document.lineAt(line - 1).text)
  return { firstLine: shown.start, lines }
}

/** Sends the review to a session the person picks; true once it is out of the editor's hands. */
async function send(text: string, paths: readonly string[]): Promise<boolean> {
  const workspacePaths = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? []
  const sessions = await sessionsFor(paths.length > 0 ? paths : workspacePaths)
  if (sessions.length === 0) {
    return offerCopy(text, 'No Claude Code session running the Handback mod is open on this workspace.')
  }
  const session = await pickSession(sessions)
  if (session === undefined) return false

  const progress = { location: vscode.ProgressLocation.Window, title: 'Sending the review to Claude' }
  const result = await vscode.window.withProgress(progress, () => deliver(session.id, text, deliveryMode()))
  return reportDelivery(result, text, session)
}

/** Asks only when there is a choice: each session by its title and when the person last typed in it. */
async function pickSession(sessions: readonly SessionRecord[]): Promise<SessionRecord | undefined> {
  if (sessions.length === 1) return sessions[0]
  const now = Date.now()
  const items = sessions.map(session => ({
    label: session.title ?? 'Untitled session',
    description:
      session.lastPromptAt === undefined
        ? `started ${timeAgo(session.startedAt, now)}`
        : `last prompt ${timeAgo(session.lastPromptAt, now)}`,
    detail: session.root,
    session,
  }))
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Send the review to which Claude Code session?',
    placeHolder: 'The session you typed in last comes first',
  })
  return picked?.session
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

async function reviewer(): Promise<vscode.CommentAuthorInformation> {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  const gitName = await execFileAsync('git', ['config', 'user.name'], { cwd }).then(
    ({ stdout }) => stdout.trim(),
    () => '',
  )
  return { name: gitName || userInfo().username }
}
