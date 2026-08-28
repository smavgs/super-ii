import siteData from '@/content/site.json';

export const site = siteData;
export const plans = siteData.plans;

export type CatalogKind = 'models' | 'datasets' | 'spaces';

export const catalogMeta: Record<CatalogKind, {
  singular: string;
  title: string;
  description: string;
  icon: string;
  example: string;
}> = {
  models: {
    singular: 'model',
    title: 'Models',
    description: 'Discover open models with clear cards, files, versions, and responsible-use notes.',
    icon: 'ph-cube',
    example: 'Search models, tasks, or creators',
  },
  datasets: {
    singular: 'dataset',
    title: 'Datasets',
    description: 'Find documented datasets with licenses, schemas, previews, and reproducible versions.',
    icon: 'ph-database',
    example: 'Search datasets, languages, or formats',
  },
  spaces: {
    singular: 'app',
    title: 'Apps',
    description: 'Try community AI apps in the browser and learn from the projects behind them.',
    icon: 'ph-browser',
    example: 'Search apps, tasks, or frameworks',
  },
};

export function absoluteUrl(path = '/') {
  return new URL(path, siteData.brand.url).toString();
}

export function authIsConfigured(locals: App.Locals): boolean {
  void locals;
  return Boolean(import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY);
}
