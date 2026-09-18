'use client'

// Real gap fixed (user: "cũng như markdown" — assistant markdown rendered
// with zero styling, browser-default headings/lists/code with no theme
// awareness). Deliberately kept `react-markdown` (Phase J's plan already
// noted this as a chosen difference from example-2's own plain-text
// `linkify()`-only approach — the model can produce real tables/code
// blocks, worth rendering properly) — this file is what was actually
// missing: a `components` map putting every element on our own design
// tokens instead of raw Tailwind/browser defaults, so it reads as part of
// the same UI instead of an unstyled dump.
//
// Đợt 21 — `remark-gfm` added (user: "chưa tạo ra link ... dẫn đến
// workflow"): plain `react-markdown` only speaks CommonMark, which has no
// bare-URL autolinking at all — confirmed for real, a live n8n_upsert_
// workflow test had the model reply with a literal
// "http://127.0.0.1:5678/workflow/<id>" (n8n-skill's own new rule asks for
// this), and it rendered as inert plain text, not a clickable `<a>`. GFM's
// "autolink literals" extension is what turns a bare URL into a real link,
// and it needs this plugin explicitly — `remarkPlugins` was empty before.
// Bonus: this table also fixes GFM tables (`table`/`th`/`td` below were
// already styled in COMPONENTS but silently never rendered as tables
// without this — same missing plugin).
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ComponentProps } from 'react'

const COMPONENTS: ComponentProps<typeof ReactMarkdown>['components'] = {
  p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mb-2 mt-4 text-[1.3em] font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-4 text-[1.15em] font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-[1.05em] font-semibold first:mt-0">{children}</h3>,
  ul: ({ children }) => <ul className="my-2 list-disc pl-5 marker:text-muted">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal pl-5 marker:text-muted">{children}</ol>,
  li: ({ children }) => <li className="my-0.5 leading-relaxed">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent-text underline decoration-current/40 underline-offset-2 hover:decoration-current"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-accent pl-3 text-muted">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
  code: ({ className, children }) => {
    // react-markdown v9 gives a fenced block's <code> a `language-*`
    // className (from the ```lang fence) and leaves an inline `` `code` ``
    // span with none — the one reliable way to tell them apart here.
    const isBlock = className?.includes('language-') === true
    if (!isBlock) {
      return <code className="rounded bg-bg-raised px-[0.35em] py-[0.1em] font-mono text-[0.9em]">{children}</code>
    }
    return <code className={`font-mono text-[0.85em] ${className ?? ''}`}>{children}</code>
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-xl border border-border-subtle bg-bg-raised p-3">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="border-collapse text-[0.9em]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
}

export function Markdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>{text}</ReactMarkdown>
}
