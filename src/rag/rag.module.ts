import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RagController } from './rag.controller';
import { DocumentChunk } from './document-chunk.entity';
import { ChunkingService } from './chunking/chunking.service';
import { EmbeddingService } from './embedding/embedding.service';
import { IngestionService } from './ingestion/ingestion.service';
import { RetrievalService } from './retrieval/retrieval.service';
import { GenerationService } from './generation/generation.service';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentChunk])],
  controllers: [RagController],
  providers: [ChunkingService, EmbeddingService, IngestionService, RetrievalService, GenerationService]
})
export class RagModule {}
