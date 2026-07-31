export class ChatMessage {
  role!: 'user' | 'assistant';
  content!: string;
}

export class IngestTextDto {
  text!: string;
  title?: string;
  source?: string;
  metadata?: Record<string, any>;
}

export class QueryDto {
  question!: string;
  topK?: number;
  history?: ChatMessage[];
}
