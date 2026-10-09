import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'
import { parseFromWebview, type FinishChoice, type FromWebview, type ToWebview } from './finishDialogMessages.ts'
import { isVerdict } from './format.ts'
import template from './webview/finishDialog.html'

const VIEW_TYPE = 'handback.finishReview'
const VERDICT_KEY = 'handback.verdict'
const NONCE_BYTES = 16
/** Where esbuild writes the page's script and stylesheet, relative to the extension. */
const WEBVIEW_DIR = ['dist', 'webview']

export type FinishHandlers = {
  /** True once the review left the editor; the dialog then closes. */
  submit: (choice: FinishChoice) => Promise<boolean>
  /** True once the pending review was discarded. */
  discard: () => Promise<boolean>
}

type TemplateValues = Record<'cspSource' | 'nonce' | 'styleUri' | 'scriptUri', string>

/** GitHub's "Finish your review" box: a summary, a verdict and Submit review. */
export class FinishReviewDialog implements vscode.Disposable {
  readonly #webviewRoot: vscode.Uri
  readonly #memento: vscode.Memento
  readonly #handlers: FinishHandlers
  #panel: vscode.WebviewPanel | undefined
  #pendingCount = 0
  // Kept while the dialog is closed, as GitHub keeps an unsent review summary.
  #draft: FinishChoice

  constructor(extensionUri: vscode.Uri, memento: vscode.Memento, handlers: FinishHandlers) {
    this.#webviewRoot = vscode.Uri.joinPath(extensionUri, ...WEBVIEW_DIR)
    this.#memento = memento
    this.#handlers = handlers
    const lastVerdict = memento.get<unknown>(VERDICT_KEY)
    this.#draft = { verdict: isVerdict(lastVerdict) ? lastVerdict : 'comment', summary: '' }
  }

  show(pendingCount: number): void {
    this.#pendingCount = pendingCount
    if (this.#panel !== undefined) {
      this.#panel.reveal()
      this.showPendingCount(pendingCount)
      return
    }
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Finish your review',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, localResourceRoots: [this.#webviewRoot] },
    )
    panel.webview.html = this.#page(panel.webview)
    panel.webview.onDidReceiveMessage((message: unknown) => this.#receive(parseFromWebview(message)))
    panel.onDidDispose(() => {
      this.#panel = undefined
    })
    this.#panel = panel
  }

  showPendingCount(count: number): void {
    this.#pendingCount = count
    this.#post({ type: 'pending', count })
  }

  dispose(): void {
    this.#panel?.dispose()
  }

  #page(webview: vscode.Webview): string {
    const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.#webviewRoot, name)).toString()
    return fillTemplate({
      cspSource: webview.cspSource,
      nonce: randomBytes(NONCE_BYTES).toString('base64'),
      styleUri: asset('finishDialog.css'),
      scriptUri: asset('finishDialog.js'),
    })
  }

  async #receive(message: FromWebview | undefined): Promise<void> {
    switch (message?.type) {
      case undefined:
        return
      // The page loads afresh whenever its tab comes back into view.
      case 'ready':
        this.#post({ type: 'init', ...this.#draft, pendingCount: this.#pendingCount })
        return
      case 'draft':
        this.#draft = { verdict: message.verdict, summary: message.summary }
        return
      case 'discard':
        if (await this.#handlers.discard()) this.#panel?.dispose()
        return
      case 'submit':
        await this.#submit({ verdict: message.verdict, summary: message.summary })
        return
    }
  }

  async #submit(choice: FinishChoice): Promise<void> {
    void this.#memento.update(VERDICT_KEY, choice.verdict)
    const isSent = await this.#handlers.submit(choice).catch(() => false)
    if (!isSent) {
      this.#post({ type: 'idle' })
      return
    }
    this.#draft = { verdict: choice.verdict, summary: '' }
    this.#panel?.dispose()
  }

  #post(message: ToWebview): void {
    void this.#panel?.webview.postMessage(message)
  }
}

function fillTemplate(values: TemplateValues): string {
  return Object.entries(values).reduce((page, [name, value]) => page.replaceAll(`{{${name}}}`, value), template)
}
