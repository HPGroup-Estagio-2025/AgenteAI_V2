import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ error: 'TOTP não configurado' }, { status: 404 });
}
