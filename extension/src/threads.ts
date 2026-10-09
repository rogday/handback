// Turns VS Code's comment threads and selections into what format.ts quotes.

import * as vscode from 'vscode'
import {
  commentedSpan,
  excerptSpan,
  isCommentedCodeIntact,
  type Excerpt,
  type LineSpan,
  type ReviewedThread,
  type Snapshot,
} from './format.ts'
import { reviewComments, type ReviewEntry } from './review.ts'

/** The selection grown to whole lines, as a comment takes them. */
export function selectedLines(editor: vscode.TextEditor): { range: vscode.Range; lines: string[] } {
  const { start, end } = editor.selection
  const span = commentedSpan(start.line, end.line, end.character)
  const lines: string[] = []
  for (let line = span.start; line <= span.end; line++) lines.push(editor.document.lineAt(line - 1).text)
  const lastLineLength = lines.at(-1)?.length ?? 0
  return { range: new vscode.Range(span.start - 1, 0, span.end - 1, lastLineLength), lines }
}

/** The commented lines and their context as the editor shows them now, when the comment is written. */
export async function snapshotOf(thread: vscode.CommentThread): Promise<Snapshot> {
  const { start, end } = thread.range
  const commented = commentedSpan(start.line, end.line, end.character)
  const document = await vscode.workspace.openTextDocument(thread.uri)
  return { languageId: document.languageId, commented, excerpt: excerptOf(document, commented) }
}

/** The review's threads as sent: each quoted as commented, flagged where the file on disk no longer matches. */
export async function reviewedThreads(entries: readonly ReviewEntry[]): Promise<ReviewedThread[]> {
  // Each file is read once, however many comments it holds.
  const fileLines = new Map<string, Promise<readonly string[]>>()
  const linesOf = (uri: vscode.Uri) => {
    const key = uri.toString()
    const cached = fileLines.get(key)
    if (cached !== undefined) return cached
    const read = readLines(uri)
    fileLines.set(key, read)
    return read
  }
  return Promise.all(
    entries.map(async ({ thread, snapshot }) => ({
      ...snapshot,
      path: vscode.workspace.asRelativePath(thread.uri, false),
      bodies: reviewComments(thread).map(comment => comment.text),
      isChangedOnDisk: !isCommentedCodeIntact(snapshot, await linesOf(thread.uri)),
    })),
  )
}

function excerptOf(document: vscode.TextDocument, commented: LineSpan): Excerpt {
  const shown = excerptSpan(commented, document.lineCount)
  const lines: string[] = []
  for (let line = shown.start; line <= shown.end; line++) lines.push(document.lineAt(line - 1).text)
  return { firstLine: shown.start, lines }
}

/** The file as saved, which is what Claude reads; none when it is gone. */
async function readLines(uri: vscode.Uri): Promise<readonly string[]> {
  const bytes = await Promise.resolve(vscode.workspace.fs.readFile(uri)).catch(() => undefined)
  return bytes === undefined ? [] : new TextDecoder().decode(bytes).split(/\r?\n/)
}
