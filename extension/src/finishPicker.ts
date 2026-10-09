import * as vscode from 'vscode'
import type { Verdict } from './format.ts'

const VERDICT_KEY = 'handback.verdict'

export type FinishChoice = {
  verdict: Verdict
  summary: string
}

export type FinishHandlers = {
  /** True once the review left the editor. */
  submit: (choice: FinishChoice) => Promise<boolean>
  /** True once the pending review was discarded. */
  discard: () => Promise<boolean>
}

type FinishItem = vscode.QuickPickItem & { action: Verdict | 'discard' }

// Shown whatever the summary typed above them says: the input is the summary, not a filter.
const VERDICT_ITEMS: readonly FinishItem[] = [
  {
    action: 'comment',
    label: '$(comment) Comment',
    detail: 'Submit general feedback without explicit approval.',
    alwaysShow: true,
  },
  {
    action: 'approve',
    label: '$(check) Approve',
    detail: 'Give your approval to these changes.',
    alwaysShow: true,
  },
  {
    action: 'requestChanges',
    label: '$(request-changes) Request changes',
    detail: 'Submit feedback that must be addressed.',
    alwaysShow: true,
  },
]

const DISCARD_ITEM: FinishItem = { action: 'discard', label: '$(trash) Discard pending review', alwaysShow: true }

/**
 * GitHub's "Finish your review" box, as VS Code's quick input at the top of the window: the summary is typed into
 * it and a verdict picked below it.
 */
export class FinishReviewPicker {
  readonly #memento: vscode.Memento
  readonly #handlers: FinishHandlers
  // Kept while the box is closed, as GitHub keeps an unsent review summary.
  #draft = ''

  constructor(memento: vscode.Memento, handlers: FinishHandlers) {
    this.#memento = memento
    this.#handlers = handlers
  }

  show(pendingCount: number): void {
    const picker = vscode.window.createQuickPick<FinishItem>()
    picker.title = `Finish your review · ${pendingTitle(pendingCount)}`
    picker.placeholder = 'Leave a summary (optional), then pick a verdict'
    picker.value = this.#draft
    picker.items = this.#items(pendingCount)
    picker.onDidChangeValue(value => {
      this.#draft = value
    })
    picker.onDidAccept(() => {
      const [item] = picker.selectedItems
      if (item === undefined) return
      const summary = picker.value
      // Closed first: choosing a session opens a quick input of its own, and only one shows at a time.
      picker.hide()
      void this.#act(item.action, summary)
    })
    picker.onDidHide(() => {
      picker.dispose()
    })
    picker.show()
  }

  /** The last verdict used comes first, so typing a summary and pressing Enter repeats it. */
  #items(pendingCount: number): FinishItem[] {
    const lastVerdict = this.#memento.get<unknown>(VERDICT_KEY)
    const isLast = (item: FinishItem) => item.action === lastVerdict
    const verdicts = [...VERDICT_ITEMS.filter(isLast), ...VERDICT_ITEMS.filter(item => !isLast(item))]
    if (pendingCount === 0) return verdicts
    const separator: FinishItem = { action: 'discard', label: '', kind: vscode.QuickPickItemKind.Separator }
    return [...verdicts, separator, DISCARD_ITEM]
  }

  async #act(action: FinishItem['action'], summary: string): Promise<void> {
    if (action === 'discard') {
      if (await this.#handlers.discard()) this.#draft = ''
      return
    }
    void this.#memento.update(VERDICT_KEY, action)
    if (await this.#handlers.submit({ verdict: action, summary })) this.#draft = ''
  }
}

function pendingTitle(count: number): string {
  if (count === 0) return 'no pending comments'
  return `${count} pending ${count === 1 ? 'comment' : 'comments'}`
}
