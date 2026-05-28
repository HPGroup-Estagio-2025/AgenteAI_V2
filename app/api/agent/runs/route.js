import { NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { supabase } from '@/src/lib/supabase';

const AGENT_RUNS_TABLE = process.env.SUPABASE_AGENT_RUNS_TABLE || 'agent_runs';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  try {
    verifyToken(token);
  } catch {
    return NextResponse.json({ error: 'Token inválido ou expirado' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from(AGENT_RUNS_TABLE)
    .select('*')
    .order('started_at', { ascending: false })
    .limit(10);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ runs: data || [] });
}
