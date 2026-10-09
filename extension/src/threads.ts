// Turns VS Code's comment threads and selections into what format.ts quotes.

import * as vscode from 'vscode'
import { commentedSpan, excerptSpan, type Excerpt, type LineSpan, type ReviewedThread } from './format.ts'
import { reviewComments } from './review.ts'

/** The selection grown to whole lines, as a comment takes them. */
export function selectedLines(editor: vscode.TextEditor): { range: vscode.Range; lines: string[] } {
  const { start, end } = editor.selection
  const span = commentedSpan(start.line, end.line, end.character)
  const lines: string[] = []
  for (let line = span.start; line <= span.end; line++) lines.push(editor.document.lineAt(line - 1).text)
  const lastLineLength = lines.at(-1)?.length ?? 0
  return { range: new vscode.Range(span.start - 1, 0, span.end - 1, lastLineLength), lines }
}

export async function reviewedThread(thread: vscode.CommentThread): Promise<ReviewedThread> {
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
