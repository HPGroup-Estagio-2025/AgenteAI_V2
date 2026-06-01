import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { getAccounts, waitForAccounts } from '@/src/lib/social';

// Endpoint seguro (requer login) que expõe os tokens completos para uso em ferramentas externas.
// GET /api/social/tokens

export async function GET(request) {
  const token = getTokenFromRequest(request);
  try { if (!token) throw new Error(); verifyToken(token); } catch {
    return Response.json({ error: 'Não autenticado' }, { status: 401 });
  }

  await waitForAccounts();
  const accounts = getAccounts();

  const result = accounts.map(a => {
    const now = new Date();
    const expiresAt = a.expiresAt ? new Date(a.expiresAt) : null;
    const isExpired = expiresAt ? expiresAt < now : false;
    const daysLeft = expiresAt && !isExpired
      ? Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24))
      : null;

    return {
      id: a.id,
      platform: a.platform,
      name: a.name,
      connectedAt: a.connectedAt,
      // Token de utilizador/página
      accessToken: a.accessToken || null,
      expiresAt: a.expiresAt || null,
      expired: isExpired,
      daysLeft,
      neverExpires: !a.expiresAt,
      // Instagram
      instagramUserId: a.instagramUserId || null,
      // Páginas do Facebook (cada uma com o seu Page Token)
      pages: (a.pages || []).map(p => ({
        id: p.id,
        name: p.name,
        accessToken: p.accessToken || null,
        neverExpires: true, // page tokens obtidos via token longo nunca expiram
      })),
    };
  });

  return Response.json({ accounts: result });
}
