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
    const threshold = parseFloat(
      this.config.get('SIMILARITY_THRESHOLD', '0.35'),
    );
    const vectorWeight = parseFloat(
      this.config.get('HYBRID_VECTOR_WEIGHT', '0.7'),
    );
    const keywordWeight = parseFloat(
      this.config.get('HYBRID_KEYWORD_WEIGHT', '0.3'),
    );

    const queryVector = await this.embedding.embed(query);
    const vectorLiteral = `[${queryVector.join(',')}]`;

    return this.repo.query(
      `WITH scored AS (
       SELECT content, metadata,
              1 - (embedding <=> $1) AS similarity,
              ts_rank(content_tsv, plainto_tsquery('english', $3)) AS keyword_rank,
              content_tsv @@ plainto_tsquery('english', $3) AS keyword_match
       FROM document_chunks
     )
     SELECT content, metadata, similarity,
            $4 * similarity + $5 * keyword_rank AS combined_score
     FROM scored
     WHERE similarity >= $6 OR keyword_match
     ORDER BY combined_score DESC
     LIMIT $2`,
      [vectorLiteral, k, query, vectorWeight, keywordWeight, threshold],
    );
  }
}
