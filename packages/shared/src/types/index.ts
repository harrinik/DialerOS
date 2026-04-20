// ============================================================
// SHARED DOMAIN TYPES
// Used by all services (api, worker, listener)
// ============================================================

// ---- Enums ----------------------------------------------------------------

export type UserRole = 'admin' | 'user' | 'agent';

export type CampaignStatus =
  | 'draft'
  | 'running'
  | 'paused'
  | 'completed'
  | 'archived';

export type DialMode = 'preview' | 'progressive' | 'predictive';

export type AmdAction = 'hangup' | 'continue';

export type ContactStatus =
  | 'pending'
  | 'dialing'
  | 'answered'
  | 'machine'
  | 'busy'
  | 'no_answer'
  | 'failed'
  | 'dnc'
  | 'completed'
  | 'retry_scheduled';

export type CallDisposition =
  | 'no_answer'
  | 'busy'
  | 'answered'
  | 'machine'
  | 'failed'
  | 'cancelled'
  | 'voicemail';

export type AmdResult = 'HUMAN' | 'MACHINE' | 'NOTSURE' | 'HANGUP';

export type AgentStatus = 'available' | 'busy' | 'offline' | 'paused' | 'wrapup' | 'training';

export type IvrStepType =
  | 'start'
  | 'play'
  | 'dtmf_collect'
  | 'route_agent'
  | 'webhook'
  | 'hangup'
  | 'condition';

// ---- User -----------------------------------------------------------------

export interface User {
  _id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
}

// ---- Campaign -------------------------------------------------------------

export interface RetryRule {
  maxAttempts: number;
  delayMinutes: number;
}

export interface RetryRules {
  busy: RetryRule;
  noAnswer: RetryRule;
  failed: RetryRule;
}

export interface CampaignStats {
  totalContacts: number;
  dialed: number;
  answered: number;
  machines: number;
  failed: number;
  busy: number;
  noAnswer: number;
  dnc: number;
  completed: number;
  active: number; // currently in-flight calls
}

export interface Campaign {
  _id: string;
  name: string;
  description?: string;
  ownerId: string;
  status: CampaignStatus;
  dialMode: DialMode;
  concurrency: number;
  ratePerSecond: number;
  retryRules: RetryRules;
  amdAction: AmdAction;
  ivrFlowId?: string;
  agentPool: string[]; // Agent IDs
  timezone: string;
  startTime?: string; // HH:MM
  endTime?: string;   // HH:MM
  blackoutDates: string[]; // YYYY-MM-DD in campaign timezone
  holidayCalendarId?: string;
  stats: CampaignStats;
  callerIdName: string;
  callerIdNumber: string;
  sipTrunk: string; // Asterisk endpoint/trunk
  createdAt: Date;
  updatedAt: Date;
}

// ---- Contact --------------------------------------------------------------

export interface Contact {
  _id: string;
  campaignId: string;
  phone: string;
  firstName: string;
  lastName: string;
  email?: string;
  customFields: Record<string, string | number | boolean>;
  status: ContactStatus;
  retryCount: number;
  nextRetryAt?: Date;
  callLogs: string[]; // CallLog IDs
  createdAt: Date;
  updatedAt: Date;
}

// ---- CallLog --------------------------------------------------------------

export interface DtmfEntry {
  digit: string;
  receivedAt: Date;
}

export interface CallLog {
  _id: string;
  contactId: string;
  campaignId: string;
  agentId?: string;
  channelId: string;         // Asterisk channel ID
  uniqueId: string;          // Asterisk uniqueid
  asteriskCallerId: string;
  startTime: Date;
  answerTime?: Date;
  endTime?: Date;
  duration?: number;          // seconds
  disposition: CallDisposition;
  amdResult?: AmdResult;
  dtmfSequence: DtmfEntry[];
  routedToAgentId?: string;
  webhookFired: boolean;
  webhookResponse?: string;
  retryable: boolean;
  attempt: number;
  notes?: string;
  createdAt: Date;
}

// ---- Agent ----------------------------------------------------------------

export interface Agent {
  _id: string;
  userId: string;
  name: string;
  extension: string;
  sipEndpoint: string;        // e.g. "PJSIP/1001"
  status: AgentStatus;
  currentCallId?: string;
  campaignIds: string[];
  maxConcurrentCalls: number;
  createdAt: Date;
  updatedAt: Date;
}

