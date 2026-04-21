/**
 * Canonical IvrFlow model — ISSUE-05 fix.
 * IVR step types defined inline here to avoid circular import with @dialer/shared.
 */
import mongoose, { type Document, type Model } from 'mongoose';

// ---- IVR type definitions (mirrors @dialer/shared types) -----------------

export interface IvrBranch {
  digit: string;
  nextStepId: string;
}

export interface IvrStep {
  id: string;
  type: 'play' | 'dtmf_collect' | 'route_agent' | 'transfer' | 'webhook' | 'hangup' | string;
  audioFile?: string;
  nextStepId?: string;
  maxDigits?: number;
  timeoutSeconds?: number;
  agentPool?: string[];
  transferTo?: string;
  transferTrunk?: string;
  webhookUrl?: string;
  webhookMethod?: string;
  webhookHeaders?: Record<string, string>;
  webhookPayloadTemplate?: string;
  webhookTimeoutSeconds?: number;
  webhookSuccessNextStepId?: string;
  webhookFailureNextStepId?: string;
  webhookExtraFields?: Record<string, unknown>;
  branches?: IvrBranch[];
}

export interface IvrFlow {
  steps: IvrStep[];
  entryStepId: string;
}

export interface IIvrFlow extends Document {
  name: string;
  description?: string;
  steps: IvrStep[];
  entryStepId: string;
  createdAt: Date;
  updatedAt: Date;
}

// -------------------------------------------------------------------------

const IvrBranchSchema = new mongoose.Schema(
  { digit: String, nextStepId: String },
  { _id: false },
);

const IvrStepSchema = new mongoose.Schema(
  {
    id:              { type: String, required: true },
    type:            { type: String, required: true },
    audioFile:       String,
    nextStepId:      String,
    maxDigits:       Number,
    timeoutSeconds:  Number,
    agentPool:       [String],
    transferTo:      String,
    transferTrunk:   String,
    webhookUrl:      String,
    webhookMethod:   String,
    webhookHeaders:  mongoose.Schema.Types.Mixed,
    webhookPayloadTemplate:   String,
    webhookTimeoutSeconds:    Number,
    webhookSuccessNextStepId: String,
    webhookFailureNextStepId: String,
    webhookExtraFields:       mongoose.Schema.Types.Mixed,
    branches: { type: [IvrBranchSchema], default: [] },
  },
  { _id: false },
);

const IvrFlowSchema = new mongoose.Schema<IIvrFlow>(
  {
    name:        { type: String, required: true, trim: true },
    description: String,
    steps:       { type: [IvrStepSchema], default: [] },
    entryStepId: { type: String, required: true },
  },
  { timestamps: true, collection: 'ivr_flows' },
);

export const IvrFlowModel: Model<IIvrFlow> =
  (mongoose.models['IvrFlow'] as Model<IIvrFlow>) ??
  mongoose.model<IIvrFlow>('IvrFlow', IvrFlowSchema);
