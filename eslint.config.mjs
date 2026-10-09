import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/', '**/node_modules/', 'plugin/.claude-plugin/types/', 'extension/test/fixture/'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Object shapes here are data (protocol records, messages), written as type aliases throughout.
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      // A callback written `x => doSomething(x)` returning void is the usual VS Code API idiom.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // Numbers in template literals read fine; the rule's default bans them.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-floating-promises': [
        'error',
        // node:test runs what test() and describe() return; nobody awaits them.
        { allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['test', 'describe'] }] },
      ],
    },
  },
  {
    // Type-aware rules over Claude Code's declarations take minutes and gigabytes; `tsc -p plugin` checks the types.
    files: ['plugin/**'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
)
