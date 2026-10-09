# Security

## Reporting a vulnerability

Report it privately through GitHub's "Report a vulnerability" on this repository's Security tab, not in a public issue.

## Trust model

- **Nothing leaves the machine.** Neither the extension nor the mod makes network requests. A review goes from the extension to Claude Code through files under `~/.claude/handback/`, and from there to Claude like any message you type.
- **The inbox speaks as you.** The mod submits whatever review lands in its session's inbox as your own message. Anything that can write to `~/.claude/handback/` can therefore prompt Claude in your name. That is the same trust Claude Code already places in `~/.claude`, where settings and hooks run commands as you: only processes running as you can write there. The extension creates the inbox owner-only (`0700`, files `0600`), since reviews quote your code.
- **Paths come from checked values.** A session id read from a session record must be a plain path segment before it names an inbox, so a crafted record cannot steer a write elsewhere.
- **The webview is locked down.** The "Finish your review" page runs under a Content Security Policy that allows only its own stylesheet and its one script, by nonce, and loads resources only from the extension's `dist/webview/`. Every message it sends is checked before the extension acts on it. Comments render as Markdown without HTML or command links.
- **Dependencies are pinned.** Every npm dependency is an exact version, locked in `package-lock.json` and installed with `npm ci`, with install scripts off (`.npmrc`). The devcontainer image is pinned by digest, its feature by version, and the integration tests' VS Code by version. Dependabot proposes updates to all of them.
