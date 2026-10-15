declare module 'js-yaml' {
  export class Type {
    constructor(tag: string, options: { kind: 'scalar'; construct: (value: string | null) => unknown })
  }
  interface Schema { extend(type: Type): Schema }
  export const DEFAULT_SCHEMA: Schema
  export function load(text: string, options?: { schema: Schema }): unknown
  export function dump(value: unknown, options?: { forceQuotes?: boolean; quotingType?: string; lineWidth?: number; noRefs?: boolean }): string
}
