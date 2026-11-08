import { z } from 'zod';
import { isAddress, getAddress, zeroAddress } from 'viem';
import { LEGAL_VERSION } from './legal.js';
export const categories = ['Illustration', 'Photography', '3D Art', 'Graphic Design'] as const;
export const licenseTypes = {
  personal: {
    title: 'Personal',
    factor: 1,
    description: 'For personal projects without commercial use.',
  },
  commercial: {
    title: 'Commercial',
    factor: 2.5,
    description: 'For commercial projects by one license holder. No resale of the source file.',
  },
  extended: {
    title: 'Extended',
    factor: 5,
    description: 'For reproduction and large projects. Confirm the terms with the creator.',
  },
};
export const planRules = {
  free: { name: 'Free', price: 0, limit: 5, commission: 10 },
  premium: { name: 'Premium', price: 10, limit: 10000, commission: 5 },
  business: { name: 'Business', price: 50, limit: 10000, commission: 0 },
};
const name = z.string().trim().min(2, 'Use at least 2 characters.').max(80);
const email = z
  .email('Enter a valid email address.')
  .max(254)
  .transform((v) => v.toLowerCase());
const password = z.string().min(8, 'Use at least 8 characters.').max(128);
export const registerSchema = z.object({
  name,
  email,
  password,
  legalAccepted: z.literal(true, {
    error: 'Accept the prototype terms and data processing consent.',
  }),
  legalVersion: z.literal(LEGAL_VERSION),
});
export const loginSchema = z.object({ email, password });
export const profileSchema = z.object({
  name,
  email,
  role: z.enum(['Creator and buyer', 'Creator', 'Buyer', 'Studio']).default('Creator and buyer'),
});
export const licenseSchema = z.enum(['personal', 'commercial', 'extended']);
const artworkDetailsSchema = z.object({
  licenseDurationDays: z.coerce
    .number()
    .refine((v) => [0, 30, 90, 365].includes(v), 'Choose a supported license period.')
    .default(0),
  title: z.string().trim().min(2, 'Use at least 2 characters.').max(100),
  description: z
    .string()
    .trim()
    .min(10, 'Describe your artwork in at least 10 characters.')
    .max(1500),
  category: z.enum(categories),
  price: z.coerce.number().min(1).max(100000),
  licenses: z
    .array(licenseSchema)
    .min(1, 'Select at least one license.')
    .max(3)
    .transform((v) => [...new Set(v)]),
  status: z.enum(['published', 'draft']).default('published'),
});
export const purchaseSchema = z.object({
  items: z
    .array(z.object({ artworkId: z.string().min(1).max(100), license: licenseSchema }))
    .min(1)
    .max(50),
});
export const planSchema = z.object({ plan: z.enum(['free', 'premium', 'business']) });
export const recipientListSchema = z
  .array(
    z.object({
      name,
      percent: z.coerce.number().int().min(1).max(99),
      wallet: z
        .string()
        .trim()
        .optional()
        .refine(
          (v) => !v || (isAddress(v) && v.toLowerCase() !== zeroAddress),
          'Enter a valid, nonzero Ethereum wallet.',
        )
        .transform((v) => (v ? getAddress(v) : undefined)),
    }),
  )
  .max(10)
  .refine((recipients) => recipients.reduce((s, r) => s + r.percent, 0) <= 99, {
    message: 'Recipient shares must total no more than 99%.',
  })
  .refine(
    (recipients) => {
      const wallets = recipients.flatMap((r) => (r.wallet ? [r.wallet.toLowerCase()] : []));
      return new Set(wallets).size === wallets.length;
    },
    { message: 'Each co-author wallet must be unique.' },
  );
export const recipientsSchema = z.object({ recipients: recipientListSchema });
export const teamSchema = z.object({ name, email });
export const artworkSchema = artworkDetailsSchema.extend({
  recipients: recipientListSchema.default([]),
});
export type ArtworkInput = z.input<typeof artworkSchema>;
