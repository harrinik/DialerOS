import mongoose, { type Document, type Model } from 'mongoose';

interface DtmfEntry {
  digit: string;
  receivedAt: Date;
}

export interface ICallLog extends Document {
  contactId: mongoose.Types.ObjectId;
  campaignId: mongoose.Types.ObjectId;
  channelId: string;
  uniqueId: string;
  asteriskCallerId: string;
  startTime: Date;
  answerTime?: Date;
  endTime?: Date;
  duration?: number;
  disposition:
    | 'no_answer'
    | 'busy'
    | 'answered'
    | 'machine'
    | 'failed'
    | 'cancelled'
    | 'voicemail';
  amdResult?: 'HUMAN' | 'MACHINE' | 'NOTSURE' | 'HANGUP';
  dtmfSequence: DtmfEntry[];
  routedToAgentId?: mongoose.Types.ObjectId;
  webhookFired: boolean;
  webhookResponse?: string;
  retryable: boolean;
  attempt: number;
  notes?: string;
  createdAt: Date;
}

const CallLogSchema = new mongoose.Schema<ICallLog>(
  {
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contact',
      required: true,
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
      index: true,
    },
    channelId: { type: String, required: true },
    uniqueId: { type: String, default: '' },
    asteriskCallerId: { type: String, default: '' },
    startTime: { type: Date, required: true, default: Date.now },
    answerTime: Date,
    endTime: Date,
    duration: Number,
    disposition: {
      type: String,
      enum: ['no_answer', 'busy', 'answered', 'machine', 'failed', 'cancelled', 'voicemail'],
      default: 'no_answer',
      index: true,
    },
    amdResult: {
      type: String,
      enum: ['HUMAN', 'MACHINE', 'NOTSURE', 'HANGUP'],
    },
    dtmfSequence: [
      {
        digit: String,
        receivedAt: { type: Date, default: Date.now },
        _id: false,
      },
    ],
    routedToAgentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent' },
    webhookFired: { type: Boolean, default: false },
    webhookResponse: String,
    retryable: { type: Boolean, default: false },
    attempt: { type: Number, default: 1 },
    notes: String,
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false },
    collection: 'call_logs',
  },
);

// Asterisk uniqueId — sparse so null values aren't indexed
CallLogSchema.index({ uniqueId: 1 }, { sparse: true });
CallLogSchema.index({ channelId: 1 }, { unique: true });
// Dashboard queries
CallLogSchema.index({ campaignId: 1, startTime: -1 });
CallLogSchema.index({ campaignId: 1, disposition: 1 });
// Reporting
CallLogSchema.index({ startTime: -1 });

export const CallLog: Model<ICallLog> =
  mongoose.models['CallLog'] ??
  mongoose.model<ICallLog>('CallLog', CallLogSchema);
