import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { createState } from '@/src/lib/social';

const CONFIGS = {
  facebook: {
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    scope: 'pages_show_list,pages_manage_posts,pages_read_engagement,pages_manage_metadata',
    clientIdEnv: 'FACEBOOK_APP_ID',
},
  instagram: {
  authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
  scope: 'pages_show_list',
  clientIdEnv: 'FACEBOOK_APP_ID',
},
  linkedin: {
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    scope: 'w_member_social r_liteprofile r_emailaddress',
    clientIdEnv: 'LINKEDIN_CLIENT_ID',
  },
};

function isConfiguredValue(value) {
  return Boolean(value && !value.includes('coloca_aqui') && !value.includes('coloca-aqui'));
}

export async function GET(request, { params }) {
  const token = getTokenFromRequest(request);
  if (!token || !verifyToken(token)) {
    return Response.json({ error: 'Nao autenticado' }, { status: 401 });
  }

  const platform = (await params).platform;
  const config = CONFIGS[platform];
  if (!config) return Response.json({ error: 'Plataforma nao suportada' }, { status: 400 });

  const clientId = process.env[config.clientIdEnv];
  if (!isConfiguredValue(clientId)) {
    return Response.json({ error: `${config.clientIdEnv} nao configurado no .env` }, { status: 503 });
  }

  const state = createState(platform);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const redirectUri = `${appUrl}/api/social/callback/${platform}`;

  const url = new URL(config.authUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');

  return Response.json({ url: url.toString() });
}
