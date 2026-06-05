import { NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

async function fetchLinkedInName(token) {
  try {
    const [userRes, meRes] = await Promise.all([
      fetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('https://api.linkedin.com/v2/me?projection=(id,localizedFirstName,localizedLastName)', { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const d = await userRes.json().catch(() => ({}));
    const me = await meRes.json().catch(() => ({}));

    return d.name?.trim()
      || [d.given_name, d.family_name].filter(Boolean).join(' ').trim()
      || [me.localizedFirstName, me.localizedLastName].filter(Boolean).join(' ').trim()
      || d.email?.split('@')[0]
      || null;
  } catch { return null; }
}

export async function POST(request) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  try { verifyToken(token); } catch {
    return NextResponse.json({ error: 'Token inválido' }, { status: 403 });
  }

  // Busca todas as contas LinkedIn com nome genérico
  const { data: accounts } = await supabaseAdmin
    .from('social_accounts')
    .select('id, name, access_token')
    .eq('platform', 'linkedin')
    .or('name.eq.LinkedIn User,name.eq.Conta LinkedIn,name.is.null');

  if (!accounts?.length) return NextResponse.json({ updated: 0, message: 'Nenhuma conta a corrigir' });

  let updated = 0;
  for (const acc of accounts) {
    const name = await fetchLinkedInName(acc.access_token);
    if (name && name !== acc.name) {
      await supabaseAdmin.from('social_accounts').update({ name }).eq('id', acc.id);
      updated++;
    }
  }

  return NextResponse.json({ updated, total: accounts.length });
}
