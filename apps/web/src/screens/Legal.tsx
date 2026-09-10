import { Card, Divider, Typography } from 'antd';
import { Link } from 'react-router-dom';

const { Title, Paragraph, Text } = Typography;

/**
 * The two pages a Google Play listing asks for by URL: a privacy policy,
 * and a page describing how to delete an account. Both are public — a
 * store reviewer opens them without an account, and so does anyone
 * deciding whether to sign up.
 *
 * They live in the app rather than on a separate marketing site because
 * they have to say what this deployment actually does, and what it does is
 * in this repository. A policy hosted elsewhere drifts from the code the
 * first time the code changes.
 *
 * The operator of a deployment still has to fill in the two placeholders
 * marked below — a company name and a contact address are facts about who
 * is running it, not about the software.
 */
function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', padding: 16 }}>
      <Card style={{ maxWidth: 760, margin: '0 auto' }}>
        <Title level={3} style={{ marginTop: 0 }}>
          {title}
        </Title>
        {children}
        <Divider />
        <Link to="/login">Back to sign in</Link>
      </Card>
    </div>
  );
}

/** Fill these in for your deployment; they are facts about the operator, not the software. */
const OPERATOR = {
  name: import.meta.env.VITE_OPERATOR_NAME ?? '[your company name]',
  contact: import.meta.env.VITE_OPERATOR_CONTACT ?? '[your support email]',
};

export function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy policy">
      <Paragraph type="secondary">
        This describes what the Warehouse Operations application stores and why. It is written
        against what the software actually does; where it says “we”, it means{' '}
        <Text strong>{OPERATOR.name}</Text>, who operates this installation.
      </Paragraph>

      <Title level={5}>What is stored about a person</Title>
      <Paragraph>
        An account holds a name, an email address, an optional mobile number, and a password stored
        only as an argon2id hash — never the password itself. Sign-ins, failed sign-ins, permission
        refusals and every record-changing action are written to an audit log with the account, the
        role it acted as, and the IP address the request came from, because a warehouse has to be
        able to say who booked a receipt or approved an adjustment.
      </Paragraph>

      <Title level={5}>What is stored about the business</Title>
      <Paragraph>
        The operational record: customers, products, warehouses, goods received and dispatched, the
        stock ledger, and the documents generated from them — receipts, gate passes, proofs of
        delivery, invoices and statements. Photographs and signatures captured at a gate or on
        delivery are stored as files alongside the record they belong to.
      </Paragraph>

      <Title level={5}>Who can see it</Title>
      <Paragraph>
        Each workspace's data is isolated at the database level, not only in application code: every
        table carries the workspace it belongs to and a row-level security policy that refuses rows
        from any other. A customer signing into the portal sees only their own goods, receipts,
        dispatches and invoices, enforced by a second policy on top of the first. Within a
        workspace, what someone can see is decided by their role.
      </Paragraph>

      <Title level={5}>What leaves the system</Title>
      <Paragraph>
        Nothing is sold, and there is no advertising or tracking in this application. Notifications
        are sent to the email, SMS or WhatsApp endpoints the operator configures. Generated
        documents can be shared through links that expire in minutes and name one document.
      </Paragraph>

      <Title level={5}>How long it is kept</Title>
      <Paragraph>
        Operational records — receipts, dispatches, invoices, the stock ledger — are commercial and
        tax records, and are kept for the statutory retention period that applies to the business
        using the software (in India, six years for GST records). Personal data attached to an
        account is removed when the account is deleted; see{' '}
        <Link to="/delete-account">deleting your account</Link>.
      </Paragraph>

      <Title level={5}>Contact</Title>
      <Paragraph>
        Questions, corrections, or a request for a copy of what is held about you:{' '}
        <Text strong>{OPERATOR.contact}</Text>.
      </Paragraph>
    </LegalPage>
  );
}

export function DeleteAccountInfo() {
  return (
    <LegalPage title="Deleting your account">
      <Title level={5}>From inside the app</Title>
      <Paragraph>
        Sign in, open <Text code>Settings → Your account</Text>, and choose{' '}
        <Text strong>Delete my account</Text>. You will be asked for your password to confirm. It
        takes effect immediately.
      </Paragraph>

      <Title level={5}>What is deleted</Title>
      <Paragraph>
        Your sign-in: your name, email address, mobile number and password are removed from the
        account, every session ends at once, and you cannot sign in again. Your membership of each
        workspace is disabled.
      </Paragraph>

      <Title level={5}>What is kept, and why</Title>
      <Paragraph>
        The work itself. A goods receipt you booked, a dispatch you released or an invoice you
        issued belongs to the warehouse's own commercial and tax record, which it is legally
        required to keep — so those records stay, with your name replaced by “Deleted user”.
        Deleting them is not something the person who left is able to authorise, because they are
        not that person's records.
      </Paragraph>

      <Title level={5}>Closing a whole workspace</Title>
      <Paragraph>
        An Owner can close the workspace from <Text code>Settings → Company</Text>. Every sign-in is
        disabled immediately; the records are retained for the statutory period and then removed.
        Ask before you close it if you want an export first.
      </Paragraph>

      <Title level={5}>If you cannot sign in</Title>
      <Paragraph>
        Use <Link to="/forgot-password">the password reset</Link> first. If that does not reach you,
        write to <Text strong>{OPERATOR.contact}</Text> from the address on the account and ask for
        it to be deleted.
      </Paragraph>
    </LegalPage>
  );
}
