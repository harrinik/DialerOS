/**
 * CdrLog — Raw CDR records for ALL calls (internal + campaign).
 *
 * Populated by the AMI CDR listener in the listener service.
 * Unlike CallLog, this model has no campaign/contact requirement.
 */
import mongoose, { type Document, type Model } from 'mongoose';

export interface ICdrLog extends Document {
  uniqueId:       string;       // Asterisk UniqueID
  linkedId:       string;       // Linked call ID (bridged party)
  channel:        string;       // e.g. PJSIP/1001-00000001
  destChannel:    string;       // Destination channel
  src:            string;       // Caller number
  dst:            string;       // Destination number/extension
  dstContext:     string;       // Dialplan context (agents, from-trunk, etc.)
  callerIdName:   string;
  callerIdNum:    string;
  lastApp:        string;       // Last dialplan app (Dial, Stasis, etc.)
  lastData:       string;       // App data
  startTime:      Date;
  answerTime?:    Date;
  endTime:        Date;
  duration:       number;       // Total call duration (seconds)
  billableSeconds:number;       // Seconds after answer
  disposition:    'ANSWERED' | 'NO ANSWER' | 'BUSY' | 'FAILED' | 'CONGESTION';
  amaFlags:       string;
  accountCode:    string;
  userField:      string;
  type:           'internal' | 'outbound' | 'inbound' | 'campaign'; // call origin type
  campaignId?:    mongoose.Types.ObjectId;  // only for campaign calls (duplicated from CallLog)
}

const CdrLogSchema = new mongoose.Schema<ICdrLog>(
  {
    uniqueId:        { type: String, required: true },
    linkedId:        { type: String, default: '' },
    channel:         { type: String, default: '' },
    destChannel:     { type: String, default: '' },
    src:             { type: String, default: '' },
    dst:             { type: String, default: '' },
    dstContext:      { type: String, default: '' },
    callerIdName:    { type: String, default: '' },
    callerIdNum:     { type: String, default: '' },
    lastApp:         { type: String, default: '' },
    lastData:        { type: String, default: '' },
    startTime:       { type: Date, required: true },
    answerTime:      Date,
    endTime:         { type: Date, required: true },
    duration:        { type: Number, default: 0 },
    billableSeconds: { type: Number, default: 0 },
    disposition: {
      type: String,
      enum: ['ANSWERED', 'NO ANSWER', 'BUSY', 'FAILED', 'CONGESTION'],
      default: 'NO ANSWER',
    },
    amaFlags:        { type: String, default: '' },
    accountCode:     { type: String, default: '' },
    userField:       { type: String, default: '' },
    type: {
      type: String,
      enum: ['internal', 'outbound', 'inbound', 'campaign'],
      default: 'internal',
    },
    campaignId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false }, collection: 'cdr_logs' },
);

CdrLogSchema.index({ uniqueId: 1 }, { unique: true });
CdrLogSchema.index({ startTime: -1 });
CdrLogSchema.index({ src: 1, startTime: -1 });
CdrLogSchema.index({ dst: 1, startTime: -1 });
CdrLogSchema.index({ type: 1, startTime: -1 });
CdrLogSchema.index({ disposition: 1, startTime: -1 });

export const CdrLog: Model<ICdrLog> =
  (mongoose.models['CdrLog'] as Model<ICdrLog>) ??
  mongoose.model<ICdrLog>('CdrLog', CdrLogSchema);
