import { NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { deleteCompany } from '@/src/lib/companies';

export async function DELETE(request, { params }) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  let user;
  try { user = verifyToken(token); } catch {
    return NextResponse.json({ error: 'Token inválido ou expirado' }, { status: 403 });
  }

  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: 'ID da empresa é obrigatório' }, { status: 400 });
  }

  try {
    const result = await deleteCompany(id);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err.code === 'not_found') {
      return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 404 });
    }
    if (err.code === 'already_deleted') {
      return NextResponse.json({ error: 'Empresa já foi apagada' }, { status: 409 });
    }
    console.error('[companies] DELETE error:', err.message);
    return NextResponse.json({ error: 'Erro ao apagar empresa' }, { status: 500 });
  }
}
