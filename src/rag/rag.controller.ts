import {
  Body,
  Controller,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { IngestionService } from './ingestion/ingestion.service';
import { GenerationService } from './generation/generation.service';
import { IngestTextDto, QueryDto } from './dto';
import type { Response } from 'express';
import type { RequestUser } from '../auth/current-user.decorator';

@Controller('rag')
@UseGuards(JwtAuthGuard)
export class RagController {
  constructor(
    private ingestion: IngestionService,
    private generation: GenerationService,
  ) {}

  @Post('ingest')
  async ingest(@Body() dto: IngestTextDto, @CurrentUser() user: RequestUser) {
    return this.ingestion.ingestText(dto.text, user.userId, {
      title: dto.title,
      source: dto.source,
      metadata: dto.metadata,
    });
  }

  @Post('ingest-file')
  @UseInterceptors(FileInterceptor('file'))
  async ingestFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('title') title: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    const pdfParse = (await import('pdf-parse')).default;
    const parsed = await pdfParse(file.buffer);
    return this.ingestion.ingestText(parsed.text, user.userId, {
      title: title ?? file.originalname,
      source: file.originalname,
    });
  }

  @Post('query')
  async query(@Body() dto: QueryDto, @CurrentUser() user: RequestUser) {
    return this.generation.answer(
      dto.question,
      user.userId,
      dto.topK,
      dto.history,
    );
  }

  @Post('query-stream')
  async queryStream(
    @Body() dto: QueryDto,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      for await (const token of this.generation.answerStream(
        dto.question,
        user.userId,
        dto.topK,
        dto.history,
      )) {
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    } finally {
      res.end();
    }
  }
}
