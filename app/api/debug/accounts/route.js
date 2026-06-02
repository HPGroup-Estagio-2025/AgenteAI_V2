import { getAccounts, waitForAccounts } from '@/src/lib/social';

export async function GET(request) {
  await waitForAccounts();
  const accounts = getAccounts();

  const debug = accounts.map(acc => ({
    id: acc.id,
    platform: acc.platform,
    name: acc.name,
    companyName: acc.companyName,
    pages: Array.isArray(acc.pages) ? acc.pages.map(p => ({
      id: p.id,
      name: p.name,
      hasAccessToken: !!p.accessToken,
      accessToken: p.accessToken ? '***HIDDEN***' : 'MISSING!',
    })) : [],
    instagramUserId: acc.instagramUserId || 'MISSING!',
    accessToken: acc.accessToken ? '***HIDDEN***' : 'MISSING!',
  }));

  return Response.json({ accounts: debug });
}
