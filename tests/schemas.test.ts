import { describe, it, expect } from 'vitest';
import { registerSchema, artworkSchema, purchaseSchema, recipientsSchema } from '../shared/schemas';
describe('shared request validation', () => {
  it('normalizes email and refuses weak or malformed registration data', () => {
    expect(
      registerSchema.parse({
        name: 'Alice',
        legalAccepted: true,
        legalVersion: '2026-11-08.1',
        email: 'Alice@Example.test',
        password: 'local-password',
      }).email,
    ).toBe('alice@example.test');
    expect(registerSchema.safeParse({ name: 'A', email: 'bad', password: 'short' }).success).toBe(
      false,
    );
  });
  it('coerces artwork prices, deduplicates licenses, and rejects invalid prices', () => {
    const artwork = {
      title: 'Artwork',
      description: 'An original illustration.',
      category: 'Illustration',
      price: '24.50',
      licenses: ['personal', 'personal'],
      status: 'published',
    };
    expect(artworkSchema.parse(artwork)).toMatchObject({ price: 24.5, licenses: ['personal'] });
    expect(artworkSchema.safeParse({ ...artwork, price: 'NaN' }).success).toBe(false);
    expect(artworkSchema.safeParse({ ...artwork, licenses: [] }).success).toBe(false);
  });
  it('rejects malformed purchases and recipient totals', () => {
    expect(purchaseSchema.safeParse({ items: [null] }).success).toBe(false);
    expect(
      purchaseSchema.safeParse({ items: [{ artworkId: 'work', license: 'invalid' }] }).success,
    ).toBe(false);
    expect(
      recipientsSchema.safeParse({
        recipients: [
          { name: 'One', percent: 60 },
          { name: 'Two', percent: 50 },
        ],
      }).success,
    ).toBe(false);
  });
});
