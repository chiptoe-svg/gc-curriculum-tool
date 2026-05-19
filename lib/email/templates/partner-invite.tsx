import { Html, Head, Body, Container, Heading, Text, Button, Hr, Section } from '@react-email/components';

export interface PartnerInviteProps {
  firstName: string;
  magicUrl: string;
}

export function PartnerInvite({ firstName, magicUrl }: PartnerInviteProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: '#f8fafc', padding: '24px 0' }}>
        <Container style={{ backgroundColor: '#ffffff', padding: '32px', maxWidth: 560, borderRadius: 8 }}>
          <Heading as="h1" style={{ fontSize: 22, margin: 0 }}>
            Help us shape what GC graduates can do
          </Heading>
          <Text>Hi {firstName},</Text>
          <Text>
            Clemson Graphic Communications is updating the career targets our curriculum builds toward, and
            we&apos;d like your input. Tell us about the roles you hire GC grads into — job title, responsibilities,
            salary range, the skills you actually look for. You can describe as many positions as you want, and
            you can stop and come back anytime through the same link.
          </Text>
          <Section style={{ textAlign: 'center', margin: '28px 0' }}>
            <Button
              href={magicUrl}
              style={{ backgroundColor: '#1e293b', color: '#ffffff', padding: '12px 20px', borderRadius: 6, fontSize: 15, textDecoration: 'none' }}
            >
              Open the survey
            </Button>
          </Section>
          <Text style={{ fontSize: 13, color: '#475569' }}>
            About 10 minutes per position you describe. Optional 5 minutes to rate the student projects you&apos;d
            want grads to have done.
          </Text>
          <Hr />
          <Text style={{ fontSize: 12, color: '#64748b' }}>
            This link is unique to you. Please don&apos;t share it. If you weren&apos;t expecting this email, reply and
            let us know.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
