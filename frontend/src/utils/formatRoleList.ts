/** "Moderator", "Moderator and Admin", "Moderator, Admin and Owner". */
export function formatRoleList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
