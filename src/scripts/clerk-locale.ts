import { updateClerkOptions } from '@clerk/astro/client';
import { ruRU, zhCN } from '@clerk/localizations';

const localization = document.documentElement.lang === 'ru'
  ? ruRU
  : document.documentElement.lang === 'zh-CN'
    ? zhCN
    : null;

if (localization) {
  let attempts = 0;
  const applyLocalization = () => {
    attempts += 1;
    try {
      updateClerkOptions({ localization });
    } catch {
      if (attempts < 120) window.setTimeout(applyLocalization, 50);
    }
  };
  applyLocalization();
}
