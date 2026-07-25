export class IngestTextDto {
  text!: string;
  documentId!: number;
  metadata?: Record<string, any>;
}

export class QueryDto {
  question!: string;
  topK?: number;
}