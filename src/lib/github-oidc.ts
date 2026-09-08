/** Called workflow identity wins for reusable jobs; otherwise bind the regular workflow. */
export function githubWorkflowRef(claims: Record<string, unknown>): string | null {
  const value = claims.job_workflow_ref ?? claims.workflow_ref;
  return typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/\.github\/workflows\/[A-Za-z0-9._/-]+@refs\/(?:heads|tags)\/[A-Za-z0-9._/-]+$/.test(value) ? value : null;
}
