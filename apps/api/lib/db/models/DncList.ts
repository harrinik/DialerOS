import mongoose, { type Document, type Model } from 'mongoose';
import { createHash } from 'node:crypto';

export interface IDncList extends Document {
  phone: string;
  phoneHash: string;
  addedBy: mongoose.Types.ObjectId;
  reason?: string;
  source: 'manual' | 'csv' | 'opted_out' | 'internal';
  addedAt: Date;
}

const DncListSchema = new mongoose.Schema<IDncList>(
  {
    phone: { type: String, required: true, trim: true },
    phoneHash: { type: String, required: true, unique: true, index: true },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reason: { type: String, maxlength: 500 },
    source: {
      type: String,
      enum: ['manual', 'csv', 'opted_out', 'internal'],
      default: 'manual',
      index: true,
    },
    addedAt: { type: Date, default: Date.now, index: true },
  },
  {
    collection: 'dnc_list',
    // No timestamps — use addedAt instead
  },
);

// Pre-save hook: hash the phone number
DncListSchema.pre('save', function (next) {
  if (this.isModified('phone') || this.isNew) {
    this.phoneHash = createHash('sha256')
      .update(this.phone.trim())
      .digest('hex');
  }
  next();
});

export const DncList: Model<IDncList> =
  mongoose.models['DncList'] ??
  mongoose.model<IDncList>('DncList', DncListSchema);
