/**
 * ScentSaver Chrome Extension — Fragrance Aliases & Normalization Constants
 */

export const RECENT_SEARCHES_STORAGE_KEY = "scentsaver_recent_searches_v1";
export const MAX_RECENT_SEARCHES = 3;

/**
 * Stop phrases and tokens to strip when normalizing fragrance titles.
 * Suffixes and packaging descriptors are stripped, but generic words like
 * "de" or "eau" are preserved to keep brand phrases (e.g. Parfums de Marly, Eau Sauvage) intact.
 */
export const STOP_WORDS = new Set([
  "eau de parfum",
  "eau de toilette",
  "eau de cologne",
  "extrait de parfum",
  "edp",
  "edt",
  "extrait",
  "parfum",
  "perfume",
  "fragrance",
  "cologne",
  "inspired by",
  "inspired",
  "100ml",
  "50ml",
  "80ml",
  "75ml",
  "30ml",
  "for men",
  "for women",
  "unisex"
]);

/**
 * Community abbreviations and shorthand acronyms mapped to canonical house/fragrance names.
 * Applied symmetrically to both user queries and catalog `inspired_by` strings on whole-token boundaries.
 */
export const BRAND_AND_FRAGRANCE_ALIASES = {
  "br540": "baccarat rouge 540",
  "br 540": "baccarat rouge 540",
  "mfk": "maison francis kurkdjian",
  "tf": "tom ford",
  "pdm": "parfums de marly",
  "lv": "louis vuitton",
  "adg": "acqua di gio",
  "ysl": "yves saint laurent",
  "jpg": "jean paul gaultier",
  "bdc": "bleu de chanel"
};

/**
 * Default popular designer fragrance suggestions shown on empty search input.
 */
export const POPULAR_DESIGNER_CHIPS = [
  "Baccarat Rouge 540",
  "Creed Aventus",
  "Tom Ford Oud Wood",
  "Dior Sauvage",
  "Parfums de Marly Delina",
  "Kilian Angels' Share",
  "Tom Ford Lost Cherry"
];
