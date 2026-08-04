import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ChunkingService {
  constructor(private config: ConfigService) {}

  chunk(text: string): string[] {
    const size = parseInt(this.config.get('CHUNK_SIZE', '500'), 10);
    const overlap = parseInt(this.config.get('CHUNK_OVERLAP', '50'), 10);

    const cleaned = text.replace(/\s+/g, ' ').trim();
    if(!cleaned) return [];

    const sentences = this.splitIntoSentences(cleaned);
    return this.packSentencesIntoChunks(sentences, size, overlap);
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
    let currentLength = 0;

    for (const sentence of sentences) {
      if (current.length > 0) {
        chunks.push(current.join(' '));
        current = [];
        currentLength = 0;
      }
      chunks.push(...this.fixedSizeSlice(sentence, size, overlap));
      continue;
    }

    if (currentLength + sentences.length > size && current.length > 0) {
      chunks.push(current.join(' '));
      const lastSentence = current[current.length - 1];
      current = lastSentence.length <= overlap ? [lastSentence] : [];
      currentLength = current.reduce((sum, s) => sum + s.length + 1, 0);
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
      start += size - overlap;
    }
    return chunks;
  }
}
