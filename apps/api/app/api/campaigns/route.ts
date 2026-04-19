import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { Campaign } from '@/lib/db/models/Campaign';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { withAuth } from '@/lib/auth/rbac';
import { CreateCampaignSchema, PaginationSchema } from '@dialer/shared';
import type { JwtPayload } from '@/lib/auth/jwt';

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
      const parsed = CreateCampaignSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: parsed.error.flatten() },
          { status: 400 },
        );
      }

      const campaign = await Campaign.create({
        ...parsed.data,
        ownerId: user.sub,
        status: 'draft',
      });

      await AuditLog.create({
        userId: user.sub,
        action: 'campaign.create',
        resource: 'Campaign',
        resourceId: String(campaign._id),
        ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
      });

      return NextResponse.json({ data: campaign }, { status: 201 });
    } catch (err) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
  ['admin', 'user'],
);
