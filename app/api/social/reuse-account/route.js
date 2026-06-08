import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { getAccountById, addAccount, waitForAccounts } from '@/src/lib/social';

// Cria uma nova entrada para a mesma conta (mesmo token) noutra empresa
export async function POST(request) {
  const token = getTokenFromRequest(request);
  try { if (!token) throw new Error(); verifyToken(token); } catch {
    return Response.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const { sourceAccountId, targetCompanyId } = await request.json();
  if (!sourceAccountId || !targetCompanyId) {
    return Response.json({ error: 'sourceAccountId e targetCompanyId obrigatórios' }, { status: 400 });
  }

  await waitForAccounts();
  const source = getAccountById(sourceAccountId);
  if (!source) return Response.json({ error: 'Conta origem não encontrada' }, { status: 404 });

  const newAccount = await addAccount({
    platform: source.platform,
    accountId: source.accountId,
    accessToken: source.accessToken,
    name: source.name,
    email: source.email,
    picture: source.picture,
    pages: source.pages || [],
    instagramUserId: source.instagramUserId || null,
    companyId: targetCompanyId,
    expiresAt: source.expiresAt || null,
  });

  console.log(`[social] Conta ${source.platform} reutilizada para empresa ${targetCompanyId}: ${newAccount.id}`);
  return Response.json({ success: true, account: { id: newAccount.id, name: newAccount.name } });
}
