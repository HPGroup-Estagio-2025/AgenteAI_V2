import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { createState, supabaseAdmin, SOCIAL_TABLE, addAccount } from '@/src/lib/social';

const CONFIGS = {
  facebook: {
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    scope: 'pages_show_list,pages_manage_posts,pages_read_engagement,pages_manage_metadata',
    clientIdEnv: 'FACEBOOK_APP_ID',
},
  instagram: {
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    scope: 'pages_show_list,pages_read_engagement,instagram_basic,instagram_content_publish',
    clientIdEnv: 'FACEBOOK_APP_ID',
  },
  linkedin: {
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    scope: 'openid profile email w_member_social w_organization_social',
    clientIdEnv: 'LINKEDIN_CLIENT_ID',
  },
};

function isConfiguredValue(value) {
  return Boolean(value && !value.includes('coloca_aqui') && !value.includes('coloca-aqui'));
}

export async function GET(request, { params }) {
  const token = getTokenFromRequest(request);
  try { if (!token) throw new Error(); verifyToken(token); } catch {
    return Response.json({ error: 'Nao autenticado' }, { status: 401 });
  }

  const platform = (await params).platform;
  const config = CONFIGS[platform];
  if (!config) return Response.json({ error: 'Plataforma nao suportada' }, { status: 400 });

  const clientId = process.env[config.clientIdEnv];
  if (!isConfiguredValue(clientId)) {
    return Response.json({ error: `${config.clientIdEnv} nao configurado no .env` }, { status: 503 });
  }

  const searchParamsObj = new URL(request.url).searchParams;
  const companyId = searchParamsObj.get('companyId') || null;
  const fresh = searchParamsObj.get('fresh') === 'true';

  // Se já existe uma conta desta plataforma com token válido E não é fresh OAuth,
  // copia para a nova empresa em vez de fazer OAuth de novo (evita o erro "An unexpected error" do Facebook).
  if (!fresh && companyId && supabaseAdmin && (platform === 'facebook' || platform === 'instagram')) {
    const { data: existing } = await supabaseAdmin
      .from(SOCIAL_TABLE)
      .select('*')
      .eq('platform', platform)
      .not('access_token', 'is', null)
      .order('connected_at', { ascending: false })
      .limit(1);
    const src = existing?.[0];
    if (src && src.company_id !== companyId) {
      // Tenta refrescar as páginas com o token existente para incluir todas as páginas do utilizador
      let freshPages = Array.isArray(src.pages) ? src.pages : [];
      if (src.access_token && platform === 'facebook') {
        try {
          const pagesRes = await fetch(
            `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,tasks,picture.width(200)&access_token=${encodeURIComponent(src.access_token)}`
          );
          const pagesData = await pagesRes.json().catch(() => ({}));
          if (pagesRes.ok && Array.isArray(pagesData.data) && pagesData.data.length > 0) {
            freshPages = pagesData.data.map(p => ({
              id: p.id, name: p.name, accessToken: p.access_token, tasks: p.tasks || [], picture: p.picture?.data?.url || null,
            }));
          }
        } catch {}
      }
      // Cria novo registo para esta empresa com os tokens já existentes
      await addAccount({
        platform: src.platform,
        accountId: src.account_id,
        accessToken: src.access_token,
        name: src.name,
        email: src.email,
        picture: src.picture,
        pages: freshPages,
        instagramUserId: src.instagram_user_id || null,
        companyId,
        expiresAt: src.expires_at || null,
      });
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://agente-ai-v2.vercel.app';
      return Response.json({ url: `${appUrl}/social?connected=${platform}` });
    }
  }

  const state = createState(platform, companyId);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://agente-ai-v2.vercel.app';
  const redirectUri = `${appUrl}/api/social/callback/${platform}`;

  const url = new URL(config.authUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  // prompt: 'login' removido — conflito com w_organization_social no LinkedIn OAuth

  return Response.json({ url: url.toString() });
}
