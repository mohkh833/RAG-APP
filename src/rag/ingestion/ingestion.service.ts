import { Injectable, Logger } from '@nestjs/common';
import { ChunkingService } from '../chunking/chunking.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { InjectRepository } from '@nestjs/typeorm';
import { DocumentChunk } from '../document-chunk.entity';
import { Repository } from 'typeorm';

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
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
  ): Promise<{ chunksStored: number }> {
    const chunks = this.chunking.chunk(text);
    this.logger.log(
      `Ingesting document ${documentId}: ${chunks.length} chunks`,
    );

    for (const content of chunks) {
      const vector = await this.embedding.embed(content);
      await this.repo.query(
        `INSERT INTO document_chunks (content, embedding, metadata, document_id)
            VALUES ($1, $2, $3, $4)`,
        [content, toVectorLiteral(vector), metadata, documentId],
      );
    }

    return { chunksStored: chunks.length };
  }
}
