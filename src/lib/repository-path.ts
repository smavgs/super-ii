import type { RepositoryKind } from './catalog';

export function kindPath(kind: RepositoryKind): string {
  return kind === 'model' ? 'models' : kind === 'dataset' ? 'datasets' : 'spaces';
}
