import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { getAccounts, removeAccount, removeAccountsByPlatform, waitForAccounts, refreshAccountsFromSupabase, supabaseAdmin, SOCIAL_TABLE } from '@/src/lib/social';
import { listCompanies } from '@/src/lib/companies';

export async function GET(request) {
  const token = getTokenFromRequest(request);
  try { if (!token) throw new Error(); verifyToken(token); } catch {
    return Response.json({ error: 'Não autenticado' }, { status: 401 });
  }
  await refreshAccountsFromSupabase();
  const accounts = getAccounts();
  const companies = await listCompanies().catch(() => []);
  const singleCompany = companies.length === 1 ? companies[0] : null;

  const grouped = {};
  // Deduplica por platform+id (cada registo é único — uma conta por empresa)
  const seen = new Set();
  for (const account of accounts) {
    if (seen.has(account.id)) continue;
    seen.add(account.id);

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
      selectedPageId: account.selectedPageId || null,
      pages: Array.isArray(account.pages) ? account.pages.map(page => ({
        id: page.id,
        name: page.name,
        picture: page.picture || null,
      })) : [],
    });
  }
  return Response.json({ accounts: grouped });
}

export async function PATCH(request) {
  const token = getTokenFromRequest(request);
  try { if (!token) throw new Error(); verifyToken(token); } catch {
    return Response.json({ error: 'Não autenticado' }, { status: 401 });
  }
  const { accountId, selectedPageId } = await request.json().catch(() => ({}));
  if (!accountId) return Response.json({ error: 'accountId obrigatório' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from(SOCIAL_TABLE)
    .update({ selected_page_id: selectedPageId || null })
    .eq('id', accountId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
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
