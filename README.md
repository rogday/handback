# Handback

Review Claude's work the way you review a pull request on GitHub: comment on lines in VS Code, finish the review, and it reaches the open Claude Code chat as one message with every comment, its file, its lines and the code around them.

## Install

It takes two pieces, the VS Code extension and a Claude Code mod:

1. Install **Handback** from the VS Code Marketplace.
2. In a Claude Code session in a terminal, type:

   ```
   /plugin install handback --marketplace rogday/handback
   ```

   Answer `y` to add the marketplace, then press Enter to install for your user. The mod runs in every Claude Code session from then on, the VS Code chat included.

The mod is a Claude Code function-hooks plugin, built against Claude Code 2.1.295.

## How it works

It comes in two halves:

- **The VS Code extension** draws the review: comment threads in the gutter, pending comments, the "Finish your review" dialog.
- **The Claude Code mod** runs inside each Claude Code session and hands the finished review to that session as your next message.

They talk through files under `~/.claude/handback/`; see [docs/architecture.md](docs/architecture.md).

## Reviewing

1. Hover a line and click the **+** in the gutter, or select several lines first. Write your comment and press **Start a review**, or **Add single comment** to send just that one comment right away.
2. Keep going with **Add review comment**. Each comment shows a **Pending** badge; edit or delete it from its **…** menu. A pending review survives reloading the window; **Handback: Discard pending review** drops it.
3. Press **Finish your review** in the status bar or the editor's title bar. Leave a summary if you like, pick a verdict and press **Submit review** (or Ctrl+Enter). The review arrives in Claude Code as your next message: your summary, then every comment with its file, its lines and the code around them.

The verdict tells Claude how to take the comments:

| Verdict         | Claude is asked to                                                         |
| --------------- | -------------------------------------------------------------------------- |
| Comment         | reply to each comment and change the code only where a comment asks for it |
| Approve         | treat the comments as optional suggestions                                 |
| Request changes | address every comment, or say why not                                      |

### Suggesting a change

Select lines (or put the cursor on one), right-click and choose **Suggest a change**. A comment opens on them holding a `suggestion` block with their code, as GitHub's "Add a suggestion" does: edit it into what the lines should be, add words around it if you like, and **Start a review** or **Add single comment**. Claude is told the block replaces the commented lines.

### Which Claude Code session gets it

Only sessions whose project holds the commented files are candidates. With one, the review goes straight there. With several, Submit asks which one: each is listed by its title and when you last typed in it, the most recent first, so Enter picks the chat you were just talking to. If no session takes the review, you can copy it and paste it into the chat yourself.

## Settings

| Setting             | Default |                                                                                                                                                                                                                                                                                |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `handback.delivery` | `send`  | `send` sends the review as your next message. `fill` puts it in the prompt box for you to add to and send yourself. The VS Code chat draws its own prompt box, which only a paste can fill: there the review lands on your clipboard and the Claude Code input gets the focus. |

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
