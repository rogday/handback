// Turns VS Code's comment threads and selections into what format.ts quotes.

import * as vscode from 'vscode'
import {
  commentedSpan,
  excerptSpan,
  isCommentedCodeIntact,
  type Excerpt,
  type LineSpan,
  type ReviewedThread,
  type Revision,
  type Snapshot,
} from './format.ts'
import { reviewComments, type ReviewEntry } from './review.ts'

/** VS Code's git extension opens a file's other versions under this scheme, the query naming the file and version. */
const GIT_SCHEME = 'git'
/**
 * The git extension's refs for the index: `''`, and `'~'` for the left side of a working tree diff, which reads the
 * index when the file has staged changes and HEAD otherwise, the same text as the index then.
 */
const INDEX_REFS = new Set(['', '~'])

/** A file of the working tree as a document shows it: as it stands, or at a revision. */
export type FileVersion = {
  file: vscode.Uri
  revision: Revision | undefined
}

/** Undefined for a document that shows no file of the working tree: an untitled one, output, settings. */
export function fileVersionOf(uri: vscode.Uri): FileVersion | undefined {
  if (uri.scheme === 'file') return { file: uri, revision: undefined }
  if (uri.scheme === GIT_SCHEME) return gitFileVersion(uri.query)
  return undefined
}

/** The file and version a review thread is on; a thread opens only where `fileVersionOf` finds a file. */
export function threadFileVersion(thread: vscode.CommentThread): FileVersion {
  return fileVersionOf(thread.uri) ?? { file: thread.uri, revision: undefined }
}

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
    entries.map(async ({ thread, snapshot }) => {
      const { file, revision } = threadFileVersion(thread)
      return {
        ...snapshot,
        path: vscode.workspace.asRelativePath(file, false),
        revision,
        bodies: reviewComments(thread).map(comment => comment.text),
        // A revision is quoted as that version: the working tree is free to differ from it.
        isChangedOnDisk: revision === undefined && !isCommentedCodeIntact(snapshot, await linesOf(file)),
      }
    }),
  )
}

function gitFileVersion(query: string): FileVersion | undefined {
  const params = parseJson(query)
  if (typeof params !== 'object' || params === null) return undefined
  const { path, ref } = params as Record<string, unknown>
  if (typeof path !== 'string' || typeof ref !== 'string') return undefined
  return { file: vscode.Uri.file(path), revision: INDEX_REFS.has(ref) ? 'index' : { ref } }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
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
