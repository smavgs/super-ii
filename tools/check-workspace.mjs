import assert from 'node:assert/strict';
import { workspaceDestination, repositoryMatches } from '../src/lib/workspace-navigation.ts';

// Old bookmarks must still reach the member's private controls after they move.
assert.equal(workspaceDestination('#robots').redirect, '/robot#my-robots');
assert.equal(workspaceDestination('#hardware').redirect, '/robot#hardware');
assert.equal(workspaceDestination('#transparent').redirect, '/transparent#my-reports');
assert.equal(workspaceDestination('#organizations').redirect, '/organizations#my-organizations');
// A brand-new visit, an outdated bookmark, and untrusted fragments remain local.
for (const fragment of ['', '#missing', '#https://example.invalid', '#__proto__', '#constructor']) {
  assert.deepEqual(workspaceDestination(fragment), { section: 'work' });
}
assert.deepEqual(workspaceDestination('#ai-worker'), { section: 'setup', target: 'ai-worker' });
assert.deepEqual(workspaceDestination('#connect-super-ii'), { section: 'setup', target: 'connect-super-ii' });
assert.deepEqual(workspaceDestination('', 'ai-worker'), { section: 'setup', target: 'ai-worker' });
assert.deepEqual(workspaceDestination('', 'https://example.invalid'), { section: 'work' });
assert.deepEqual(workspaceDestination('#profile'), { section: 'account', target: 'profile' });
assert.deepEqual(workspaceDestination('#/security'), { section: 'account', target: 'identity' });
assert.deepEqual(workspaceDestination('#activity'), { section: 'work', target: 'activity' });
assert.deepEqual(workspaceDestination('#commerce'), { section: 'commerce' });

const work = [
  { text: 'Résumé assistant member/resume', kind: 'model' },
  { text: 'Русские примеры member/russian', kind: 'dataset' },
  { text: 'Image studio member/studio', kind: 'space' },
];
const find = (query, kind = 'all') => work.filter((row) => repositoryMatches(row.text, row.kind, query, kind));
assert.equal(find(' RESUME ').length, 1);
assert.equal(find('РУССКИЕ', 'dataset').length, 1);
assert.equal(find('member/studio', 'space').length, 1);
assert.equal(find('resume', 'dataset').length, 0);
assert.equal(find('missing').length, 0);
assert.equal(find('').length, 3);
assert.equal(find('', 'model').length, 1);
console.log('Workspace checks passed: legacy destinations, onboarding, Clerk account routes, safe fragment fallback and repository filtering.');
