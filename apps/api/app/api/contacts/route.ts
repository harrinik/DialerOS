import { NextResponse, type NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectDb } from '@/lib/db/connection';
import { Contact } from '@/lib/db/models/Contact';
import { withAuth } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

/**
 * GET /api/contacts
 * Supports filtering by campaignId, status, and free-text search (q).
 * Paginated via page and limit query params.
 */
export const GET = withAuth(async (req: NextRequest, user: JwtPayload) => {
  await connectDb();
  const { searchParams } = new URL(req.url);

  const filter: Record<string, unknown> = {};

  // Non-admins can only see contacts in their own campaigns — enforce later
  // via campaign ownership check if needed. For now allow any authenticated user.

  const campaignId = searchParams.get('campaignId');
  if (campaignId) {
    try {
      filter['campaignId'] = new mongoose.Types.ObjectId(campaignId);
    } catch {
      return NextResponse.json({ error: 'Invalid campaignId' }, { status: 400 });
    }
  }

  const status = searchParams.get('status');
  if (status) filter['status'] = status;

  const q = searchParams.get('q');
  if (q) {
    filter['$or'] = [
      { phone: { $regex: q, $options: 'i' } },
      { firstName: { $regex: q, $options: 'i' } },
      { lastName: { $regex: q, $options: 'i' } },
    ];
  }

  const page  = Math.max(1, Number(searchParams.get('page')  ?? 1));
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 200);
  const skip  = (page - 1) * limit;

  const [data, total] = await Promise.all([
    Contact.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Contact.countDocuments(filter),
  ]);

  return NextResponse.json({ data, total, page, limit });
});
