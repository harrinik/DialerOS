import { NextResponse, type NextRequest } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, extname } from 'path';
import { tmpdir } from 'os'; // cross-platform temp dir
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { connectDb } from '@/lib/db/connection';
import { AudioFile } from '@/lib/db/models/AudioFile';
import { AsteriskSettings } from '@/lib/db/models/AsteriskSettings';
import { withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);

async function convertToAsteriskWav(inputPath: string, outputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let durationSecs = 0;
    ffmpeg(inputPath)
      .audioFrequency(8000)
      .audioChannels(1)
      .audioBitrate('64k')
      .audioCodec('pcm_s16le')
      .format('wav')
      .on('codecData', (d: { duration?: string }) => {
        // Parse "HH:MM:SS.ms" → seconds
        const parts = (d.duration ?? '0').split(':').map(Number);
        durationSecs = (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
      })
      .on('end', () => resolve(durationSecs))
      .on('error', (err: Error) => reject(err))
      .save(outputPath);
  });
}

export const GET = withUser(async (_req: NextRequest, _user: JwtPayload) => {
  await connectDb();
  const files = await AudioFile.find({}).sort({ createdAt: -1 }).lean();
  return NextResponse.json({ data: files });
});

export const POST = withUser(async (req: NextRequest, user: JwtPayload) => {
  await connectDb();
  const s = await AsteriskSettings.findOne({}).lean();
  if (!s) return NextResponse.json({ error: 'Asterisk not configured. Go to Asterisk → Connection Hub first.' }, { status: 400 });

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const name = (formData.get('name') as string | null)?.trim();
  const category = (formData.get('category') as string | null) ?? 'ivr';

  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });
  if (!name)  return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const ext = extname(file.name) || '.wav';
  const safeName = name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const relPath = `${category}/${safeName}`;
  const outDir  = join(s.soundsDir, category);
  const outPath = join(s.soundsDir, category, `${safeName}.wav`);
  const tmpPath = join(tmpdir(), `dialer_upload_${Date.now()}${ext}`); // cross-platform

  // Write original upload to tmp
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(tmpPath, buf);

  // Ensure output dir exists on the Asterisk sounds path
  if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });

  // Convert to Asterisk-compatible WAV (8kHz, 16-bit, mono)
  let durationSecs = 0;
  try {
    durationSecs = await convertToAsteriskWav(tmpPath, outPath);
  } catch (err) {
    return NextResponse.json({ error: `Audio conversion failed: ${String(err)}` }, { status: 500 });
  }

  // Upsert DB record
  const existing = await AudioFile.findOne({ asteriskPath: relPath });
  if (existing) {
    existing.originalName = file.name;
    existing.durationSecs = durationSecs;
    existing.sizeBytes = buf.length;
    await existing.save();
    return NextResponse.json({ data: existing });
  }

  const doc = await AudioFile.create({
    name: safeName,
    originalName: file.name,
    category,
    asteriskPath: relPath,
    diskPath: outPath,
    durationSecs,
    sizeBytes: buf.length,
    uploadedBy: user.sub,
  });

  return NextResponse.json({ data: doc }, { status: 201 });
});
