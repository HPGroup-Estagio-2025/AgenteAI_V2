import { NextResponse } from 'next/server';
import { getStore } from '@/src/lib/store';

export function GET() {
  return NextResponse.json({
    status: 'ok',
    newsInMemory: getStore().length,
    uptime: process.uptime(),
  });
}
