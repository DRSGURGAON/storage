import {
  Body,
  Controller,
  Get,
  Ip,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ChargeTypesService } from './charge-types.service';
import { CreateRateCardDto } from './dto/create-rate-card.dto';
import { CreateRateCardLineDto } from './dto/create-rate-card-line.dto';
import { ListRateCardsQuery } from './dto/list-rate-cards.query';
import { ResolveRateQuery } from './dto/resolve-rate.query';
import { UpdateRateCardDto } from './dto/update-rate-card.dto';
import { UpdateRateCardLineDto } from './dto/update-rate-card-line.dto';
import { RateCardLinesService } from './rate-card-lines.service';
import { RateCardResolutionService } from './rate-card-resolution.service';
import { RateCardsService } from './rate-cards.service';

@Controller('rate-cards')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RateCardsController {
  constructor(
    private readonly rateCards: RateCardsService,
    private readonly rateCardLines: RateCardLinesService,
    private readonly resolution: RateCardResolutionService,
    private readonly chargeTypes: ChargeTypesService,
  ) {}

  @Post()
  @RequirePermission('create_rate_card')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRateCardDto, @Ip() ip: string) {
    return this.rateCards.create(user, dto, ip);
  }

  @Get()
  @RequirePermission('view_rate_card')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListRateCardsQuery) {
    return this.rateCards.list(user, query);
  }

  /**
   * billing-engine.md §3's resolution algorithm, exposed for the rate-card
   * UI to preview "what would this customer/warehouse/charge type actually
   * charge" before anything bills. Route is registered ahead of ':id' so
   * Nest doesn't try to parse 'resolve' as a UUID path param.
   */
  @Get('resolve')
  @RequirePermission('view_rate_card')
  async resolve(@CurrentUser() user: AuthenticatedUser, @Query() query: ResolveRateQuery) {
    const chargeType = (await this.chargeTypes.list(user.tenantId)).find((c) => c.code === query.chargeTypeCode);
    if (!chargeType) {
      throw new NotFoundException(`Unknown charge type code: ${query.chargeTypeCode}`);
    }
    return this.resolution.resolve(user.tenantId, {
      customerId: query.customerId,
      warehouseId: query.warehouseId,
      chargeTypeId: chargeType.id,
      productId: query.productId,
      categoryId: query.categoryId,
    });
  }

  @Get(':id')
  @RequirePermission('view_rate_card')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rateCards.get(user, id);
  }

  @Patch(':id')
  @RequirePermission('edit_rate_card')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRateCardDto,
    @Ip() ip: string,
  ) {
    return this.rateCards.update(user, id, dto, ip);
  }

  @Post(':id/lines')
  @RequirePermission('edit_rate_card')
  createLine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRateCardLineDto,
    @Ip() ip: string,
  ) {
    return this.rateCardLines.create(user, id, dto, ip);
  }

  @Get(':id/lines')
  @RequirePermission('view_rate_card')
  listLines(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rateCardLines.list(user, id);
  }

  @Patch(':id/lines/:lineId')
  @RequirePermission('edit_rate_card')
  updateLine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: UpdateRateCardLineDto,
    @Ip() ip: string,
  ) {
    return this.rateCardLines.update(user, id, lineId, dto, ip);
  }
}
