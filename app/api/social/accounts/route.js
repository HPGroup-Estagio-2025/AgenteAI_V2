import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { getAccounts, removeAccount } from '@/src/lib/social';

export async function GET(request) {
  const token = getTokenFromRequest(request);
  try { if (!token) throw new Error(); verifyToken(token); } catch {
    return Response.json({ error: 'Não autenticado' }, { status: 401 });
  }
  const accounts = getAccounts();
  const safe = Object.fromEntries(
    Object.entries(accounts).map(([platform, data]) => [
      platform,
      {
        platform,
        name: data.name,
        email: data.email,
        picture: data.picture,
        connectedAt: data.connectedAt,
        pages: Array.isArray(data.pages) ? data.pages.map(page => ({
          id: page.id,
          name: page.name,
          picture: page.picture || null,
        })) : [],
      },
    ])
  );
  return Response.json({ accounts: safe });
}

export async function DELETE(request) {
  const token = getTokenFromRequest(request);
  try { if (!token) throw new Error(); verifyToken(token); } catch {
    return Response.json({ error: 'Não autenticado' }, { status: 401 });
  }
  const { platform } = await request.json();
  if (!['facebook', 'instagram', 'linkedin'].includes(platform)) {
    return Response.json({ error: 'Plataforma inválida' }, { status: 400 });
  }
  removeAccount(platform);
  return Response.json({ success: true });
}
