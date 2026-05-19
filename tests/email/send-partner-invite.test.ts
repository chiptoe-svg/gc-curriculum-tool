import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Resend client BEFORE importing the module under test.
const send = vi.fn();
vi.mock('@/lib/email/resend', () => ({
  getResend: () => ({ emails: { send } }),
  getFromEmail: () => 'GC Curriculum <no-reply@example.com>',
  getPartnersBaseUrl: () => 'https://example.test',
}));

import { sendPartnerInvite } from '@/lib/email/send-partner-invite';

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ data: { id: 'msg_123' }, error: null });
});

describe('sendPartnerInvite', () => {
  it('sends with rendered HTML containing the magic URL', async () => {
    await sendPartnerInvite({ firstName: 'Alex', email: 'alex@acme.test', token: 'TOKEN123' });
    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0]![0];
    expect(arg.to).toBe('alex@acme.test');
    expect(arg.from).toBe('GC Curriculum <no-reply@example.com>');
    expect(arg.subject).toMatch(/Clemson/i);
    expect(arg.html).toContain('https://example.test/partners/TOKEN123');
    expect(arg.html).toContain('Alex');
  });

  it('throws when Resend returns an error', async () => {
    send.mockResolvedValueOnce({ data: null, error: { message: 'rejected' } });
    await expect(
      sendPartnerInvite({ firstName: 'Alex', email: 'alex@acme.test', token: 'TOKEN123' }),
    ).rejects.toThrow(/rejected/);
  });
});
