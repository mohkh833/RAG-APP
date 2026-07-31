import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document } from '../document.entity';

export interface DocumentSummary {
  id: number;
  title: string | null;
  source: string | null;
  ingestedAt: Date;
  chunkCount: number;
}

@Injectable()
export class DocumentService {
  constructor(
    @InjectRepository(Document)
    private documentRepo: Repository<Document>,
  ) {}

  async list(): Promise<DocumentSummary[]> {
    return this.documentRepo.query(`
      SELECT d.id,
             d.title,
             d.source,
             d.ingested_at AS "ingestedAt",
             count(c.id)::int AS "chunkCount"
      FROM documents d
      LEFT JOIN document_chunks c ON c.document_id = d.id
      GROUP BY d.id
      ORDER BY d.ingested_at DESC
    `);
  }

  async delete(id: number): Promise<{ deleted: true }> {
    const result = await this.documentRepo.delete({ id });
    if ((result.affected ?? 0) === 0) {
      throw new NotFoundException(`Document ${id} not found`);
    }
    return { deleted: true };
  }
}
