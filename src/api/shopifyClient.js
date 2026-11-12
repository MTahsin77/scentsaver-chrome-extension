/**
 * ScentSaver Chrome Extension — Shopify API Client & Cache Synchronizer
 */

export const STORE_BASE_URL = "https://scentsaver.co.uk";
export const CATALOG_STORAGE_KEY = "scentsaver_catalog_v1";
export const SYNC_BACKOFF_KEY = "scentsaver_sync_backoff_until";
export const CATALOG_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const PAGE_DELAY_MS = 400; // Polite delay between pages to avoid Cloudflare 429

// In-memory verification memoization (60s TTL) & rate-limit cooldown
const liveVerifyCache = new Map();
const VERIFY_CACHE_TTL_MS = 60 * 1000;
const VERIFY_DELAY_MS = 250; // Stagger live .js checks to avoid Shopify burst 429
const MAX_VERIFY_HANDLES = 3;
let verifyBackoffUntil = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Normalizes protocol-relative Shopify CDN URLs to strict https://.
 * @param {string|null} url
 * @returns {string|null}
 */
export function normalizeImageUrl(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  return trimmed;
}

/**
 * Loads the bundled pre-seeded catalog snapshot for instant 0ms first launch.
 * @returns {Promise<{ updatedAt: number, items: Array<Object> }|null>}
 */
export async function loadSeedCatalog() {
  if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.getURL === "function") {
    try {
      const seedUrl = chrome.runtime.getURL("src/data/seedCatalog.json");
      const res = await fetch(seedUrl);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.items) && data.items.length > 0) {
          return data;
        }
      }
    } catch {
      // Seed file unavailable
    }
  }
  return null;
}

/**
 * Extracts the catalog JSON payload from Shopify's Section Rendering API HTML wrapper.
 * @param {string} htmlString
 * @returns {{ version: number, page: number, total_pages: number, has_next_page: boolean, products: Array<Object> }}
 */
