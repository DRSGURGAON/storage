import { IsDefined } from 'class-validator';

/**
 * The value is deliberately untyped at the DTO layer: `tenant_settings` is
 * a jsonb column and each key declares its own type in
 * `tenant-settings.registry.ts`, which is where the value is validated.
 * `@IsDefined` still rejects a body with no `value` at all, so "unset" is
 * an explicit DELETE rather than an accidental null.
 */
export class SetSettingDto {
  @IsDefined()
  value!: unknown;
}
