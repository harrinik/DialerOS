import { type NextRequest } from 'next/server';
import { createReadStream, statSync } from 'fs';
import { connectDb } from '@/lib/db/connection';
import { AudioFile } from '@/lib/db/models/AudioFile';

type Params = { params: { id: string } };

// Stream audio for browser playback — no auth required so <audio src> tag works
export async function GET(req: NextRequest, { params }: Params) {
  await connectDb();
  const doc = await AudioFile.findById(params.id).lean();
  if (!doc) return new Response('Not found', { status: 404 });

  let stat;
  try { stat = statSync(doc.diskPath); } catch { return new Response('File not found on disk', { status: 404 }); }

  const range = req.headers.get('range');
  const total = stat.size;

  if (range) {
    const parts = range.replace('bytes=', '').split('-');
    const start = parseInt(parts[0] ?? '0', 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
    const chunkSize = end - start + 1;
    const stream = createReadStream(doc.diskPath, { start, end });
    return new Response(stream as unknown as ReadableStream, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Content-Type': 'audio/wav',
      },
    });
  }

  const stream = createReadStream(doc.diskPath);
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': String(total),
      'Accept-Ranges': 'bytes',
    },
  });
}
