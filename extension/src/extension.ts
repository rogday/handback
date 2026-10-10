import { execFile } from 'node:child_process'
import { userInfo } from 'node:os'
import { promisify } from 'node:util'
import * as vscode from 'vscode'
import { FinishReviewPicker } from './finishPicker.ts'
import { formatComment, formatReview, suggestionBlock, type Verdict } from './format.ts'
import { PendingReview, ReviewComment, parseSavedThreads } from './review.ts'
import { send } from './send.ts'
import { fileVersionOf, reviewedThreads, selectedLines, snapshotOf, threadFileVersion } from './threads.ts'

const CONTROLLER_ID = 'handback'
const REVIEW_IN_PROGRESS = 'handback.reviewInProgress'
const PENDING_REVIEW_KEY = 'handback.pendingReview'
/** Beside the other right-hand items, left of the notifications bell. */
const FINISH_BUTTON_PRIORITY = 100

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
    review.addComment(reply, await author, await snapshotOf(reply.thread))
  }
  const addSingleComment = async (reply: vscode.CommentReply) => {
    const thread = review.addComment(reply, await author, await snapshotOf(reply.thread))
    if (thread !== undefined) await sendSingleComment(review, thread)
  }
  const suggestChange = async () => {
    const editor = vscode.window.activeTextEditor
    if (editor?.document.uri.scheme !== 'file') return
    const { range, lines } = selectedLines(editor)
    review.startDraft(controller, editor.document.uri, range, suggestionBlock(lines), await author)
  }
  const addDraft = async (comment: ReviewComment) => {
    review.addDraft(comment, await snapshotOf(comment.thread))
  }
  const sendDraft = async (comment: ReviewComment) => {
    const thread = review.addDraft(comment, await snapshotOf(comment.thread))
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
    vscode.commands.registerCommand('handback.startReviewWithDraft', addDraft),
    vscode.commands.registerCommand('handback.addDraftToReview', addDraft),
    vscode.commands.registerCommand('handback.sendDraft', sendDraft),
    vscode.commands.registerCommand('handback.discardDraft', (comment: ReviewComment) => comment.thread.dispose()),
    vscode.commands.registerCommand('handback.finishReview', () => picker.show(review.commentCount)),
    vscode.commands.registerCommand('handback.discardReview', () => discardReview(review)),
  )
}

function wholeFile(document: vscode.TextDocument): vscode.Range[] | undefined {
  if (fileVersionOf(document.uri) === undefined) return undefined
  return [new vscode.Range(0, 0, document.lineCount - 1, 0)]
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
  const threads = await reviewedThreads(review.entries)
  const paths = review.threads.map(thread => threadFileVersion(thread).file.fsPath)
  const isSent = await send(formatReview({ verdict, summary, threads }), paths)
  if (isSent) review.clear()
  return isSent
}

/** Sends one thread at once; if it cannot be sent, it stays in the review as a pending comment. */
async function sendSingleComment(review: PendingReview, thread: vscode.CommentThread): Promise<void> {
  const entry = review.entryOf(thread)
  if (entry === undefined) return
  const [reviewed] = await reviewedThreads([entry])
  if (reviewed === undefined) return
  const isSent = await send(formatComment(reviewed), [threadFileVersion(thread).file.fsPath])
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

async function reviewer(): Promise<vscode.CommentAuthorInformation> {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  const gitName = await execFileAsync('git', ['config', 'user.name'], { cwd }).then(
    ({ stdout }) => stdout.trim(),
    () => '',
  )
  return { name: gitName || userInfo().username }
}
