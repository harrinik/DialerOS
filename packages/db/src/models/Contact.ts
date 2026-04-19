import mongoose, { type Document, type Model } from 'mongoose';

export interface IContact extends Document {
  campaignId: mongoose.Types.ObjectId;
  phone: string;
  firstName: string;
  lastName: string;
  email?: string;
  customFields: Map<string, string | number | boolean>;
  status: 'pending' | 'dialing' | 'answered' | 'machine' | 'busy' | 'no_answer' | 'failed' | 'dnc' | 'completed' | 'retry_scheduled';
  retryCount: number;
  nextRetryAt?: Date;
  callLogs: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const ContactSchema = new mongoose.Schema<IContact>(
  {
    campaignId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    phone:        { type: String, required: true, trim: true },
    firstName:    { type: String, required: true, trim: true, maxlength: 100 },
    lastName:     { type: String, required: true, trim: true, maxlength: 100 },
    email:        { type: String, lowercase: true, trim: true },
    customFields: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['pending', 'dialing', 'answered', 'machine', 'busy', 'no_answer', 'failed', 'dnc', 'completed', 'retry_scheduled'],
      default: 'pending',
    },
    retryCount:  { type: Number, default: 0 },
    nextRetryAt: { type: Date, index: { sparse: true } },
    callLogs:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'CallLog' }],
  },
  { timestamps: true, collection: 'contacts' },
);

ContactSchema.index({ campaignId: 1, status: 1 });
ContactSchema.index({ campaignId: 1, nextRetryAt: 1, status: 1 });
ContactSchema.index({ campaignId: 1, phone: 1 }, { unique: true });
ContactSchema.index({ status: 1, nextRetryAt: 1 });

export const Contact: Model<IContact> =
  (mongoose.models['Contact'] as Model<IContact>) ??
  mongoose.model<IContact>('Contact', ContactSchema);
