import { HttpException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { Database } from "./database";

// Only explicitly marked business errors may be returned to a client.
export class InputError extends Error {}
export function clientError(error: unknown): never {
  if (error instanceof HttpException) throw error;
  if (error instanceof InputError)
    throw new HttpException({ message: error.message }, 400);
  throw new HttpException({ message: "So‘rov bajarilmadi. Keyinroq qayta urining." }, 500);
}

export class RateLimiter {
  private buckets = new Map<string, { count: number; expires: number }>();
  constructor(private capacity = 10000) {}
  consume(key: string, limit: number, windowMs = 60000, now = Date.now()) {
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.expires <= now) {
      for (const [key, value] of this.buckets)
        if (value.expires <= now) this.buckets.delete(key);
      if (!bucket && this.buckets.size >= this.capacity) return false;
      bucket = { count: 0, expires: now + windowMs };
      this.buckets.set(key, bucket);
    }
    return ++bucket.count <= limit;
  }
}

// Shared across API workers and restarts; hash phone numbers before storage.
export async function limitAccount(db: Database, phone: string) {
  const key = createHash("sha256").update(phone).digest("hex");
  const now = Date.now();
  await db.prepare("DELETE FROM login_limits WHERE expires <= $1").run(now);
  const bucket = await db.prepare(
    "INSERT INTO login_limits(key,attempts,expires) VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET attempts=login_limits.attempts+1 RETURNING attempts",
  ).get(key, now + 15 * 60000) as { attempts: number };
  if (bucket.attempts > 20)
    throw new HttpException({ message: "Kirish urinishlari ko‘p. 15 daqiqadan keyin qayta urining." }, 429);
}

export function securityMiddleware() {
  const limiter = new RateLimiter();
  return (req: Request, res: Response, next: NextFunction) => {
    res.removeHeader("X-Powered-By");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; sandbox");
    res.setHeader("Cache-Control", "no-store");
    if (req.headers["sec-fetch-site"] === "cross-site")
      return res.status(403).json({ message: "Ruxsat etilmagan manba." });
    if (!limiter.consume(req.ip || "unknown", 180)) {
      res.setHeader("Retry-After", "60");
      return res.status(429).json({ message: "Biroz kutib qayta urinib ko‘ring." });
    }
    next();
  };
}

export async function readLimitedFile(response: globalThis.Response, maxBytes = 10 * 1024 * 1024) {
  if (!response.ok || !response.body) throw new InputError("Chekni yuklab bo‘lmadi.");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    if (Number(response.headers.get("content-length")) > maxBytes)
      throw new InputError("Chek 10 MB dan oshmasin.");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new InputError("Chek 10 MB dan oshmasin.");
      chunks.push(Buffer.from(value));
    }
    const bytes = Buffer.concat(chunks);
    const mime = bytes.subarray(0, 5).toString() === "%PDF-" ? "application/pdf"
      : bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png"
      : bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg" : null;
    if (!mime) throw new InputError("Faqat PDF, PNG yoki JPG chek qabul qilinadi.");
    return { bytes, mime };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
