import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseFromWebview } from './finishDialogMessages.ts'

test('only well-formed messages from the webview are taken', () => {
  assert.deepEqual(parseFromWebview({ type: 'submit', verdict: 'approve', summary: 'LGTM', extra: 1 }), {
    type: 'submit',
    verdict: 'approve',
    summary: 'LGTM',
  })
  assert.equal(parseFromWebview({ type: 'submit', verdict: 'merge', summary: '' }), undefined)
  assert.equal(parseFromWebview({ type: 'draft', verdict: 'comment', summary: 42 }), undefined)
  assert.equal(parseFromWebview({ type: 'run', command: 'rm' }), undefined)
  assert.equal(parseFromWebview('submit'), undefined)
})
