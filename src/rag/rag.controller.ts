import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { File as MulterFile } from 'multer';

import { IngestTextDto, QueryDto } from './dto';
import { IngestionService } from './ingestion/ingestion.service';
import { GenerationService } from './generation/generation.service';

@Controller('rag')
export class RagController {
  constructor(
    private ingestion: IngestionService,
    private generation: GenerationService,
  ) {}

  @Post('ingest')
  async ingest(@Body() dto: IngestTextDto) {
    return this.ingestion.ingestText(dto.text, dto.documentId, dto.metadata ?? {});
  }

  @Post('ingest-file')
  @UseInterceptors(FileInterceptor('file'))
  async ingestFile(
    @UploadedFile() file: MulterFile,
    @Body('documentId') documentId: string,
  ) {
    const pdfParse = (await import('pdf-parse')).default;
    const parsed = await pdfParse(file.buffer);
    return this.ingestion.ingestText(parsed.text, parseInt(documentId, 10), {
      filename: file.originalname,
    });
  }

  @Post('query')
  async query(@Body() dto: QueryDto) {
    return this.generation.answer(dto.question);
  }
}