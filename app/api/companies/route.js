import { NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { createCompany, listCompanies } from '@/src/lib/companies';

export async function GET(request) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  let user;
  try { user = verifyToken(token); } catch {
    return NextResponse.json({ error: 'Token inválido ou expirado' }, { status: 403 });
  }

  try {
    const companies = await listCompanies();
    return NextResponse.json({ companies }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (err) {
    console.error('[companies] GET error:', err.message);
    return NextResponse.json({ error: 'Erro ao listar empresas' }, { status: 500 });
  }
}

export async function POST(request) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  let user;
  try { user = verifyToken(token); } catch {
    return NextResponse.json({ error: 'Token inválido ou expirado' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));

  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return NextResponse.json({ error: 'Nome da empresa é obrigatório' }, { status: 400 });
  }

  try {
    const company = await createCompany(body.name, user.username);
    return NextResponse.json(company, { status: 201 });
  } catch (err) {
    if (err.code === 'duplicate') {
      return NextResponse.json({ error: `Empresa '${body.name}' já existe` }, { status: 409 });
    }
    if (err.code === 'invalid_name') {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[companies] POST error:', err.message);
    return NextResponse.json({ error: 'Erro ao criar empresa' }, { status: 500 });
  }
}
