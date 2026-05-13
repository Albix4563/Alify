import { NextResponse } from 'next/server';

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  keyPrefix: string;
  max: number;
  windowMs: number;
};

declare global {
  var __albifyRateLimitStore: Map<string, RateLimitBucket> | undefined;
}

const rateLimitStore =
  globalThis.__albifyRateLimitStore ?? new Map<string, RateLimitBucket>();
if (!globalThis.__albifyRateLimitStore) {
  globalThis.__albifyRateLimitStore = rateLimitStore;
}

const MAX_BUCKETS = 5000;

function getHeaderValue(request: Request, name: string): string {
  return request.headers.get(name)?.trim() ?? '';
}

function getClientIp(request: Request): string {
  const xff = getHeaderValue(request, 'x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }

  const fallbackHeaders = ['x-real-ip', 'cf-connecting-ip'];
  for (const header of fallbackHeaders) {
    const value = getHeaderValue(request, header);
    if (value) return value;
  }

  return 'unknown';
}

function sweepExpiredBuckets(now: number): void {
  for (const [key, value] of rateLimitStore.entries()) {
    if (value.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
}

function enforceStoreSize(now: number): void {
  if (rateLimitStore.size <= MAX_BUCKETS) return;
  sweepExpiredBuckets(now);
  if (rateLimitStore.size <= MAX_BUCKETS) return;

  const oldestKeys = [...rateLimitStore.entries()]
    .sort((a, b) => a[1].resetAt - b[1].resetAt)
    .slice(0, rateLimitStore.size - MAX_BUCKETS)
    .map(([key]) => key);

  for (const key of oldestKeys) {
    rateLimitStore.delete(key);
  }
}

function buildRateLimitHeaders(bucket: RateLimitBucket, max: number): Headers {
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((bucket.resetAt - Date.now()) / 1000),
  );
  const remaining = Math.max(0, max - bucket.count);

  const headers = new Headers();
  headers.set('Retry-After', String(retryAfterSeconds));
  headers.set('X-RateLimit-Limit', String(max));
  headers.set('X-RateLimit-Remaining', String(remaining));
  headers.set('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
  return headers;
}

export function applyRateLimit(
  request: Request,
  options: RateLimitOptions,
): NextResponse | null {
  const now = Date.now();
  enforceStoreSize(now);

  const clientIp = getClientIp(request);
  const key = `${options.keyPrefix}:${clientIp}`;
  const existing = rateLimitStore.get(key);

  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + options.windowMs,
    });
    return null;
  }

  if (existing.count >= options.max) {
    return NextResponse.json(
      { error: 'Too many requests. Please retry later.' },
      { status: 429, headers: buildRateLimitHeaders(existing, options.max) },
    );
  }

  existing.count += 1;
  rateLimitStore.set(key, existing);
  return null;
}

export function normalizeAndLimit(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized) return '';
  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

export function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

export function logApiError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${context}: ${message}`);
}
