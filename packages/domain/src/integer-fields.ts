/** Pure descriptor mechanics. No host defaults, I/O, authority, or error-code policy. */
export interface IntegerField {
  readonly minInclusive: number;
  readonly maxInclusive?: number;
  readonly unit: "bytes" | "count" | "percent" | "seconds";
}

// Metadata is frozen, but the pre-existing DTO contract did not make values readonly.
export type IntegerRecord<Fields> = { -readonly [K in keyof Fields]: number };

export function integerFieldsCheck(
  fields: Readonly<Record<string, IntegerField>>,
): (value: unknown) => string | null {
  const keys = Object.keys(fields);
  return (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return "expected object";
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!Object.prototype.hasOwnProperty.call(fields, key))
        return `unknown field ${key}`;
    }
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(record, key))
        return `missing field ${key}`;
      const field = fields[key]!;
      const scalar = record[key];
      if (typeof scalar !== "number" || !Number.isSafeInteger(scalar) || scalar < field.minInclusive)
        return `${key} must be a safe integer >= ${field.minInclusive}`;
      if (field.maxInclusive !== undefined && scalar > field.maxInclusive)
        return `${key} must be <= ${field.maxInclusive}`;
    }
    return null;
  };
}
