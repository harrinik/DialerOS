import mongoose, { Schema, type Document } from 'mongoose';

export interface IAudioFile extends Document {
  name: string;
  originalName: string;
  category: 'ivr' | 'moh' | 'greeting' | 'misc';
  /** Path relative to soundsDir, e.g. "ivr/welcome" (no extension) */
  asteriskPath: string;
  /** Absolute path on disk for the primary WAV file */
  diskPath: string;
  durationSecs?: number;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: Date;
}

const AudioFileSchema = new Schema<IAudioFile>(
  {
    name:         { type: String, required: true },
    originalName: { type: String, required: true },
    category:     { type: String, enum: ['ivr', 'moh', 'greeting', 'misc'], default: 'ivr' },
    asteriskPath: { type: String, required: true, unique: true },
    diskPath:     { type: String, required: true },
    durationSecs: { type: Number },
    sizeBytes:    { type: Number, default: 0 },
    uploadedBy:   { type: String, required: true },
  },
  { timestamps: true, collection: 'audio_files' },
);

export const AudioFile =
  (mongoose.models['AudioFile'] as mongoose.Model<IAudioFile>) ??
  mongoose.model<IAudioFile>('AudioFile', AudioFileSchema);
