// The wiring unit tests cannot reach: the manifest against the registered commands, comment threads, documents,
// the quick pick, settings and the clipboard, end to end through the file protocol with the tests playing the mod.

import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import * as vscode from 'vscode'
import {
  deliveredFileName,
  reviewIdOf,
  sessionFileName,
  sessionInboxDir,
  sessionsDir,
  type DeliveryOutcome,
  type SessionRecord,
} from '../../../plugin/hooks/protocol.ts'
import { test } from './harness.ts'

const EXTENSION_ID = 'rogday.handback'
const SAMPLE = 'src/sample.ts'
/** 0-based: `let sum = 0`. */
const SAMPLE_LINE = 1
const MOD_POLL_MS = 50
const QUICK_PICK_POLL_MS = 100

type Manifest = { contributes: { commands: { command: string }[] } }

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
  const record: SessionRecord = { id, root: workspaceRoot().fsPath, startedAt: now, heartbeatAt: now, lastPromptAt }
  await mkdir(sessionsDir(homedir()), { recursive: true })
  await writeFile(`${sessionsDir(homedir())}/${sessionFileName(id)}`, JSON.stringify(record))
}

/** What VS Code hands the extension when the person presses a button under a new comment on the sample line. */
async function reply(text: string): Promise<vscode.CommentReply> {
  const uri = vscode.Uri.joinPath(workspaceRoot(), SAMPLE)
  await vscode.window.showTextDocument(uri)
  const controller = vscode.comments.createCommentController('handback-test', 'Test')
  const thread = controller.createCommentThread(uri, new vscode.Range(SAMPLE_LINE, 0, SAMPLE_LINE, 0), [])
  return { thread, text }
}

/** Plays the mod for one session: takes the first review sent there, answers `outcome` and resolves its text. */
async function playMod(sessionId: string, outcome: DeliveryOutcome): Promise<string> {
  const inbox = sessionInboxDir(homedir(), sessionId)
  for (;;) {
    const names = await readdir(inbox).catch(() => [])
    const reviewId = names.map(reviewIdOf).find(id => id !== undefined)
    if (reviewId !== undefined) {
      const { text } = JSON.parse(await readFile(join(inbox, `${reviewId}.json`), 'utf8')) as { text: string }
      await writeFile(join(inbox, deliveredFileName(reviewId)), outcome)
      return text
    }
    await sleep(MOD_POLL_MS)
  }
}

async function pressEnterOnQuickPickUntil(done: Promise<unknown>): Promise<void> {
  const finished = done.then(() => true)
  for (;;) {
    await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem')
    if (await Promise.race([finished, sleep(QUICK_PICK_POLL_MS, false)])) return
  }
}
