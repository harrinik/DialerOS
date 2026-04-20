import mongoose, { type Document, type Model } from 'mongoose';

export interface IHolidayCalendar extends Document {
  name: string;
  timezone: string;
  dates: Array<{
    date: string; // YYYY-MM-DD
    label: string;
  }>;
  ownerId: mongoose.Types.ObjectId;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const HolidayCalendarSchema = new mongoose.Schema<IHolidayCalendar>(
  {
    name: { type: String, required: true, trim: true },
    timezone: { type: String, default: 'UTC' },
    dates: [{
      date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
      label: { type: String, required: true, trim: true },
    }],
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'holiday_calendars' },
);

HolidayCalendarSchema.index({ ownerId: 1, isDefault: 1 });
HolidayCalendarSchema.index({ 'dates.date': 1 });

export const HolidayCalendar: Model<IHolidayCalendar> =
  mongoose.models['HolidayCalendar'] ??
  mongoose.model<IHolidayCalendar>('HolidayCalendar', HolidayCalendarSchema);