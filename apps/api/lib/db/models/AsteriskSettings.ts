import mongoose, { Schema, type Document } from 'mongoose';

export interface IAsteriskSettings extends Document {
  // ARI
  ariHost: string;
  ariPort: number;
  ariUser: string;
  ariPassword: string;
  ariSsl: boolean;
  ariApp: string;
  // AMI (optional — defaults to same host, port 5038)
  amiHost?: string;
  amiPort?: number;
  amiUser?: string;
  amiPassword?: string;
  // Directories (paths on the Asterisk box — or mounted volumes in Docker)
  soundsDir: string;
  recordingsDir: string;
  // State
  lastTestedAt?: Date;
  lastTestOk?: boolean;
  lastTestError?: string;
}

const AsteriskSettingsSchema = new Schema<IAsteriskSettings>(
  {
    ariHost:      { type: String, required: true, default: 'localhost' },
    ariPort:      { type: Number, required: true, default: 8088 },
    ariUser:      { type: String, required: true, default: 'dialer' },
    ariPassword:  { type: String, required: true, default: '' },
    ariSsl:       { type: Boolean, default: false },
    ariApp:       { type: String, default: 'dialer' },
    amiHost:      { type: String },
    amiPort:      { type: Number, default: 5038 },
    amiUser:      { type: String },
    amiPassword:  { type: String },
    soundsDir:    { type: String, default: '/var/lib/asterisk/sounds/dialer' },
    recordingsDir:{ type: String, default: '/var/spool/asterisk/monitor' },
    lastTestedAt: { type: Date },
    lastTestOk:   { type: Boolean },
    lastTestError:{ type: String },
  },
  { timestamps: true, collection: 'asterisk_settings' },
);

export const AsteriskSettings =
  (mongoose.models['AsteriskSettings'] as mongoose.Model<IAsteriskSettings>) ??
  mongoose.model<IAsteriskSettings>('AsteriskSettings', AsteriskSettingsSchema);
