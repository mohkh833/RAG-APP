import { Injectable, Logger } from '@nestjs/common';
import { Ollama } from 'ollama';
import { RetrievalService } from '../retrieval/retrieval.service';
import { ConfigService } from '@nestjs/config';
import { ChatMessage } from '../dto';

export interface RagAnswer {
  answer: string;
  sources: { content: string; similarity: number }[];
}

@Injectable()
export class GenerationService {
  private static readonly NO_CONTEXT_MESSAGE =
    "I don't have any relevant documents to answer that. Try ingesting some content first.";

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

  private buildPrompt(
    question: string,
    chunks: { content: string }[],
    history: ChatMessage[] = [],
  ): string {
    const context = chunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n');

    const historyBlock =
      history.length > 0
        ? `Conversation so far:\n${history
            .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n')}\n\n`
        : '';

    return `You are a helpful assistant. Answer the question using ONLY the context below.
Use the conversation history only to understand what the current question is referring to
(e.g. pronouns like "it" or "that") — do not invent facts from the conversation itself.
If the answer is not contained in the context, say "I don't know based on the provided documents."
Cite which numbered source(s) you used, like [1], [2].

Write your answer in the SAME LANGUAGE as the question, regardless of what
language the context is in. If the question is in Arabic, answer in Arabic —
including the "I don't know" response above, translated.
Answer the question directly. Do not comment on the wording of the sources or
on the question itself; some sources are themselves phrased as questions, and
that is not something to remark on.

${historyBlock}Context:
${context}

Question: ${question}

Answer:`;
  }

  private buildRewritePrompt(question: string, history: ChatMessage[]): string {
    const historyBlock = history
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    return `Given this conversation history and a follow-up question, rewrite the
follow-up as a standalone question that doesn't require the history to
understand.

Rules:
- Replace pronouns with the specific thing they refer to, taken from the history.
- Keep the follow-up's original intent. Do not answer it, and do not ask about
  something else.
- Write the rewritten question in the SAME LANGUAGE as the follow-up. If the
  follow-up is in Arabic, the rewritten question must be in Arabic.
- Copy names exactly as they are spelled in the history.
- Use correct spelling and grammar. Misspellings degrade retrieval.
- Only output the rewritten question, nothing else.

Example 1:
History:
User: When did the Titanic sink?
Assistant: It sank in 1912.
Follow-up: Who built it?
Standalone question: Who built the Titanic?

Example 2:
History:
User: ما هي عاصمة فرنسا؟
Assistant: عاصمة فرنسا هي باريس.
Follow-up: كم عدد سكانها؟
Standalone question: كم عدد سكان باريس؟

Example 3:
History:
User: متى بنيت الأهرامات؟
Assistant: بنيت الأهرامات قبل أكثر من أربعة آلاف عام.
Follow-up: من الذي بناها؟
Standalone question: من الذي بنى الأهرامات؟

History:
${historyBlock}

Follow-up: ${question}

Standalone question:`;
  }

  /**
   * Turns a context-dependent follow-up ("Who built it?") into a standalone
   * question ("Who built the Titanic?") so the retrieval embedding is sharp
   * instead of diluted by concatenated history. Costs one extra Ollama call
   * per query with history — an accepted tradeoff.
   */
  private async rewriteQueryWithHistory(
    question: string,
    history: ChatMessage[] = [],
  ): Promise<string> {
    if (history.length === 0) return question;

    const model = this.config.get('OLLAMA_MODEL', 'llama3');

    try {
      const response = await this.ollama.chat({
        model,
        messages: [
          { role: 'user', content: this.buildRewritePrompt(question, history) },
        ],
        options: { temperature: 0 },
      });

      const rewritten = response.message.content.trim().replace(/^["']|["']$/g, '');

      if (!rewritten) {
        this.logger.warn(`Query rewrite returned empty output, using original question`);
        return question;
      }

      this.logger.log(`Rewrote "${question}" -> "${rewritten}"`);
      return rewritten;
    } catch (err) {
      this.logger.warn(
        `Query rewrite failed, falling back to original question: ${err instanceof Error ? err.message : err}`,
      );
      return question;
    }
  }

  private async prepare(
    question: string,
    mode: 'Generating' | 'Streaming',
    topK?: number,
    history: ChatMessage[] = [],
  ) {
    const retrievalQuery = await this.rewriteQueryWithHistory(question, history);
    const chunks = await this.retrieval.retrieve(retrievalQuery, topK);

    if (chunks.length === 0) {
      return null;
    }

    const prompt = this.buildPrompt(question, chunks, history);
    const model = this.config.get('OLLAMA_MODEL', 'llama3');
    this.logger.log(`${mode} answer with model=${model}`);

    return { chunks, prompt, model };
  }

  async answer(
    question: string,
    topK?: number,
    history: ChatMessage[] = [],
  ): Promise<RagAnswer> {
    const prepared = await this.prepare(question, 'Generating', topK, history);

    if (!prepared) {
      return { answer: GenerationService.NO_CONTEXT_MESSAGE, sources: [] };
    }

    const { chunks, prompt, model } = prepared;

    const response = await this.ollama.chat({
      model,
      messages: [{ role: 'user', content: prompt }],
    });

    return {
      answer: response.message.content,
      sources: chunks.map((c) => ({ content: c.content, similarity: c.similarity })),
    };
  }

  async *answerStream(
    question: string,
    topK?: number,
    history: ChatMessage[] = [],
  ): AsyncGenerator<string> {
    const prepared = await this.prepare(question, 'Streaming', topK, history);

    if (!prepared) {
      yield GenerationService.NO_CONTEXT_MESSAGE;
      return;
    }

    const { prompt, model } = prepared;

    const stream = await this.ollama.chat({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    });

    for await (const part of stream) {
      yield part.message.content;
    }
  }
}