import { Resend } from 'resend';

let cached: Resend | null = null;

export function getResend(): Resend {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error('RESEND_API_KEY not set');
  cached = new Resend(key);
  return cached;
}

export function getFromEmail(): string {
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!from) throw new Error('RESEND_FROM_EMAIL not set');
  return from;
}

export function getPartnersBaseUrl(): string {
  const url = process.env.PARTNERS_BASE_URL?.trim();
  if (!url) throw new Error('PARTNERS_BASE_URL not set');
  return url.replace(/\/$/, '');
}
