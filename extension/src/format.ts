// Turns a finished review into the prompt Claude reads. Pure, so it runs under Node's test runner without VS Code.

/** Lines shown around the commented ones, as GitHub shows a comment's diff hunk. */
const CONTEXT_LINES = 3
const MIN_FENCE_LENGTH = 3
const SUGGESTION_FENCE = /^`{3,}suggestion\s*$/m
const SUGGESTION_NOTE = 'A `suggestion` block is the replacement for the lines its comment is on, as on GitHub.'
const CHANGED_ON_DISK_NOTE =
  '_The file on disk no longer reads like this here (unsaved edits, or changed since the comment): the lines are quoted as they were commented._'

export type Verdict = 'comment' | 'approve' | 'requestChanges'

/** 1-based, inclusive. */
export type LineSpan = {
  start: number
  end: number
}

export type Excerpt = {
  firstLine: number
  lines: readonly string[]
}

/** The commented code as it was when the comment was written: what the review quotes, whatever happened since. */
export type Snapshot = {
  languageId: string
  commented: LineSpan
  excerpt: Excerpt
}

export type ReviewedThread = Snapshot & {
  /** Relative to the workspace. */
  path: string
  /** The thread's comments, oldest first. */
  bodies: readonly string[]
  /** The file on disk, which Claude reads, no longer holds the commented lines where they were. */
  isChangedOnDisk: boolean
}

export type Review = {
  verdict: Verdict
  summary: string
  threads: readonly ReviewedThread[]
}

const HEADINGS: Record<Verdict, string> = {
  comment: 'Code review',
  approve: 'Code review: approved',
  requestChanges: 'Code review: changes requested',
}

const INSTRUCTIONS: Record<Verdict, string> = {
  comment: 'Reply to each comment. Change the code only where a comment asks for it.',
  approve: 'The changes are approved. Treat the comments as optional suggestions.',
  requestChanges: 'Address every comment. Where you disagree with one, say why instead of changing the code.',
}

/**
 * The commented lines of a range given as VS Code's 0-based positions. A selection that ends at the start of a
 * line does not take that line: it is how a selection of whole lines ends.
 */
export function commentedSpan(startLine: number, endLine: number, endCharacter: number): LineSpan {
  const isEndAtLineStart = endCharacter === 0 && endLine > startLine
  return { start: startLine + 1, end: (isEndAtLineStart ? endLine - 1 : endLine) + 1 }
}

/** Whether the file's lines, as read now, still hold the snapshot's commented lines at the same place. */
export function isCommentedCodeIntact(snapshot: Snapshot, fileLines: readonly string[]): boolean {
  const { commented, excerpt } = snapshot
  for (let line = commented.start; line <= commented.end; line++) {
    if (fileLines[line - 1] !== excerpt.lines[line - excerpt.firstLine]) return false
  }
  return true
}

/** The lines to quote for a comment: the commented ones and their context, within the file. */
export function excerptSpan(commented: LineSpan, lineCount: number): LineSpan {
  return {
    start: Math.max(1, commented.start - CONTEXT_LINES),
    end: Math.min(lineCount, commented.end + CONTEXT_LINES),
  }
}

export function formatReview(review: Review): string {
  const threads = [...review.threads].sort(byPlace)
  const commentCount = threads.reduce((count, thread) => count + thread.bodies.length, 0)
  const heading = `**${HEADINGS[review.verdict]}**` + (commentCount > 0 ? ` (${plural(commentCount, 'comment')})` : '')
  const summary = review.summary.trim()
  return [
    heading,
    ...(summary === '' ? [] : [summary]),
    ...threads.map(formatThread),
    instructions(review.verdict, threads),
  ].join('\n\n---\n\n')
}

/** A single comment, sent at once rather than as part of a review, as GitHub's "Add single comment" does. */
export function formatComment(thread: ReviewedThread): string {
  return ['**Review comment**', formatThread(thread), instructions('comment', [thread])].join('\n\n---\n\n')
}

/** The body GitHub's "Add a suggestion" starts from: the commented lines, to be edited into their replacement. */
export function suggestionBlock(lines: readonly string[]): string {
  const fence = fenceFor(lines)
  return [`${fence}suggestion`, ...lines, fence].join('\n')
}

function instructions(verdict: Verdict, threads: readonly ReviewedThread[]): string {
  const hasSuggestion = threads.some(thread => thread.bodies.some(body => SUGGESTION_FENCE.test(body)))
  return hasSuggestion ? `${INSTRUCTIONS[verdict]} ${SUGGESTION_NOTE}` : INSTRUCTIONS[verdict]
}

function formatThread(thread: ReviewedThread): string {
  const { start, end } = thread.commented
  const lines = start === end ? `line ${start}` : `lines ${start}–${end}`
  const note = thread.isChangedOnDisk ? [CHANGED_ON_DISK_NOTE] : []
  return [`**${thread.path}** ${lines}`, ...note, formatExcerpt(thread), ...thread.bodies].join('\n\n')
}

function formatExcerpt({ languageId, commented, excerpt }: ReviewedThread): string {
  const lastLine = excerpt.firstLine + excerpt.lines.length - 1
  const numberWidth = String(lastLine).length
  const numbered = excerpt.lines.map((text, index) => {
    const line = excerpt.firstLine + index
    const marker = line >= commented.start && line <= commented.end ? '>' : ' '
    return `${String(line).padStart(numberWidth)} ${marker} ${text}`.trimEnd()
  })
  const fence = fenceFor(excerpt.lines)
  const language = languageId === 'plaintext' ? '' : languageId
  return [fence + language, ...numbered, fence].join('\n')
}

/** A fence longer than any run of backticks in the code, so the code cannot close it. */
function fenceFor(lines: readonly string[]): string {
  const longestRun = Math.max(0, ...lines.flatMap(line => line.match(/`+/g) ?? []).map(run => run.length))
  return '`'.repeat(Math.max(MIN_FENCE_LENGTH, longestRun + 1))
}

function byPlace(a: ReviewedThread, b: ReviewedThread): number {
  return a.path.localeCompare(b.path) || a.commented.start - b.commented.start
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
