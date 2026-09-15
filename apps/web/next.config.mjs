import { fileURLToPath } from 'node:url'

/** @type {import('next').NextConfig} */
export default {
  output: 'export',
  images: { unoptimized: true },
  // This is its own standalone pnpm project (see pnpm-workspace.yaml here),
  // nested inside the much larger dsh checkout which has its own
  // pnpm-lock.yaml — without this, Next.js guesses the wrong workspace root
  // from the outer lockfile and warns on every build.
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
}
