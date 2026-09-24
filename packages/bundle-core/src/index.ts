// The "." export exists only because package.json convention expects one; no
// composition loads the plugins through it — cordis.patch.yml's insert rows
// reference each plugin by its own exports subpath ("./ui", "./gateway", …)
// instead, so plain `export *` here would silently collide on the shared
// `name`/`apply` bindings (ES module star-export ambiguity drops both).
export * as ui from './ui.ts'
export * as auth from './auth.ts'
export * as gateway from './gateway.ts'
export * as audit from './audit.ts'
export * as prompt from './prompt.ts'
export * as resilience from './resilience.ts'
export * as webClean from './web-clean.ts'
export * as skillModelPreference from './skill-model-preference.ts'
