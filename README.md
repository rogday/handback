# Handback

Review an AI's work the way you review a pull request on GitHub: comment on lines in VS Code, finish the review, and it reaches the open Claude Code or Copilot Chat as one message with every comment, its file, its lines and the code around them.

## Install

Install **Handback** from the VS Code Marketplace. That is all Copilot Chat needs. Claude Code takes a second piece, a mod:

In a Claude Code session in a terminal, type:

```
/plugin install handback --marketplace rogday/handback
```

Answer `y` to add the marketplace, then press Enter to install for your user. The mod runs in every Claude Code session from then on, the VS Code chat included.

The mod is a Claude Code function-hooks plugin, built against Claude Code 2.1.295.

## How it works

For Claude Code it comes in two halves:

- **The VS Code extension** draws the review: comment threads in the gutter, pending comments, the "Finish your review" box.
- **The Claude Code mod** runs inside each Claude Code session and hands the finished review to that session as your next message.

They talk through files under `~/.claude/handback/`; see [docs/architecture.md](docs/architecture.md). Copilot Chat runs in the VS Code window itself, so the extension hands it the review directly.

## Reviewing

1. Hover a line and click the **+** in the gutter, or select several lines first. Write your comment and press **Start a review**, or **Add single comment** to send just that one comment right away.
2. Keep going with **Add review comment**. Each comment shows a **Pending** badge; edit or delete it from its **…** menu. A pending review survives reloading the window; **Handback: Discard pending review** drops it.
3. Press **Finish your review** in the status bar or the editor's title bar. A box opens at the top of the window, like the command palette: type a one-line summary if you like, pick a verdict and press Enter. The verdict you used last comes first, and **Discard pending review** sits at the bottom. The review arrives in Claude Code as your next message: your summary, then every comment in the order you wrote them, with its file, its lines and the code around them.

The verdict tells Claude how to take the comments:

| Verdict         | Claude is asked to                                                         |
| --------------- | -------------------------------------------------------------------------- |
| Comment         | reply to each comment and change the code only where a comment asks for it |
| Approve         | treat the comments as optional suggestions                                 |
| Request changes | address every comment, or say why not                                      |

Each comment quotes the code as it was when you wrote it. If the file on disk no longer reads that way when you send the review, because you haven't saved or the code changed since, the review tells Claude so.

You can comment on other versions of a file too: a commit opened from the Source Control Graph or the Timeline, either side of a diff, the staged version. Claude is told which version a comment is on (`HEAD`, a commit, the index) and gets its code as you saw it.

### Suggesting a change

Select lines (or put the cursor on one), right-click and choose **Suggest a change**. A comment opens on them holding a `suggestion` block with their code, as GitHub's "Add a suggestion" does: edit it into what the lines should be, add words around it if you like, and **Start a review** or **Add single comment**. Claude is told the block replaces the commented lines.

### Which chat gets it

The candidates are the Claude Code sessions running the mod whose project holds the commented files, and Copilot Chat once you are signed in to Copilot. With one, the review goes straight there. With several, Submit asks which one: Claude Code sessions are listed by when they started and when you last messaged them (and by their title, if you renamed them), the most recent first; Claude Code and Copilot Chat come in the order you last sent to them, so Enter picks the chat you were just talking to. If no chat takes the review, you can copy it and paste it into the chat yourself.

Copilot Chat takes the review in whatever mode you left it in: switch it to Agent for Copilot to change the code.

## Settings

| Setting             | Default |                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handback.delivery` | `send`  | `send` sends the review as your next message. `fill` puts it in the prompt box for you to add to and send yourself. Claude Code's VS Code chat draws its own prompt box, which only a paste can fill: there the review lands on your clipboard and the Claude Code input gets the focus. In Copilot Chat both replace whatever you had typed in its prompt box. |

## Development

Open the repository in its devcontainer. Then, from the root:

```sh
npm ci
git config core.hooksPath .githooks   # the devcontainer does this for you
npm run verify             # format check, lint, type-check, unit tests, the mod's checks
npm run test:integration   # the extension in a real, headless VS Code
npm run package  # builds extension/handback.vsix
```

The devcontainer points `CLAUDE_CODE_PLUGIN_DIRS` at `plugin/`, so Claude Code sessions in it run the mod from the working tree. `npm run verify` checks the mod too, on the pinned Claude Code. Releasing is in [docs/publishing.md](docs/publishing.md).

## License

[MIT](LICENSE)
