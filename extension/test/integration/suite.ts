// What VS Code runs in its extension host. Importing a test file registers its tests.

import './handback.test.ts'
import { runAll } from './harness.ts'

export const run = runAll
