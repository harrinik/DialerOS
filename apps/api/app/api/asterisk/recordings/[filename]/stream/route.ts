import { type NextRequest } from 'next/server';
import { createReadStream, statSync } from 'fs';
import { join } from 'path';
import { connectDb } from '@/lib/db/connection';
import { AsteriskSettings } from '@/lib/db/models/AsteriskSettings';
import { verifyAccessToken, extractBearerToken } from '@/lib/auth/jwt';

type Params = { params: { filename: string } };

export async function GET(req: NextRequest, { params }: Params) {
  const token = extractBearerToken(req.headers.get('authorization'));
  if (!token) return new Response('Unauthorized', { status: 401 });
  try { verifyAccessToken(token); } catch { return new Response('Invalid token', { status: 401 }); }

  await connectDb();
  const s = await AsteriskSettings.findOne({}).lean();
  if (!s) return new Response('Asterisk not configured', { status: 400 });

  const filename = decodeURIComponent(params.filename);
  const filePath = join(s.recordingsDir, filename);

  let stat;
  try { stat = statSync(filePath); } catch { return new Response('File not found', { status: 404 }); }

  const total = stat.size;
  const range = req.headers.get('range');

  const ext = filename.split('.').pop()?.toLowerCase();
  const mime = ext === 'mp3' ? 'audio/mpeg' : ext === 'ogg' ? 'audio/ogg' : 'audio/wav';

  if (range) {
    const [startStr, endStr] = range.replace('bytes=', '').split('-');
    const start = parseInt(startStr ?? '0', 10);
    const end = endStr ? parseInt(endStr, 10) : total - 1;
    const stream = createReadStream(filePath, { start, end });
    return new Response(stream as unknown as ReadableStream, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        'Content-Type': mime,
      },
    });
  }

  const stream = createReadStream(filePath);
  return new Response(stream as unknown as ReadableStream, {
    headers: { 'Content-Type': mime, 'Content-Length': String(total), 'Accept-Ranges': 'bytes' },
  });
}
