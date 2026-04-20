import mongoose, { type Document, type Model } from 'mongoose';

export interface IAgentQrLoginToken extends Document {
  userId: mongoose.Types.ObjectId;
  agentId: mongoose.Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AgentQrLoginTokenSchema = new mongoose.Schema<IAgentQrLoginToken>(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
    collection: 'agent_qr_login_tokens',
  },
);

AgentQrLoginTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AgentQrLoginToken: Model<IAgentQrLoginToken> =
  mongoose.models['AgentQrLoginToken'] ??
  mongoose.model<IAgentQrLoginToken>('AgentQrLoginToken', AgentQrLoginTokenSchema);
