import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('knowledge_entries')
export class KnowledgeEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar' })
  source: string; // 'manual_oficial_pba' | 'reglas_locales'

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  // Vector de 1536 dimensiones para OpenAI text-embedding-3-small
  @Column({ type: 'vector', width: 1536, nullable: true })
  embedding: number[];

  @CreateDateColumn()
  createdAt: Date;
}
