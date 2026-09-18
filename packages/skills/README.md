# @cordis-app/skills

**Not a `dsh` bundle** — no code, nothing to build. Each directory is one
built-in skill (`<name>/SKILL.md`, optional `references/`, `scripts/`,
`templates/`, `checklists/`) available to every user.

Cloned verbatim from example-2 (`packages/skills`) — every file here already
reads generically (no fox-harness-specific branding or backend references),
so nothing needed adapting. `web_search`/`bash` are real tools in this app
too (via the cloned `@cordis-app/tool-serper-web-search` + dsh-base), and
"sửa/xoá trong mục Kỹ năng ở thanh bên" (skill-creator's own text) matches
this app's own Skills UI.

## How it is loaded

- `packages/bundle-core/cordis.patch.yml` mounts `@deepseek-ai/dsh-skill-filesystem`
  with `bundledSkillDir: !!js process.env.CORDIS_BUNDLED_SKILL_DIR` —
  `scripts/dev.sh`/`deploy/entrypoint.sh` set that env var to this directory's
  real path.
- `bundled` has the lowest precedence (rank 600). A user-created skill (via
  the `create_skill` tool, `packages/tool/create-skill`) lands in
  `$DSH_HOME/skills` (rank 400, source `user-dsh`) and would silently win a
  same-name collision — `create_skill` refuses names that already exist
  anywhere (built-in or user) before writing.

## Frontmatter

`dsh-skill-filesystem` reads only `name`, `description`, `whenToUse`,
`metadata`, `disable-model-invocation`, `user-invocable`. Other keys are
ignored.

- `name` must be kebab-case.
- **Invocation keys must be kebab-case.** `userInvocable: false` (camelCase)
  drops the whole skill from discovery with only a log warning.
- `user-invocable: false` hides the skill from `/name`; the model can still
  load it with the `skill` tool.

Origin: `example-2/packages/skills`, itself "ported from agent-core
`bundles/skills`" per that package's own README.
