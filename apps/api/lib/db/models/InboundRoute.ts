import mongoose, { Schema, type Document } from 'mongoose';

export interface IInboundRoute extends Document {
  did: string;
  description: string;
  destination: 'ivr_flow' | 'queue' | 'extension' | 'voicemail' | 'hangup' | 'announcement';
  destinationId?: string;
  destinationName?: string;
  priority: number;
  isActive: boolean;
  /** The generated dialplan extension snippet for this DID */
  dialplanSnippet?: string;
  lastPushed?: Date;
}

const InboundRouteSchema = new Schema<IInboundRoute>(
  {
    did:             { type: String, required: true, unique: true },
    description:     { type: String, default: '' },
    destination:     { type: String, enum: ['ivr_flow', 'queue', 'extension', 'voicemail', 'hangup', 'announcement'], required: true },
    destinationId:   { type: String },
    destinationName: { type: String },
    priority:        { type: Number, default: 1 },
    isActive:        { type: Boolean, default: true },
    dialplanSnippet: { type: String },
    lastPushed:      { type: Date },
  },
  { timestamps: true, collection: 'inbound_routes' },
);

export const InboundRoute =
  (mongoose.models['InboundRoute'] as mongoose.Model<IInboundRoute>) ??
  mongoose.model<IInboundRoute>('InboundRoute', InboundRouteSchema);
