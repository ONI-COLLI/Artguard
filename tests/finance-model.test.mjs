import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assumptions, effectiveCommission, forecast } from '../scripts/finance-model.mjs';

test('the founder-operated base case pays no salaries or unapproved future hires', () => {
  const base = forecast();
  assert.equal(assumptions.founderMonthlyCashSalaryKzt, 0);
  assert.equal(assumptions.monthlyPaidStaffKzt, 0);
  assert.ok(base.rows.every(row => row.salaries === 0));
  // An explicitly paid scenario must still include its cash compensation and burden.
  const paid = forecast({}, { ...assumptions, founderMonthlyCashSalaryKzt: 300_000 });
  assert.equal(paid.rows[0].salaries, 1_410_000);
  assert.ok(paid.metrics.npvThreeYears < base.metrics.npvThreeYears);
});
test('forecast respects the actual 10/5/0 commission tiers and the volume-weighted mix', () => {
  assert.ok(Math.abs(effectiveCommission() - 0.065) < 1e-12);
  assert.equal(effectiveCommission({ ...assumptions, salesVolumeMix: { free: 0, premium: 0, business: 1 } }), 0);
});
test('processing costs apply to gross buyer payments and subscriptions', () => {
  const row = forecast().rows[11];
  assert.ok(Math.abs(row.processing - (row.gmv + row.subscriptions) * 0.025) < 1e-8);
  assert.ok(row.processing > row.revenue * 0.025);
});
test('cash reconciliation excludes financing from operating revenue and project NPV', () => {
  const result = forecast();
  for (const row of result.rows) assert.ok(Math.abs(row.openingCash + row.fcf + row.financing - row.closingCash) < 1e-7);
  assert.ok(Math.abs(result.rows.at(-1).cumulativeFcf + 40_000_000 - result.metrics.endingCash) < 1e-6);
  assert.ok(Math.abs(result.metrics.npvThreeYears - result.annual.reduce((n, y) => n + y.fcf / 1.25 ** y.year, 0)) < 1e-6);
});
test('lower demand and higher costs worsen NPV and funding needs', () => {
  const base = forecast(), demand = forecast({ demand: 0.7 }), costs = forecast({ costMultiplier: 1.2 });
  for (const worse of [demand, costs]) {
    assert.ok(worse.metrics.npvThreeYears < base.metrics.npvThreeYears);
    assert.ok(worse.metrics.peakNeed > base.metrics.peakNeed);
    if (worse.metrics.extraFunding > 0) assert.equal(worse.metrics.illustrativeInvestorIrr, null);
  }
});
test('the investor IRR uses both tranche dates and reconciles their present values', () => {
  const { metrics } = forecast();
  const npv = metrics.investorCashflows.reduce((n, [t, cash]) => n + cash / (1 + metrics.illustrativeInvestorIrr) ** t, 0);
  assert.ok(Math.abs(npv) < 0.01);
  assert.equal(metrics.investorCashflows[1][0], 0.75);
});
