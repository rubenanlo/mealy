/**
 * Plain-text shopping-list export for WhatsApp/Notes (Phase 2 Task 8,
 * spec §9): aisle-grouped, unchecked items only, "— Mealy" footer.
 */

export interface ExportItem {
  /** Display label, e.g. "Carottes — 450 g" or a verbatim unmatched line. */
  label: string;
  checked: boolean;
}

export interface ExportGroup {
  aisle: string;
  items: ExportItem[];
}

export function buildShoppingText(groups: ExportGroup[]): string {
  const sections: string[] = [];
  for (const group of groups) {
    const open = group.items.filter((item) => !item.checked);
    if (open.length === 0) continue;
    sections.push([group.aisle, ...open.map((item) => `- ${item.label}`)].join('\n'));
  }
  if (sections.length === 0) return '';
  return `${sections.join('\n\n')}\n\n— Mealy`;
}
