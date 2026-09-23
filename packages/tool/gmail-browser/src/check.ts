// The two runnable checks: refuseUrl is what keeps the agent inside Gmail,
// and trimSnapshot is what keeps a page from filling the context window.
// Run with `pnpm --dir packages/tool/gmail-browser run check` after a build.
import assert from 'node:assert/strict'
import { parseRows, resolveUrl, safeFileName, trimSnapshot } from './index.ts'

const url = (input: string): string => {
  const result = resolveUrl(input)
  return 'url' in result ? result.url : result.refusal
}
assert.equal(url('https://mail.google.com/mail/u/0/#inbox'), 'https://mail.google.com/mail/u/0/#inbox')
assert.equal(url('https://accounts.google.com/signin'), 'https://accounts.google.com/signin')
// Short forms the model actually writes resolve against Gmail itself.
assert.equal(url('#inbox'), 'https://mail.google.com/mail/u/0/#inbox')
assert.equal(url('/mail/u/0/#sent'), 'https://mail.google.com/mail/u/0/#sent')
assert.match(url('https://evil.com/?u=mail.google.com'), /only Gmail/)
assert.match(url('https://mail.google.com.evil.com/'), /only Gmail/)
assert.match(url('http://mail.google.com.'), /only Gmail/)
assert.match(url('file:///etc/passwd'), /only Gmail/)
assert.match(url('mail.google.com'), /not a URL/)

const snapshot = [
  '### Page',
  '- Page URL: https://mail.google.com/mail/u/0/#inbox',
  '```yaml',
  '- generic [ref=e1]:',
  '  - row "Google, Security alert, 04:00" [ref=e10]:',
  '    - checkbox "Google, Security alert, 04:00" [ref=e11]',
  '    - link "Security alert" [ref=e12] [cursor=pointer]:',
  '      - /url: https://mail.google.com/mail/u/0/?very&long&redirect',
  '    - gridcell "04:00" [ref=e13]',
  '  - button "Compose" [ref=e20] [cursor=pointer]',
].join('\n')
const trimmed = trimSnapshot(snapshot)

// Frame-prefixed refs are what a page with an iframe (Gmail) really produces.
// Frame-prefixed refs, and the star button carried out of each row.
assert.deepEqual(
  parseRows([
    '  - row "Google, Security alert, 04:00" [ref=f8e1778]:',
    '    - gridcell [ref=f8e1779]:',
    '      - checkbox [ref=f8e1780]',
    '    - button "Không được gắn dấu sao" [ref=f8e1781]',
    '  - row "LinkedIn, Weekly" [ref=e12]:',
  ].join('\n')),
  [
    { ref: 'f8e1778', name: 'Google, Security alert, 04:00', star: 'f8e1781' },
    { ref: 'e12', name: 'LinkedIn, Weekly' },
  ],
)

// Kept: the page header, and every element the model can act on, with its ref.
assert.match(trimmed, /Page URL/)
assert.match(trimmed, /- button "Compose" \[ref=e20\]/)
assert.match(trimmed, /- checkbox \[ref=e11\]/) // ref kept, duplicated name dropped
assert.match(trimmed, /- row "Google, Security alert, 04:00"/)
// Dropped: noise annotations, link targets, refs on things nothing can click,
// and a container that only repeats its parent.
assert.ok(!trimmed.includes('cursor=pointer'))
assert.ok(!trimmed.includes('/url:'))
assert.ok(!trimmed.includes('ref=e1]'))
assert.ok(!/gridcell "04:00"/.test(trimmed), 'a cell repeating its row says nothing')
assert.ok(trimmed.length < snapshot.length)
// A downloaded file is named by the site that sent it, so the name is only
// ever a name: nothing here may reach outside the session workspace.
assert.equal(safeFileName('hop-dong.pdf'), 'hop-dong.pdf')
assert.equal(safeFileName('Hợp đồng 2026.pdf'), 'Hợp_đồng_2026.pdf')
assert.equal(safeFileName('../../etc/passwd'), 'passwd')
assert.equal(safeFileName('/etc/shadow'), 'shadow')
assert.equal(safeFileName('..'), 'download')
assert.equal(safeFileName(''), 'download')
assert.ok(!safeFileName('a/../../b.pdf').includes('/'))
assert.ok(safeFileName('x'.repeat(400) + '.pdf').length <= 120)

console.log('ok')
