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
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'viewport',
  },
  security: {
    checkOrigin: true,
  },
  vite: {
    build: {
      cssMinify: 'lightningcss',
    },
  },
});
