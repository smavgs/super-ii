/** Called workflow identity wins for reusable jobs; otherwise bind the regular workflow. */
export function githubWorkflowRef(claims: Record<string, unknown>): string | null {
  const value = Object.hasOwn(claims, 'job_workflow_ref') ? claims.job_workflow_ref : claims.workflow_ref;
  return typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/\.github\/workflows\/[A-Za-z0-9._/-]+@refs\/(?:heads|tags)\/[A-Za-z0-9._/-]+$/.test(value) ? value : null;
}

// New GitHub repositories include immutable numeric IDs in the repo segment.
// Both IDs must be present together and must match separately verified claims.
const subjectPattern = /^repo:([A-Za-z0-9_.-]+)(?:@([1-9][0-9]*))?\/([A-Za-z0-9_.-]+)(?:@([1-9][0-9]*))?:(?:ref:refs\/(?:heads|tags)\/[A-Za-z0-9._/-]+|environment:[^\r\n]{1,200}|pull_request)$/;

function subjectIdentity(subject: unknown) {
  const match = typeof subject === 'string' ? subjectPattern.exec(subject) : null;
  if (!match || Boolean(match[2]) !== Boolean(match[4])) return null;
  return { repository: `${match[1]}/${match[3]}`, ownerId: match[2], repositoryId: match[4] };
}

export function validGithubSubject(subject: string): boolean {
  return subjectIdentity(subject) !== null;
}

/** Call only after signature, issuer, audience and lifetime verification. */
export function githubRepositoryMatchesSubject(claims: Record<string, unknown>): boolean {
  const identity = subjectIdentity(claims.sub);
  if (!identity || typeof claims.repository !== 'string' || identity.repository.toLowerCase() !== claims.repository.toLowerCase()) return false;
  return identity.ownerId === undefined || (
    claims.repository_owner_id === identity.ownerId && claims.repository_id === identity.repositoryId
  );
}
