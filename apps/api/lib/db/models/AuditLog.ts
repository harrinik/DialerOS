import mongoose, { type Document, type Model } from 'mongoose';

export interface IAuditLog extends Document {
  userId: mongoose.Types.ObjectId;
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ip: string;
  userAgent?: string;
  createdAt: Date;
}

const AuditLogSchema = new mongoose.Schema<IAuditLog>(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    action: { type: String, required: true, trim: true },
    resource: { type: String, required: true, trim: true },
    resourceId: String,
    metadata: { type: mongoose.Schema.Types.Mixed },
    ip: { type: String, required: true },
    userAgent: String,
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false },
    collection: 'audit_logs',
  },
);

// Compound indexes for audit trail queries
AuditLogSchema.index({ userId: 1, createdAt: -1 });
AuditLogSchema.index({ resource: 1, resourceId: 1, createdAt: -1 });

// TTL: auto-delete audit logs older than 90 days
AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7_776_000 });

export const AuditLog: Model<IAuditLog> =
  mongoose.models['AuditLog'] ??
  mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