// ---- IVR Flow -------------------------------------------------------------

export interface IvrStepBranch {
  digit: string;              // DTMF digit or "default" or "timeout"
  nextStepId: string;
}

export interface IvrStep {
  id: string;
  type: IvrStepType;
  label?: string;
  // play
  audioFile?: string;
  audioText?: string;         // TTS fallback text
  // dtmf_collect
  timeoutSeconds?: number;
  maxDigits?: number;
  interDigitTimeoutSeconds?: number;
  branches?: IvrStepBranch[];
  // route_agent
  agentPool?: string[];       // Agent IDs; empty = campaign pool
  agentSelectionStrategy?: 'round_robin' | 'least_busy' | 'random';
  // webhook
  webhookUrl?: string;
  webhookMethod?: 'GET' | 'POST';
  webhookHeaders?: Record<string, string>;
  webhookPayloadTemplate?: string; // JSON template with {{contact.phone}} etc.
  webhookTimeoutSeconds?: number;
  webhookSuccessNextStepId?: string;
  webhookFailureNextStepId?: string;
  // condition
  variable?: string;
  conditionBranches?: IvrStepBranch[];
  // next step (for linear steps)
  nextStepId?: string;
  // position for React Flow canvas
  position?: { x: number; y: number };
}

export interface IvrFlow {
  _id: string;
  name: string;
  campaignId: string;
  entryStepId: string;
  steps: IvrStep[];
  isDeployed: boolean;
  deployedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ---- DNC ------------------------------------------------------------------

export interface DncEntry {
  _id: string;
  phone: string;
  phoneHash: string;          // SHA-256 for quick lookup
  addedBy: string;            // User ID
  reason?: string;
  source: 'manual' | 'csv' | 'opted_out' | 'internal';
  addedAt: Date;
}

// ---- BullMQ Job Payloads --------------------------------------------------

export interface DialJobPayload {
  contactId: string;
  campaignId: string;
  phone: string;
  callerIdName: string;
  callerIdNumber: string;
  sipTrunk: string;           // Asterisk SIP endpoint/trunk
  concurrencyLimit: number;
  amdAction: AmdAction;
  ivrFlowId?: string;
  attempt: number;
  callLogId?: string;         // reuse existing log on retry
}

export interface RetryJobPayload {
  contactId: string;
  campaignId: string;
  reason: CallDisposition;
  attempt: number;
}

// ---- ARI Events -----------------------------------------------------------

export interface AriEvent {
  type: string;
  timestamp: string;
  application: string;
  channel?: AriChannel;
  bridge?: AriBridge;
  variable?: string;
  value?: string;
  digit?: string;
  durationMs?: number;
}

export interface AriChannel {
  id: string;
  name: string;
  state: string;
  caller: { name: string; number: string };
  connected: { name: string; number: string };
  accountcode: string;
  dialplan: { context: string; exten: string; priority: number };
  creationtime: string;
  language: string;
}

export interface AriBridge {
  id: string;
  technology: string;
  bridge_type: string;
  bridge_class: string;
  creator: string;
  name: string;
  channels: string[];
}

// ---- Realtime Events (Socket.IO) ------------------------------------------

export interface RealtimeCallEvent {
  type:
    | 'call:started'
    | 'call:ringing'
    | 'call:answered'
    | 'call:machine'
    | 'call:human'
    | 'call:dtmf'
    | 'call:routed'
    | 'call:ended'
    | 'call:failed';
  callLogId: string;
  contactId: string;
  campaignId: string;
  channelId: string;
  phone?: string;
  amdResult?: AmdResult;
  digit?: string;
  agentId?: string;
  disposition?: CallDisposition;
  duration?: number;
  timestamp: string;
}

export interface RealtimeCampaignStats {
  campaignId: string;
  stats: CampaignStats;
  timestamp: string;
}

export interface RealtimeAgentEvent {
  type: 'agent:available' | 'agent:busy' | 'agent:offline';
  agentId: string;
  campaignId?: string;
  timestamp: string;
}

export interface HolidayCalendar {
  _id: string;
  name: string;
  timezone: string;
  dates: Array<{
    date: string; // YYYY-MM-DD
    label: string;
  }>;
  ownerId: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}
