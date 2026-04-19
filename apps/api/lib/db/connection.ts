import mongoose from 'mongoose';
import { logger } from '@/lib/logger';

/**
 * Global cache for the mongoose connection in Next.js (avoids re-connecting
 * on every hot reload during development).
 */
declare global {
  // eslint-disable-next-line no-var
  var __mongooseConnection: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
  };
}

if (!global.__mongooseConnection) {
  global.__mongooseConnection = { conn: null, promise: null };
}

export async function connectDb(): Promise<typeof mongoose> {
  // Guard here (not at module level) so Next.js build can import routes safely
  const MONGODB_URI = process.env['MONGODB_URI'];
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is not set');
  }

  if (global.__mongooseConnection.conn) {
    return global.__mongooseConnection.conn;
  }

  if (!global.__mongooseConnection.promise) {
    mongoose.set('strictQuery', true);

    global.__mongooseConnection.promise = mongoose
      .connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 10_000,
        socketTimeoutMS: 45_000,
        maxPoolSize: 20,
      })
      .then((mongooseInstance) => {
        logger.info('MongoDB connected (api)');
        return mongooseInstance;
      });
  }

  global.__mongooseConnection.conn = await global.__mongooseConnection.promise;
  return global.__mongooseConnection.conn;
}
