import { NextResponse, type NextRequest } from 'next/server';
import { Readable } from 'node:stream';
import { parse } from 'fast-csv';
import { connectDb } from '@/lib/db/connection';
import { Contact } from '@/lib/db/models/Contact';
import { Campaign } from '@/lib/db/models/Campaign';
import { DncList } from '@/lib/db/models/DncList';
import { withUser } from '@/lib/auth/rbac';
import { createHash } from 'node:crypto';
import type { JwtPayload } from '@/lib/auth/jwt';

/**
 * POST /api/contacts/upload
 * Accepts a multipart form with:
 *   - campaignId: string
 *   - file: CSV file (required columns: phone, firstName, lastName)
 */
export const POST = withUser(
  async (req: NextRequest, user: JwtPayload) => {
    await connectDb();

    const formData = await req.formData();
    const campaignId = formData.get('campaignId') as string;
    const file = formData.get('file') as File | null;

    if (!campaignId || !file) {
      return NextResponse.json(
        { error: 'campaignId and file are required' },
        { status: 400 },
      );
    }

    // Verify campaign exists and belongs to user
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    if (user.role !== 'admin' && String(campaign.ownerId) !== user.sub) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Load DNC hashes for deduplication
    const dncHashes = new Set(
      (await DncList.find({}).select('phoneHash').lean()).map((d) => d.phoneHash),
    );

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const readable = Readable.from(fileBuffer);

    const rows: Array<{
      phone: string;
      firstName: string;
      lastName: string;
      email?: string;
      [key: string]: string | undefined;
    }> = [];

    await new Promise<void>((resolve, reject) => {
      readable
        .pipe(parse({ headers: true, trim: true }))
        .on('data', (row: Record<string, string>) => {
          // Skip rows where every value is blank (fast-csv v5 has no skipEmptyRows option)
          const isEmpty = Object.values(row).every((v) => !v || !v.trim());
          if (!isEmpty && row['phone']) rows.push(row as typeof rows[number]);
        })
        .on('end', resolve)
        .on('error', reject);
    });

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No valid rows found in CSV' }, { status: 400 });
    }

    // Deduplicate by phone within this batch
    const seenPhones = new Set<string>();
    const validRows = rows.filter((r) => {
      const normalized = r.phone.trim().replace(/\s+/g, '');
      if (seenPhones.has(normalized)) return false;
      seenPhones.add(normalized);
      return true;
    });

    // Separate DNC from valid
    let dncCount = 0;
    const contactsToInsert = [];

    for (const row of validRows) {
      const { phone, firstName, lastName, email, ...rest } = row;
      const phoneHash = createHash('sha256').update(phone.trim()).digest('hex');

      if (dncHashes.has(phoneHash)) {
        dncCount++;
        continue;
      }

      // Extract known columns, put rest into customFields
      contactsToInsert.push({
        campaignId,
        phone: phone.trim(),
        firstName: firstName ?? '',
        lastName: lastName ?? '',
        email: email || undefined,
        customFields: rest,
        status: 'pending',
      });
    }

    // Bulk upsert — ignore duplicates (same phone+campaign)
    let inserted = 0;
    let duplicates = 0;

    if (contactsToInsert.length > 0) {
      const result = await Contact.insertMany(contactsToInsert, {
        ordered: false,
        rawResult: true,
      }).catch((err: { insertedDocs?: unknown[]; writeErrors?: unknown[] }) => {
        // Partial success — some may be duplicate key errors
        return {
          insertedCount: err.insertedDocs?.length ?? 0,
          hasErrors: true,
          errorCount: err.writeErrors?.length ?? 0,
        };
      });

      inserted = (result as { insertedCount?: number }).insertedCount ?? contactsToInsert.length;
      duplicates = contactsToInsert.length - inserted;
    }

    // Update campaign contact count
    await Campaign.updateOne(
      { _id: campaignId },
      { $inc: { 'stats.totalContacts': inserted } },
    );

    return NextResponse.json({
      message: 'Upload complete',
      stats: {
        total: rows.length,
        inserted,
        duplicates,
        dnc: dncCount,
        invalid: rows.length - validRows.length,
      },
    });
  },
);
