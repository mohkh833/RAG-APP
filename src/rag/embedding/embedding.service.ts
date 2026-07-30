import { Injectable, Logger } from '@nestjs/common';
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private embedder: any = null;
  private loadingPromise: Promise<any> | null = null;

  private async getEmbedder() {
    if (this.embedder) return this.embedder;
    if (!this.loadingPromise) {
      this.logger.log(
        'Loading local multilingual embedding model (first call only)...',
      );
      this.loadingPromise = import('@xenova/transformers').then(
        ({ pipeline }) =>
          pipeline(
            'feature-extraction',
            'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
          ),
      );
    }
    this.embedder = await this.loadingPromise;
    this.logger.log('Embedding model ready.');
    return this.embedder;
  }

  async embed(text: string): Promise<number[]> {
    const embedder = await this.getEmbedder();
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}
