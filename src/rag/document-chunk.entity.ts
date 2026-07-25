import {
  Entity,
  Column,
  CreateDateColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('document_chunks')
export class DocumentChunk {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column('text')
  content!: string;

  @Column('jsonb', { nullable: true })
  metadata!: Record<string, any>;

  @Column({ name: 'document_id', nullable: true })
  documentId!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
