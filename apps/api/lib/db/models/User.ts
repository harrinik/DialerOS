import mongoose, { type Document, type Model } from 'mongoose';

export interface IUser extends Document {
  email: string;
  name: string;
  passwordHash: string;
  role: 'admin' | 'user' | 'agent';
  isActive: boolean;
  refreshTokens: string[];
  lastLogin?: Date;
  mfaEnabled?: boolean;
  mfaSecret?: string | null;
  mfaMethod?: string | null;
  mfaPending?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new mongoose.Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ['admin', 'user', 'agent'],
      default: 'user',
      index: true,
    },
    isActive: { type: Boolean, default: true, index: true },
    refreshTokens: { type: [String], default: [], select: false },
    lastLogin: Date,
    mfaEnabled: { type: Boolean, default: false },
    mfaSecret: { type: String, default: null, select: false },
    mfaMethod: { type: String, default: null },
    mfaPending: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'users',
  },
);

// Prevent duplicate refresh tokens
UserSchema.index({ 'refreshTokens': 1 });

export const User: Model<IUser> =
  mongoose.models['User'] ?? mongoose.model<IUser>('User', UserSchema);
