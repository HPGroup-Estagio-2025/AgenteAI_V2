import { redirect } from 'next/navigation';
import { consumeState, addAccount } from '@/src/lib/social';

const CONFIGS = {
  facebook: {
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    clientIdEnv: 'FACEBOOK_APP_ID',
    clientSecretEnv: 'FACEBOOK_APP_SECRET',
    async getProfile(token) {
      const [profileRes, pagesRes] = await Promise.all([
        fetch(`https://graph.facebook.com/me?fields=id,name,email,picture.width(200)&access_token=${token}`),
        fetch(`https://graph.facebook.com/me/accounts?fields=id,name,access_token,picture.width(200)&access_token=${token}`),
      ]);
      const d = await profileRes.json();
      const pages = await pagesRes.json();
      return {
        name: d.name,
        email: d.email,
        picture: d.picture?.data?.url || null,
        pages: Array.isArray(pages.data) ? pages.data.map(page => ({
          id: page.id,
          name: page.name,
          accessToken: page.access_token,
          picture: page.picture?.data?.url || null,
        })) : [],
      };
    },
  },
  instagram: {
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    clientIdEnv: 'FACEBOOK_APP_ID',
    clientSecretEnv: 'FACEBOOK_APP_SECRET',
    async getProfile(token) {
      // Get connected Instagram accounts via Facebook
      const res = await fetch(
        `https://graph.facebook.com/me?fields=id,name,instagram_accounts{name,username,profile_picture_url}&access_token=${token}`
      );
      const d = await res.json();
      const igAccount = d.instagram_accounts?.data?.[0];
      return {
        name: igAccount ? `@${igAccount.username}` : d.name,
        email: null,
        picture: igAccount?.profile_picture_url || null,
      };
    },
  },
  linkedin: {
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    clientIdEnv: 'LINKEDIN_CLIENT_ID',
    clientSecretEnv: 'LINKEDIN_CLIENT_SECRET',
    async getProfile(token) {
      const res = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await res.json();
      return { name: d.name || `${d.given_name} ${d.family_name}`, email: d.email || null, picture: d.picture || null };
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
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

    const tokenRes = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: tokenBody.toString(),
    });

    let tokenData;
    try {
      tokenData = await tokenRes.json();
    } catch (e) {
      console.error(`[oauth:${platform}] Resposta do token não é JSON (status ${tokenRes.status})`);
      return redirect('/social?error=token_exchange_failed');
    }

    const accessToken = tokenData.access_token;
    if (!accessToken) {
      console.error(`[oauth:${platform}] Token exchange falhou:`, JSON.stringify(tokenData));
      return redirect('/social?error=token_exchange_failed');
    }

    // 2. Vai buscar o perfil
    let profile;
    try {
      profile = await config.getProfile(accessToken);
    } catch (e) {
      console.error(`[oauth:${platform}] Falha ao obter perfil:`, e.message);
      return redirect('/social?error=profile_failed');
    }

    // 3. Guarda a conta
    addAccount({
      platform,
      accessToken,
      name: profile.name,
      email: profile.email,
      picture: profile.picture,
      pages: profile.pages || [],
      expiresAt: tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : null,
    });

    return redirect(`/social?connected=${platform}`);
  } catch (err) {
    console.error(`[oauth:${platform}] Erro inesperado:`, err.message);
    return redirect('/social?error=connection_failed');
  }
}
