// The wiring unit tests cannot reach: the manifest against the registered commands, comment threads, documents,
// the quick pick, settings and the clipboard, end to end through the file protocol with the tests playing the mod.

import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import * as vscode from 'vscode'
import {
  PROTOCOL_VERSION,
  deliveredFileName,
  reviewFileName,
  reviewIdOf,
  sessionFileName,
  sessionInboxDir,
  sessionsDir,
  type DeliveryOutcome,
  type SessionRecord,
} from '../../../plugin/hooks/protocol.ts'
import { test } from './harness.ts'

const EXTENSION_ID = 'rogday.handback'
const GIT_EXTENSION_ID = 'vscode.git'
const GIT_API_VERSION = 1
const SAMPLE = 'src/sample.ts'
/** 0-based: `let sum = 0`. */
const SAMPLE_LINE = 1
const MOD_POLL_MS = 50
const QUICK_PICK_POLL_MS = 100

type Manifest = { contributes: { commands: { command: string }[] } }
/** The part of the git extension's API the tests use. */
type GitApi = {
  openRepository(root: vscode.Uri): Promise<unknown>
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri
}

test('every command the manifest contributes has a handler', async () => {
  const extension = vscode.extensions.getExtension(EXTENSION_ID)
  assert.ok(extension, `${EXTENSION_ID} is not loaded`)
  await extension.activate()

  const registered = new Set(await vscode.commands.getCommands(true))
  const { contributes } = extension.packageJSON as Manifest
  const unhandled = contributes.commands.map(({ command }) => command).filter(command => !registered.has(command))
  assert.deepEqual(unhandled, [])
})

test('Add single comment sends the comment and its code to the session and leaves nothing behind', async () => {
  await forgetEverything()
  await announce('only', Date.now())
  const mod = playMod('only', 'submitted')

  await vscode.commands.executeCommand('handback.addSingleComment', await reply('Rename `sum`.'))

  const review = await mod
  assert.match(review, /\*\*src\/sample\.ts\*\* line 2/)
  assert.match(review, /2 > {3}let sum = 0/)
  assert.match(review, /Rename `sum`\./)
  assert.deepEqual(await readdir(sessionInboxDir(homedir(), 'only')), [])
})

test('a review started on a line and finished in the box reaches the session as one message', async () => {
  await forgetEverything()
  await announce('only', Date.now())
  const mod = playMod('only', 'submitted')

  await vscode.commands.executeCommand('handback.startReview', await reply('Name this after what it holds.'))
  await vscode.commands.executeCommand('handback.finishReview')
  await pressEnterOnQuickPickUntil(mod)

  const review = await mod
  assert.match(review, /^\*\*Code review\*\* \(1 comment\)/)
  assert.match(review, /Name this after what it holds\./)
})

test('a comment quotes the code as it was written on, and says so once the file on disk changed', async () => {
  await forgetEverything()
  await announce('only', Date.now())
  const sample = vscode.Uri.joinPath(workspaceRoot(), SAMPLE)
  const original = await readFile(sample.fsPath, 'utf8')
  const mod = playMod('only', 'submitted')
  try {
    await vscode.commands.executeCommand('handback.startReview', await reply('Why start at zero?'))
    await writeFile(sample.fsPath, original.replace('let sum = 0', 'let sum = prices.length'))
    await vscode.commands.executeCommand('handback.finishReview')
    await pressEnterOnQuickPickUntil(mod)

    const review = await mod
    assert.match(review, /2 > {3}let sum = 0/)
    assert.match(review, /file on disk no longer/)
  } finally {
    await writeFile(sample.fsPath, original)
  }
})

