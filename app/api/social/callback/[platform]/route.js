import { redirect } from 'next/navigation';
import { consumeState, addAccount } from '@/src/lib/social';
import { ensureCompanyExists } from '@/src/lib/companies';

// Troca um User Access Token curto (1-2h) por um de longa duração (60 dias).
// Os Page Access Tokens obtidos a partir de um token longo NUNCA expiram.
async function exchangeForLongLivedToken(shortToken, clientId, clientSecret) {
  const url = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('fb_exchange_token', shortToken);

  const res = await fetch(url.toString());
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    console.warn('[oauth:meta] Falha ao obter token longo, usa token curto:', data?.error?.message);
    return { token: shortToken, expiresIn: null };
  }
  console.log('[oauth:meta] Token longo obtido, expira em', data.expires_in, 'segundos (~60 dias)');
  return { token: data.access_token, expiresIn: data.expires_in || null };
}

const CONFIGS = {
  facebook: {
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    clientIdEnv: 'FACEBOOK_APP_ID',
    clientSecretEnv: 'FACEBOOK_APP_SECRET',
    longLived: true, // troca para token de longa duração automaticamente
    async getProfile(token) {
      const [profileRes, pagesRes] = await Promise.all([
        fetch(`https://graph.facebook.com/me?fields=id,name,email,picture.width(200)&access_token=${token}`),
        // Com token longo, os page tokens retornados aqui NUNCA expiram
        fetch(`https://graph.facebook.com/me/accounts?fields=id,name,access_token,tasks,picture.width(200)&access_token=${token}`),
      ]);
      const d = await profileRes.json();
      const pages = await pagesRes.json();
      return {
        accountId: d.id || null,
        name: d.name,
        email: d.email,
        picture: d.picture?.data?.url || null,
        pages: Array.isArray(pages.data) ? pages.data.map(page => ({
          id: page.id,
          name: page.name,
          accessToken: page.access_token, // nunca expira (obtido via token longo)
          tasks: page.tasks || [],
          picture: page.picture?.data?.url || null,
        })) : [],
      };
    },
  },
  instagram: {
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    clientIdEnv: 'FACEBOOK_APP_ID',
    clientSecretEnv: 'FACEBOOK_APP_SECRET',
    longLived: true, // troca para token de longa duração automaticamente
    async getProfile(token) {
      // Vai buscar conta Instagram e também as Páginas (para ter page token que não expira)
      const res = await fetch(
        `https://graph.facebook.com/me?fields=id,name,instagram_accounts{id,name,username,profile_picture_url},accounts{id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}}&access_token=${token}`
      );
      const d = await res.json();
      const pages = Array.isArray(d.accounts?.data) ? d.accounts.data : [];
      const linkedPage = pages.find(page => page.instagram_business_account?.id);
      const igBusinessAccount = linkedPage?.instagram_business_account || null;
      const fallbackIgAccount = d.instagram_accounts?.data?.[0] || null;
      console.log('[oauth:instagram] API response:', JSON.stringify({
        id: d.id,
        name: d.name,
        instagram_accounts: d.instagram_accounts,
        accounts_count: pages.length,
        business_account_id: igBusinessAccount?.id || null,
        linked_page: linkedPage ? { id: linkedPage.id, name: linkedPage.name, hasAccessToken: Boolean(linkedPage.access_token) } : null,
      }));

      // Tenta encontrar o Page Access Token da página ligada ao Instagram
      const igPageToken = linkedPage?.access_token || null;

      // Fallback: usa INSTAGRAM_USER_ID da env se a API não devolveu o ID
      const instagramUserId = igBusinessAccount?.id || fallbackIgAccount?.id || process.env.INSTAGRAM_USER_ID || null;
      if (!igBusinessAccount && !fallbackIgAccount && instagramUserId) {
        console.log('[oauth:instagram] A usar INSTAGRAM_USER_ID da env como fallback:', instagramUserId);
      }

      return {
        accountId: instagramUserId || d.id || null,
        name: igBusinessAccount?.username
          ? `@${igBusinessAccount.username}`
          : fallbackIgAccount?.username
            ? `@${fallbackIgAccount.username}`
            : (d.name || process.env.INSTAGRAM_USERNAME || 'Instagram'),
        email: null,
        picture: igBusinessAccount?.profile_picture_url || fallbackIgAccount?.profile_picture_url || null,
        instagramUserId,
        // Page token nunca expira — preferido para publicar no Instagram
        accessToken: igPageToken || token,
      };
    },
  },
  linkedin: {
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    clientIdEnv: 'LINKEDIN_CLIENT_ID',
    clientSecretEnv: 'LINKEDIN_CLIENT_SECRET',
    longLived: false,
    async getProfile(token) {
      const res = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await res.json();
      const fullName =
        d.name?.trim() ||
        [d.given_name, d.family_name].filter(Boolean).join(' ').trim() ||
        d.email?.split('@')[0] || d.sub || null;
      return {
        accountId: d.sub || d.id || null,
        name: fullName || 'Conta LinkedIn',
        email: d.email || null,
        picture: d.picture || null,
      };
    },
  },
  'linkedin-org': {
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    clientIdEnv: 'LINKEDIN_ORG_CLIENT_ID',
    clientSecretEnv: 'LINKEDIN_ORG_CLIENT_SECRET',
    longLived: false,
    async getProfile(token) {
      // Com Community Management API obtemos as organizações administradas
      const orgRes = await fetch(
        'https://api.linkedin.com/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR',
        { headers: { Authorization: `Bearer ${token}`, 'X-Restli-Protocol-Version': '2.0.0' } }
      );
      const orgData = await orgRes.json().catch(() => ({}));
      console.log('[linkedin-org] organizationAcls:', JSON.stringify(orgData).slice(0, 300));
      const firstOrg = orgData?.elements?.[0];
      const orgUrn = firstOrg?.organization; // ex: "urn:li:organization:12345"
      const orgId = orgUrn?.split(':').pop() || null;
      return {
        accountId: orgUrn || 'linkedin-org-token',
        name: `Org Token (${orgId || 'desconhecido'})`,
        email: null,
        picture: null,
        isOrgToken: true,
        orgUrn,
      };
    },
  },
};