export function extractCatalogJsonFromSectionHtml(htmlString) {
  if (!htmlString || typeof htmlString !== "string") {
    throw new Error("Invalid or empty HTML response from Section Rendering API");
  }

  // Look for the JSON payload inside <script type="application/json" id="scentsaver-extension-catalog-json">
  const scriptRegex = /<script[^>]*id=["']scentsaver-extension-catalog-json["'][^>]*>([\s\S]*?)<\/script>/i;
  const match = htmlString.match(scriptRegex);

  if (!match || !match[1]) {
    throw new Error(
      "Section Rendering response missing #scentsaver-extension-catalog-json script block"
    );
  }

  try {
    const parsed = JSON.parse(match[1].trim());
    if (!parsed || !Array.isArray(parsed.products)) {
      throw new Error("Catalog JSON missing valid products array");
    }

    // Normalize image URLs in products array
    parsed.products = parsed.products.map((p) => ({
      ...p,
      image_url: normalizeImageUrl(p.image_url),
      compare_at_price_pence: Number(p.compare_at_price_pence || 0),
      price_pence: Number(p.price_pence || 0)
    }));

    return parsed;
  } catch (err) {
    throw new Error(`Failed to parse catalog JSON from section: ${err.message}`);
  }
}

/**
 * Fetches a single page of the unattached extension-catalog section.
 * @param {number} page
 * @param {AbortSignal} [signal]
 * @returns {Promise<Object>}
 */
export async function fetchCatalogPage(page = 1, signal) {
  const url = `${STORE_BASE_URL}/collections/all?section_id=extension-catalog&page=${page}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "text/html"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      const err = new Error(`Shopify Section Rendering returned status ${response.status}`);
      err.status = response.status;
      throw err;
    }

    const html = await response.text();
    return extractCatalogJsonFromSectionHtml(html);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Reads the cached catalog (or bundled seed) and syncs fresh data in the background when stale.
 * Implements Stale-While-Revalidate with rate-limit backoff.
 *
 * @param {(items: Array<Object>) => void} [onProgress]
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {Promise<{ items: Array<Object>, updatedAt: number, fromCache: boolean, isStale: boolean }>}
 */
export async function getCachedOrSyncCatalog(onProgress, options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  let cached = null;
  let backoffUntil = 0;

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      const data = await chrome.storage.local.get([CATALOG_STORAGE_KEY, SYNC_BACKOFF_KEY]);
      cached = data[CATALOG_STORAGE_KEY];
      backoffUntil = data[SYNC_BACKOFF_KEY] || 0;
    } catch {
      // Storage read failed
    }
  }

  // Fallback to bundled seed catalog if storage is empty (0ms first launch)
  if (!cached || !Array.isArray(cached.items) || cached.items.length === 0) {
    const seed = await loadSeedCatalog();
    if (seed) {
      cached = seed;
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [CATALOG_STORAGE_KEY]: seed }).catch(() => {});
      }
    }
  }

  const now = Date.now();
  const hasCachedItems = cached && Array.isArray(cached.items) && cached.items.length > 0;
  const isFresh = !forceRefresh && hasCachedItems && now - (cached.updatedAt || 0) < CATALOG_TTL_MS;

  if (isFresh) {
    return {
      items: cached.items,
      updatedAt: cached.updatedAt,
      fromCache: true,
      isStale: false
    };
  }

  // Unblock UI immediately with existing cached/seeded items while syncing in background
  if (hasCachedItems && typeof onProgress === "function") {
    onProgress(cached.items);
  }

  // Respect active 429 rate-limit backoff window (even on manual refresh to avoid extending ban)
  if (backoffUntil > now && hasCachedItems) {
    return {
      items: cached.items,
      updatedAt: cached.updatedAt,
      fromCache: true,
      isStale: true,
      rateLimited: true
    };
  }

  // Polite paginated sync
  try {
    const page1Data = await fetchCatalogPage(1);
    let allProducts = [...page1Data.products];

    const totalPages = page1Data.total_pages || 1;
    let hasNext = page1Data.has_next_page;
    let currentPage = 2;

    while (hasNext && currentPage <= totalPages) {
      await sleep(PAGE_DELAY_MS);
      try {
        const nextPageData = await fetchCatalogPage(currentPage);
        allProducts = allProducts.concat(nextPageData.products);
        hasNext = nextPageData.has_next_page;
        currentPage++;
      } catch (pageErr) {
        if (pageErr.status === 429 && typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.set({ [SYNC_BACKOFF_KEY]: Date.now() + 120_000 }).catch(() => {});
        }
        console.warn(`Stopped catalog pagination at page ${currentPage}:`, pageErr);
        break;
      }
    }

    // Only replace cache if we got a complete or substantial sync
    if (allProducts.length > 0 && currentPage > totalPages) {
      const productMap = new Map();
      for (const item of allProducts) {
        productMap.set(item.id, item);
      }
      const mergedProducts = Array.from(productMap.values());

      if (typeof onProgress === "function") {
        onProgress(mergedProducts);
      }

      const newSnapshot = {
        updatedAt: Date.now(),
        items: mergedProducts
      };

      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({
          [CATALOG_STORAGE_KEY]: newSnapshot,
          [SYNC_BACKOFF_KEY]: 0
        }).catch(() => {});
      }

      return {
        items: mergedProducts,
        updatedAt: newSnapshot.updatedAt,
        fromCache: false,
        isStale: false
      };
    }

    // Partial sync finished — keep existing cache if it's larger
    if (hasCachedItems) {
      return {
        items: cached.items,
        updatedAt: cached.updatedAt,
        fromCache: true,
        isStale: true,
        rateLimited: syncErr.status === 429
      };
    }

    return {
      items: allProducts,
      updatedAt: Date.now(),
      fromCache: false,
      isStale: false
    };
  } catch (syncErr) {
    if (syncErr.status === 429 && typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ [SYNC_BACKOFF_KEY]: Date.now() + 120_000 }).catch(() => {});
    }
    if (hasCachedItems) {
      return {
        items: cached.items,
        updatedAt: cached.updatedAt,
        fromCache: true,
        isStale: true,
        rateLimited: syncErr.status === 429
      };
    }
    throw syncErr;
  }
}

/**
 * Verifies live stock availability and price for top displayed product handles.
 * Staggered sequentially across up to 3 handles with 60s memoization and 429 backoff.
 *
 * @param {Array<string>} handles Max 3 handles verified per search
 * @param {number} [catalogUpdatedAt] Timestamp of catalog snapshot
 * @param {AbortSignal} [signal]
 * @returns {Promise<Map<string, { available: boolean, price_pence: number, compare_at_price_pence: number }>>}
 */
export async function verifyLiveProducts(handles, catalogUpdatedAt = 0, signal) {
  const results = new Map();
  if (!handles || handles.length === 0) return results;

  const now = Date.now();
  // Short-circuit if catalog was freshly synced within last 60s or in 429 cooldown
  if ((catalogUpdatedAt && now - catalogUpdatedAt < 60 * 1000) || verifyBackoffUntil > now) {
    return results;
  }

  const uniqueHandles = Array.from(new Set(handles)).slice(0, MAX_VERIFY_HANDLES);
  let networkCalls = 0;

  for (const handle of uniqueHandles) {
    if (signal?.aborted) break;

    const cachedEntry = liveVerifyCache.get(handle);
    if (cachedEntry && now - cachedEntry.timestamp < VERIFY_CACHE_TTL_MS) {
      results.set(handle, cachedEntry.data);
      continue;
    }

    if (networkCalls > 0) {
      await sleep(VERIFY_DELAY_MS);
      if (signal?.aborted || verifyBackoffUntil > Date.now()) break;
    }

    networkCalls++;
    try {
      const url = `${STORE_BASE_URL}/products/${encodeURIComponent(handle)}.js`;
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal
      });

      if (res.status === 429) {
        const retryAfterSec = Number(res.headers?.get?.("retry-after")) || 60;
        verifyBackoffUntil = Date.now() + Math.min(Math.max(retryAfterSec, 30), 120) * 1000;
        break;
      }

      if (!res.ok) continue;

      const data = await res.json();
      const verified = {
        available: Boolean(data.available),
        price_pence: Number(data.price || 0),
        compare_at_price_pence: Number(data.compare_at_price || 0)
      };

      liveVerifyCache.set(handle, {
        timestamp: Date.now(),
        data: verified
      });

      results.set(handle, verified);
    } catch {
      // Aborted or individual handle check failed; stop on abort, otherwise keep cached state
      if (signal?.aborted) break;
    }
  }

  return results;
}

/**
 * Builds the canonical ScentSaver product URL with UTM conversion tracking.
 * @param {string} handle
 * @param {"popup"|"context_menu"} [medium="popup"]
 * @returns {string}
 */
export function buildProductUrl(handle, medium = "popup") {
  const safeMedium = medium === "context_menu" ? "context_menu" : "popup";
  return `${STORE_BASE_URL}/products/${encodeURIComponent(
    handle
  )}?utm_source=chrome_extension&utm_medium=${safeMedium}&utm_campaign=inspired_by_finder`;
}

/**
 * Builds a fallback storefront search URL for queries returning zero inspired_by matches.
 * @param {string} rawQuery
 * @param {"popup"|"context_menu"} [medium="popup"]
 * @returns {string}
 */
export function buildSearchFallbackUrl(rawQuery, medium = "popup") {
  const safeMedium = medium === "context_menu" ? "context_menu" : "popup";
  return `${STORE_BASE_URL}/search?q=${encodeURIComponent(
    rawQuery.trim()
  )}&utm_source=chrome_extension&utm_medium=${safeMedium}&utm_campaign=inspired_by_finder`;
}
