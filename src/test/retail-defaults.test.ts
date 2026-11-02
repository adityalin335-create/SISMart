import { afterEach, describe, expect, it, vi } from 'vitest';
import { db, seedDefaultData } from '@/lib/db';

describe('retail-oriented defaults', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.categories.clear();
    await db.units.clear();
    await db.paymentMethods.clear();
    await db.storeSettings.clear();
  });

  it('seeds minimarket categories and retail units instead of F&B defaults', async () => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('crypto.randomUUID is unavailable');
    });
    await db.categories.clear();
    await db.units.clear();
    await db.paymentMethods.clear();
    await db.storeSettings.clear();

    await seedDefaultData();

    expect((await db.categories.toArray()).map(category => category.name)).toEqual([
      'Sembako',
      'Makanan & Minuman Kemasan',
      'Perawatan & Rumah Tangga',
    ]);
    expect((await db.units.toArray()).map(unit => unit.name)).toEqual([
      'pcs',
      'botol',
      'sachet',
      'pack',
      'dus',
    ]);
    const storeSettings = await db.storeSettings.toCollection().first();
    expect(storeSettings?.deviceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });
});
