import { NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

function auth(request) {
  const token = getTokenFromRequest(request);
  if (!token) return false;
  try { verifyToken(token); return true; } catch { return false; }
}

export async function GET(request) {
  if (!auth(request)) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  const { data, error } = await supabaseAdmin
    .from('news_sources')
    .select('*')
    .order('priority', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sources: data || [] });
}

export async function POST(request) {
  if (!auth(request)) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const { url, name, sector } = body;
  if (!url || !sector) return NextResponse.json({ error: 'URL e setor são obrigatórios' }, { status: 400 });

  // Nova fonte vai para o fim da fila (priority = max + 1)
  const { data: existing } = await supabaseAdmin
    .from('news_sources')
    .select('priority')
    .order('priority', { ascending: false })
    .limit(1);
  const nextPriority = ((existing?.[0]?.priority) ?? 0) + 1;

  const { data, error } = await supabaseAdmin
    .from('news_sources')
    .insert([{ id: crypto.randomUUID(), url, name: name || url, sector, active: true, priority: nextPriority, created_at: new Date().toISOString() }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ source: data });
}

export async function PATCH(request) {
  if (!auth(request)) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  const { updates } = await request.json().catch(() => ({}));
  if (!Array.isArray(updates)) return NextResponse.json({ error: 'updates obrigatório' }, { status: 400 });

  // Actualiza priority de cada source em paralelo
  const results = await Promise.all(
    updates.map(({ id, priority }) =>
      supabaseAdmin.from('news_sources').update({ priority }).eq('id', id)
    )
  );
  const failed = results.find(r => r.error);
  if (failed) return NextResponse.json({ error: failed.error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(request) {
  if (!auth(request)) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  const { id } = await request.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });
  const { error } = await supabaseAdmin.from('news_sources').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
