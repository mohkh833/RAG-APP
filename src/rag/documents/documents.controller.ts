import { Controller, Delete, Get, Param, ParseIntPipe } from '@nestjs/common';
import { DocumentService } from './document.service';

@Controller('rag/documents')
export class DocumentsController {
  constructor(private documents: DocumentService) {}

  @Get()
  async list() {
    return this.documents.list();
  }

  @Delete(':id')
  async delete(@Param('id', ParseIntPipe) id: number) {
    return this.documents.delete(id);
  }
}
