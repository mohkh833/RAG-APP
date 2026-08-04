import { ConfigService } from '@nestjs/config';
import { ChunkingService } from './chunking.service';

function makeService(size: number, overlap: number): ChunkingService {
  const config = {
    get: (key: string, fallback: string) => {
      if (key === 'CHUNK_SIZE') return String(size);
      if (key === 'CHUNK_OVERLAP') return String(overlap);
      return fallback;
    },
  } as unknown as ConfigService;
  return new ChunkingService(config);
}

describe('ChunkingService', () => {
  describe('Arabic question mark (؟) as a sentence boundary', () => {
    const arabic =
      'متى غرقت السفينة تيتانيك؟ غرقت السفينة تيتانيك في شهر ابريل من عام 1912؟ ' +
      'نعم هذا صحيح تماما وهي حقيقة تاريخية مؤكدة تماما بلا شك على الاطلاق؟ ' +
      'من الذي بنى السفينة تيتانيك؟ بنتها شركة هارلاند اند وولف الشهيرة في ' +
      'مدينة بلفاست بايرلندا الشمالية؟';

    it('splits on ؟ instead of emitting one oversized sentence', () => {
      const chunks = makeService(100, 20).chunk(arabic);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(100);
      }
    });

    it('keeps حقيقة intact rather than slicing it into حقيق + ة', () => {
      const chunks = makeService(100, 20).chunk(arabic);

      const containing = chunks.filter((c) => c.includes('حقيقة'));
      expect(containing.length).toBeGreaterThan(0);

      // The pre-fix failure mode: a chunk ending on the truncated stem.
      for (const chunk of chunks) {
        expect(chunk.endsWith('حقيق')).toBe(false);
        expect(chunk.startsWith('ة')).toBe(false);
      }
    });

    it('does not split words at any chunk boundary', () => {
      const chunks = makeService(100, 20).chunk(arabic);
      const words = new Set(arabic.split(/\s+/).filter(Boolean));

      for (const chunk of chunks) {
        const first = chunk.split(/\s+/)[0];
        const last = chunk.split(/\s+/).pop() as string;
        // Every boundary token must be a whole word from the source text
        // (punctuation is carried along with the sentence, so tokens match).
        expect([...words].some((w) => w.includes(first))).toBe(true);
        expect([...words].some((w) => w.includes(last))).toBe(true);
        expect(words.has(first)).toBe(true);
        expect(words.has(last)).toBe(true);
      }
    });
  });

  describe('Latin punctuation regression', () => {
    it('still splits on . ! and ?', () => {
      const text =
        'The Titanic sank in 1912. Who built her? ' +
        'Harland and Wolff built her in Belfast!';
      const chunks = makeService(60, 10).chunk(text);

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join(' ')).toContain('Titanic sank in 1912.');
      expect(chunks.join(' ')).toContain('Who built her?');
      expect(chunks.join(' ')).toContain('Belfast!');
    });

    it('returns [] for blank input', () => {
      expect(makeService(100, 20).chunk('   ')).toEqual([]);
    });

    it('falls back to fixed-size slicing for a single oversized sentence', () => {
      const text = 'x'.repeat(250) + '.';
      const chunks = makeService(100, 20).chunk(text);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(100);
      }
    });
  });
});
