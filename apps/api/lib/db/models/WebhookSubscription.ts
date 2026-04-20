import mongoose, { type Document, type Model } from 'mongoose';

export interface IWebhookSubscription extends Document {
  ownerId: mongoose.Types.ObjectId;
  url: string;
  events: string[];
  secret?: string;
  isActive: boolean;
  lastEventAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookSubscriptionSchema = new mongoose.Schema<IWebhookSubscription>(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    url: { type: String, required: true },
    events: [{ type: String }],
    secret: { type: String },
    isActive: { type: Boolean, default: true },
    lastEventAt: { type: Date },
  },
  { timestamps: true, collection: 'webhook_subscriptions' },
);

WebhookSubscriptionSchema.index({ ownerId: 1, isActive: 1 });
WebhookSubscriptionSchema.index({ events: 1 });

export const WebhookSubscription: Model<IWebhookSubscription> =
  mongoose.models['WebhookSubscription'] ??
  mongoose.model<IWebhookSubscription>('WebhookSubscription', WebhookSubscriptionSchema);