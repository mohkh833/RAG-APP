import {
  Body,
  Controller,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { File as MulterFile } from 'multer';
import type { Response } from 'express';
import { IngestTextDto, QueryDto } from './dto';
import { IngestionService } from './ingestion/ingestion.service';
import { GenerationService } from './generation/generation.service';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
@Controller('rag')
export class RagController {
  constructor(
    private ingestion: IngestionService,
    private generation: GenerationService,
  ) {}

  @Post('ingest')
  async ingest(@Body() dto: IngestTextDto) {
    return this.ingestion.ingestText(dto.text, {
      title: dto.title,
      source: dto.source,
      metadata: dto.metadata,
    });
  }

  @Post('ingest-file')
  @UseInterceptors(FileInterceptor('file'))
  async ingestFile(
    @UploadedFile() file: MulterFile,
    @Body('title') title?: string,
  ) {

    if(!file) throw new BadRequestException("No file uploaded");

    if(file.mimetype !== 'application/pdf') throw new BadRequestException(`Expected a PDF, got ${file.mimetype}`);

    if(file.size > MAX_FILE_SIZE) throw new BadRequestException('File exceed 20MB limit');
    
    const pdfParse = (await import('pdf-parse')).default;
    const parsed = await pdfParse(file.buffer);
    return this.ingestion.ingestText(parsed.text, {
      title: title ?? file.originalname,
      source: file.originalname,
      metadata: { filename: file.originalname },
    });
  }

  @Post('query')
  async query(@Body() dto: QueryDto) {
    return this.generation.answer(dto.question, dto.topK, dto.history ?? []);
  }

  @Post('query-stream')
  async queryStream(@Body() dto: QueryDto, @Res() res: Response) {
    res.setHeader('content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    try {
      for await (const token of this.generation.answerStream(
        dto.question,
        dto.topK,
        dto.history ?? [],
      )) {
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      } 
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    } finally {
      res.end();
    }
  }
}
