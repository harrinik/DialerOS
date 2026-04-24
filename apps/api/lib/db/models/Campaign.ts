import mongoose, { type Document, type Model } from 'mongoose';

interface RetryRule {
  maxAttempts: number;
  delayMinutes: number;
}

export interface ICampaign extends Document {
  name: string;
  description?: string;
  ownerId: mongoose.Types.ObjectId;
  status: 'draft' | 'running' | 'paused' | 'completed' | 'archived';
  dialMode: 'preview' | 'progressive' | 'predictive';
  concurrency: number;
  ratePerSecond: number;
  retryRules: {
    busy: RetryRule;
    noAnswer: RetryRule;
    failed: RetryRule;
  };
  amdAction: 'hangup' | 'continue';
  amdEnabled: boolean;
  ivrFlowId?: mongoose.Types.ObjectId;
  agentPool: mongoose.Types.ObjectId[];
  timezone: string;
  startTime?: string;
  endTime?: string;
  blackoutDates: string[];
  holidayCalendarId?: mongoose.Types.ObjectId;
  callerIdName: string;
  callerIdNumber: string;
  sipTrunk: string;
  stats: {
    totalContacts: number;
    dialed: number;
    answered: number;
    machines: number;
    failed: number;
    busy: number;
    noAnswer: number;
    dnc: number;
    completed: number;
    active: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const RetryRuleSchema = new mongoose.Schema<RetryRule>(
  {
    maxAttempts: { type: Number, default: 3, min: 0, max: 10 },
    delayMinutes: { type: Number, default: 5, min: 1 },
  },
  { _id: false },
);

const StatsSchema = new mongoose.Schema(
  {
    totalContacts: { type: Number, default: 0 },
    dialed: { type: Number, default: 0 },
    answered: { type: Number, default: 0 },
    machines: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    busy: { type: Number, default: 0 },
    noAnswer: { type: Number, default: 0 },
    dnc: { type: Number, default: 0 },
    completed: { type: Number, default: 0 },
    active: { type: Number, default: 0 },
  },
  { _id: false },
);

const CampaignSchema = new mongoose.Schema<ICampaign>(
  {
    name: { type: String, required: true, trim: true, maxlength: 255 },
    description: { type: String, maxlength: 1000 },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['draft', 'running', 'paused', 'completed', 'archived'],
      default: 'draft',
      index: true,
    },
    dialMode: {
      type: String,
      enum: ['preview', 'progressive', 'predictive'],
      default: 'progressive',
    },
    concurrency: { type: Number, default: 5, min: 1, max: 500 },
    ratePerSecond: { type: Number, default: 1, min: 0.1, max: 100 },
    retryRules: {
      busy: { type: RetryRuleSchema, default: () => ({ maxAttempts: 3, delayMinutes: 5 }) },
      noAnswer: { type: RetryRuleSchema, default: () => ({ maxAttempts: 3, delayMinutes: 30 }) },
      failed: { type: RetryRuleSchema, default: () => ({ maxAttempts: 1, delayMinutes: 60 }) },
    },
    amdAction:  { type: String, enum: ['hangup', 'continue'], default: 'hangup' },
    amdEnabled: { type: Boolean, default: true },
    ivrFlowId: { type: mongoose.Schema.Types.ObjectId, ref: 'IvrFlow' },
    agentPool: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Agent' }],
    timezone: { type: String, default: 'UTC' },
    startTime: { type: String, match: /^([01]\d|2[0-3]):([0-5]\d)$/ },
    endTime: { type: String, match: /^([01]\d|2[0-3]):([0-5]\d)$/ },
    blackoutDates: [{ type: String, match: /^\d{4}-\d{2}-\d{2}$/ }],
    holidayCalendarId: { type: mongoose.Schema.Types.ObjectId, ref: 'HolidayCalendar' },
    callerIdName: { type: String, required: true, maxlength: 100 },
    callerIdNumber: {
      type: String,
      required: true,
      match: /^\+?[1-9]\d{1,14}$/,
    },
    sipTrunk: { type: String, required: true },
    stats: { type: StatsSchema, default: () => ({}) },
  },
  {
    timestamps: true,
    collection: 'campaigns',
  },
);

// Compound indexes for dashboard queries
CampaignSchema.index({ status: 1, createdAt: -1 });
CampaignSchema.index({ ownerId: 1, status: 1 });

export const Campaign: Model<ICampaign> =
  mongoose.models['Campaign'] ??
  mongoose.model<ICampaign>('Campaign', CampaignSchema);
