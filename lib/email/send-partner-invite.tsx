import { render } from '@react-email/components';
import { getResend, getFromEmail, getPartnersBaseUrl } from './resend';
import { PartnerInvite } from './templates/partner-invite';

export interface SendPartnerInviteArgs {
  firstName: string;
  email: string;
  token: string;
}

export async function sendPartnerInvite({ firstName, email, token }: SendPartnerInviteArgs) {
  const magicUrl = `${getPartnersBaseUrl()}/partners/${token}`;
  const html = await render(<PartnerInvite firstName={firstName} magicUrl={magicUrl} />);
  const { error } = await getResend().emails.send({
    from: getFromEmail(),
    to: email,
    subject: 'Help shape the Clemson GC curriculum — quick survey',
    html,
  });
  if (error) throw new Error(`Resend rejected invite for ${email}: ${error.message}`);
}
