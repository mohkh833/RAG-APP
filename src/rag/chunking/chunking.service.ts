import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ChunkingService {
  constructor(private config: ConfigService) {}

  chunk(text: string): string[] {
    const size = parseInt(this.config.get('CHUNK_SIZE', '500'), 10);
    const overlap = parseInt(this.config.get('CHUNK_OVERLAP', '50'), 10);

    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return [];

    const chunks: string[] = [];
    let start = 0;

    while (start < cleaned.length) {
      const end = Math.min(start + size, cleaned.length);
      chunks.push(cleaned.slice(start, end));
      if (end === cleaned.length) break;
      start += size - overlap;
    }

    return chunks;
  }
}
