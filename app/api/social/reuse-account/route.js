import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { getAccountById, shareAccount, waitForAccounts } from '@/src/lib/social';

// Torna a conta partilhada (company_id = null) para que fique disponível em todas as empresas
export async function POST(request) {
  const token = getTokenFromRequest(request);
  try { if (!token) throw new Error(); verifyToken(token); } catch {
    return Response.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const { sourceAccountId } = await request.json();
  if (!sourceAccountId) {
    return Response.json({ error: 'sourceAccountId obrigatório' }, { status: 400 });
  }

  await waitForAccounts();
  const source = getAccountById(sourceAccountId);
  if (!source) return Response.json({ error: 'Conta origem não encontrada' }, { status: 404 });

  await shareAccount(sourceAccountId);
  console.log(`[social] Conta ${source.platform} (${source.name}) partilhada entre todas as empresas`);
  return Response.json({ success: true, account: { id: source.id, name: source.name } });
}
