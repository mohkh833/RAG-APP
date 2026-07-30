import { Injectable, Logger } from '@nestjs/common';
import { ChunkingService } from '../chunking/chunking.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { InjectRepository } from '@nestjs/typeorm';
import { DocumentChunk } from '../document-chunk.entity';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private chunking: ChunkingService,
    private embedding: EmbeddingService,
    @InjectRepository(DocumentChunk)
    private repo: Repository<DocumentChunk>,
  ) {}

  async ingestText(
    text: string,
    documentId: number,
    metadata: Record<string, any> = {},
  ): Promise<{ chunksStored: number; chunksSkipped: number }> {
    const chunks = this.chunking.chunk(text);
    this.logger.log(
      `Ingesting document ${documentId}: ${chunks.length} chunks`,
    );

    let stored = 0;
    let skipped = 0;

    for (const content of chunks) {
      const contentHash = hashContent(content);

      const existing = await this.repo.query(
        `SELECT id FROM document_chunks
         WHERE document_id = $1 AND content_hash = $2
         LIMIT 1`,
        [documentId, contentHash],
      );

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      const vector = await this.embedding.embed(content);
      await this.repo.query(
        `INSERT INTO document_chunks (content, embedding, metadata, document_id, content_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [content, toVectorLiteral(vector), metadata, documentId, contentHash],
      );
      stored++;
    }

    this.logger.log(`Stored ${stored}, skipped ${skipped} duplicates`);
    return { chunksStored: stored, chunksSkipped: skipped };
  }
}
