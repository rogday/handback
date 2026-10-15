// Hands a finished review to Copilot Chat, which runs in this window: no mod, no session to pick.

import * as vscode from 'vscode'
import type { DeliveryMode } from '../../plugin/hooks/protocol.ts'

/** VS Code's command behind the chat view. Its options are not public API: a VS Code update may change them. */
const OPEN_CHAT = 'workbench.action.chat.open'
/** Copilot registers its models under this vendor once the person is signed in. */
const COPILOT_VENDOR = 'copilot'

/** Copilot Chat ships with VS Code, so only a signed-in Copilot, which shows as its models, says it is in use. */
export async function isCopilotChatReady(): Promise<boolean> {
  const models = await Promise.resolve(vscode.lm.selectChatModels({ vendor: COPILOT_VENDOR })).catch(() => [])
  return models.length > 0
}

/**
 * Resolves once Copilot Chat took the review and rejects with VS Code's reason otherwise. Sending leaves the draft in
 * its prompt box alone (`preserveInput`, VS Code 1.131 and later; earlier ones ignore it and replace the draft).
 * Filling replaces the draft: nothing outside the chat can read it to append to. The chat keeps the mode the person
 * left it in: switching modes may ask to start a new session.
 */
export async function sendToCopilotChat(text: string, mode: DeliveryMode): Promise<void> {
  const isFill = mode === 'fill'
  await vscode.commands.executeCommand(OPEN_CHAT, { query: text, isPartialQuery: isFill, preserveInput: !isFill })
}
