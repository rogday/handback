import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commentedSpan, excerptSpan, formatReview, suggestionBlock, type ReviewedThread } from './format.ts'

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

function thread(path: string, commented: ReviewedThread['commented'], lines: string[], body: string): ReviewedThread {
  const languageId = path.endsWith('.md') ? 'markdown' : 'typescript'
  return { path, languageId, commented, excerpt: { firstLine: commented.start - 1 || 1, lines }, bodies: [body] }
}
