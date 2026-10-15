# Architecture

Two programs that never call each other: the VS Code extension writes a finished review to a file, and the Claude Code mod in the right session picks it up and submits it as a prompt. Files work across every place the two can run together (a devcontainer, WSL, a plain desktop) without a socket, a port or a shared process.

Copilot Chat needs no mod and no protocol: it runs in the same window, and the extension hands it the review through a VS Code command.

## Protocol

`plugin/hooks/protocol.ts` holds the paths, the shapes and their parsers; both halves import it. Everything lives under `~/.claude/handback/`, the home folder found the way Node finds it (`USERPROFILE` on Windows, `HOME` elsewhere) on both sides:

```
sessions/<session id>.json                 SessionRecord, written by the mod
inbox/<session id>/<review id>.json        ReviewDelivery, written by the extension
inbox/<session id>/<review id>.delivered   DeliveryOutcome, written by the mod once it took the review
```

- **Versions.** `PROTOCOL_VERSION` rises with any change to these paths or shapes. The extension updates itself from the Marketplace while the mod updates only with `claude plugin update`, so each session record carries the version its mod speaks (a record without one reads as 0). The extension sends only to sessions on its own version, and when every candidate speaks another one it names the side to update instead.
- **Sessions.** Each session running the mod keeps its record fresh: a heartbeat every `HEARTBEAT_INTERVAL_MS`, the title and the time of the person's last prompt on each prompt, `endedAt` when it ends. A session whose heartbeat is older than `SESSION_STALE_AFTER_MS` is gone. After a `/clear` the process goes on under a new session id, and the next heartbeat announces it.
- **Reviews.** The extension formats the whole review into the prompt text and writes it into the chosen session's inbox. Review ids sort by creation time, so a session delivers its reviews in the order they were finished.
- **Delivery.** The mod polls its inbox every `INBOX_POLL_INTERVAL_MS` and handles each review by its `mode`, writing what it did into the `.delivered` marker:
  - `send`: marks `submitted`, then submits the text with `$.prompt.submit({ asUser: true })`. The model reads it as the person's own message; it starts a turn of its own once the session is idle. The mod does not wait for that, so a review sent while Claude works is marked at once and queued behind the turn. Marking first means a mod reload never submits a review twice.
  - `fill`: puts the text in the prompt box with `$.prompt.fill`, after any draft, and marks `filled`. A surface that draws its own prompt box refuses with `no_composer`; the mod marks `noPromptBox`, and the extension copies the review and focuses Claude Code's input for the person to paste. The extension never pastes for them: if the focus missed the chat, the paste would land in their code. Any other refusal (a dialog holds the keys) is tried again on the next poll.

  The mod cannot delete files, so the extension removes a review and its marker once it reads the outcome, and takes the review back if none shows up within `DELIVERY_TIMEOUT_MS`.

## Extension (`extension/`)

Bundled by esbuild into `dist/extension.js`; runs in the workspace's extension host (`extensionKind: workspace`), so in a devcontainer it runs inside the container, where Claude Code runs too.

- `review.ts`: the pending review. A comment controller draws GitHub-style threads on any `file:` document, and on the `git:` documents VS Code's git extension opens for a file's other versions (a commit from the Source Control Graph or the Timeline, the left side of a diff); each comment carries the "Pending" badge until the review is finished, and the threads are dropped once it is sent. Suggest a change opens a draft comment in edit mode holding a `suggestion` block of the selected lines; it joins the review once saved. The review is saved to the workspace state on every change and restored on activation, so it survives a window reload; a thread whose file is gone by then is sent without its excerpt.
- `format.ts`: the prompt. Pure, so Node's test runner covers it. Threads keep the order they joined the review in, since a comment may refer to an earlier one ("do the one above first"); each quotes its lines with `CONTEXT_LINES` around them, numbered, the commented ones marked `>`. The verdict picks the heading and the closing instruction to Claude.
- `delivery.ts`: the extension's side of the protocol. It offers the live sessions whose root holds every commented file, the one the person prompted last first, and deletes the records and inboxes of gone sessions.
- `finishPicker.ts`: GitHub's "Finish your review" box, as VS Code's quick input at the top of the window: the input is the summary (every item stays shown whatever is typed), the items are the verdicts, last used first, and Discard pending review. Closing the box keeps the summary typed so far. It hides before it acts, since choosing a session opens a quick input of its own.
- `threads.ts`: VS Code's comment threads and selections turned into what `format.ts` quotes. A thread's code is captured when its first comment is written (the commented lines and their context, as the editor shows them) and that copy is what the review quotes, so later edits cannot shift what a comment points at. When the review is sent, each file is read once from disk, which is what Claude reads, and a comment whose lines no longer stand there is flagged; that covers unsaved edits and changes since the comment alike. VS Code does not move a comment thread when the text above it changes, and nothing here tracks edits either: the flag tells Claude to look. A comment on a `git:` document is on the file its URI names, at the revision it names: the review names that revision (the git extension's `''` and `~` both read the index) and does not compare it with the disk.
- `send.ts`: the way out. Gathers the targets, the live Claude Code sessions holding the files and Copilot Chat when it is ready, and asks only when there are several: Claude Code sessions by their last message, the two agents in the order the person last sent to them (kept in the global state). It delivers through `delivery.ts` or `copilotChat.ts` and reports the outcome; when nothing takes the review it offers to copy the prompt to the clipboard. One review is on its way at a time, so pressing Finish twice cannot send it twice; the guard is released before any notification waits on the person.
- `copilotChat.ts`: Copilot Chat's side. Copilot Chat ships with VS Code, so it counts as ready only once a signed-in Copilot has registered its language models. The review goes in through `workbench.action.chat.open` (`isPartialQuery` for `fill`), VS Code's own command, whose options are not public API. Both modes replace the chat's draft, which nothing outside the chat can read; the chat's mode is left alone, since switching it may ask to start a new session.
- `extension.ts`: activation, the commands and menus, the "Finish your review" status bar button.

## Mod (`plugin/`)

A Claude Code plugin whose `hooks/hooks.json` names one function-hooks module, `hooks/register.ts`. It hooks `session.start` (announce the session, start the heartbeat and the inbox poll), `classic.UserPromptSubmit` (title and last prompt time) and `session.end`.

The engine requires every engine call to be spelled `$.noun.method(...)` where it is made: `$` is never passed to a function or stored. So the work that needs `$` lives in closures inside the hook, and the pure parts are plain functions beside it.
