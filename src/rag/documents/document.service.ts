import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document } from '../document.entity';

export interface DocumentSummary {
  id: number;
  title: string;
  ingestedAt: Date;
  chunkCount: number;
}

@Injectable()
export class DocumentService {
  constructor(
    @InjectRepository(Document)
    private documentRepo: Repository<Document>,
  ) {}

  async list(userId: number): Promise<DocumentSummary[]> {
    return this.documentRepo.query(
      `SELECT d.id, d.title, d.ingested_at AS "ingestedAt", count(c.id)::int AS "chunkCount"
       FROM documents d
       LEFT JOIN document_chunks c ON c.document_id = d.id
       WHERE d.user_id = $1
       GROUP BY d.id
       ORDER BY d.ingested_at DESC`,
      [userId],
    );
  }

  async delete(id: number, userId: number): Promise<{ deleted: boolean }> {
    const document = await this.documentRepo.findOne({ where: { id } });

    if (!document) {
      throw new NotFoundException(`Document ${id} not found`);
    }
    if (document.userId !== userId) {
      throw new ForbiddenException(
        "You don't have permission to delete this document",
      );
    }

    const result = await this.documentRepo.delete({ id });
    return { deleted: (result.affected ?? 0) > 0 };
  }
}
