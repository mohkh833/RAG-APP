import { hashContent } from './ingestion.service';

// Pure function, no DI — imported and called directly, no testing module.
describe('hashContent', () => {
  it('is deterministic for the same input', () => {
    expect(hashContent('the titanic sank in 1912')).toBe(
      hashContent('the titanic sank in 1912'),
    );
  });

  it('is stable across many calls (no salt or randomness)', () => {
    const hashes = new Set(
      Array.from({ length: 50 }, () => hashContent('same content')),
    );
    expect(hashes.size).toBe(1);
  });

  it('produces different hashes for different inputs', () => {
    expect(hashContent('chunk a')).not.toBe(hashContent('chunk b'));
  });

  it('is sensitive to small differences', () => {
    const inputs = ['titanic', 'Titanic', 'titanic ', ' titanic', 'titanlc'];
    const hashes = new Set(inputs.map(hashContent));
    expect(hashes.size).toBe(inputs.length);
  });

  it('returns a 64-char lowercase hex sha256 digest', () => {
    expect(hashContent('anything')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches the known sha256 of an empty string', () => {
    expect(hashContent('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('hashes identical Arabic content identically', () => {
    expect(hashContent('غرقت السفينة تيتانيك')).toBe(
      hashContent('غرقت السفينة تيتانيك'),
    );
    expect(hashContent('غرقت السفينة تيتانيك')).not.toBe(
      hashContent('غرقت السفينة'),
    );
  });
});
