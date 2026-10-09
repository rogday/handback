// A test runner small enough to need no dependency: tests run one after another in the extension host.

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
  const failed: string[] = []
  for (const { name, body } of tests) {
    try {
      await withTimeout(body(), name)
      console.log(`ok   ${name}`)
    } catch (error) {
      failed.push(name)
      console.error(`FAIL ${name}\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    }
  }
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
