import { Injectable, Logger } from '@nestjs/common';
import { Ollama } from 'ollama';
import { RetrievalService } from '../retrieval/retrieval.service';
import { ConfigService } from '@nestjs/config';

export interface RagAnswer {
  answer: string;
  sources: { content: string; similarity: number }[];
}
@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);
  private ollama: Ollama;

  constructor(
    private retrieval: RetrievalService,
    private config: ConfigService,
  ) {
    this.ollama = new Ollama({
      host: this.config.get('OLLAMA_HOST', 'http://127.0.0.1:11434'),
    });
  }

  async answer(question: string): Promise<RagAnswer> {
    const chunks = await this.retrieval.retrieve(question);

    if (chunks.length == 0) {
      return {
        answer:
          "I don't have any relevant documents to answer that. Try ingesting some content first.",
        sources: [],
      };
    }

    const context = chunks
      .map((c, i) => `[${i + 1}] ${c.content}`)
      .join('\n\n');

    const prompt = `You are a helpful assistant. Answer the question using ONLY the context below.
If the answer is not contained in the context, say "I don't know based on the provided documents."
Cite which numbered source(s) you used, like [1], [2].

Context:
${context}

Question: ${question}

Answer:`;

    const model = this.config.get('OLLAMA_MODEL', 'llama3');
    this.logger.log(`Generating answer with model=${model}`);

    const response = await this.ollama.chat({
      model,
      messages: [{ role: 'user', content: prompt }],
    });

    return {
      answer: response.message.content,
      sources: chunks.map((c) => ({
        content: c.content,
        similarity: c.similarity,
      })),
    };
  }
}