function isConfiguredValue(value) {
  return Boolean(value && !value.includes('coloca_aqui') && !value.includes('coloca-aqui'));
}

export async function GET(request, { params }) {
  const platform = (await params).platform;
  const config = CONFIGS[platform];
  if (!config) return redirect('/social?error=unsupported_platform');

  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const oauthError = searchParams.get('error');

  if (oauthError) return redirect(`/social?error=${encodeURIComponent(oauthError)}`);
  if (!code || !state) return redirect('/social?error=missing_params');

  const stateData = consumeState(state);
  if (!stateData || stateData.platform !== platform) {
    return redirect('/social?error=invalid_state');
  }

  const clientId = process.env[config.clientIdEnv];
  const clientSecret = process.env[config.clientSecretEnv];
  if (!isConfiguredValue(clientId) || !isConfiguredValue(clientSecret)) return redirect('/social?error=not_configured');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://agente-ai-v2.vercel.app';
  const redirectUri = `${appUrl}/api/social/callback/${platform}`;

  try {
    // 1. Troca o código pelo access token
    const tokenBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const tokenHeaders = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
    // LinkedIn requer Basic auth no header para trocar o token
    if (platform === 'linkedin') {
      tokenHeaders['Authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    }

    const tokenRes = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: tokenHeaders,
      body: tokenBody.toString(),
    });

    let tokenData;
    try {
      tokenData = await tokenRes.json();
    } catch (e) {
      console.error(`[oauth:${platform}] Resposta do token não é JSON (status ${tokenRes.status})`);
      return redirect('/social?error=token_exchange_failed');
    }

    let accessToken = tokenData.access_token;
    if (!accessToken) {
      const fbError = tokenData?.error?.message || tokenData?.error_description || JSON.stringify(tokenData);
      console.error(`[oauth:${platform}] Token exchange falhou:`, fbError);
      return redirect(`/social?error=token_exchange_failed&detail=${encodeURIComponent(fbError)}`);
    }

    // 2. Para Meta (Facebook/Instagram): troca por token de longa duração (60 dias)
    //    Os Page Access Tokens obtidos a seguir com este token NUNCA expiram.
    let finalExpiresIn = tokenData.expires_in || null;
    if (config.longLived) {
      const longLived = await exchangeForLongLivedToken(accessToken, clientId, clientSecret);
      accessToken = longLived.token;
      finalExpiresIn = longLived.expiresIn;
    }

    // 3. Vai buscar o perfil (já com o token longo)
    let profile;
    try {
      profile = await config.getProfile(accessToken);
    } catch (e) {
      console.error(`[oauth:${platform}] Falha ao obter perfil:`, e.message);
      return redirect('/social?error=profile_failed');
    }

    // 4. Guarda a conta
    // Para Instagram: usa o page token (nunca expira) guardado em profile.accessToken se disponível
    const tokenToStore = profile.accessToken || accessToken;

    // Recupera companyId do JWT state (fiável) com fallback para cookie legado
    let companyId = stateData.companyId || null;
    let companyName = null;
    if (!companyId) {
      const companyNameCookie = request.cookies.get('pending_company_name')?.value;
      companyName = companyNameCookie ? decodeURIComponent(companyNameCookie) : null;
      if (companyName) {
        companyId = await ensureCompanyExists(companyName, 'oauth');
        console.log(`[oauth:${platform}] Empresa '${companyName}' (cookie) mapeada para ID: ${companyId}`);
      }
    } else {
      // Busca o nome da empresa pelo ID para backward compat
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const adm = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
        const { data: co } = await adm.from('companies').select('name').eq('id', companyId).single();
        companyName = co?.name || null;
      } catch {}
      console.log(`[oauth:${platform}] companyId do state: ${companyId}, nome: ${companyName || 'desconhecido'}`);
    }

    const accountData = {
      platform,
      accountId: profile.accountId || null,
      accessToken: tokenToStore,
      name: profile.name,
      email: profile.email,
      picture: profile.picture,
      pages: profile.pages || [],
      instagramUserId: profile.instagramUserId || null,
      companyId,
      companyName, // backward compat
      expiresAt: (profile.accessToken || !finalExpiresIn)
        ? null
        : new Date(Date.now() + finalExpiresIn * 1000).toISOString(),
    };

    console.log(`[oauth:${platform}] Guardando conta no Supabase:`, {
      name: accountData.name,
      pages: accountData.pages.length,
      pageNames: accountData.pages.map(page => page.name),
      pageTokens: accountData.pages.map(page => ({ name: page.name, hasAccessToken: Boolean(page.accessToken), tasks: page.tasks || [] })),
      instagramUserId: accountData.instagramUserId || 'null',
    });

    await addAccount(accountData);
    console.log(`[oauth:${platform}] ✓ Conta guardada com sucesso no Supabase`);

    return redirect(`/social?connected=${platform}`);
  } catch (err) {
    // IMPORTANT: Next.js redirect() works by throwing a NEXT_REDIRECT error.
    // If redirect() was called inside this try block, re-throw it so Next.js handles it correctly.
    if (err?.digest?.startsWith?.('NEXT_REDIRECT')) throw err;
    console.error(`[oauth:${platform}] Erro inesperado:`, err.message);
    return redirect(`/social?error=connection_failed&detail=${encodeURIComponent(err.message || 'erro desconhecido')}`);
  }
}
