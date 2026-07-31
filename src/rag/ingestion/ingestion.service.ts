import { Injectable, Logger } from '@nestjs/common';
import { ChunkingService } from '../chunking/chunking.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { InjectRepository } from '@nestjs/typeorm';
import { DocumentChunk } from '../document-chunk.entity';
import { Document } from '../document.entity';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';

const UNIQUE_VIOLATION = '23505';

export interface IngestOptions {
  title?: string;
  source?: string;
  metadata?: Record<string, any>;
}

export interface IngestResult {
  documentId: number;
  chunksStored: number;
  chunksSkipped: number;
}

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
    @InjectRepository(Document)
    private documentRepo: Repository<Document>,
  ) {}

  async ingestText(text: string, opts: IngestOptions = {}): Promise<IngestResult> {
    const textHash = hashContent(text);

    const alreadyIngested = await this.findIngested(textHash);
    if (alreadyIngested) return alreadyIngested;

    const chunks = this.chunking.chunk(text);
    const unique: { content: string; contentHash: string }[] = [];
    const seen = new Set<string>();

    for (const content of chunks) {
      const contentHash = hashContent(content);
      if (seen.has(contentHash)) continue;
      seen.add(contentHash);
      unique.push({ content, contentHash });
    }

    const skipped = chunks.length - unique.length;
    this.logger.log(
      `Embedding ${unique.length} chunks (${skipped} duplicates skipped)`,
    );

    // Embed before opening the transaction: inference is slow, and a failure
    // here must leave no document row behind for the content hash to claim.
    const embedded: { content: string; contentHash: string; vector: string }[] =
      [];
    for (const chunk of unique) {
      embedded.push({
        ...chunk,
        vector: toVectorLiteral(await this.embedding.embed(chunk.content)),
      });
    }

    const metadata = opts.metadata ?? {};

    try {
      const documentId = await this.documentRepo.manager.transaction(
        async (manager) => {
          const document = await manager.getRepository(Document).save({
            title: opts.title ?? 'Untitled document',
            source: opts.source,
            contentHash: textHash,
          });

          for (const chunk of embedded) {
            await manager.query(
              `INSERT INTO document_chunks (content, embedding, metadata, document_id, content_hash)
               VALUES ($1, $2, $3, $4, $5)`,
              [
                chunk.content,
                chunk.vector,
                metadata,
                document.id,
                chunk.contentHash,
              ],
            );
          }

          return document.id;
        },
      );

      this.logger.log(
        `Stored document ${documentId}: ${embedded.length} chunks, ${skipped} duplicates skipped`,
      );
      return {
        documentId,
        chunksStored: embedded.length,
        chunksSkipped: skipped,
      };
    } catch (err) {
      // A concurrent ingest of identical text won the unique constraint race.
      const driverError = (err as { driverError?: { code?: string } })
        ?.driverError;
      if (driverError?.code === UNIQUE_VIOLATION) {
        const raced = await this.findIngested(textHash);
        if (raced) return raced;
      }
      throw err;
    }
  }

  private async findIngested(textHash: string): Promise<IngestResult | null> {
    const existing = await this.documentRepo.findOne({
      where: { contentHash: textHash },
    });
    if (!existing) return null;

    const chunkCount = await this.repo.count({
      where: { documentId: existing.id },
    });
    this.logger.log(
      `Document ${existing.id} already ingested (identical content); skipping ${chunkCount} chunks`,
    );
    return {
      documentId: existing.id,
      chunksStored: 0,
      chunksSkipped: chunkCount,
    };
  }
}
