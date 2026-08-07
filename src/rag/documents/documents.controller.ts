import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { RequestUser } from '../../auth/current-user.decorator';
import { DocumentService } from './document.service';

@Controller('rag/documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private documents: DocumentService) {}

  @Get()
  async list(@CurrentUser() user: RequestUser) {
    return this.documents.list(user.userId);
  }

  @Delete(':id')
  async delete(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.documents.delete(id, user.userId);
  }
}
