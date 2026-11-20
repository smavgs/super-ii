// This is fresh first-factor verification, not a claim of MFA enrollment.
// Clerk verifies the signed session; client-supplied timestamps are never used.
export function requireRecentVerification(locals: App.Locals): Response | null {
  try {
    const auth = locals.auth();
    if (!auth.userId) return Response.json({ error: 'authentication_required' }, { status: 401 });
    if (auth.has({ reverification: { level: 'first_factor', afterMinutes: 10 } })) return null;
    return Response.json({
      error: 'verification_required',
      message: 'Verify it is you before granting access. Your selections will be kept.',
    }, { status: 403, headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'verification_service_unavailable' }, {
      status: 503, headers: { 'cache-control': 'private, no-store', 'retry-after': '30' },
    });
  }
}