test('a comment on the committed version names it and quotes it, whatever the file on disk says', async () => {
  await forgetEverything()
  await announce('only', Date.now())
  const sample = vscode.Uri.joinPath(workspaceRoot(), SAMPLE)
  const original = await readFile(sample.fsPath, 'utf8')
  const atHead = (await gitApi()).toGitUri(sample, 'HEAD')
  const mod = playMod('only', 'submitted')
  try {
    await writeFile(sample.fsPath, original.replace('let sum = 0', 'let sum = prices.length'))
    await vscode.commands.executeCommand('handback.addSingleComment', await reply('Why did this go?', atHead))

    const review = await mod
    assert.match(review, /\*\*src\/sample\.ts\*\* line 2 at `HEAD`/)
    assert.match(review, /2 > {3}let sum = 0/)
    assert.doesNotMatch(review, /file on disk no longer/)
  } finally {
    await writeFile(sample.fsPath, original)
  }
})

test('an edited comment is sent as saved', async () => {
  await forgetEverything()
  await announce('only', Date.now())
  const comment = await pendingComment('First draft.')

  await vscode.commands.executeCommand('handback.editComment', comment)
  comment.body.value = 'Better words.'
  await vscode.commands.executeCommand('handback.saveComment', comment)
  const review = await finishReview('only')

  assert.match(review, /Better words\./)
  assert.doesNotMatch(review, /First draft\./)
})

test('a cancelled edit keeps the comment as it was', async () => {
  await forgetEverything()
  await announce('only', Date.now())
  const comment = await pendingComment('Keep me.')

  await vscode.commands.executeCommand('handback.editComment', comment)
  comment.body.value = 'Not this.'
  await vscode.commands.executeCommand('handback.cancelEdit', comment)
  const review = await finishReview('only')

  assert.match(review, /Keep me\./)
  assert.doesNotMatch(review, /Not this\./)
})

test('a deleted comment leaves the review', async () => {
  await forgetEverything()
  await announce('only', Date.now())
  await pendingComment('Stays.')
  const deleted = await pendingComment('Goes.')

  await vscode.commands.executeCommand('handback.deleteComment', deleted)
  const review = await finishReview('only')

  assert.match(review, /\(1 comment\)/)
  assert.match(review, /Stays\./)
  assert.doesNotMatch(review, /Goes\./)
})

test('with several sessions the picker offers the one prompted last first', async () => {
  await forgetEverything()
  await announce('earlier', Date.now() - 60_000)
  await announce('latest', Date.now() - 1_000)
  // Only the expected session answers: picking the other one would time out.
  const mod = playMod('latest', 'submitted')

  const sending = vscode.commands.executeCommand('handback.addSingleComment', await reply('For the latest.'))
  await pressEnterOnQuickPickUntil(mod)

  assert.match(await mod, /For the latest\./)
  await sending
})

test('in fill mode a chat that draws its own prompt box gets the review on the clipboard', async () => {
  await forgetEverything()
  const settings = vscode.workspace.getConfiguration('handback')
  await settings.update('delivery', 'fill', vscode.ConfigurationTarget.Global)
  try {
    await announce('chat', Date.now())
    const mod = playMod('chat', 'noPromptBox')

    await vscode.commands.executeCommand('handback.addSingleComment', await reply('Paste me.'))

    assert.equal(await vscode.env.clipboard.readText(), await mod)
  } finally {
    await settings.update('delivery', undefined, vscode.ConfigurationTarget.Global)
  }
})

test('a second review sent while one is on its way is held back, not sent twice', async () => {
  await forgetEverything()
  await announce('only', Date.now())
  const held = await reply('Sent while the first is on its way.')

  const first = vscode.commands.executeCommand('handback.addSingleComment', await reply('The first.'))
  const review = await nextReview('only')
  await vscode.commands.executeCommand('handback.addSingleComment', held)
  await answer('only', review.id, 'submitted')
  await first

  assert.match(review.text, /The first\./)
  // Held back, the comment stays pending; dropped here so the tests after this one start from an empty review.
  const [pending] = held.thread.comments
  assert.ok(pending, 'the held comment stays in the review')
  await vscode.commands.executeCommand('handback.deleteComment', pending)
})

async function forgetEverything(): Promise<void> {
  await rm(join(homedir(), '.claude'), { recursive: true, force: true })
}

function workspaceRoot(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0]
  assert.ok(folder, 'the tests run in a workspace')
  return folder.uri
}

