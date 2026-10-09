// Runs the integration tests in a real VS Code: `npm run test:integration`. Prints the results; VS Code's own
// output (Chromium, its agent host, API proposals) goes to a log, named when something fails.

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { SilentReporter, downloadAndUnzipVSCode } from '@vscode/test-electron'
import { REPORT_ENV } from './harness.ts'

/**
 * A fixed version, so a run means the same thing tomorrow. Not engines.vscode's 1.95: its Electron crashes on the
 * headless backend; compiling against @types/vscode 1.95 holds the extension to that API instead.
 */
const VSCODE_VERSION = '1.141.0'
/** When VS Code dies before any test ran, the end of its log says why. */
const LOG_TAIL_LINES = 30
const extensionRoot = join(import.meta.dirname, '..', '..')
// Outside the repository: the download is a few hundred megabytes and is reused across runs.
const cachePath = join(homedir(), '.cache', 'vscode-test')

const scratch = await mkdtemp(join(tmpdir(), 'handback-integration-'))
const workspace = join(scratch, 'workspace')
const home = join(scratch, 'home')
const reportPath = join(scratch, 'report.txt')
const logPath = join(scratch, 'vscode.log')
await cp(join(extensionRoot, 'test', 'fixture'), workspace, { recursive: true })
await mkdir(home)

console.log(`Integration tests in VS Code ${VSCODE_VERSION}`)
const executable = await downloadAndUnzipVSCode({ version: VSCODE_VERSION, cachePath, reporter: new SilentReporter() })
const exitCode = await runVSCode(executable)
const results = await readFile(reportPath, 'utf8').catch(() => '')
process.stdout.write(results)
if (exitCode !== 0) {
  if (results === '') process.stdout.write(await logTail())
  console.error(`VS Code exited with ${String(exitCode)}. Its output: ${logPath}`)
  process.exitCode = 1
}

async function runVSCode(executable: string): Promise<number | null> {
  // Set for processes VS Code starts (its terminals, Claude Code), it would make the VS Code under test plain Node.
  const inherited = { ...process.env }
  delete inherited.ELECTRON_RUN_AS_NODE
  const args = [
    workspace,
    `--extensionDevelopmentPath=${extensionRoot}`,
    `--extensionTestsPath=${join(extensionRoot, 'dist', 'test', 'suite.js')}`,
    `--user-data-dir=${join(scratch, 'user-data')}`,
    '--disable-extensions',
    '--disable-workspace-trust',
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-gpu',
    // Chromium's headless backend: no display or Xvfb needed.
    '--ozone-platform=headless',
    // Containers cannot give Chromium its setuid sandbox; this VS Code opens nothing but the fixture.
    '--no-sandbox',
  ]
  // The extension finds sessions and inboxes under HOME; the tests own this one.
  const env = { ...inherited, HOME: home, [REPORT_ENV]: reportPath }
  const vscode = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const log = createWriteStream(logPath)
  vscode.stdout.pipe(log)
  vscode.stderr.pipe(log)
  return new Promise(resolve => vscode.on('close', resolve))
}

async function logTail(): Promise<string> {
  const lines = (await readFile(logPath, 'utf8').catch(() => '')).split('\n')
  return lines.slice(-LOG_TAIL_LINES).join('\n')
}
