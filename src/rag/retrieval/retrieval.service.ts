import { Injectable } from '@nestjs/common';
import { EmbeddingService } from '../embedding/embedding.service';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DocumentChunk } from '../document-chunk.entity';
import { Repository } from 'typeorm';

export interface RetrievalChunk {
  content: string;
  metadata: Record<string, any>;
  similarity: number;
}

@Injectable()
export class RetrievalService {
  constructor(
    private embedding: EmbeddingService,
    private config: ConfigService,
    @InjectRepository(DocumentChunk)
    private repo: Repository<DocumentChunk>,
  ) {}

  async retrieve(query: string, topK?: number): Promise<RetrievalChunk[]> {
    const k = topK ?? parseInt(this.config.get('TOP_K', '5'), 10);
    const queryVector = await this.embedding.embed(query);
    const vectorLiteral = `[${queryVector.join(',')}]`;

    console.log('DEBUG k:', k);
    console.log('DEBUG queryVector length:', queryVector.length);
    console.log(
      'DEBUG vectorLiteral (first 80 chars):',
      vectorLiteral.slice(0, 80),
    );

    const result = await this.repo.query(
      `SELECT content, metadata,
            1 - (embedding <=> $1) AS similarity
     FROM document_chunks
     ORDER BY embedding <=> $1
     LIMIT $2`,
      [vectorLiteral, k],
    );

    console.log('DEBUG result:', JSON.stringify(result));

    return result;
  }
}
