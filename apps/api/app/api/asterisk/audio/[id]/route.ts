import { NextResponse, type NextRequest } from 'next/server';
import { unlink } from 'fs/promises';
import { createReadStream, statSync } from 'fs';
import { connectDb } from '@/lib/db/connection';
import { AudioFile } from '@/lib/db/models/AudioFile';
import { withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

type Params = { params: { id: string } };

export const DELETE = withUser(async (_req: NextRequest, _user: JwtPayload, { params }: Params) => {
  await connectDb();
  const doc = await AudioFile.findById(params.id);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try { await unlink(doc.diskPath); } catch { /* file already gone */ }
  await doc.deleteOne();
  return NextResponse.json({ ok: true });
});

export const GET = withUser(async (_req: NextRequest, _user: JwtPayload, { params }: Params) => {
  await connectDb();
  const doc = await AudioFile.findById(params.id).lean();
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ data: doc });
});
