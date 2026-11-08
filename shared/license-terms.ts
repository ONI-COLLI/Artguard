import type { LicenseId } from './types.js';
import { licenseTypes } from './schemas.js';
export const detailedUsage: Record<LicenseId, string> = {
  personal:
    'Non-exclusive, non-transferable use by one person for private, non-commercial projects in Kazakhstan. You may adapt the image. No advertising, resale, sublicensing, standalone file distribution, AI training or tokenization. Copyright stays with the creator.',
  commercial:
    'Non-exclusive, non-transferable use by one person or legal entity in one commercial project in Kazakhstan, including advertising and adaptations. No sale of products whose main value is the artwork, standalone source redistribution, sublicensing, AI training or tokenization. Copyright stays with the creator.',
  extended:
    'Non-exclusive, non-transferable use by one person or legal entity in multiple commercial projects and products for sale in Kazakhstan. Adaptation and reproduction are permitted during the stated period. No standalone source redistribution, sublicensing, AI training or tokenization. Copyright stays with the creator.',
};
export const licensePeriodRule =
  'The period starts when escrow is released. After expiry, stop new reproductions and ongoing public/commercial use or renew. Previously lawfully distributed copies are not remotely deleted. Downloaded files cannot be technically recalled. Rights to depicted people, trademarks and third-party material require separate permission where applicable.';

// Show the chosen usage rights from the frozen quote, rather than raw technical JSON.
export function licenseUsageTerms(snapshot: string, license: LicenseId): string {
  try {
    const parsed = JSON.parse(snapshot) as { licenses?: { id?: string; terms?: unknown }[] };
    if (!parsed || typeof parsed !== 'object') return licenseTypes[license].description;
    const terms = Array.isArray(parsed.licenses)
      ? parsed.licenses.find((l) => l.id === license)?.terms
      : null;
    return typeof terms === 'string' ? terms : licenseTypes[license].description;
  } catch {
    return snapshot.trim().startsWith('{')
      ? licenseTypes[license].description
      : snapshot || licenseTypes[license].description;
  }
}