/** Announces a live session on the workspace, as the mod does. */
async function announce(id: string, lastPromptAt: number): Promise<void> {
  const now = Date.now()
  const root = workspaceRoot().fsPath
  const record: SessionRecord = { id, protocol: PROTOCOL_VERSION, root, startedAt: now, heartbeatAt: now, lastPromptAt }
  await mkdir(sessionsDir(homedir()), { recursive: true })
  await writeFile(`${sessionsDir(homedir())}/${sessionFileName(id)}`, JSON.stringify(record))
}

/** The git extension's API, once it has opened the fixture's repository. */
async function gitApi(): Promise<GitApi> {
  const extension = vscode.extensions.getExtension<{ getAPI(version: number): GitApi }>(GIT_EXTENSION_ID)
  assert.ok(extension, `${GIT_EXTENSION_ID} is not loaded`)
  const api = (await extension.activate()).getAPI(GIT_API_VERSION)
  await api.openRepository(workspaceRoot())
  return api
}

/**
 * What VS Code hands the extension when the person presses a button under a new comment on the sample line, in the
 * working tree unless `uri` names another version of the sample.
 */
async function reply(text: string, uri = vscode.Uri.joinPath(workspaceRoot(), SAMPLE)): Promise<vscode.CommentReply> {
  await vscode.window.showTextDocument(uri)
  const controller = vscode.comments.createCommentController('handback-test', 'Test')
  const thread = controller.createCommentThread(uri, new vscode.Range(SAMPLE_LINE, 0, SAMPLE_LINE, 0), [])
  return { thread, text }
}

/**
 * Plays the mod for one session: takes the first review sent there, answers `outcome` and resolves its text once
 * the extension has cleaned up after it, so a test never ends with a delivery still under way.
 */
async function playMod(sessionId: string, outcome: DeliveryOutcome): Promise<string> {
  const review = await nextReview(sessionId)
  await answer(sessionId, review.id, outcome)
  return review.text
}

/** Waits for a review to arrive in the session's inbox, without answering it. */
async function nextReview(sessionId: string): Promise<{ id: string; text: string }> {
  const inbox = sessionInboxDir(homedir(), sessionId)
  for (;;) {
    const names = await readdir(inbox).catch(() => [])
    const id = names.map(reviewIdOf).find(reviewId => reviewId !== undefined)
    if (id !== undefined) {
      const { text } = JSON.parse(await readFile(join(inbox, reviewFileName(id)), 'utf8')) as { text: string }
      return { id, text }
    }
    await sleep(MOD_POLL_MS)
  }
}

/** Answers a review as the mod does, then waits until the extension has read the answer and removed both files. */
async function answer(sessionId: string, reviewId: string, outcome: DeliveryOutcome): Promise<void> {
  const inbox = sessionInboxDir(homedir(), sessionId)
  await writeFile(join(inbox, deliveredFileName(reviewId)), outcome)
  while ((await readdir(inbox).catch(() => [])).length > 0) await sleep(MOD_POLL_MS)
}

/** A comment of the pending review, as VS Code hands it to the comment's menu commands. */
type PendingComment = vscode.Comment & { body: vscode.MarkdownString }

/** Starts or adds to the review with a comment on the sample line. */
async function pendingComment(text: string): Promise<PendingComment> {
  const pending = await reply(text)
  await vscode.commands.executeCommand('handback.startReview', pending)
  const [comment] = pending.thread.comments
  assert.ok(comment?.body instanceof vscode.MarkdownString, 'the comment joined the review')
  return comment as PendingComment
}

/** Finishes the pending review with the box's first verdict and resolves what the session received. */
async function finishReview(sessionId: string): Promise<string> {
  const mod = playMod(sessionId, 'submitted')
  await vscode.commands.executeCommand('handback.finishReview')
  await pressEnterOnQuickPickUntil(mod)
  return mod
}

async function pressEnterOnQuickPickUntil(done: Promise<unknown>): Promise<void> {
  const finished = done.then(() => true)
  for (;;) {
    await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem')
    if (await Promise.race([finished, sleep(QUICK_PICK_POLL_MS, false)])) return
  }
}
