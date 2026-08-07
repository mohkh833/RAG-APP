import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ nullable: true })
  title!: string;

  @Column({ nullable: true })
  source!: string;

  @Column({ name: 'content_hash', unique: true })
  contentHash!: string;

  @CreateDateColumn({ name: 'ingested_at' })
  ingestedAt!: Date;

  @Column({ name: 'user_id' })
  userId!: number;
}
