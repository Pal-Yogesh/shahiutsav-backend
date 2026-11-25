import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { config } from "../config/index.js";
import { createDbSocket, dnsFallbackEnabled } from "./db-dns.js";

// A long-running Express server talks to Postgres over a regular TCP pool.
// (The Neon serverless/WebSocket driver is meant for edge functions; on a
// persistent server its sockets drop and surface as an opaque `ErrorEvent`.)
let db: PrismaClient;

export function getDb(): PrismaClient {
  if (!db) {
    const adapter = new PrismaPg({
      // `sslmode=require` already means verify-full in pg today, but pg warns that it will mean
      // something weaker in its next major version, so ask for verify-full explicitly
      connectionString: config.databaseUrl?.replace(/sslmode=(prefer|require|verify-ca)\b/, "sslmode=verify-full"),
      max: 10,
      // Neon suspends idle databases; allow time for the first connection to wake it
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 30_000,
      // Falls back to public DNS if the local resolver can't find the database (dev only)
      ...(dnsFallbackEnabled ? { stream: createDbSocket } : {}),
    });
    db = new PrismaClient({ adapter });
  }
  return db;
}

// Interactive transactions: Neon can take several seconds to wake from idle, so allow
// more than Prisma's 5s default to start (maxWait) and to finish (timeout).
export const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;
