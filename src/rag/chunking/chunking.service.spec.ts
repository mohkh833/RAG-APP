import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ChunkingService } from './chunking.service';

/**
 * ConfigService stub so each test controls CHUNK_SIZE / CHUNK_OVERLAP
 * directly instead of depending on whatever .env happens to hold.
 */
function stubConfig(size: number, overlap: number): ConfigService {
  return {
    get: (key: string, fallback: string) => {
      if (key === 'CHUNK_SIZE') return String(size);
      if (key === 'CHUNK_OVERLAP') return String(overlap);
      return fallback;
    },
  } as unknown as ConfigService;
}

/** DI is exercised here because ChunkingService reads config through injection. */
async function buildService(
  size: number,
  overlap: number,
): Promise<ChunkingService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      ChunkingService,
      { provide: ConfigService, useValue: stubConfig(size, overlap) },
    ],
  }).compile();
  return moduleRef.get(ChunkingService);
}

describe('ChunkingService', () => {
  describe('sentence splitting', () => {
    it('splits English text on . ! and ?', async () => {
      const service = await buildService(500, 50);
      const chunks = service.chunk(
        'The Titanic sank in 1912. Who built her? Harland and Wolff did!',
      );

      const joined = chunks.join(' | ');
      expect(joined).toContain('The Titanic sank in 1912.');
      expect(joined).toContain('Who built her?');
      expect(joined).toContain('Harland and Wolff did!');
    });

    it('splits Arabic text on ؟ (U+061F) into 2 sentences, not 1', async () => {
      const service = await buildService(500, 50);
      const chunks = service.chunk(
        'متى غرقت السفينة تيتانيك؟ غرقت في عام 1912؟',
      );

      // Both halves must be present as separate units, i.e. the ؟ between
      // them was recognised as a terminator rather than ordinary text.
      const sentences = chunks.join(' ').split('؟').filter((s) => s.trim());
      expect(sentences).toHaveLength(2);
      expect(chunks.some((c) => c.includes('متى غرقت السفينة تيتانيك'))).toBe(
        true,
      );
      expect(chunks.some((c) => c.includes('غرقت في عام 1912'))).toBe(true);
    });

    it('does not cut an Arabic word in half (regression: ؟ not recognised)', async () => {
      const service = await buildService(100, 20);
      const text =
        'متى غرقت السفينة تيتانيك؟ غرقت السفينة تيتانيك في شهر ابريل من عام 1912؟ ' +
        'نعم هذا صحيح تماما وهي حقيقة تاريخية مؤكدة تماما بلا شك على الاطلاق؟ ' +
        'من الذي بنى السفينة تيتانيك؟';

      const chunks = service.chunk(text);

      // Before the ؟ fix this was one oversized "sentence", so the fixed-size
      // fallback sliced it and truncated حقيقة to حقيق.
      expect(chunks.some((c) => c.includes('حقيقة'))).toBe(true);
      for (const chunk of chunks) {
        expect(chunk.endsWith('حقيق')).toBe(false);
        expect(chunk.startsWith('ة')).toBe(false);
      }
    });

    it('treats unpunctuated text as a single sentence', async () => {
      const service = await buildService(500, 50);
      expect(service.chunk('no terminator here at all')).toEqual([
        'no terminator here at all',
      ]);
    });
  });

  describe('empty input', () => {
    it('returns [] for an empty string', async () => {
      const service = await buildService(500, 50);
      expect(service.chunk('')).toEqual([]);
    });

    it('returns [] for a whitespace-only string', async () => {
      const service = await buildService(500, 50);
      expect(service.chunk('   \n\t  ')).toEqual([]);
    });
  });

  describe('packing', () => {
    it('packs multiple short sentences into one chunk when they fit', async () => {
      const service = await buildService(200, 20);
      const text = 'One two. Three four. Five six.';

      const chunks = service.chunk(text);

      // All three sentences total ~30 chars, well under CHUNK_SIZE=200,
      // so they belong in a single chunk — not one chunk per sentence.
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toContain('One two.');
      expect(chunks[0]).toContain('Three four.');
      expect(chunks[0]).toContain('Five six.');
    });

    it('carries a short trailing sentence forward as overlap', async () => {
      const service = await buildService(24, 12);
      // "Alpha one. Beta two." is 20 chars and fits; adding "Gamma three."
      // reaches 33 and overflows. "Beta two." (9) is <= overlap=12, so it
      // repeats at the head of chunk 2.
      const chunks = service.chunk('Alpha one. Beta two. Gamma three.');

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0]).toContain('Beta two.');
      expect(chunks[1]).toContain('Beta two.');
    });

    it('does not carry a trailing sentence longer than the overlap', async () => {
      const service = await buildService(60, 10);
      const text =
        'This first sentence is comfortably long. This second one is too.';
      const chunks = service.chunk(text);

      // Both sentences exceed overlap=10, so neither may be duplicated.
      const occurrences = chunks.filter((c) =>
        c.includes('This first sentence is comfortably long.'),
      );
      expect(occurrences).toHaveLength(1);
    });

    it('never lands a chunk boundary mid-word for a realistic paragraph', async () => {
      const service = await buildService(120, 20);
      const text =
        'The Titanic was a British passenger liner. She struck an iceberg ' +
        'on her maiden voyage. The ship sank in the North Atlantic. ' +
        'More than fifteen hundred people died in the disaster.';

      const chunks = service.chunk(text);
      const words = new Set(text.split(/\s+/).filter(Boolean));

      for (const chunk of chunks) {
        const tokens = chunk.split(/\s+/).filter(Boolean);
        expect(words.has(tokens[0])).toBe(true);
        expect(words.has(tokens[tokens.length - 1])).toBe(true);
      }
    });
  });

  describe('fixed-size fallback', () => {
    it('slices a single sentence that exceeds CHUNK_SIZE on its own', async () => {
      const service = await buildService(100, 20);
      const chunks = service.chunk('x'.repeat(250) + '.');

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(100);
      }
    });

    it('does not slice when every sentence fits under CHUNK_SIZE', async () => {
      const service = await buildService(500, 50);
      const text = 'Short one. Short two. Short three.';

      // Nothing here is oversized, so no chunk should be a mid-sentence cut.
      for (const chunk of service.chunk(text)) {
        expect(chunk).toMatch(/[.!?؟]$/);
      }
    });

    // Without the clamp, `start += size - overlap` never advances and this
    // loops until the heap dies — a synchronous hang no jest timeout can stop.
    it.each([
      { label: 'overlap equal to size', size: 100, overlap: 100 },
      { label: 'overlap greater than size', size: 100, overlap: 500 },
      { label: 'negative overlap', size: 100, overlap: -50 },
    ])('clamps $label (no infinite loop)', async ({ size, overlap }) => {
      const service = await buildService(size, overlap);
      const chunks = service.chunk('x'.repeat(250) + '.');

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.length).toBeLessThan(20);
      for (const chunk of chunks) {
        expect(chunk.length).toBeGreaterThan(0);
        expect(chunk.length).toBeLessThanOrEqual(size);
      }
    });

    it('survives a non-numeric CHUNK_SIZE / CHUNK_OVERLAP', async () => {
      const service = await buildService(NaN as unknown as number, NaN as unknown as number);
      const chunks = service.chunk('Short one. Short two.');

      expect(chunks.length).toBeGreaterThan(0);
    });
  });
});
