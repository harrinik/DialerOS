import mongoose from 'mongoose';
import { logger } from './logger.js';

let isConnected = false;

export async function connectDb(): Promise<void> {
  if (isConnected) return;

  const uri = process.env['MONGODB_URI'];
  if (!uri) throw new Error('MONGODB_URI environment variable is not set');

  mongoose.set('strictQuery', true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
    maxPoolSize: 10,
  });

  isConnected = true;
  logger.info({ uri: uri.replace(/\/\/.*@/, '//**:**@') }, 'MongoDB connected');

  mongoose.connection.on('error', (err) => {
    logger.error({ err }, 'MongoDB connection error');
    isConnected = false;
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected. Attempting reconnect...');
    isConnected = false;
  });
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
  isConnected = false;
  logger.info('MongoDB disconnected cleanly');
}
