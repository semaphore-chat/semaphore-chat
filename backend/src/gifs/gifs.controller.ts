import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { GifsService } from './gifs.service';
import { GifSearchResponseDto } from './dto/gif-response.dto';
import { GifQueryDto } from './dto/gif-query.dto';

@Controller('gifs')
@UseGuards(JwtAuthGuard)
export class GifsController {
  constructor(private readonly gifsService: GifsService) {}

  /**
   * Search GIFs by query term.
   */
  @Get('search')
  @ApiOkResponse({ type: GifSearchResponseDto })
  @ApiQuery({ name: 'q', required: true })
  async search(
    @Query('q') q: string,
    @Query() query: GifQueryDto,
  ): Promise<GifSearchResponseDto> {
    return this.gifsService.search(q, query.limit, query.pos);
  }

  /**
   * Fetch currently featured/trending GIFs (shown when the search box is
   * empty).
   */
  @Get('featured')
  @ApiOkResponse({ type: GifSearchResponseDto })
  async featured(@Query() query: GifQueryDto): Promise<GifSearchResponseDto> {
    return this.gifsService.featured(query.limit, query.pos);
  }
}
