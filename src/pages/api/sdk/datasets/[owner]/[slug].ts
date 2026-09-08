import type { APIRoute } from 'astro';
import { sdkManifestResponse } from '@/lib/sdk-manifest';

export const GET: APIRoute = (context) => sdkManifestResponse(context, 'dataset');
