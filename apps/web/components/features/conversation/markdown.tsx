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
// Tables were reported broken by the user and the cause was here: pipe tables
// are GitHub-Flavoured Markdown, which `react-markdown` does NOT parse on its
// own — it needs `remark-gfm`. Without the plugin the `table`/`th`/`td` entries
// below could never fire, so every table this model produces (and it produces
// them constantly — a plain "how do TCP and UDP differ?" comes back as one)
// rendered as raw lines of pipes and dashes. The plugin also restores
// strikethrough, task lists and bare-URL autolinking.
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
    <div className="my-3 max-w-full overflow-x-auto rounded-xl border border-border-subtle">
      <table className="w-full border-collapse text-left text-[0.9em]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-bg-raised">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-border-subtle last:border-b-0">{children}</tr>,
  th: ({ children }) => (
    <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-fg">{children}</th>
  ),
  td: ({ children }) => <td className="px-3 py-2 align-top">{children}</td>,
  del: ({ children }) => <del className="text-muted line-through">{children}</del>,
}

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
      {text}
    </ReactMarkdown>
  )
}
