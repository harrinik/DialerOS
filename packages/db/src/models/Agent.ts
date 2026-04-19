import mongoose, { type Document, type Model } from 'mongoose';

export interface IAgent extends Document {
  name: string;
  sipEndpoint: string;
  status: 'available' | 'busy' | 'offline' | 'paused';
  campaignIds: mongoose.Types.ObjectId[];
  maxConcurrentCalls: number;
  currentCallId?: mongoose.Types.ObjectId;
  extension?: string;
  email?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AgentSchema = new mongoose.Schema<IAgent>(
  {
    name:               { type: String, required: true, trim: true },
    sipEndpoint:        { type: String, required: true },
    status:             { type: String, enum: ['available', 'busy', 'offline', 'paused'], default: 'offline', index: true },
    campaignIds:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' }],
    maxConcurrentCalls: { type: Number, default: 1, min: 1, max: 10 },
    currentCallId:      { type: mongoose.Schema.Types.ObjectId, ref: 'CallLog' },
    extension:          { type: String, trim: true },
    email:              { type: String, lowercase: true, trim: true },
  },
  { timestamps: true, collection: 'agents' },
);

AgentSchema.index({ status: 1, updatedAt: 1 });         // for finding oldest-idle agents
AgentSchema.index({ campaignIds: 1, status: 1 });       // for campaign-specific agent pool queries

export const Agent: Model<IAgent> =
  (mongoose.models['Agent'] as Model<IAgent>) ??
  mongoose.model<IAgent>('Agent', AgentSchema);
