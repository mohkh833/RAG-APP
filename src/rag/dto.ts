import {
  IsString,
  IsOptional,
  IsNumber,
  IsObject,
  MinLength,
  IsArray,
  ValidateNested,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ChatMessage {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  content!: string;
}

export class IngestTextDto {
  @IsString()
  @MinLength(1)
  text!: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class QueryDto {
  @IsString()
  @MinLength(1)
  question!: string;

  @IsOptional()
  @IsNumber()
  topK?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessage)
  history?: ChatMessage[];
}
