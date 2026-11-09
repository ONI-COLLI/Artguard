// Educational forecast. These inputs are planning assumptions, not real sales or legal tax advice.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const assumptions = {
  currency: 'KZT', planningKztPerUsd: 447.94, months: 36,
  averageLicenseUsd: 30, premiumUsd: 10, businessUsd: 50,
  salesVolumeMix: { free: 0.5, premium: 0.3, business: 0.2 },
  commission: { free: 0.10, premium: 0.05, business: 0 },
  cardProcessingRate: 0.025, gasBudgetUsdPerSale: 0.10,
  employerCostBurden: 0.175, corporateTaxPlanningRate: 0.20,
  // Founder-operated coursework scenario: development is an unpaid, non-cash contribution.
  // No employee hiring is committed in this base case. Opportunity cost is excluded.
  founderCount: 4, founderMonthlyCashSalaryKzt: 0, monthlyPaidStaffKzt: 0,
  annualDiscountRate: 0.25, terminalGrowth: 0.05,
  financing: [{ month: 1, kzt: 25_000_000 }, { month: 10, kzt: 15_000_000 }],
  proposedEquity: 0.26, illustrativeExitRevenueMultiple: 2.5,
  anchors: {
    sales: [[5, 50], [12, 400], [24, 1300], [36, 2500]],
    premium: [[5, 15], [12, 150], [24, 350], [36, 600]],
    business: [[5, 2], [12, 20], [24, 60], [36, 120]],
  },
};
function interpolate(month, anchors) {
  if (month < anchors[0][0]) return 0;
  for (let i = 1; i < anchors.length; i++) {
    const [start, a] = anchors[i - 1], [end, b] = anchors[i];
    if (month <= end) return a + (b - a) * (month - start) / (end - start);
  }
  return anchors.at(-1)[1];
}
export function effectiveCommission(a = assumptions) {
  return Object.keys(a.salesVolumeMix).reduce((n, tier) => n + a.salesVolumeMix[tier] * a.commission[tier], 0);
}
function irr(payments) {
  const value = (r) => payments.reduce((n, [t, cash]) => n + cash / (1 + r) ** t, 0);
  let low = -0.999, high = 10;
  if (value(low) * value(high) > 0) return null;
  for (let i = 0; i < 120; i++) {
    const mid = (low + high) / 2;
    if (value(mid) > 0) low = mid; else high = mid;
  }
  return (low + high) / 2;
}
export function forecast({ demand = 1, costMultiplier = 1 } = {}, a = assumptions) {
  const fx = a.planningKztPerUsd, fee = effectiveCommission(a);
  let cumulativeFcf = 0, cash = 0, taxLoss = 0, peakNeed = 0, troughMonth = 0;
  const rows = [];
  for (let month = 1; month <= a.months; month++) {
    const year = Math.ceil(month / 12);
    const sales = interpolate(month, a.anchors.sales) * demand;
    const premium = interpolate(month, a.anchors.premium) * demand;
    const business = interpolate(month, a.anchors.business) * demand;
    const gmv = sales * a.averageLicenseUsd * fx;
    const commissions = gmv * fee;
    const subscriptions = (premium * a.premiumUsd + business * a.businessUsd) * fx;
    const revenue = commissions + subscriptions;
    // The hypothetical fiat service processes the buyer's full payment, not just its own fee.
    const processing = (gmv + subscriptions) * a.cardProcessingRate * costMultiplier;
    const gas = sales * a.gasBudgetUsdPerSale * fx * costMultiplier;
    const hosting = 100 * year * fx * costMultiplier;
    const salaries = (a.founderCount * a.founderMonthlyCashSalaryKzt + a.monthlyPaidStaffKzt) * (1 + a.employerCostBurden) * costMultiplier;
    const marketing = (month < 5 ? 100_000 : [300_000, 450_000, 600_000][year - 1]) * costMultiplier;
    const security = ((month === 4 ? 10_300 : 0) + ([16, 28].includes(month) ? 3_000 : 0) + (month >= 5 ? 2_000 / 12 : 0)) * fx * costMultiplier;
    const administration = (100 * fx + 140_000 + ([1, 13, 25].includes(month) ? (month === 1 ? 1_500 : 1_000) * fx : 0)) * costMultiplier;
    const costs = processing + gas + hosting + salaries + marketing + security + administration;
    const ebitda = revenue - costs;
    const lossUsed = Math.min(taxLoss, Math.max(0, ebitda));
    const tax = Math.max(0, ebitda - lossUsed) * a.corporateTaxPlanningRate;
    taxLoss = Math.max(0, taxLoss - lossUsed) + Math.max(0, -ebitda);
    const fcf = ebitda - tax;
    cumulativeFcf += fcf;
    if (-cumulativeFcf > peakNeed) { peakNeed = -cumulativeFcf; troughMonth = month; }
    const financing = a.financing.filter((f) => f.month === month).reduce((n, f) => n + f.kzt, 0);
    const openingCash = cash;
    cash += fcf + financing;
    rows.push({ month, year, sales, premium, business, gmv, commissions, subscriptions, revenue, processing, gas, hosting, salaries, marketing, security, administration, costs, ebitda, tax, fcf, cumulativeFcf, financing, openingCash, closingCash: cash });
  }
  const annual = [1, 2, 3].map((year) => {
    const group = rows.filter((r) => r.year === year), total = {};
    for (const key of ['gmv', 'commissions', 'subscriptions', 'revenue', 'processing', 'gas', 'hosting', 'salaries', 'marketing', 'security', 'administration', 'costs', 'ebitda', 'tax', 'fcf', 'financing']) total[key] = group.reduce((n, r) => n + r[key], 0);
    return { year, ...total, openingCash: group[0].openingCash, closingCash: group.at(-1).closingCash };
  });
  const r = a.annualDiscountRate;
  const npvThreeYears = annual.reduce((n, y) => n + y.fcf / (1 + r) ** y.year, 0);
  const terminalValue = Math.max(0, annual[2].fcf) * (1 + a.terminalGrowth) / (r - a.terminalGrowth);
  const last = rows.at(-1), funding = a.financing.reduce((n, f) => n + f.kzt, 0);
  const exitEquityValue = Math.max(0, last.revenue * 12 * a.illustrativeExitRevenueMultiple + last.closingCash);
  const investorExit = exitEquityValue * a.proposedEquity;
  const investorCashflows = [...a.financing.map((f) => [(f.month - 1) / 12, -f.kzt]), [3, investorExit]];
  const noRevenueCosts = rows.reduce((n, row) => {
    if (n.exhausted) return n;
    const next = n.cash - (row.costs - row.processing - row.gas);
    return { cash: next, months: next >= 0 ? row.month : n.months, exhausted: next < 0 };
  }, { cash: funding, months: 0, exhausted: false });
  return { rows, annual, effectiveCommission: fee, metrics: {
    npvThreeYears, terminalValue, npvWithTerminal: npvThreeYears + terminalValue / (1 + r) ** 3,
    peakNeed, troughMonth, firstPositiveEbitdaMonth: rows.find((x) => x.ebitda >= 0)?.month ?? null,
    simplePaybackMonth: rows.find((x) => x.month >= 5 && x.cumulativeFcf >= 0)?.month ?? null,
    extraFunding: Math.max(0, peakNeed - funding), minFinancedCash: Math.min(...rows.map((x) => x.closingCash)),
    endingCash: last.closingCash, noRevenueRunwayCompleteMonths: noRevenueCosts.months,
    investorReturnRequiresNewFundingTerms: peakNeed > funding,
    exitEquityValue: peakNeed > funding ? null : exitEquityValue,
    investorExit: peakNeed > funding ? null : investorExit,
    investorMoic: peakNeed > funding ? null : investorExit / funding,
    illustrativeInvestorIrr: peakNeed > funding ? null : irr(investorCashflows),
    investorCashflows: peakNeed > funding ? null : investorCashflows,
  } };
}
export function buildModel() {
  return { generatedAt: new Date().toISOString(), status: 'Educational assumptions require team review; no actual investment or revenue', assumptions, scenarios: {
    base: forecast(), demand: forecast({ demand: 0.7 }), costs: forecast({ costMultiplier: 1.2 }), combined: forecast({ demand: 0.7, costMultiplier: 1.2 }),
  } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const model = buildModel();
  if (process.argv[2]) writeFileSync(resolve(process.argv[2]), JSON.stringify(model, null, 2));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(model.scenarios).map(([name, data]) => [name, { annual: data.annual.map(({ year, revenue, costs, fcf }) => ({ year, revenue, costs, fcf })), ...data.metrics }])), null, 2));
}
