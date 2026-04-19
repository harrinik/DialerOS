import { NextResponse, type NextRequest } from 'next/server';
import { readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { connectDb } from '@/lib/db/connection';
import { AsteriskSettings } from '@/lib/db/models/AsteriskSettings';
import { CallLog } from '@/lib/db/models/CallLog';
import { withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

export interface RecordingEntry {
  filename: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
  /** Linked call log ID if matched by filename prefix */
  callLogId?: string;
  callerId?: string;
  duration?: number;
}

export const GET = withUser(async (_req: NextRequest, _user: JwtPayload) => {
  await connectDb();
  const s = await AsteriskSettings.findOne({}).lean();
  if (!s) return NextResponse.json({ error: 'Asterisk not configured' }, { status: 400 });

  let files: RecordingEntry[] = [];
  try {
    const entries = readdirSync(s.recordingsDir);
    files = entries
      .filter(e => ['.wav', '.mp3', '.ogg', '.gsm'].includes(extname(e).toLowerCase()))
      .map(filename => {
        const fullPath = join(s.recordingsDir, filename);
        const stat = statSync(fullPath);
        return {
          filename,
          path: fullPath,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
  } catch {
    return NextResponse.json({ error: `Cannot read recordings directory: ${s.recordingsDir}` }, { status: 500 });
  }

  // Try to match filenames to call logs by asteriskCallerId embedded in the filename
  const callLogs = await CallLog.find({}).select('_id asteriskCallerId channelId startTime').lean().limit(500);
  const enriched = files.map(f => {
    const matched = callLogs.find(l =>
      l.asteriskCallerId && f.filename.includes(l.asteriskCallerId.replace(/\D/g, '')),
    );
    return {
      ...f,
      ...(matched ? { callLogId: matched._id.toString(), callerId: matched.asteriskCallerId } : {}),
    };
  });

  return NextResponse.json({ data: enriched, directory: s.recordingsDir });
});
