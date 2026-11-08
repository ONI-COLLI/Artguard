export type Expense = {
  id: string;
  category: string;
  amount_cents: string;
  occurred_on: string;
  note: string;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
};
export interface FinanceReport {
  period: { from: string; to: string; timezone: string };
  basis: string;
  cashRevenueCents: string;
  earnedRevenueCents: string;
  deferredServiceCents: string;
  operatingCostsCents: string;
  profitCents: string;
  salesVolumeCents: string;
  salesCount: number;
  recordedEscrowWei: string;
  refundsInPeriodWei: string;
  breakdown: { commission: string; subscriptions: string; promotions: string };
  expenses: Expense[];
}
