import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { getAccounts, removeAccount, removeAccountsByPlatform, waitForAccounts, refreshAccountsFromSupabase } from '@/src/lib/social';
import { listCompanies } from '@/src/lib/companies';

export async function GET(request) {
  const token = getTokenFromRequest(request);
  try { if (!token) throw new Error(); verifyToken(token); } catch {
    return Response.json({ error: 'Não autenticado' }, { status: 401 });
  }
  // Sempre vai buscar dados frescos ao Supabase (evita cache stale entre instâncias Vercel)
  await refreshAccountsFromSupabase();
  const accounts = getAccounts();
  const companies = await listCompanies().catch(() => []);
  const singleCompany = companies.length === 1 ? companies[0] : null;
  console.log('[social/accounts] GET: %d contas carregadas', accounts.length);
  accounts.forEach(a => console.log('  - %s (%s) id=%s companyName=%s', a.platform, a.name, a.id, a.companyName || 'none'));

  const grouped = {};
  const seen = new Set();
  const newestAccounts = [...accounts].sort((a, b) =>
    new Date(b.connectedAt || 0).getTime() - new Date(a.connectedAt || 0).getTime()
  );

  for (const account of newestAccounts) {
    const stableAccountId = account.accountId && account.accountId !== account.id
      ? account.accountId
      : null;
    const dedupeKey = [
      account.platform,
      stableAccountId || account.email || account.name || account.id,
    ].join(':');
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const companyId = account.companyId || (singleCompany ? singleCompany.id : null);
    const companyName = account.companyName || (singleCompany ? singleCompany.name : null);

    if (!grouped[account.platform]) grouped[account.platform] = [];
    grouped[account.platform].push({
      id: account.id,
      accountId: account.accountId || null,
      platform: account.platform,
      name: account.name,
      email: account.email,
      picture: account.picture,
      companyId,
      companyName,
      connectedAt: account.connectedAt,
      pages: Array.isArray(account.pages) ? account.pages.map(page => ({
        id: page.id,
        name: page.name,
        picture: page.picture || null,
        accessToken: page.accessToken || null,
      })) : [],
    });
  }
  console.log('[social/accounts] Retornando grupos: %s', Object.keys(grouped).join(', '));
  return Response.json({ accounts: grouped });
}

export async function DELETE(request) {
  const token = getTokenFromRequest(request);
  try { if (!token) throw new Error(); verifyToken(token); } catch {
    return Response.json({ error: 'Não autenticado' }, { status: 401 });
  }
  const body = await request.json();
  const { accountId, platform } = body;
  if (accountId) {
    await removeAccount(accountId);
  } else if (platform) {
    if (!['facebook', 'instagram', 'linkedin'].includes(platform)) {
      return Response.json({ error: 'Plataforma inválida' }, { status: 400 });
    }
    await removeAccountsByPlatform(platform);
  } else {
    return Response.json({ error: 'accountId ou platform obrigatório' }, { status: 400 });
  }
  return Response.json({ success: true });
}
