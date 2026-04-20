/**
 * Canonical DncList model — ISSUE-31: phone index added.
 */
import mongoose, { type Document, type Model } from 'mongoose';
import { createHash } from 'crypto';  // use 'crypto' (not 'node:crypto') for tsconfig compatibility

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
    phone:     { type: String, required: true, trim: true, index: true },   // ISSUE-31: index for fast DNC sync query
    phoneHash: { type: String, required: true, unique: true, index: true },
    addedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason:    { type: String, maxlength: 500 },
    source:    { type: String, enum: ['manual', 'csv', 'opted_out', 'internal'], default: 'manual', index: true },
    addedAt:   { type: Date, default: Date.now, index: true },
  },
  { collection: 'dnc_list' },
);

DncListSchema.pre('save', function (this: any, next: any) {
  if (this.isModified('phone') || this.isNew) {
    this.phoneHash = createHash('sha256').update(this.phone.trim()).digest('hex');
  }
  next();
});

export const DncList: Model<IDncList> =
  (mongoose.models['DncList'] as Model<IDncList>) ??
  mongoose.model<IDncList>('DncList', DncListSchema);
