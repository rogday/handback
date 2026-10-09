// The script of the "Finish your review" page, bundled for the webview.

import type { FinishChoice, FromWebview, ToWebview } from '../finishDialogMessages.ts'
import { isVerdict, type Verdict } from '../format.ts'

declare function acquireVsCodeApi(): { postMessage: (message: FromWebview) => void }

const vscode = acquireVsCodeApi()
const form = element('review', HTMLFormElement)
const summary = element('summary', HTMLTextAreaElement)
const pending = element('pending', HTMLSpanElement)
const discard = element('discard', HTMLButtonElement)
const submit = element('submit', HTMLButtonElement)

let pendingCount = 0
let isBusy = false

function element<T extends HTMLElement>(id: string, type: abstract new () => T): T {
  const found = document.getElementById(id)
  if (!(found instanceof type)) throw new Error(`The page has no #${id}.`)
  return found
}

function verdictInput(verdict: Verdict): HTMLInputElement {
  const input = form.querySelector(`input[name=verdict][value=${verdict}]`)
  if (!(input instanceof HTMLInputElement)) throw new Error(`The page has no ${verdict} verdict.`)
  return input
}

function choice(): FinishChoice {
  const checked = form.querySelector<HTMLInputElement>('input[name=verdict]:checked')?.value
  return { verdict: isVerdict(checked) ? checked : 'comment', summary: summary.value }
}

function render(): void {
  const plural = pendingCount === 1 ? '' : 's'
  pending.textContent = pendingCount === 0 ? 'No pending comments' : `${pendingCount} pending comment${plural}`
  discard.hidden = pendingCount === 0
  const { verdict, summary: text } = choice()
  // An approval alone says something; an empty comment does not.
  const isEmpty = pendingCount === 0 && text.trim() === ''
  submit.disabled = isBusy || (isEmpty && verdict !== 'approve')
}

function saveDraft(): void {
  vscode.postMessage({ type: 'draft', ...choice() })
  render()
}

function receive(message: ToWebview): void {
  if (message.type === 'init') {
    summary.value = message.summary
    verdictInput(message.verdict).checked = true
    pendingCount = message.pendingCount
    summary.focus()
  }
  if (message.type === 'pending') pendingCount = message.count
  if (message.type === 'idle') isBusy = false
  render()
}

summary.addEventListener('input', saveDraft)
form.addEventListener('change', saveDraft)
form.addEventListener('submit', event => {
  event.preventDefault()
  if (submit.disabled) return
  isBusy = true
  render()
  vscode.postMessage({ type: 'submit', ...choice() })
})
document.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) form.requestSubmit()
})
discard.addEventListener('click', () => {
  vscode.postMessage({ type: 'discard' })
})
window.addEventListener('message', ({ data }: MessageEvent<ToWebview>) => {
  receive(data)
})

vscode.postMessage({ type: 'ready' })
