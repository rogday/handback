# Architecture

Two programs that never call each other: the VS Code extension writes a finished review to a file, and the Claude Code mod in the right session picks it up and submits it as a prompt. Files work across every place the two can run together (a devcontainer, WSL, a plain desktop) without a socket, a port or a shared process.

## Protocol

`plugin/hooks/protocol.ts` holds the paths, the shapes and their parsers; both halves import it. Everything lives under `~/.claude/handback/`:

```
sessions/<session id>.json                 SessionRecord, written by the mod
inbox/<session id>/<review id>.json        ReviewDelivery, written by the extension
inbox/<session id>/<review id>.delivered   DeliveryOutcome, written by the mod once it took the review
```

- **Sessions.** Each session running the mod keeps its record fresh: a heartbeat every `HEARTBEAT_INTERVAL_MS`, the title and the time of the person's last prompt on each prompt, `endedAt` when it ends. A session whose heartbeat is older than `SESSION_STALE_AFTER_MS` is gone. After a `/clear` the process goes on under a new session id, and the next heartbeat announces it.
- **Reviews.** The extension formats the whole review into the prompt text and writes it into the chosen session's inbox. Review ids sort by creation time, so a session delivers its reviews in the order they were finished.
- **Delivery.** The mod polls its inbox every `INBOX_POLL_INTERVAL_MS` and handles each review by its `mode`, writing what it did into the `.delivered` marker:
  - `send`: marks `submitted`, then submits the text with `$.prompt.submit({ asUser: true })`. The model reads it as the person's own message; it starts a turn of its own once the session is idle. The mod does not wait for that, so a review sent while Claude works is marked at once and queued behind the turn. Marking first means a mod reload never submits a review twice.
  - `fill`: puts the text in the prompt box with `$.prompt.fill`, after any draft, and marks `filled`. A surface that draws its own prompt box refuses with `no_composer`; the mod marks `noPromptBox`, and the extension copies the review and focuses Claude Code's input for the person to paste. The extension never pastes for them: if the focus missed the chat, the paste would land in their code. Any other refusal (a dialog holds the keys) is tried again on the next poll.

  The mod cannot delete files, so the extension removes a review and its marker once it reads the outcome, and takes the review back if none shows up within `DELIVERY_TIMEOUT_MS`.

## Extension (`extension/`)

Bundled by esbuild into `dist/extension.js`; runs in the workspace's extension host (`extensionKind: workspace`), so in a devcontainer it runs inside the container, where Claude Code runs too.

- `review.ts`: the pending review. A comment controller draws GitHub-style threads on any `file:` document; each comment carries the "Pending" badge until the review is finished, and the threads are dropped once it is sent. Suggest a change opens a draft comment in edit mode holding a `suggestion` block of the selected lines; it joins the review once saved. The review is saved to the workspace state on every change and restored on activation, so it survives a window reload; a thread whose file is gone by then is sent without its excerpt.
- `format.ts`: the prompt. Pure, so Node's test runner covers it. Threads are ordered by file and line; each quotes its lines with `CONTEXT_LINES` around them, numbered, the commented ones marked `>`. The verdict picks the heading and the closing instruction to Claude.
- `delivery.ts`: the extension's side of the protocol. It offers the live sessions whose root holds every commented file, the one the person prompted last first, and deletes the records and inboxes of gone sessions.
- `finishDialog.ts`: GitHub's "Finish your review" box as a webview: summary, verdict, Submit review, Discard review. It keeps an unsent summary while closed and remembers the last verdict. The page is `webview/finishDialog.html` (bundled into the extension as text; only the nonce, the CSP source and the asset URIs are filled in), `webview/finishDialog.css`, and `webview/finishDialog.ts`, bundled for the browser into `dist/webview/` with a tsconfig of its own. The page asks for its state with a `ready` message each time it loads; every message from it is checked by `finishDialogMessages.ts` before use.
- `extension.ts`: commands, menus, the "Finish your review" status bar button, and the session picker shown when several sessions hold the files. When no session takes the review, it offers to copy the prompt to the clipboard.

## Mod (`plugin/`)

A Claude Code plugin whose `hooks/hooks.json` names one function-hooks module, `hooks/register.ts`. It hooks `session.start` (announce the session, start the heartbeat and the inbox poll), `classic.UserPromptSubmit` (title and last prompt time) and `session.end`.

The engine requires every engine call to be spelled `$.noun.method(...)` where it is made: `$` is never passed to a function or stored. So the work that needs `$` lives in closures inside the hook, and the pure parts are plain functions beside it.
