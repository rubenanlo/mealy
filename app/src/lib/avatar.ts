/**
 * Preset avatar palette (persons.avatar_color, migration 0023). Editorial
 * tones, all dark enough for white initials. The person page offers exactly
 * these; a null color keeps the monochrome default chip.
 */
export const AVATAR_COLORS = [
  '#C7442E', // brick (app accent)
  '#B8622C', // ochre
  '#5F7A34', // olive
  '#2F6F5E', // pine
  '#2E6E8C', // steel blue
  '#5B5EA6', // indigo
  '#8A4E85', // plum
  '#7A5C43', // umber
] as const;
