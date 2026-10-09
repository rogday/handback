// Runs the integration tests in a real VS Code: `npm run test:integration`.

import { cp, mkdir, mkdtemp } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTests } from '@vscode/test-electron'

/**
 * A fixed version, so a run means the same thing tomorrow. Not engines.vscode's 1.95: its Electron crashes on the
 * headless backend; compiling against @types/vscode 1.95 holds the extension to that API instead.
 */
const VSCODE_VERSION = '1.141.0'
const extensionRoot = join(import.meta.dirname, '..', '..')
// Outside the repository: the download is a few hundred megabytes and is reused across runs.
const cachePath = join(homedir(), '.cache', 'vscode-test')

// Set for processes VS Code starts (its terminals, Claude Code), it would make the VS Code under test plain Node.
delete process.env.ELECTRON_RUN_AS_NODE

const scratch = await mkdtemp(join(tmpdir(), 'handback-integration-'))
const workspace = join(scratch, 'workspace')
const home = join(scratch, 'home')
await cp(join(extensionRoot, 'test', 'fixture'), workspace, { recursive: true })
await mkdir(home)

await runTests({
  version: VSCODE_VERSION,
  cachePath,
  extensionDevelopmentPath: extensionRoot,
  extensionTestsPath: join(extensionRoot, 'dist', 'test', 'suite.js'),
  launchArgs: [
    workspace,
    '--disable-extensions',
    '--disable-workspace-trust',
    '--disable-gpu',
    // Chromium's headless backend: no display or Xvfb needed.
    '--ozone-platform=headless',
    // Containers cannot give Chromium its setuid sandbox; this VS Code opens nothing but the fixture.
    '--no-sandbox',
    `--user-data-dir=${join(scratch, 'user-data')}`,
  ],
  // The extension finds sessions and inboxes under HOME; the tests own this one.
  extensionTestsEnv: { HOME: home },
})
