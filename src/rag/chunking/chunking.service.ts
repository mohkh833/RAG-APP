import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ChunkingService {
  constructor(private config: ConfigService) {}

  chunk(text: string): string[] {
    const size = Math.max(1, this.readInt('CHUNK_SIZE', 500));
    // An overlap >= size makes fixedSizeSlice's step (size - overlap) zero or
    // negative, so it would never advance. Cap it at half the chunk size.
    const overlap = Math.min(
      Math.max(0, this.readInt('CHUNK_OVERLAP', 50)),
      Math.floor(size / 2),
    );

    const cleaned = text.replace(/\s+/g, ' ').trim();
    if(!cleaned) return [];

    const sentences = this.splitIntoSentences(cleaned);
    return this.packSentencesIntoChunks(sentences, size, overlap);
  }

  private readInt(key: string, fallback: number): number {
    const parsed = parseInt(this.config.get(key, String(fallback)), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private splitIntoSentences(text: string): string[] {
    // Includes ؟ (U+061F, Arabic question mark) alongside Latin terminators.
    // Note: text with no punctuation at all still has no detectable sentence
    // structure and will fall through to fixedSizeSlice once it exceeds size.
    const matches = text.match(/[^.!?؟]+[.!?؟]+(\s|$)/g);
    if (!matches) return [text];
    return matches.map((s) => s.trim()).filter(Boolean);
  }

  private packSentencesIntoChunks(
    sentences: string[],
    size: number,
    overlap: number,
  ): string[] {
    const chunks: string[] = [];
    let current: string[] = [];

    // Length of current.join(' '), i.e. including the single-space separators.
    const joinedLength = (parts: string[]) =>
      parts.reduce((sum, s) => sum + s.length, 0) + Math.max(0, parts.length - 1);

    const wouldOverflow = (sentence: string) =>
      joinedLength([...current, sentence]) > size;

    for (const sentence of sentences) {
      // Oversized on its own: no amount of packing helps, so emit what we have
      // and hand this sentence to the character-level fallback.
      if (sentence.length > size) {
        if (current.length > 0) {
          chunks.push(current.join(' '));
          current = [];
        }
        chunks.push(...this.fixedSizeSlice(sentence, size, overlap));
        continue;
      }

      if (current.length > 0 && wouldOverflow(sentence)) {
        chunks.push(current.join(' '));
        // Carry the trailing sentence into the next chunk as overlap, but only
        // when it is short enough to read as overlap rather than duplication.
        const lastSentence = current[current.length - 1];
        current = lastSentence.length <= overlap ? [lastSentence] : [];
        // The carried sentence must not itself push the next chunk over size.
        if (current.length > 0 && wouldOverflow(sentence)) current = [];
      }

      current.push(sentence);
    }

    if (current.length > 0) {
      chunks.push(current.join(' '));
    }

    return chunks;
  }

  private fixedSizeSlice(
    text: string,
    size: number,
    overlap: number,
  ): string[] {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + size, text.length);
      chunks.push(text.slice(start, end));
      if (end === text.length) break;
      // Guard the step independently of the caller's clamp: a non-positive
      // step here would loop forever.
      start += Math.max(1, size - overlap);
    }
    return chunks;
  }
}
