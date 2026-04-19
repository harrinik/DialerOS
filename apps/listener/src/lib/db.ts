import mongoose from 'mongoose';
import { logger } from './logger.js';

let isConnected = false;

export async function connectDb(): Promise<void> {
  if (isConnected) return;
  const uri = process.env['MONGODB_URI'];
  if (!uri) throw new Error('MONGODB_URI is not set');

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 5,
  });
  isConnected = true;
  logger.info('MongoDB connected (listener)');
  mongoose.connection.on('error', () => { isConnected = false; });
  mongoose.connection.on('disconnected', () => { isConnected = false; });
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
  isConnected = false;
}
