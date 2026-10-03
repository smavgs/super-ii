import type { APIRoute } from 'astro';
import { chineseMessages, reviewedChineseMessages } from '@/lib/i18n';

export const GET: APIRoute = () => Response.json(
  {
    locale: 'zh-CN',
    sourceLocale: 'en',
    messages: chineseMessages,
    reviewedMessages: reviewedChineseMessages,
  },
  {
    headers: {
      'cache-control': 'public, max-age=3600, s-maxage=86400',
      'content-language': 'zh-CN',
    },
  },
);
