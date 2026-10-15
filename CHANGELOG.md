# Changelog

## 0.2.0

- Copilot Chat takes reviews too, with no mod: once Copilot is signed in, Submit offers it beside the Claude Code sessions, the chat you sent to last first.
- `handback.agent` sends to Claude Code or Copilot Chat only, without asking.

## 0.1.0

First release.

- GitHub-style review comments on any line or lines: Start a review, Add review comment, Add single comment, edit and delete, a Pending badge.
- Finish your review: a summary and a verdict (Comment, Approve, Request changes).
- Suggest a change: GitHub's `suggestion` blocks.
- The review reaches the open Claude Code chat through the Handback mod, as your next message or into the prompt box (`handback.delivery`).
- With several Claude Code sessions open, Submit asks which one gets the review.
- A pending review survives window reloads.
