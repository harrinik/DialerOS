import mongoose, { type Document, type Model } from 'mongoose';

export interface IAgent extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  extension: string;
  sipEndpoint: string;
  status: 'available' | 'busy' | 'offline' | 'break';
  currentCallId?: mongoose.Types.ObjectId;
  campaignIds: mongoose.Types.ObjectId[];
  maxConcurrentCalls: number;
  skills: string[];
  priority: number;
  wrapupTimeSeconds: number;
  createdAt: Date;
  updatedAt: Date;
}

const AgentSchema = new mongoose.Schema<IAgent>(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    extension: { type: String, required: true, trim: true, maxlength: 20 },
    sipEndpoint: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['available', 'busy', 'offline', 'paused', 'wrapup', 'training'],
      default: 'offline',
      index: true,
    },
    currentCallId: { type: mongoose.Schema.Types.ObjectId, ref: 'CallLog' },
    campaignIds: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' },
    ],
    maxConcurrentCalls: { type: Number, default: 1, min: 1, max: 10 },
    skills: [{ type: String, trim: true }],
    priority: { type: Number, default: 0, min: 0, max: 100 },
    wrapupTimeSeconds: { type: Number, default: 30, min: 0, max: 300 },
  },
  {
    timestamps: true,
    collection: 'agents',
  },
);

AgentSchema.index({ status: 1, campaignIds: 1 });
AgentSchema.index({ campaignIds: 1 });

export const Agent: Model<IAgent> =
  mongoose.models['Agent'] ?? mongoose.model<IAgent>('Agent', AgentSchema);
