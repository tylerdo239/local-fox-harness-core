// Cloned and adapted from example-2's packages/tool/create-skill. The
// original's own README explains WHY it only validates and never saves:
// "The worker never knows who the user is" — a real multi-tenant constraint
// (many users share worker containers there), so the actual write happens
// in apps/web after the browser sees a successful tool/result, as the
// signed-in user, against their own backend.
//
// That constraint does not exist here: this app is single-admin, one
// process, and the tool's own `ctx` already has full filesystem access —
// there is no "which user" ambiguity to defer to a browser for. So this
// version does the ENTIRE job itself: validates, then writes
// `$DSH_HOME/skills/<name>/SKILL.md` directly. That exact path is
// `dsh-skill-filesystem`'s own real "user-dsh" root (confirmed by reading
// its compiled source: `join(this.dshHome, "skills")`, source tag
// `"user-dsh"`) — no invented storage, no new backend route, no frontend
// involvement required at all. `dsh-skill-filesystem`'s own file watcher
// (Config.watch, on by default) picks up the new file without a restart.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

export const name = 'cordis-tool-create-skill'
export const inject = ['tools', 'skills']

// Limits mirror dsh-skill-filesystem's own real constraints where they
// exist (name must be kebab-case per its frontmatter parser) — the rest
// (description/content length, skill count) are this tool's own sensible
// caps, same numbers example-2 chose, kept for consistency.
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
const MAX_DESCRIPTION_CHARS = 280
const MAX_CONTENT_BYTES = 64 * 1024
const MAX_USER_SKILLS = 50

function frontmatter(name: string, description: string): string {
  // Minimal valid frontmatter per dsh-skill-filesystem's real parser
  // (confirmed via its compiled source): requires exactly `name` +
  // `description`; YAML string values are wrapped in double quotes with
  // internal quotes escaped, since either field could contain a colon or
  // other YAML-significant character.
  const escape = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `---\nname: "${escape(name)}"\ndescription: "${escape(description)}"\n---\n\n`
}

export function apply(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'create_skill',
      description: [
        'Save a new skill so it can be reused in later conversations.',
        'Two steps. First turn: show the full skill (name, description, content) and stop —',
        'never call this in the same turn the user asked for it, even if they said "just create it",',
        'because they have not seen the content yet. Later turn: once the user approves, call this',
        'immediately with exactly what they approved, without asking again.',
        'Usable from the next message as /<name>.',
      ].join(' '),
      parameters: {
        name: {
          type: 'string',
          required: true,
          description: 'kebab-case slug, no spaces or accents, e.g. "weekly-report"',
        },
        description: {
          type: 'string',
          required: true,
          description: 'One sentence stating WHEN to use this skill, not what it is. At most 280 characters.',
        },
        content: {
          type: 'string',
          required: true,
          description: 'The skill body in Markdown. Self-contained: it cannot reference other files.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { name: { type: 'string', required: true } },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: `Skill "${value.name}" saved. It can be used from the next message as /${value.name}.`,
          },
        ],
      },
      async execute(args, exec) {
        const skillName = args.name.trim()
        if (!NAME_RE.test(skillName)) {
          throw new Error(`invalid name "${skillName}": use kebab-case, e.g. "weekly-report"`)
        }
        const description = args.description.trim()
        if (description === '' || description.length > MAX_DESCRIPTION_CHARS) {
          throw new Error(`description is required and at most ${String(MAX_DESCRIPTION_CHARS)} characters`)
        }
        const content = args.content.trim()
        if (content === '' || Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
          throw new Error(`content is required and at most ${String(MAX_CONTENT_BYTES)} bytes`)
        }
        const skills = await ctx.skills.list({
          cwd: exec.agent?.session.header.cwd,
          signal: exec.signal,
          scope: exec.agent,
        })
        if (skills.some(skill => skill.name === skillName)) {
          throw new Error(`a skill named "${skillName}" already exists — ask for a different name`)
        }
        if (skills.filter(skill => skill.source === 'user-dsh').length >= MAX_USER_SKILLS) {
          throw new Error(`already at the ${String(MAX_USER_SKILLS)}-skill limit — delete one first (Settings > Skills)`)
        }
        const skillDir = join(resolveDshHome(), 'skills', skillName)
        await mkdir(skillDir, { recursive: true })
        await writeFile(join(skillDir, 'SKILL.md'), frontmatter(skillName, description) + content + '\n', 'utf8')
        return { name: skillName }
      },
    }),
  )
}
