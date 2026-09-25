import type { Preferences } from "./schemas/private";

/** Default preferences (zod-free for the browser bundle; a unit test checks they match the schema defaults). */
export const DEFAULT_PREFERENCES: Preferences = {
  theme: "dark",
  geography: "india",
  geoMode: "either",
  followedSectors: [],
  highlightSector: "fig",
  sectorPickerDismissed: false,
  displayCurrency: "original",
  inrNumberSystem: "indian",
  timezone: "Asia/Kolkata",
  newsWindowDays: 7,
  dealColumns: [],
  sidebarCollapsed: false,
};
