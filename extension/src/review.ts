import * as vscode from 'vscode'

/** The `comment` and `commentThread` context values menus match on. */
const PENDING = 'pending'
const DRAFT = 'draft'

/**
 * A comment of the pending review, shown with GitHub's "Pending" badge until the review is finished. A draft is one
 * still being written in place (a suggestion), not yet part of the review.
 */
export class ReviewComment implements vscode.Comment {
  body: vscode.MarkdownString
  mode: vscode.CommentMode
  readonly author: vscode.CommentAuthorInformation
  readonly timestamp: Date
  readonly thread: vscode.CommentThread
  // VS Code writes the editor's text into `body` before any edit action runs, Cancel included.
  #savedText: string
  #isDraft: boolean

  constructor(
    thread: vscode.CommentThread,
    author: vscode.CommentAuthorInformation,
    text: string,
    timestamp: Date,
    isDraft = false,
  ) {
    this.thread = thread
    this.author = author
    this.body = new vscode.MarkdownString(text)
    this.timestamp = timestamp
    this.#savedText = text
    this.#isDraft = isDraft
    this.mode = isDraft ? vscode.CommentMode.Editing : vscode.CommentMode.Preview
  }

  get contextValue(): string {
    return this.#isDraft ? DRAFT : PENDING
  }

  get label(): string {
    return this.#isDraft ? 'Draft' : 'Pending'
  }

  get text(): string {
    return this.body.value
  }

  publish(): void {
    this.#isDraft = false
    this.saveEdit()
  }

  startEditing(): void {
    this.mode = vscode.CommentMode.Editing
  }

  saveEdit(): void {
    this.#savedText = this.body.value
    this.mode = vscode.CommentMode.Preview
  }

  cancelEdit(): void {
    this.body = new vscode.MarkdownString(this.#savedText)
    this.mode = vscode.CommentMode.Preview
  }
}

/** A pending thread as kept across window reloads: positions 0-based, comment times in epoch milliseconds. */
export type SavedThread = {
  uri: string
  range: [startLine: number, startCharacter: number, endLine: number, endCharacter: number]
  comments: { text: string; time: number }[]
}

/** The threads of the review being written, like a pull request's pending review. */
export class PendingReview implements vscode.Disposable {
  readonly #threads = new Set<vscode.CommentThread>()
  readonly #changed = new vscode.EventEmitter<void>()
  readonly onDidChange = this.#changed.event

  get threads(): readonly vscode.CommentThread[] {
    return [...this.#threads]
  }

  get commentCount(): number {
    return this.threads.reduce((count, thread) => count + reviewComments(thread).length, 0)
  }

  /** Adds the reply to the review; the thread it went to, or undefined for an empty reply. */
  addComment(reply: vscode.CommentReply, author: vscode.CommentAuthorInformation): vscode.CommentThread | undefined {
    const text = reply.text.trim()
    if (text === '') return undefined
    const { thread } = reply
    thread.comments = [...thread.comments, new ReviewComment(thread, author, text, new Date())]
    this.#adopt(thread)
    this.#changed.fire()
    return thread
  }

  /** Opens a draft comment on `range`, as GitHub's "Add a suggestion" does; it joins the review once saved. */
  startDraft(
    controller: vscode.CommentController,
    uri: vscode.Uri,
    range: vscode.Range,
    text: string,
    author: vscode.CommentAuthorInformation,
  ): void {
    const thread = controller.createCommentThread(uri, range, [])
    // A reply box under the draft would read as a second comment.
    thread.canReply = false
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded
    thread.comments = [new ReviewComment(thread, author, text, new Date(), true)]
  }

  /** Makes a draft a pending comment of the review; undefined when it was left empty and so dropped. */
  addDraft(comment: ReviewComment): vscode.CommentThread | undefined {
    const { thread } = comment
    if (comment.text.trim() === '') {
      thread.dispose()
      return undefined
    }
    comment.publish()
    redraw(thread)
    this.#adopt(thread)
    this.#changed.fire()
    return thread
  }

  restore(
    controller: vscode.CommentController,
    saved: readonly SavedThread[],
    author: vscode.CommentAuthorInformation,
  ): void {
    for (const { uri, range, comments } of saved) {
      const thread = controller.createCommentThread(vscode.Uri.parse(uri), new vscode.Range(...range), [])
      thread.comments = comments.map(({ text, time }) => new ReviewComment(thread, author, text, new Date(time)))
      this.#adopt(thread)
    }
    this.#changed.fire()
  }

  toSaved(): SavedThread[] {
    return this.threads.map(({ uri, range, comments }) => ({
      uri: uri.toString(),
      range: [range.start.line, range.start.character, range.end.line, range.end.character],
      comments: comments
        .filter(comment => comment instanceof ReviewComment)
        .map(comment => ({ text: comment.text, time: comment.timestamp.getTime() })),
    }))
  }

  editComment(comment: ReviewComment): void {
    comment.startEditing()
    redraw(comment.thread)
  }

  saveComment(comment: ReviewComment): void {
    comment.saveEdit()
    redraw(comment.thread)
    this.#changed.fire()
  }

  cancelEdit(comment: ReviewComment): void {
    comment.cancelEdit()
    redraw(comment.thread)
  }

  deleteComment(comment: ReviewComment): void {
    const { thread } = comment
    const remaining = thread.comments.filter(other => other !== comment)
    if (remaining.length > 0) {
      thread.comments = remaining
    } else {
      this.#threads.delete(thread)
      thread.dispose()
    }
    this.#changed.fire()
  }

  /** Drops a thread that was sent on its own. */
  removeThread(thread: vscode.CommentThread): void {
    this.#threads.delete(thread)
    thread.dispose()
    this.#changed.fire()
  }

  /** Drops every thread: once the review is sent, or when it is discarded. */
  clear(): void {
    for (const thread of this.#threads) thread.dispose()
    this.#threads.clear()
    this.#changed.fire()
  }

  // Disposes the threads without dropping them from the saved review: VS Code is shutting down or reloading.
  dispose(): void {
    for (const thread of this.#threads) thread.dispose()
    this.#changed.dispose()
  }

  #adopt(thread: vscode.CommentThread): void {
    thread.contextValue = PENDING
    thread.canReply = true
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded
    this.#threads.add(thread)
  }
}

export function parseSavedThreads(value: unknown): SavedThread[] {
  if (!Array.isArray(value)) return []
  return value.filter(isSavedThread)
}

function isSavedThread(value: unknown): value is SavedThread {
  if (typeof value !== 'object' || value === null) return false
  const { uri, range, comments } = value as Record<string, unknown>
  return (
    typeof uri === 'string' &&
    Array.isArray(range) &&
    range.length === 4 &&
    range.every(position => typeof position === 'number') &&
    Array.isArray(comments) &&
    comments.every(isSavedComment)
  )
}

function isSavedComment(value: unknown): value is SavedThread['comments'][number] {
  if (typeof value !== 'object' || value === null) return false
  const { text, time } = value as Record<string, unknown>
  return typeof text === 'string' && typeof time === 'number'
}

export function reviewComments(thread: vscode.CommentThread): ReviewComment[] {
  return thread.comments.filter(comment => comment instanceof ReviewComment)
}

// VS Code redraws a thread when its comments are assigned, not when a comment changes.
function redraw(thread: vscode.CommentThread): void {
  thread.comments = [...thread.comments]
}
