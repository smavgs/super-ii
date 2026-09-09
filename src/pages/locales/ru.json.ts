import type { APIRoute } from 'astro';
import { reviewedRussianMessages, russianMessages } from '@/lib/i18n';

export const GET: APIRoute = () => Response.json(
  {
    locale: 'ru',
    sourceLocale: 'en',
    messages: russianMessages,
    reviewedMessages: reviewedRussianMessages,
  },
  {
    headers: {
      'cache-control': 'public, max-age=3600, s-maxage=86400',
      'content-language': 'ru',
    },
  },
);
