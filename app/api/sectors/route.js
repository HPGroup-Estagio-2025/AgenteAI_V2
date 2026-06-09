import { NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

// Setores predefinidos — usados como seed se a tabela estiver vazia
export const DEFAULT_SECTORS = [
  { id: 'maritimo',       label: 'Marítimo',      keywords: ['maritime', 'naval', 'shipping', 'vessel', 'shipbuilding', 'offshore', 'fleet', 'tanker', 'harbor', 'seaport', 'seafarer', 'nautical', 'marine engineering', 'port authority'] },
  { id: 'defesa-militar', label: 'Defesa Militar', keywords: ['defense', 'defence', 'military', 'armed forces', 'weapon system', 'missile', 'warship', 'combat', 'pentagon', 'nato', 'troops', 'warfare', 'munitions', 'air force', 'army'] },
  { id: 'aeroespacial',   label: 'Aeroespacial',   keywords: ['aerospace', 'aviation', 'aircraft', 'airline', 'satellite', 'rocket launch', 'orbit', 'uav', 'airport', 'spaceflight', 'astronaut', 'spacecraft'] },
  { id: 'ferroviario',    label: 'Ferroviário',    keywords: ['railway', 'railroad', 'rolling stock', 'locomotive', 'tram', 'high-speed rail', 'rail freight', 'metro system'] },
  { id: 'tecnologia',     label: 'Tecnologia',     keywords: ['technology', 'software', 'hardware', 'artificial intelligence', 'digital', 'cybersecurity', 'semiconductor', 'cloud computing', 'robotics', 'startup'] },
  { id: 'fitness',        label: 'Fitness',         keywords: ['fitness', 'workout', 'exercise', 'gym', 'training', 'nutrition', 'health', 'muscle', 'weight loss', 'running', 'yoga', 'crossfit', 'strength', 'cardio'] },
];

function auth(request) {
  const token = getTokenFromRequest(request);
  if (!token) return false;
  try { verifyToken(token); return true; } catch { return false; }
}

export async function GET(request) {
  if (!auth(request)) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  try {
    const { data, error } = await supabaseAdmin
      .from('news_sectors')
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: true });

    if (error?.code === '42P01') {
      // Tabela não existe ainda — devolve os predefinidos
      return NextResponse.json({ sectors: DEFAULT_SECTORS, isDefault: true });
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const sectors = data?.length ? data : DEFAULT_SECTORS;
    return NextResponse.json({ sectors });
  } catch {
    return NextResponse.json({ sectors: DEFAULT_SECTORS, isDefault: true });
  }
}

export async function POST(request) {
  if (!auth(request)) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  const { label, keywords } = await request.json().catch(() => ({}));
  if (!label?.trim()) return NextResponse.json({ error: 'Nome do setor obrigatório' }, { status: 400 });

  const id = label.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const { data, error } = await supabaseAdmin
    .from('news_sectors')
    .insert([{
      id,
      label: label.trim(),
      keywords: Array.isArray(keywords) ? keywords : [],
      active: true,
      created_at: new Date().toISOString(),
    }])
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sector: data });
}

export async function DELETE(request) {
  if (!auth(request)) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  const { id } = await request.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });

  const defaultIds = DEFAULT_SECTORS.map(s => s.id);
  if (defaultIds.includes(id)) return NextResponse.json({ error: 'Não é possível remover setores predefinidos' }, { status: 400 });

  const { error } = await supabaseAdmin.from('news_sectors').update({ active: false }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
