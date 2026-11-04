// Node loader hooks that let tests import the real middleware.ts and route
// handlers, which are written for the Cloudflare Worker build. They supply only
// what Node lacks: the `cloudflare:workers` module, the `next/server` shim vinext
// uses in the build, the `@/` alias, extensionless .ts imports, and Vite's
// `import.meta.env.DEV` flag (false, as in a built Worker).
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const WORKERS_STUB = 'data:text/javascript,export const env = (globalThis.__COURTLY_TEST_ENV ??= {});';

function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: WORKERS_STUB, shortCircuit: true };
  if (specifier === 'next/server') {
    return { url: new URL('node_modules/vinext/dist/shims/server.js', root).href, shortCircuit: true };
  }
  let target = specifier;
  if (specifier.startsWith('@/')) target = new URL(specifier.slice(2), root).href;
  else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) target = new URL(specifier, context.parentURL).href;
  if (target !== specifier || specifier.startsWith('.')) {
    if (target.startsWith('file:') && !/\.[a-z]+$/i.test(target) && existsSync(fileURLToPath(`${target}.ts`))) {
      return { url: `${target}.ts`, shortCircuit: true };
    }
    if (target !== specifier) return next(target, context);
  }
  return next(specifier, context);
}

function load(url, context, next) {
  if (url.endsWith('/middleware.ts')) {
    const source = (readFileSync(fileURLToPath(url), 'utf8')).replaceAll('import.meta.env.DEV', 'false');
    return { format: 'module-typescript', source, shortCircuit: true };
  }
  return next(url, context);
}

/** Registers the hooks for the current process; call before importing the Worker modules. */
export function registerWorkerModuleHooks() {
  registerHooks({ resolve, load });
}
