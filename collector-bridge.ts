import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.1.3';

const issuer = 'https://token.actions.githubusercontent.com';
const audience = 'radar-da-tropa:browser-collector:v1';
const keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function collectorClaimsAllowed(claims: Record<string, unknown>) {
  return claims.repository === 'jose-sites/radar-da-tropa' &&
    claims.repository_id === '1424001421' && claims.repository_owner_id === '138799985' &&
    claims.ref === 'refs/heads/main' &&
    claims.workflow_ref === 'jose-sites/radar-da-tropa/.github/workflows/tiktok-collector.yml@refs/heads/main' &&
    ['push', 'schedule', 'workflow_dispatch'].includes(String(claims.event_name)) &&
    claims.runner_environment === 'github-hosted';
}

export function collectedProfile(raw: any, expected: string) {
  if (!raw || typeof raw.id !== 'string' || !/^\d{5,30}$/.test(raw.id) ||
      typeof raw.uniqueId !== 'string' || !/^[A-Za-z0-9._]{2,40}$/.test(raw.uniqueId)) throw new Error('invalid_identity');
  if (raw.uniqueId.toLowerCase() !== expected.toLowerCase()) throw new Error('identity_mismatch');
  return { id: raw.id, uniqueId: raw.uniqueId,
    secUid: typeof raw.secUid === 'string' ? raw.secUid.slice(0, 300) : null,
    avatarUrl: typeof raw.avatarUrl === 'string' ? raw.avatarUrl.slice(0, 3000) : null };
}

export function collectorDelay(attempts: number) {
  return Math.min(24 * 60, 15 * 2 ** Math.min(Math.max(attempts - 1, 0), 7)) * 60000;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

// This capability accepts only short-lived, cryptographically verified GitHub OIDC
// tokens from our specific main-branch workflow. It cannot publish allegations,
// moderate reports or access private evidence. No database credential goes to GitHub.
export async function collectorRequest(request: Request, admin: any, saveProfile: (profile: any, handle: string) => Promise<string>) {
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer \S+$/.test(authorization)) return json({ error: 'access_denied' }, 403);
  try {
    const { payload } = await jwtVerify(authorization.slice(7), keys, {
      issuer, audience, algorithms: ['RS256'], maxTokenAge: '5m', requiredClaims: ['exp', 'iat', 'sub'],
    });
    if (!collectorClaimsAllowed(payload)) return json({ error: 'access_denied' }, 403);
  } catch { return json({ error: 'access_denied' }, 403); }
  let body: any;
  try {
    const text = await request.text();
    if (text.length > 12000) return json({ error: 'invalid_request' }, 400);
    body = JSON.parse(text);
  } catch { return json({ error: 'invalid_request' }, 400); }
  try {
    const now = new Date().toISOString();
    if (body.action === 'claim') {
      const { data, error } = await admin.from('radar_reports')
        .select('id,handle,browser_attempts').eq('status', 'published').is('profile_id', null)
        .or(`browser_next_at.is.null,browser_next_at.lt.${now}`)
        .order('browser_next_at', { ascending: true, nullsFirst: true }).limit(3);
      if (error) throw new Error('queue_unavailable');
      const jobs = [];
      for (const report of data || []) {
        const lease = crypto.randomUUID();
        const { data: claimed, error: claimError } = await admin.from('radar_reports').update({
          browser_lease: lease, browser_attempt_at: now, browser_attempts: report.browser_attempts + 1,
          browser_next_at: new Date(Date.now() + 10 * 60000).toISOString(),
        }).eq('id', report.id).eq('status', 'published').is('profile_id', null)
          .eq('browser_attempts', report.browser_attempts).select('id,handle').maybeSingle();
        if (claimError) throw new Error('queue_unavailable');
        if (claimed) jobs.push({ reportId: claimed.id, handle: claimed.handle, lease });
      }
      return json({ jobs });
    }
    if (body.action !== 'complete' || !uuid.test(body.reportId) || !uuid.test(body.lease)) return json({ error: 'invalid_request' }, 400);
    const { data: report, error } = await admin.from('radar_reports')
      .select('id,handle,browser_attempts').eq('id', body.reportId).eq('browser_lease', body.lease)
      .eq('status', 'published').is('profile_id', null).gt('browser_next_at', now).maybeSingle();
    if (error) throw new Error('queue_unavailable');
    if (!report) return json({ error: 'lease_expired' }, 409);
    let profileId: string | null = null;
    let failure: string | null = null;
    if (body.profile) {
      if (!['tiktok-api', 'tiktokpy'].includes(body.provider)) return json({ error: 'invalid_provider' }, 400);
      let profile;
      try { profile = collectedProfile(body.profile, report.handle); }
      catch { return json({ error: 'identity_mismatch' }, 400); }
      profileId = await saveProfile(profile, report.handle);
    } else {
      failure = ['blocked', 'rate_limited', 'identity_mismatch'].includes(body.error) ? body.error : 'browser_profile_unavailable';
    }
    const changes: Record<string, unknown> = {
      browser_lease: null, browser_error: failure,
      browser_next_at: profileId ? null : new Date(Date.now() + collectorDelay(report.browser_attempts)).toISOString(),
    };
    if (profileId) { changes.profile_id = profileId; changes.profile_resolution_error = null; }
    const { data: saved, error: saveError } = await admin.from('radar_reports').update(changes)
      .eq('id', report.id).eq('browser_lease', body.lease).eq('status', 'published').is('profile_id', null)
      .select('id').maybeSingle();
    if (saveError) throw new Error('result_not_saved');
    if (!saved) return json({ error: 'lease_expired' }, 409);
    return json({ profileVerified: Boolean(profileId), error: failure });
  } catch {
    return json({ error: 'collector_unavailable' }, 503);
  }
}
