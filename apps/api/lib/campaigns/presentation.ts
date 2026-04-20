type CampaignStatsShape = Partial<{
  total: number;
  totalContacts: number;
  pending: number;
  dialed: number;
  answered: number;
  machines: number;
  failed: number;
  busy: number;
  noAnswer: number;
  dnc: number;
  completed: number;
  active: number;
}>;

type CampaignWithStats = {
  stats?: CampaignStatsShape | null;
};

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function normalizeCampaignStats(stats?: CampaignStatsShape | null) {
  const total = toNumber(stats?.totalContacts ?? stats?.total);
  const answered = toNumber(stats?.answered);
  const machines = toNumber(stats?.machines);
  const failed = toNumber(stats?.failed);
  const busy = toNumber(stats?.busy);
  const noAnswer = toNumber(stats?.noAnswer);
  const dnc = toNumber(stats?.dnc);
  const active = toNumber(stats?.active);
  const completed = toNumber(stats?.completed);
  const dialed = toNumber(stats?.dialed);
  const terminalOutcomes = answered + machines + failed + busy + noAnswer + dnc;
  const progressed = Math.max(terminalOutcomes, completed);
  const pending =
    stats && 'pending' in stats
      ? toNumber(stats.pending)
      : Math.max(total - progressed - active, 0);

  return {
    total,
    totalContacts: total,
    pending,
    dialed,
    answered,
    machines,
    failed,
    busy,
    noAnswer,
    dnc,
    completed,
    active,
  };
}

export function presentCampaign<T extends CampaignWithStats>(campaign: T) {
  return {
    ...campaign,
    stats: normalizeCampaignStats(campaign.stats),
  };
}
