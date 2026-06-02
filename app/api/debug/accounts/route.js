import { getAccounts, waitForAccounts } from '@/src/lib/social';

export const runtime = 'nodejs';

export async function GET(request) {
  try {
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
        accessTokenPreview: p.accessToken ? p.accessToken.substring(0, 20) + '...' : 'MISSING!',
      })) : [],
      instagramUserId: acc.instagramUserId || 'MISSING!',
      hasAccessToken: !!acc.accessToken,
    }));

    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      accountCount: accounts.length,
      accounts: debug
    });
  } catch (err) {
    return Response.json({
      error: err.message,
      stack: err.stack
    }, { status: 500 });
  }
}
