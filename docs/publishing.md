# Publishing

The extension and the mod share a file protocol with no compatibility promises yet, so they are released together under one version: bump `extension/package.json` and `plugin/.claude-plugin/plugin.json` in the same commit, and add the release to `CHANGELOG.md`. A release that changes the protocol raises `PROTOCOL_VERSION` in `plugin/hooks/protocol.ts`: people update the two halves at different times, and the extension then tells them which one is behind.

## The repository

The links in `extension/package.json`, `plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` and the README name `github.com/rogday/handback`. Publish the repository there, or change them all to where it lives.

## Claude Code mod

The repository is its own plugin marketplace: `.claude-plugin/marketplace.json` lists the mod at `./plugin`. Once the repository is public on GitHub, people install it with the line in the README:

```
/plugin install handback --marketplace rogday/handback
```

Pushing a release to the default branch publishes it: installed copies move to it with `claude plugin update handback`. Check before pushing:

```sh
claude plugin validate .
claude plugin validate plugin
claude plugin test plugin
```

## VS Code extension

One-time setup:

1. Create a publisher at https://marketplace.visualstudio.com/manage. Its ID must match `publisher` in `extension/package.json` (now `rogday`).
2. Create an Azure DevOps personal access token with the **Marketplace: Manage** scope, for all accessible organizations.
3. `cd extension && npx vsce login <publisher>` with that token.

Each release:

```sh
cd extension
npm ci
npm run check
npm test
npm run package          # builds handback.vsix
npx vsce publish --packagePath handback.vsix
```

`npm run package` copies the root `README.md`, `LICENSE` and `CHANGELOG.md` into `extension/` first: the Marketplace page is the root README.

To reach VSCodium and other editors that use Open VSX, publish the same `.vsix` there with `npx ovsx publish handback.vsix -p <token>` after creating a namespace at https://open-vsx.org.
