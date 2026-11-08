import { PageHeading } from '../components/ui';
import { AccessPanel } from '../components/dialogs';
import { EscrowOrders } from '../components/escrow-orders';
import { useData } from '../lib/workspace';
export default function EscrowPage({ manager = false }: { manager?: boolean }) {
  const { user } = useData();
  if (!user) return <AccessPanel />;
  if (!user.emailVerified)
    return (
      <p className="local-note">
        Verify your email in Account security before managing escrow orders.
      </p>
    );
  if (manager && !user.isManager)
    return <p className="local-note">Manager access is required to review site disputes.</p>;
  return (
    <>
      <PageHeading
        kicker={manager ? 'Manager workspace' : 'Your orders'}
        title={manager ? 'Escrow & disputes' : 'Orders & escrow'}
        description="Payment stays in the contract until the order is accepted or its review period ends. The license starts when payment is released."
      />
      <EscrowOrders manager={manager} />
      <details className="panel escrow-policy">
        <summary>Delivery, review and refund rules</summary>
        <p>
          The seller has 72 hours to confirm delivery. The buyer then has 24 hours to inspect the
          file and accept it or open a dispute. A manager has 7 days to resolve a dispute; after
          that a refund is available. If the seller never confirms delivery, a full refund is
          available after 72 hours.
        </p>
        <p>
          Deadlines enable an on-chain action; release and refund still require a transaction.
          Commission and co-author credits appear only after release. Refunds go into a separate
          buyer balance and must be withdrawn. Network gas is not refunded.
        </p>
      </details>
    </>
  );
}
