import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  commentedSpan,
  excerptSpan,
  formatReview,
  isCommentedCodeIntact,
  suggestionBlock,
  type ReviewedThread,
} from './format.ts'

test('a selection of whole lines does not take the line after it', () => {
  assert.deepEqual(commentedSpan(4, 7, 0), { start: 5, end: 7 })
  assert.deepEqual(commentedSpan(4, 4, 0), { start: 5, end: 5 })
  assert.deepEqual(commentedSpan(4, 7, 3), { start: 5, end: 8 })
})

test('the excerpt stays within the file', () => {
  assert.deepEqual(excerptSpan({ start: 1, end: 2 }, 100), { start: 1, end: 5 })
  assert.deepEqual(excerptSpan({ start: 99, end: 100 }, 100), { start: 96, end: 100 })
})

test('threads are ordered by file and line, and the commented lines are marked', () => {
  const later = thread('b.ts', { start: 2, end: 2 }, ['x', 'y', 'z'], 'Rename y.')
  const earlier = thread('a.ts', { start: 9, end: 10 }, ['p', 'q', 'r'], 'Why two lines?')
  const text = formatReview({ verdict: 'requestChanges', summary: '', threads: [later, earlier] })

  assert.ok(text.startsWith('**Code review: changes requested** (2 comments)'))
  assert.ok(text.indexOf('**a.ts** lines 9–10') < text.indexOf('**b.ts** line 2'))
  assert.ok(text.includes(' 8   p\n 9 > q\n10 > r'))
  assert.ok(text.includes('1   x\n2 > y\n3   z'))
})

test('code holding backticks gets a longer fence', () => {
  const text = formatReview({
    verdict: 'comment',
    summary: '',
    threads: [thread('README.md', { start: 1, end: 1 }, ['```sh'], 'Close this block.')],
  })
  assert.ok(text.includes('````markdown\n1 > ```sh\n````'))
})

test('Claude learns what a suggestion block means only when the review holds one', () => {
  const suggestion = thread('a.ts', { start: 2, end: 2 }, ['x', 'y', 'z'], `Simpler:\n${suggestionBlock(['y()'])}`)
  const plain = thread('a.ts', { start: 2, end: 2 }, ['x', 'y', 'z'], 'Simpler, please.')

  assert.match(formatReview({ verdict: 'comment', summary: '', threads: [suggestion] }), /`suggestion` block is/)
  assert.doesNotMatch(formatReview({ verdict: 'comment', summary: '', threads: [plain] }), /`suggestion` block is/)
})

test('the commented code counts as intact only where the file still has it, at the same lines', () => {
  const snapshot = {
    languageId: 'typescript',
    commented: { start: 2, end: 3 },
    excerpt: { firstLine: 1, lines: ['a', 'b', 'c', 'd'] },
  }

  assert.equal(isCommentedCodeIntact(snapshot, ['a', 'b', 'c', 'd']), true)
  assert.equal(isCommentedCodeIntact(snapshot, ['A', 'b', 'c', 'D']), true, 'context lines may change')
  assert.equal(isCommentedCodeIntact(snapshot, ['a', 'b', 'C', 'd']), false)
  assert.equal(isCommentedCodeIntact(snapshot, ['new', 'a', 'b', 'c', 'd']), false, 'moved down')
  assert.equal(isCommentedCodeIntact(snapshot, []), false, 'the file is gone')
})

test('Claude is told when the file on disk no longer holds the commented code', () => {
  const changed = { ...thread('a.ts', { start: 2, end: 2 }, ['x', 'y', 'z'], 'Why?'), isChangedOnDisk: true }
  const intact = thread('a.ts', { start: 2, end: 2 }, ['x', 'y', 'z'], 'Why?')

  assert.match(formatReview({ verdict: 'comment', summary: '', threads: [changed] }), /file on disk no longer/)
  assert.doesNotMatch(formatReview({ verdict: 'comment', summary: '', threads: [intact] }), /file on disk no longer/)
})

test('a comment on another version of a file names it, and each version of a file is kept together', () => {
  const working = thread('a.ts', { start: 3, end: 3 }, ['x', 'y', 'z'], 'Here.')
  const committed = { ...thread('a.ts', { start: 2, end: 2 }, ['x', 'y', 'z'], 'Before.'), revision: { ref: 'HEAD' } }
  const staged = { ...thread('a.ts', { start: 1, end: 1 }, ['x', 'y'], 'Staged.'), revision: 'index' as const }
  const text = formatReview({ verdict: 'comment', summary: '', threads: [committed, working, staged] })

  assert.ok(text.includes('**a.ts** line 2 at `HEAD`'))
  assert.ok(text.includes('**a.ts** line 1 in the index'))
  assert.ok(text.indexOf('**a.ts** line 3\n') < text.indexOf('at `HEAD`'), 'the working tree first')
})

function thread(path: string, commented: ReviewedThread['commented'], lines: string[], body: string): ReviewedThread {
  const languageId = path.endsWith('.md') ? 'markdown' : 'typescript'
  const excerpt = { firstLine: commented.start - 1 || 1, lines }
  return { path, languageId, commented, excerpt, revision: undefined, bodies: [body], isChangedOnDisk: false }
}
