import { updateClerkOptions } from '@clerk/astro/client';
import { ruRU } from '@clerk/localizations';

if (document.documentElement.lang === 'ru') {
  let attempts = 0;
  const applyRussian = () => {
    attempts += 1;
    try {
      updateClerkOptions({ localization: ruRU });
    } catch {
      if (attempts < 120) window.setTimeout(applyRussian, 50);
    }
  };
  applyRussian();
}
