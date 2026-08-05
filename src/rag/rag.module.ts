import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RagController } from './rag.controller';
import { DocumentChunk } from './document-chunk.entity';
import { Document } from './document.entity';
import { ChunkingService } from './chunking/chunking.service';
import { EmbeddingService } from './embedding/embedding.service';
import { IngestionService } from './ingestion/ingestion.service';
import { RetrievalService } from './retrieval/retrieval.service';
import { GenerationService } from './generation/generation.service';
import { DocumentService } from './documents/document.service';
import { DocumentsController } from './documents/documents.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentChunk, Document])],
  controllers: [RagController, DocumentsController],
  providers: [
    ChunkingService,
    EmbeddingService,
    IngestionService,
    RetrievalService,
    GenerationService,
    DocumentService,
  ],
})
export class RagModule {}
