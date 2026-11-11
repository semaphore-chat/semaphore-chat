import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { GifsService } from './gifs.service';
import { GifSearchResponseDto } from './dto/gif-response.dto';

const MAX_LIMIT = 50;

@Controller('gifs')
@UseGuards(JwtAuthGuard)
export class GifsController {
  constructor(private readonly gifsService: GifsService) {}

  /**
   * Search GIFs by query term.
   */
  @Get('search')
  @ApiOkResponse({ type: GifSearchResponseDto })
  @ApiQuery({ name: 'limit', required: false, type: 'integer' })
  @ApiQuery({ name: 'pos', required: false })
  async search(
    @Query('q') q: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('pos') pos?: string,
  ): Promise<GifSearchResponseDto> {
    return this.gifsService.search(q, Math.min(limit, MAX_LIMIT), pos);
  }

  /**
   * Fetch currently featured/trending GIFs (shown when the search box is
   * empty).
   */
  @Get('featured')
  @ApiOkResponse({ type: GifSearchResponseDto })
  @ApiQuery({ name: 'limit', required: false, type: 'integer' })
  @ApiQuery({ name: 'pos', required: false })
  async featured(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('pos') pos?: string,
  ): Promise<GifSearchResponseDto> {
    return this.gifsService.featured(Math.min(limit, MAX_LIMIT), pos);
  }
}
