import mongoose, { type Document, type Model } from 'mongoose';

interface IvrStepBranch {
  digit: string;
  nextStepId: string;
}

interface IvrStep {
  id: string;
  type:
    | 'start'
    | 'play'
    | 'dtmf_collect'
    | 'route_agent'
    | 'transfer'
    | 'webhook'
    | 'hangup'
    | 'condition';
  label?: string;
  audioFile?: string;
  audioText?: string;
  timeoutSeconds?: number;
  maxDigits?: number;
  interDigitTimeoutSeconds?: number;
  branches?: IvrStepBranch[];
  agentPool?: string[];
  agentSelectionStrategy?: 'round_robin' | 'least_busy' | 'random';
  transferTo?: string;
  transferTrunk?: string;
  webhookUrl?: string;
  webhookMethod?: 'GET' | 'POST';
  webhookHeaders?: Record<string, string>;
  webhookPayloadTemplate?: string;
  webhookTimeoutSeconds?: number;
  webhookSuccessNextStepId?: string;
  webhookFailureNextStepId?: string;
  variable?: string;
  conditionBranches?: IvrStepBranch[];
  nextStepId?: string;
  position?: { x: number; y: number };
}

export interface IIvrFlow extends Document {
  name: string;
  campaignId: mongoose.Types.ObjectId;
  entryStepId: string;
  steps: IvrStep[];
  isDeployed: boolean;
  deployedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const IvrStepBranchSchema = new mongoose.Schema<IvrStepBranch>(
  { digit: String, nextStepId: String },
  { _id: false },
);

const IvrStepSchema = new mongoose.Schema<IvrStep>(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      enum: [
        'start',
        'play',
        'dtmf_collect',
        'route_agent',
        'transfer',
        'webhook',
        'hangup',
        'condition',
      ],
      required: true,
    },
    label: String,
    audioFile: String,
    audioText: String,
    timeoutSeconds: { type: Number, min: 1, max: 60 },
    maxDigits: { type: Number, min: 1, max: 20 },
    interDigitTimeoutSeconds: { type: Number, min: 1, max: 10 },
    branches: [IvrStepBranchSchema],
    agentPool: [String],
    agentSelectionStrategy: {
      type: String,
      enum: ['round_robin', 'least_busy', 'random'],
    },
    transferTo: String,
    transferTrunk: String,
    webhookUrl: String,
    webhookMethod: { type: String, enum: ['GET', 'POST'] },
    webhookHeaders: { type: Map, of: String },
    webhookPayloadTemplate: String,
    webhookTimeoutSeconds: { type: Number, min: 1, max: 30 },
    webhookSuccessNextStepId: String,
    webhookFailureNextStepId: String,
    variable: String,
    conditionBranches: [IvrStepBranchSchema],
    nextStepId: String,
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
    },
  },
  { _id: false },
);

const IvrFlowSchema = new mongoose.Schema<IIvrFlow>(
  {
    name: { type: String, required: true, trim: true, maxlength: 255 },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
      index: true,
    },
    entryStepId: { type: String, required: true },
    steps: [IvrStepSchema],
    isDeployed: { type: Boolean, default: false, index: true },
    deployedAt: Date,
  },
  {
    timestamps: true,
    collection: 'ivr_flows',
  },
);

IvrFlowSchema.index({ campaignId: 1, isDeployed: 1 });

export const IvrFlow: Model<IIvrFlow> =
  mongoose.models['IvrFlow'] ??
  mongoose.model<IIvrFlow>('IvrFlow', IvrFlowSchema);
