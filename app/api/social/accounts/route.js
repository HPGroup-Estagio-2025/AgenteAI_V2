import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { getAccounts, removeAccount, removeAccountsByPlatform, waitForAccounts } from '@/src/lib/social';

export async function GET(request) {
  const token = getTokenFromRequest(request);
  try { if (!token) throw new Error(); verifyToken(token); } catch {
    return Response.json({ error: 'Não autenticado' }, { status: 401 });
  }
  await waitForAccounts();
  const accounts = getAccounts();
  const grouped = {};
  for (const account of accounts) {
    if (!grouped[account.platform]) grouped[account.platform] = [];
    grouped[account.platform].push({
      id: account.id,
      platform: account.platform,
      name: account.name,
      email: account.email,
      picture: account.picture,
      connectedAt: account.connectedAt,
      pages: Array.isArray(account.pages) ? account.pages.map(page => ({
        id: page.id,
        name: page.name,
        picture: page.picture || null,
      })) : [],
    });
  }
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
