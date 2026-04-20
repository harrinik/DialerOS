import { Contact } from '@/lib/db/models/Contact';
import { bulkEnqueueDialJobs } from '@/lib/queue';
import type { DialJobPayload } from '@dialer/shared';

interface QueueableCampaign {
  _id: unknown;
  callerIdName: string;
  callerIdNumber: string;
  sipTrunk: string;
  concurrency: number;
  amdAction: 'hangup' | 'continue';
  ivrFlowId?: unknown;
}

export async function enqueuePendingCampaignContacts(campaign: QueueableCampaign): Promise<number> {
  const contacts = await Contact.find({
    campaignId: campaign._id,
    status: { $in: ['pending', 'retry_scheduled'] },
    $or: [
      { nextRetryAt: { $exists: false } },
      { nextRetryAt: { $lte: new Date() } },
    ],
  })
    .select('_id phone retryCount')
    .lean();

  if (contacts.length === 0) {
    return 0;
  }

  const jobs: DialJobPayload[] = contacts.map((contact) => {
    const base = {
      contactId: String(contact._id),
      campaignId: String(campaign._id),
      phone: contact.phone as string,
      callerIdName: campaign.callerIdName,
      callerIdNumber: campaign.callerIdNumber,
      sipTrunk: campaign.sipTrunk,
      concurrencyLimit: campaign.concurrency,
      amdAction: campaign.amdAction,
      attempt: (contact.retryCount as number) + 1,
    } satisfies Omit<DialJobPayload, 'ivrFlowId'>;

    return campaign.ivrFlowId
      ? { ...base, ivrFlowId: String(campaign.ivrFlowId) }
      : base;
  });

  await bulkEnqueueDialJobs(jobs);
  return contacts.length;
}
