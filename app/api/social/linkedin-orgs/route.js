import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { getAccountsByPlatform, waitForAccounts } from '@/src/lib/social';

export async function GET(request) {
  const token = getTokenFromRequest(request);
  try { if (!token) throw new Error(); verifyToken(token); } catch {
    return Response.json({ error: 'Não autenticado' }, { status: 401 });
  }

  await waitForAccounts();
  const accounts = getAccountsByPlatform('linkedin');
  if (!accounts.length) return Response.json({ error: 'Nenhuma conta LinkedIn conectada' }, { status: 404 });

  const results = [];
  for (const account of accounts) {
    const accessToken = account.accessToken;
    const info = { accountId: account.id, name: account.name, companyName: account.companyName };

    // 1. Testa post como organização com o org ID guardado na empresa
    // 2. Lista organizações via API para confirmar IDs
    try {
      const orgRes = await fetch(
        'https://api.linkedin.com/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(organization~(id,localizedName),role))',
        { headers: { Authorization: `Bearer ${accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' } }
      );
      const orgData = await orgRes.json().catch(() => ({}));
      info.organizationAcls = {
        status: orgRes.status,
        organizations: (orgData.elements || []).map(e => ({
          id: e['organization~']?.id,
          name: e['organization~']?.localizedName,
          role: e.role,
          urn: e['organization~']?.id ? `urn:li:organization:${e['organization~'].id}` : null,
        })),
        raw: orgData,
      };
    } catch (e) {
      info.organizationAcls = { error: e.message };
    }

    // Testa ugcPosts com texto simples
    try {
      const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const profile = await profileRes.json().catch(() => ({}));
      info.userinfo = { sub: profile.sub, name: profile.name };
    } catch (e) {
      info.userinfo = { error: e.message };
    }

    results.push(info);
  }

  return Response.json({ results });
}
