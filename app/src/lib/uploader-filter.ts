/**
 * "Added by" filter for the library: recipes carry created_by (auth user id);
 * members map those ids to a display name via their linked person, falling
 * back to the email prefix, then to a localized generic label.
 */

export interface UploaderOption {
  id: string;
  name: string;
}

export function buildUploaderOptions(
  members: { user_id: string; email: string | null; person_id: string | null }[],
  persons: { id: string; name: string }[],
  fallbackLabel: string
): UploaderOption[] {
  const personName = new Map(persons.map((p) => [p.id, p.name]));
  return members.map((m) => ({
    id: m.user_id,
    name:
      (m.person_id ? personName.get(m.person_id) : undefined) ??
      m.email?.split('@')[0] ??
      fallbackLabel,
  }));
}

export function filterByUploader<T extends { created_by?: string | null }>(
  recipes: T[],
  uploaderId: string | null
): T[] {
  if (!uploaderId) return recipes;
  return recipes.filter((r) => r.created_by === uploaderId);
}
