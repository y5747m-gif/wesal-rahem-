/**
 * قائمة صلة القرابة الجاهزة (من وثيقة المنتج — القسم 10).
 * القيم مفاتيح ثابتة، والنصوص المعروضة في ملف الترجمة.
 */
export const Relationship = {
  Father: 'father',
  Mother: 'mother',
  Grandfather: 'grandfather',
  Grandmother: 'grandmother',
  Brother: 'brother',
  Sister: 'sister',
  UnclePaternal: 'uncle_paternal',
  AuntPaternal: 'aunt_paternal',
  UncleMaternal: 'uncle_maternal',
  AuntMaternal: 'aunt_maternal',
  CousinPaternal: 'cousin_paternal',
  CousinMaternal: 'cousin_maternal',
  Son: 'son',
  Daughter: 'daughter',
  Spouse: 'spouse',
  Friend: 'friend',
  Neighbor: 'neighbor',
  Other: 'other',
} as const;

export type Relationship = (typeof Relationship)[keyof typeof Relationship];

export const ALL_RELATIONSHIPS: readonly Relationship[] = Object.freeze(Object.values(Relationship));

export function isRelationship(value: unknown): value is Relationship {
  return typeof value === 'string' && (ALL_RELATIONSHIPS as readonly string[]).includes(value);
}
