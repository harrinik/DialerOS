import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { Campaign } from '@/lib/db/models/Campaign';
import { Contact } from '@/lib/db/models/Contact';
import { DncList } from '@/lib/db/models/DncList';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { withAuth } from '@/lib/auth/rbac';
import { enqueuePendingCampaignContacts } from '@/lib/campaigns/enqueue-pending-contacts';
import { CreateCampaignSchema, PaginationSchema, parsePastedPhoneInput } from '@dialer/shared';
import { createHash } from 'node:crypto';
import type { JwtPayload } from '@/lib/auth/jwt';
import { z } from 'zod';

const CreateCampaignRequestSchema = CreateCampaignSchema.extend({
  numbersText: z.string().optional(),
  launchMode: z.enum(['campaign', 'dial_now']).default('campaign'),
});

type PreparedContacts = {
  contacts: Array<{
    phone: string;
    firstName: string;
    lastName: string;
    status: 'pending';
    customFields: Record<string, never>;
  }>;
  stats: {
    provided: boolean;
    submitted: number;
    valid: number;
    invalid: number;
    duplicates: number;
    dnc: number;
    inserted: number;
  };
};

async function preparePastedContacts(numbersText?: string): Promise<PreparedContacts> {
  const raw = numbersText?.trim() ?? '';
  if (!raw) {
    return {
      contacts: [],
      stats: { provided: false, submitted: 0, valid: 0, invalid: 0, duplicates: 0, dnc: 0, inserted: 0 },
    };
  }

  const parsed = parsePastedPhoneInput(raw);

  const dncHashes = new Set(
    (await DncList.find({}).select('phoneHash').lean()).map((entry) => entry.phoneHash),
  );

  let dnc = 0;
  const contacts = parsed.valid.flatMap((phone) => {
    const phoneHash = createHash('sha256').update(phone).digest('hex');
    if (dncHashes.has(phoneHash)) {
      dnc += 1;
      return [];
    }
    return [{
      phone,
      firstName: 'Imported',
      lastName: 'Contact',
      status: 'pending' as const,
      customFields: {},
    }];
  });

  return {
    contacts,
    stats: {
      provided: true,
      submitted: parsed.valid.length + parsed.invalid.length + parsed.duplicates.length,
      valid: parsed.valid.length,
      invalid: parsed.invalid.length,
      duplicates: parsed.duplicates.length,
      dnc,
      inserted: contacts.length,
    },
  };
}

// GET /api/campaigns — list campaigns for the authenticated user
export const GET = withAuth(async (req: NextRequest, user: JwtPayload) => {
  try {
    await connectDb();

    const { searchParams } = new URL(req.url);
    const pagination = PaginationSchema.parse({
      page: searchParams.get('page'),
      limit: searchParams.get('limit'),
      sortBy: searchParams.get('sortBy') ?? 'createdAt',
      sortOrder: searchParams.get('sortOrder') ?? 'desc',
    });

    const filter = user.role === 'admin' ? {} : { ownerId: user.sub };
    const status = searchParams.get('status');
    if (status) Object.assign(filter, { status });

    const skip = (pagination.page - 1) * pagination.limit;
    const sortField = pagination.sortBy ?? 'createdAt';
    const sortDir = pagination.sortOrder === 'asc' ? 1 : -1;

    const [campaigns, total] = await Promise.all([
      Campaign.find(filter)
        .sort({ [sortField]: sortDir })
        .skip(skip)
        .limit(pagination.limit)
        .lean(),
      Campaign.countDocuments(filter),
    ]);

    return NextResponse.json({
      data: campaigns,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});

// POST /api/campaigns — create a new campaign
export const POST = withAuth(
  async (req: NextRequest, user: JwtPayload) => {
    try {
      await connectDb();

      const body = await req.json() as unknown;
      const parsed = CreateCampaignRequestSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: parsed.error.flatten() },
          { status: 400 },
        );
      }

      const { numbersText, launchMode, ...campaignInput } = parsed.data;
      const preparedContacts = await preparePastedContacts(numbersText);

      if (preparedContacts.stats.provided && preparedContacts.stats.valid === 0) {
        return NextResponse.json(
          {
            error: 'No valid phone numbers found. Paste one number per line or comma-separated, for example +12125550100.',
            details: preparedContacts.stats,
          },
          { status: 400 },
        );
      }

      if (launchMode === 'dial_now') {
        if (preparedContacts.contacts.length !== 1) {
          return NextResponse.json(
            {
              error: 'Dial now requires exactly one valid phone number.',
              details: preparedContacts.stats,
            },
            { status: 400 },
          );
        }
      } else if (preparedContacts.stats.provided && preparedContacts.contacts.length === 0) {
        return NextResponse.json(
          {
            error: 'No dialable numbers were found in the pasted input.',
            details: preparedContacts.stats,
          },
          { status: 400 },
        );
      }

      const generatedName =
        launchMode === 'dial_now' && !campaignInput.name.trim()
          ? `Quick Dial ${preparedContacts.contacts[0]?.phone ?? new Date().toISOString()}`
          : campaignInput.name;

      const campaign = await Campaign.create({
        ...campaignInput,
        name: generatedName,
        ownerId: user.sub,
        status: launchMode === 'dial_now' ? 'running' : 'draft',
        stats: {
          totalContacts: preparedContacts.contacts.length,
        },
      });

      if (preparedContacts.contacts.length > 0) {
        await Contact.insertMany(
          preparedContacts.contacts.map((contact) => ({
            ...contact,
            campaignId: campaign._id,
          })),
        );
      }

      let contactsEnqueued = 0;
      if (launchMode === 'dial_now') {
        contactsEnqueued = await enqueuePendingCampaignContacts(campaign);
      }

      await AuditLog.create({
        userId: user.sub,
        action: 'campaign.create',
        resource: 'Campaign',
        resourceId: String(campaign._id),
        metadata: {
          launchMode,
          contactsImported: preparedContacts.stats.inserted,
          contactsEnqueued,
        },
        ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
      });

      return NextResponse.json({
        data: campaign,
        importStats: preparedContacts.stats,
        contactsEnqueued,
      }, { status: 201 });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  },
  ['admin', 'user'],
);
