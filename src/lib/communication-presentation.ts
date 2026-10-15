/** ASCII page addresses match the existing publishing API contract. */
export function suggestPageAddress(title: string, fallback = ''): string {
  const address = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96).replace(/-+$/g, '');
  return address || (title.trim() ? fallback : '');
}

export function activityCategory(type: string): string {
  if (type === 'paper.published') return 'papers';
  if (type === 'post.published') return 'posts';
  if (type.startsWith('discussion.') || type.startsWith('comment.')) return 'discussions';
  if (type.startsWith('repository.') || type.startsWith('revision.')) return 'repositories';
  return 'community';
}
