import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const feedNamespaceId = process.env.COURTLY_FEED_KV_NAMESPACE_ID?.trim();
const requireFeedBinding = process.env.COURTLY_REQUIRE_FEED_BINDING === '1';

if (requireFeedBinding && !feedNamespaceId) {
  throw new Error(
    'Production builds require COURTLY_FEED_KV_NAMESPACE_ID so the live listing feed cannot be bundled accidentally.',
  );
}

const localWorkerConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  ...(feedNamespaceId
    ? { kv_namespaces: [{ binding: 'COURTLY_FEED', id: feedNamespaceId }] }
    : {}),
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localWorkerConfig,
      }),
    ],
  };
});
