import { Copy } from 'lucide-react';
import { useFeedback } from '../lib/workspace';
import { Button } from './ui';

export function CopyValue({ value, label }: { value: string; label: string }) {
  const { notify } = useFeedback();
  return (
    <span className="copy-value">
      <code>{value}</code>
      <Button
        className="icon-button small"
        aria-label={'Copy ' + label}
        title={'Copy ' + label}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            notify({ title: label + ' copied' });
          } catch {
            notify({
              title: 'Could not copy',
              detail: 'Select the value and copy it manually.',
              type: 'error',
            });
          }
        }}
      >
        <Copy size={14} />
      </Button>
    </span>
  );
}
export function PaymentReceipt({
  transactionHash,
  buyerWallet,
  chainId,
  fundingHash,
}: {
  transactionHash: string;
  buyerWallet: string;
  chainId: number;
  fundingHash?: string;
}) {
  return (
    <details className="payment-receipt">
      <summary>Payment receipt</summary>
      <dl>
        {fundingHash && (
          <div>
            <dt>Escrow deposit</dt>
            <dd>
              <CopyValue value={fundingHash} label="Escrow deposit hash" />
            </dd>
          </div>
        )}
        <div>
          <dt>Network</dt>
          <dd>ArtGuard Local · {chainId}</dd>
        </div>
        <div>
          <dt>{fundingHash ? 'Escrow release' : 'Transaction'}</dt>
          <dd>
            <CopyValue value={transactionHash} label="Transaction hash" />
          </dd>
        </div>
        <div>
          <dt>Your wallet</dt>
          <dd>
            <CopyValue value={buyerWallet} label="Wallet address" />
          </dd>
        </div>
      </dl>
    </details>
  );
}
