import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { IvrFlow } from '@/lib/db/models/IvrFlow';
import { Campaign } from '@/lib/db/models/Campaign';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

type RouteParams = { params: { id: string } };

/**
 * POST /api/ivr-flows/:id/deploy
 *
 * "Deploys" an IVR flow by:
 * 1. Marking it as deployed in MongoDB (isDeployed = true)
 * 2. Pushing relevant metadata to Asterisk via ARI channel variable
 *    (sets the flow ID as a global variable so channels can reference it)
 * 3. Linking the flow to its campaign
 */
export const POST = withUser(
  async (req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
    await connectDb();

    const flow = await IvrFlow.findById(params.id);
    if (!flow) return NextResponse.json({ error: 'Flow not found' }, { status: 404 });

    const campaign = await Campaign.findById(flow.campaignId);
    if (!campaign) {
      return NextResponse.json({ error: 'Associated campaign not found' }, { status: 404 });
    }

    // Validate all referenced steps exist
    const stepIds = new Set(flow.steps.map((s) => s.id));
    const brokenLinks: string[] = [];

    for (const step of flow.steps) {
      if (step.nextStepId && !stepIds.has(step.nextStepId)) {
        brokenLinks.push(`Step ${step.id}: nextStepId "${step.nextStepId}" not found`);
      }
      for (const branch of step.branches ?? []) {
        if (!stepIds.has(branch.nextStepId)) {
          brokenLinks.push(
            `Step ${step.id}: branch digit "${branch.digit}" → "${branch.nextStepId}" not found`,
          );
        }
      }
    }

    if (brokenLinks.length > 0) {
      return NextResponse.json(
        { error: 'Flow has broken step references', details: brokenLinks },
        { status: 422 },
      );
    }

    // Push IVR flow ID to Asterisk as a global channel variable via ARI
    const ariHost = process.env['ARI_HOST'] ?? 'localhost';
    const ariPort = process.env['ARI_PORT'] ?? '8088';
    const ariUser = process.env['ARI_USERNAME'] ?? 'dialer';
    const ariPass = process.env['ARI_PASSWORD'] ?? '';
    const ariBase = `http://${ariHost}:${ariPort}/ari`;

    try {
      // Set a global Asterisk variable: DIALER_IVR_<campaignId> = flowId
      const ariUrl = `${ariBase}/asterisk/variable`;
      const res = await fetch(ariUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${ariUser}:${ariPass}`).toString('base64')}`,
        },
        body: JSON.stringify({
          variable: `DIALER_IVR_${String(campaign._id)}`,
          value: String(flow._id),
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`ARI returned HTTP ${res.status}`);
    } catch (err) {
      return NextResponse.json(
        {
          error: 'ARI deployment failed',
          details: String(err),
          hint: 'Ensure Asterisk is running and ARI credentials are correct',
        },
        { status: 502 },
      );
    }

    // Mark flow as deployed
    flow.isDeployed = true;
    flow.deployedAt = new Date();
    await flow.save();

    // Link flow to campaign
    await Campaign.updateOne(
      { _id: campaign._id },
      { $set: { ivrFlowId: flow._id } },
    );

    await AuditLog.create({
      userId: user.sub,
      action: 'ivr_flow.deploy',
      resource: 'IvrFlow',
      resourceId: params.id,
      metadata: { campaignId: String(campaign._id) },
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({
      message: 'IVR flow deployed successfully',
      deployedAt: flow.deployedAt,
      asteriskVariable: `DIALER_IVR_${String(campaign._id)}`,
    });
  },
);
