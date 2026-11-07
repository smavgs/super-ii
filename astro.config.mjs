// @ts-check
import cloudflare from '@astrojs/cloudflare';
import clerk from '@clerk/astro';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://superii.site',
  output: 'server',
  trailingSlash: 'never',
  session: false,
  adapter: cloudflare({
    imageService: { build: 'compile', runtime: 'passthrough' },
    prerenderEnvironment: 'workerd',
  }),
  integrations: [clerk({ enableEnvSchema: false })],
  security: {
    // Equivalent form-origin enforcement runs first in src/middleware.ts so
    // signed RFC 8058 unsubscribe callbacks can reach their bounded handler.
    checkOrigin: false,
  },
  vite: {
    build: {
      cssMinify: 'lightningcss',
    },
  },
});
