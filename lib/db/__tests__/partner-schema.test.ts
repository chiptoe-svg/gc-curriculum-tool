import { describe, it, expect } from 'vitest';
import { partners, partnerSessions, partnerEvents } from '@/lib/db/schema';

describe('partner schema', () => {
  it('partners has expected columns', () => {
    const cols = Object.keys(partners);
    for (const c of ['id', 'email', 'firstName', 'lastName', 'company', 'roleTitle',
                     'weight', 'careerTargetHints', 'magicToken', 'tokenExpiresAt',
                     'notes', 'createdAt', 'invitedAt', 'firstOpenedAt',
                     'lastActiveAt', 'active']) {
      expect(cols).toContain(c);
    }
  });

  it('partnerSessions has expected columns', () => {
    const cols = Object.keys(partnerSessions);
    for (const c of ['id', 'partnerId', 'createdAt', 'expiresAt']) {
      expect(cols).toContain(c);
    }
  });

  it('partnerEvents has expected columns', () => {
    const cols = Object.keys(partnerEvents);
    for (const c of ['id', 'partnerId', 'eventType', 'metadata', 'createdAt']) {
      expect(cols).toContain(c);
    }
  });
});
