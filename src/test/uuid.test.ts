import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateUuid } from '@/lib/uuid';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('generateUuid', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses crypto.getRandomValues when available', () => {
    const getRandomValues = vi.spyOn(crypto, 'getRandomValues');

    expect(generateUuid()).toMatch(UUID_V4_PATTERN);
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it('falls back when crypto.getRandomValues fails', () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(() => {
      throw new Error('crypto.getRandomValues is unavailable');
    });

    expect(generateUuid()).toMatch(UUID_V4_PATTERN);
  });
});
