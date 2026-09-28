import type { APIRoute } from 'astro';
import { publicCardDocumentSchema } from '@/lib/card-openapi';

export const prerender = true;

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://superii.site/schemas/card/v1.json',
  title: 'Super ii public card document v1',
  description: 'The selected public snapshot for one active unlisted Super ii Card. Private vault, received contacts, notes and the raw card token are never included.',
  ...publicCardDocumentSchema,
};

export const GET: APIRoute = async () => Response.json(schema, {
  headers: {
    'cache-control': 'public, max-age=300, s-maxage=3600',
    'x-content-type-options': 'nosniff',
  },
});
