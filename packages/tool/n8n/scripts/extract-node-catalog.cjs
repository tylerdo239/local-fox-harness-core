'use strict'
// Runs INSIDE a real n8n container (needs its node_modules resolution) — see
// regenerate-catalog.sh, which docker-cp's this file in and runs it. Walks
// n8n-nodes-base's own `n8n.nodes` manifest (its package.json — the exact
// list n8n's own backend loads at boot) and requires every node module the
// same way n8n itself does, then prints a distilled JSON catalog to stdout.
//
// Why this exists instead of hand-writing more node gotchas into SKILL.md
// one bug at a time (user: "cứ có 1 flow node n8n làm sai rồi cứ thêm skill
// md ... ko phải có cách tối ưu hơn Agent phải hiểu và có 1 kho kiến thức về
// node trong n8n chứ"): n8n's own live schema endpoint (`/types/nodes.json`,
// what the editor UI itself uses to render node forms) needs a real browser
// login session cookie — confirmed by reading auth.service.js, our API key
// doesn't work there — so the agent can't introspect n8n live at request
// time. Extracting straight from the installed node package's own compiled
// description objects (same source n8n's UI itself reads) is the next best
// thing: ground truth, all 440+ nodes, not just the handful someone hit a
// bug on.
//
// One entry per node type, one properties array per DISTINCT version GROUP:
// n8n allocates a fresh instance per version number even when several route
// to the same class (httpRequest's own source: `3: new HttpRequestV3(...),
// 4: new HttpRequestV3(...), ...` — separate objects, confirmed by testing —
// so grouping by reference never collapses anything), so versions are
// grouped by deep-equality of the extracted description instead, collapsing
// httpRequest's {3,4,4.1,4.2,4.3,4.4,4.5} into one group as expected.

const path = require('path')
const fs = require('fs')

const N8N_BASE_DIR = process.argv[2] || '/usr/local/lib/node_modules/n8n'
const pkgRoot = path.dirname(require.resolve('n8n-nodes-base/package.json', { paths: [path.join(N8N_BASE_DIR, 'node_modules')] }))
const wfEntry = require.resolve('n8n-workflow', { paths: [path.join(N8N_BASE_DIR, 'node_modules')] })
const { VersionedNodeType } = require(wfEntry)
const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'))
const nodeFiles = pkg.n8n && Array.isArray(pkg.n8n.nodes) ? pkg.n8n.nodes : []

// Strip presentation-only noise the model never needs to produce valid JSON
// (icons, SVGs, docs links) but keep everything that shapes it: type,
// options, defaults, displayOptions gating, and any builderHint — n8n's own
// AI-authoring hints, when present, are exactly the "how do I configure
// this" guidance this catalog exists to surface (e.g. Code node's real
// "Default to javaScript" hint, HTTP Request's "prefer a dedicated node"
// hint).
function stripProperty(p) {
  if (p === null || typeof p !== 'object') return p
  if (Array.isArray(p)) return p.map(stripProperty)
  const out = {}
  for (const [k, v] of Object.entries(p)) {
    if (k === 'icon' || k === 'iconUrl' || k === 'iconColor' || k === 'documentationUrl' || k === 'codex' || k === 'subtitle') continue
    out[k] = stripProperty(v)
  }
  return out
}

function describeOne(nodeType, relFile) {
  const d = nodeType.description
  return {
    file: relFile,
    displayName: d.displayName,
    name: d.name,
    group: d.group,
    description: d.description,
    builderHint: d.builderHint,
    properties: stripProperty(d.properties || []),
  }
}

const catalog = []
const failures = []

for (const relFile of nodeFiles) {
  const absFile = path.join(pkgRoot, relFile)
  try {
    const mod = require(absFile)
    const ExportedClass = Object.values(mod).find((v) => typeof v === 'function' && v.prototype)
    if (!ExportedClass) { failures.push({ file: relFile, error: 'no exported class' }); continue }
    const instance = new ExportedClass()

    if (instance instanceof VersionedNodeType) {
      const base = instance.description
      const described = Object.entries(instance.nodeVersions).map(([verStr, versionedInstance]) => ({
        version: Number(verStr),
        payload: describeOne(versionedInstance, relFile),
      }))
      const groups = []
      for (const { version, payload } of described) {
        const key = JSON.stringify(payload)
        const group = groups.find((g) => g.key === key)
        if (group) group.versions.push(version)
        else groups.push({ key, payload, versions: [version] })
      }
      catalog.push({
        type: `n8n-nodes-base.${base.name}`,
        displayName: base.displayName,
        group: base.group,
        description: base.description,
        defaultVersion: base.defaultVersion,
        builderHint: base.builderHint,
        versionGroups: groups.map((g) => ({ versions: g.versions.sort((a, b) => a - b), ...g.payload })),
      })
    } else {
      const d = instance.description
      catalog.push({
        type: `n8n-nodes-base.${d.name}`,
        displayName: d.displayName,
        group: d.group,
        description: d.description,
        defaultVersion: typeof d.version === 'number' ? d.version : Array.isArray(d.version) ? Math.max(...d.version) : 1,
        builderHint: d.builderHint,
        versionGroups: [{ versions: Array.isArray(d.version) ? d.version : [d.version ?? 1], ...describeOne(instance, relFile) }],
      })
    }
  } catch (err) {
    failures.push({ file: relFile, error: err && err.message ? err.message : String(err) })
  }
}

process.stderr.write(`extracted ${String(catalog.length)} nodes, ${String(failures.length)} failures\n`)
if (failures.length > 0) process.stderr.write(JSON.stringify(failures, null, 2) + '\n')
process.stdout.write(JSON.stringify(catalog))
