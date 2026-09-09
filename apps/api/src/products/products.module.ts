import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ProductCategoriesController } from './product-categories.controller';
import { ProductCategoriesService } from './product-categories.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { UomsController } from './uoms.controller';
import { UomsService } from './uoms.service';

@Module({
  imports: [AuditModule],
  controllers: [ProductsController, UomsController, ProductCategoriesController],
  providers: [ProductsService, UomsService, ProductCategoriesService],
})
export class ProductsModule {}
