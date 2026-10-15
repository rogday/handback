# handback

GitHub-style code review for Claude Code and Copilot Chat: leave review comments on lines in VS Code, finish the review, and it lands in the open chat as one message.

Two halves that talk through files under `~/.claude/handback/`:

- `extension/`: the VS Code extension (TypeScript, bundled with esbuild). Comment UI, the review, its formatting into a prompt.
- `plugin/`: the Claude Code mod (a plugin with a function-hooks module). Registers its session, picks up reviews addressed to it, submits them as a prompt.
- `plugin/hooks/protocol.ts`: the file protocol between them. Both sides import it; it is the one place the shapes and paths are written.

`docs/architecture.md` describes the flow and the protocol.

## Commands

Run from the repository root; none needs permission:

- `npm run verify`: everything below but packaging. The pre-push hook in `.githooks/` runs it (`git config core.hooksPath .githooks`, which the devcontainer sets); there is no hosted CI.
- `npm run format` (`format:check` to only look), `npm run lint`, `npm run check` (type-checks both halves; the mod's needs the declarations Claude Code lays when it loads the mod), `npm test`.
- `npm run test:integration`: runs `extension/test/integration/` in a real VS Code (a pinned version, downloaded once to `~/.cache/vscode-test`), headless, with HOME pointed at a scratch folder; the tests play the mod through the file protocol. It prints only the results; VS Code's own output goes to a log in that scratch folder, named when a run fails. The pre-push hook runs it after `verify`, and prints a step's output only when the step fails.
- `npm run package`: builds `extension/handback.vsix`.
- `npm run plugin:check`: validates the marketplace and the mod and runs the mod's tests on the Claude Code pinned in `devDependencies`. The mod API is early access, so the engine it is checked against is an exact version too; `cli-wrapper.cjs` runs it because install scripts are off.

The root `package.json` is an npm workspace holding the shared tooling (TypeScript, ESLint, Prettier); `extension/` is its one workspace. TypeScript stays below 6.1 until typescript-eslint supports newer. ESLint runs without type information on `plugin/`: type-aware rules over Claude Code's declarations take minutes and gigabytes, and `tsc` covers the types.

Installing the built extension into this VS Code (`code --install-extension extension/handback.vsix --force`) is fine; it may need a window reload, which restarts the Claude Code session.

## Environment

- Node lives in `~/.local/node/bin` in the current container (no root here); a rebuilt devcontainer gets it from the Node feature.
- The libraries Electron needs for the integration tests come from the devcontainer's Dockerfile. The current container predates that: they are unpacked in `~/.local/electron-libs`, and `~/.bashrc` sets `LD_LIBRARY_PATH` and `FONTCONFIG_FILE` to them. A rebuild makes both unnecessary.
- The devcontainer sets `CLAUDE_CODE_PLUGIN_DIRS` to `plugin/`, so every Claude Code session runs the mod from the working tree and reloads it on save. The container this was first built in predates that and has the same two variables in the `env` of `~/.claude/settings.json`.
- The mod API is early access. Its types are laid by Claude Code in `plugin/.claude-plugin/types/` each time it loads the mod; the declaration file there is the authority.

## Working rules

- One feature, one commit.
- Order a list of features by risk. Implement the ones least likely to break things or slow them down first and the riskiest last, so each step can be tested end to end quickly and a regression points at one change.
- No co-authoring. Never add Co-Authored-By or other attribution lines to commits or PRs.
- Never push or publish (Marketplace, plugin marketplace) unless explicitly asked.
- Code documents itself. Prefer good naming over comments.
- Comments are short and precise: they carry the reasons behind the code. If something is obvious from the code, it needs no comment.
- Prefer flat over nested. Return early; a big if body becomes its own function.
- Do not compromise performance: never block the extension host, keep the mod's polling cheap.
- No magic constants. Name them.
- No compatibility yet. If a change needs to break the protocol, settings or commands, break them: no shims or deprecation paths. Say what broke.
- Tests must earn their place. Test behavior that could plausibly break, not wiring. Don't add production code that only tests read.
- Docs move with the code. If a change contradicts `docs/architecture.md`, the README or another doc, fix the doc in the same commit.
- Enforce invariants with types and privacy, not conventions.
