/**
 * ScentSaver Chrome Extension — Deterministic Search & Ranking Engine
 */

import { STOP_WORDS, BRAND_AND_FRAGRANCE_ALIASES } from "./aliases.js";

/**
 * Normalizes input text by removing diacritics, punctuation, stop words, and extra whitespace.
 * @param {string} input
 * @returns {string}
 */
export function normalizeText(input) {
  if (!input || typeof input !== "string") return "";

  // Lowercase and strip Unicode diacritics (e.g. é -> e)
  let text = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Replace punctuation, quotes, slashes, dashes with spaces
  text = text.replace(/[^a-z0-9\s]/g, " ");

  // Strip multi-word and single-word stop words/phrases using boundary checks
  for (const phrase of STOP_WORDS) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "gi");
    text = text.replace(regex, " ");
  }

  // Collapse multiple spaces and trim
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Expands shorthand fragrance abbreviations on whole-token boundaries.
 * Handles both multi-word keys ("br 540") and single-word keys ("br540", "mfk", "tf", "pdm").
 * @param {string} normalizedQuery
 * @returns {string}
 */
export function expandAliases(normalizedQuery) {
  if (!normalizedQuery) return "";

  let result = normalizedQuery;

  // First sort alias keys by length descending to match multi-token phrases first (e.g. "br 540" before "br")
  const aliasKeys = Object.keys(BRAND_AND_FRAGRANCE_ALIASES).sort(
    (a, b) => b.length - a.length
  );

  for (const key of aliasKeys) {
    const replacement = BRAND_AND_FRAGRANCE_ALIASES[key];
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(^|\\s)${escaped}(\\s|$)`, "gi");
    result = result.replace(regex, `$1${replacement}$2`);
  }

  return result.replace(/\s+/g, " ").trim();
}

/**
 * Computes character bigram Dice coefficient similarity between two strings.
 * Returns a value in [0, 1].
 * @param {string} strA
 * @param {string} strB
 * @returns {number}
 */
export function computeDiceSimilarity(strA, strB) {
  if (!strA || !strB) return 0;
  if (strA === strB) return 1.0;

  const a = strA.replace(/\s+/g, "");
  const b = strB.replace(/\s+/g, "");

  if (a.length < 2 || b.length < 2) {
    return a === b ? 1.0 : 0.0;
  }

  const bigramsA = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.substring(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.substring(i, i + 2);
    const count = bigramsA.get(bg) || 0;
    if (count > 0) {
      bigramsA.set(bg, count - 1);
      intersection++;
    }
  }

  const totalBigrams = a.length - 1 + (b.length - 1);
  return (2 * intersection) / totalBigrams;
}

/**
 * Searches the catalog items against a query string.
 * Ranks in-stock products above out-of-stock products, then by similarity tier.
 *
 * @param {string} rawQuery
 * @param {Array<Object>} catalogItems
 * @param {number} [limit=20]
 * @returns {Array<Object>}
 */
export function searchCatalog(rawQuery, catalogItems, limit = 20) {
  if (!rawQuery || !catalogItems || !Array.isArray(catalogItems)) return [];

  // Step 1: Normalize query and expand aliases
  let cleanQuery = normalizeText(rawQuery);
  cleanQuery = expandAliases(cleanQuery);
  cleanQuery = normalizeText(cleanQuery); // re-clean in case alias introduced extra spaces or stop words

  if (!cleanQuery) return [];

  const queryTokens = cleanQuery.split(" ").filter(Boolean);

  const scoredResults = [];

  for (const item of catalogItems) {
    const rawInspired = item.inspired_by || "";
    const normInspired = rawInspired
      ? normalizeText(expandAliases(normalizeText(rawInspired)))
      : "";
    const normTitle = normalizeText(item.title || "");
    const normVendor = normalizeText(item.vendor || "");

    let score = 0;

    if (normInspired) {
      if (normInspired === cleanQuery) {
        // Tier 1: Exact match on inspired_by
        score = 100;
      } else if (
        normInspired.startsWith(cleanQuery) ||
        normInspired.includes(` ${cleanQuery} `) ||
        normInspired.includes(cleanQuery)
      ) {
        // Tier 2: Prefix or contiguous substring match on inspired_by
        score = 85;
      } else {
        // Tier 3: All query tokens present in inspired_by
        const allTokensPresent = queryTokens.every(
          (t) => normInspired.includes(t)
        );
        if (allTokensPresent && queryTokens.length > 0) {
          score = 70;
        } else {
          // Tier 4: Token-set fuzzy matching (handles typos like "bacarat rouge")
          const inspiredTokens = normInspired.split(" ").filter(Boolean);
          let totalSim = 0;
          let allMatched = true;

          for (const qToken of queryTokens) {
            let bestSim = 0;
            for (const iToken of inspiredTokens) {
              if (iToken === qToken) {
                bestSim = 1.0;
                break;
              }
              const sim = computeDiceSimilarity(qToken, iToken);
              if (sim > bestSim) {
                bestSim = sim;
              }
            }

            if (bestSim >= 0.7) {
              totalSim += bestSim;
            } else {
              allMatched = false;
              break;
            }
          }

          if (allMatched && queryTokens.length > 0) {
            const avgSim = totalSim / queryTokens.length;
            score = 50 + Math.round(avgSim * 19);
          }
        }
      }
    }

    // Tier 5: Fallback match on Arabian title or vendor if no inspired_by score
    if (score === 0) {
      const combinedMeta = `${normVendor} ${normTitle}`.trim();
      if (combinedMeta.includes(cleanQuery)) {
        score = 40;
      } else if (queryTokens.every((t) => combinedMeta.includes(t))) {
        score = 35;
      }
    }

    if (score > 0) {
      scoredResults.push({
        ...item,
        score
      });
    }
  }

  // Deterministic Sort Order:
  // 1. In-stock first: available (true) sorts before available (false)
  // 2. Score descending
  // 3. Alphabetical tie-breaker on title
  scoredResults.sort((a, b) => {
    const aAvail = a.available ? 1 : 0;
    const bAvail = b.available ? 1 : 0;
    if (aAvail !== bAvail) {
      return bAvail - aAvail;
    }
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return (a.title || "").localeCompare(b.title || "");
  });

  return scoredResults.slice(0, limit);
}
