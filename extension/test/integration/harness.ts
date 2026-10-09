// A test runner small enough to need no dependency: tests run one after another in the extension host, and each
// result goes to the report file run.ts prints, away from VS Code's own output.

import { appendFile } from 'node:fs/promises'

/** Names the report file; run.ts sets it. */
export const REPORT_ENV = 'HANDBACK_TEST_REPORT'
const TEST_TIMEOUT_MS = 20_000

type Test = {
  name: string
  body: () => Promise<void>
}

const tests: Test[] = []

export function test(name: string, body: () => Promise<void>): void {
  tests.push({ name, body })
}

export async function runAll(): Promise<void> {
  const reportPath = process.env[REPORT_ENV]
  if (reportPath === undefined)
    throw new Error(`${REPORT_ENV} is not set: run the tests with npm run test:integration.`)
  const report = (line: string) => appendFile(reportPath, `${line}\n`)

  const failed: string[] = []
  for (const { name, body } of tests) {
    try {
      await withTimeout(body(), name)
      await report(`ok   ${name}`)
    } catch (error) {
      failed.push(name)
      await report(`FAIL ${name}\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    }
  }
  await report(`${tests.length - failed.length} of ${tests.length} passed`)
  if (failed.length > 0) throw new Error(`${failed.length} of ${tests.length} integration tests failed.`)
}

async function withTimeout(running: Promise<void>, name: string): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${name} took longer than ${TEST_TIMEOUT_MS} ms.`))
    }, TEST_TIMEOUT_MS)
  })
  try {
    await Promise.race([running, timeout])
  } finally {
    clearTimeout(timer)
  }
}
