#!/usr/bin/env node
/**
 * GRAAS requires Node.js 22+.
 *
 * Why: Next.js 16 and the OpenAI/undici client bundled with the API call
 * `webidl.util.markAsUncloneable`, which does not exist on Node 20. On Node 20
 * the web app returns 500s and cloud LLM calls (OpenRouter) fail silently and
 * fall back to keyword triage.
 *
 * Set GRAAS_ALLOW_OLD_NODE=1 to bypass this check at your own risk.
 */
const REQUIRED_MAJOR = 22;

const major = Number(process.versions.node.split(".")[0]);
if (Number.isFinite(major) && major >= REQUIRED_MAJOR) process.exit(0);

if (process.env.GRAAS_ALLOW_OLD_NODE === "1") {
  console.warn(
    `\n[GRAAS] Warning: Node ${process.versions.node} detected. Node ${REQUIRED_MAJOR}+ is required for Next.js 16 and cloud LLM calls.\n`,
  );
  process.exit(0);
}

console.error(`
[GRAAS] Unsupported Node.js version: ${process.versions.node}
         Node.js ${REQUIRED_MAJOR}+ is required (Node 22 LTS recommended).

  Fix:
    nvm install 22 && nvm use 22      # or: fnm use 22
    # no version manager? install Node 22 and put it first in PATH

  A .nvmrc file is included in the repo root.
`);
process.exit(1);
