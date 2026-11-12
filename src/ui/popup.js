/**
 * ScentSaver Chrome Extension — Popup Controller & Safe DOM Renderer
 * Complies with Manifest V3 CSP: textContent and document.createElement ONLY. Zero innerHTML.
 */

import { searchCatalog } from "../search/matcher.js";
import {
  POPULAR_DESIGNER_CHIPS,
  RECENT_SEARCHES_STORAGE_KEY,
  MAX_RECENT_SEARCHES
} from "../search/aliases.js";
import {
  getCachedOrSyncCatalog,
  verifyLiveProducts,
  buildProductUrl,
  buildSearchFallbackUrl
} from "../api/shopifyClient.js";

const PENDING_LOOKUP_KEY = "scentsaver_pending_lookup";

// Application state
let catalogItems = [];
let catalogUpdatedAt = 0;
let activeMedium = "popup";
let liveVerifyTimeout = null;
let liveVerifyController = null;

// DOM Elements
const searchInput = document.getElementById("perfume-search-input");
const clearBtn = document.getElementById("clear-search-btn");
const statusBanner = document.getElementById("status-banner");
const statusText = document.getElementById("status-text");
const emptyState = document.getElementById("empty-state");
const recentGroup = document.getElementById("recent-searches-group");
const recentChipsContainer = document.getElementById("recent-chips-container");
const popularChipsContainer = document.getElementById("popular-chips-container");
const resultsSection = document.getElementById("results-section");
const resultsCount = document.getElementById("results-count");
const resultsList = document.getElementById("results-list");
const zeroResultsSection = document.getElementById("zero-results-state");
const zeroQueryText = document.getElementById("zero-query-text");
const zeroFallbackLink = document.getElementById("zero-fallback-link");

/**
 * Formats integer pence to GBP currency string (e.g. 1999 -> "£19.99").
 * @param {number} pence
 * @returns {string}
 */
export function formatGbp(pence) {
  const num = Number(pence) || 0;
  return `£${(num / 100).toFixed(2)}`;
}

/**
 * Calculates discount percentage between compare-at price and regular price.
 * @param {number} pricePence
 * @param {number} comparePence
 * @returns {number}
 */
export function calculateSavingsPercent(pricePence, comparePence) {
  const p = Number(pricePence) || 0;
  const c = Number(comparePence) || 0;
  if (c > p && c > 0) {
    return Math.round(((c - p) / c) * 100);
  }
  return 0;
}

/**
 * Safely saves a search query to recent searches in chrome.storage.local.
 * @param {string} query
 */
async function saveRecentSearch(query) {
  if (!query || typeof query !== "string") return;
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return;

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      const data = await chrome.storage.local.get([RECENT_SEARCHES_STORAGE_KEY]);
      let recents = data[RECENT_SEARCHES_STORAGE_KEY] || [];
      // Remove duplicate if already in list
      recents = recents.filter((item) => item.toLowerCase() !== trimmed.toLowerCase());
      // Insert at front
      recents.unshift(trimmed);
      // Cap at MAX_RECENT_SEARCHES
      recents = recents.slice(0, MAX_RECENT_SEARCHES);
      await chrome.storage.local.set({ [RECENT_SEARCHES_STORAGE_KEY]: recents });
      renderRecentChips(recents);
    } catch {
      // Storage write error, ignore
    }
  }
}

/**
 * Renders popular designer chips in empty state.
 */
function renderPopularChips() {
  popularChipsContainer.textContent = "";
  for (const chip of POPULAR_DESIGNER_CHIPS) {
    const btn = document.createElement("button");
    btn.className = "chip-btn";
    btn.type = "button";
    btn.textContent = chip;
    btn.addEventListener("click", () => {
      searchInput.value = chip;
      handleSearchInput(chip);
      searchInput.focus();
    });
    popularChipsContainer.appendChild(btn);
  }
}

/**
 * Renders recent search chips in empty state.
 * @param {Array<string>} recents
 */
function renderRecentChips(recents) {
  recentChipsContainer.textContent = "";
  if (!recents || recents.length === 0) {
    recentGroup.hidden = true;
    return;
  }

  recentGroup.hidden = false;
  for (const query of recents) {
    const btn = document.createElement("button");
    btn.className = "chip-btn";
    btn.type = "button";
    btn.textContent = `🕒 ${query}`;
    btn.addEventListener("click", () => {
      searchInput.value = query;
      handleSearchInput(query);
      searchInput.focus();
    });
    recentChipsContainer.appendChild(btn);
  }
}

/**
 * Creates a single result card DOM node using safe DOM construction.
 * Zero innerHTML usage.
 * @param {Object} product
 * @returns {HTMLLIElement}
 */
function createResultCard(product) {
  const li = document.createElement("li");
  li.className = "result-card";
  li.dataset.handle = product.handle;

  // Card Top (Image + Details)
  const cardTop = document.createElement("div");
  cardTop.className = "card-top";

  // Image wrapper
  const imgWrapper = document.createElement("div");
  imgWrapper.className = "card-img-wrapper";

  if (product.image_url) {
    const img = document.createElement("img");
    img.className = "card-img";
    img.src = product.image_url;
    img.alt = product.title || "Fragrance thumbnail";
    img.loading = "lazy";
    img.width = 60;
    img.height = 60;
    imgWrapper.appendChild(img);
  } else {
    // Fallback bottle silhouette SVG icon
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "card-placeholder-img");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "32");
    svg.setAttribute("height", "32");
    svg.setAttribute("fill", "currentColor");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      "M9 2h6v2H9V2zm-1 4h8v2H8V6zm-2 4h12c1.1 0 2 .9 2 2v8c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2v-8c0-1.1.9-2 2-2z"
    );
    svg.appendChild(path);
    imgWrapper.appendChild(svg);
  }

  // Details
  const details = document.createElement("div");
  details.className = "card-details";

  if (product.inspired_by) {
    const pill = document.createElement("div");
    pill.className = "inspired-by-pill";
    pill.textContent = `Inspired By ${product.inspired_by}`;
    details.appendChild(pill);
  }

  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = product.title || "Arabian Perfume";
  details.appendChild(title);

  if (product.vendor) {
    const vendor = document.createElement("div");
    vendor.className = "card-vendor";
    vendor.textContent = product.vendor;
    details.appendChild(vendor);
  }

  cardTop.appendChild(imgWrapper);
  cardTop.appendChild(details);
  li.appendChild(cardTop);

  // Price & Badge Row
  const priceRow = document.createElement("div");
  priceRow.className = "card-price-row";

  const priceGroup = document.createElement("div");
  priceGroup.className = "price-group";

  const currentPrice = document.createElement("span");
  currentPrice.className = "price-current";
  currentPrice.dataset.field = "price";
  currentPrice.textContent = formatGbp(product.price_pence);
  priceGroup.appendChild(currentPrice);

  const comparePence = Number(product.compare_at_price_pence) || 0;
  const currentPence = Number(product.price_pence) || 0;

  if (comparePence > currentPence) {
    const comparePrice = document.createElement("span");
    comparePrice.className = "price-compare";
    comparePrice.dataset.field = "compare";
    comparePrice.textContent = formatGbp(comparePence);
    priceGroup.appendChild(comparePrice);

    const savings = calculateSavingsPercent(currentPence, comparePence);
    if (savings > 0) {
      const savingsBadge = document.createElement("span");
      savingsBadge.className = "price-savings";
      savingsBadge.dataset.field = "savings";
      savingsBadge.textContent = `${savings}% OFF`;
      priceGroup.appendChild(savingsBadge);
    }
  }

  // Stock Badge
  const stockBadge = document.createElement("span");
  stockBadge.dataset.field = "stock";
  if (product.available) {
    stockBadge.className = "stock-badge stock-badge--in";
    stockBadge.textContent = "IN STOCK";
  } else {
    stockBadge.className = "stock-badge stock-badge--oos";
    stockBadge.textContent = "OUT OF STOCK";
  }

  priceRow.appendChild(priceGroup);
  priceRow.appendChild(stockBadge);
  li.appendChild(priceRow);

  // Single Action CTA Button ("View Product")
  const productUrl = buildProductUrl(product.handle, activeMedium);
  const viewBtn = document.createElement("a");
  viewBtn.className = "btn-view-product";
  viewBtn.href = productUrl;
  viewBtn.textContent = "View Product";
  viewBtn.setAttribute("target", "_blank");
  viewBtn.setAttribute("rel", "noopener noreferrer");

  viewBtn.addEventListener("click", (e) => {
    e.preventDefault();
    saveRecentSearch(searchInput.value);
    if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: productUrl });
    } else {
      window.open(productUrl, "_blank");
    }
  });

  li.appendChild(viewBtn);
  return li;
}

/**
 * Updates a rendered DOM card with freshly verified live price/stock status.
 * @param {string} handle
 * @param {{ available: boolean, price_pence: number, compare_at_price_pence: number }} liveStatus
 */
function updateCardLiveStatus(handle, liveStatus) {
  const card = resultsList.querySelector(`li[data-handle="${CSS.escape(handle)}"]`);
  if (!card) return;

  const priceEl = card.querySelector('[data-field="price"]');
  const compareEl = card.querySelector('[data-field="compare"]');
  const savingsEl = card.querySelector('[data-field="savings"]');
  const stockEl = card.querySelector('[data-field="stock"]');

  if (priceEl) {
    priceEl.textContent = formatGbp(liveStatus.price_pence);
  }

  const compPence = Number(liveStatus.compare_at_price_pence) || 0;
  const curPence = Number(liveStatus.price_pence) || 0;

  if (compPence > curPence) {
    if (compareEl) {
      compareEl.textContent = formatGbp(compPence);
    }
    const savings = calculateSavingsPercent(curPence, compPence);
    if (savingsEl && savings > 0) {
      savingsEl.textContent = `${savings}% OFF`;
    }
  }

  if (stockEl) {
    if (liveStatus.available) {
      stockEl.className = "stock-badge stock-badge--in";
      stockEl.textContent = "IN STOCK";
    } else {
      stockEl.className = "stock-badge stock-badge--oos";
      stockEl.textContent = "OUT OF STOCK";
    }
  }
}

/**
 * Handles query execution and UI rendering.
 * @param {string} rawQuery
 */
function handleSearchInput(rawQuery) {
  const query = (rawQuery || "").trim();

  // Toggle clear button
  clearBtn.hidden = !query;

  if (!query) {
    emptyState.hidden = false;
    resultsSection.hidden = true;
    zeroResultsSection.hidden = true;
    resultsList.textContent = "";
    return;
  }

  emptyState.hidden = true;

  // Execute search across cached catalog
  const matches = searchCatalog(query, catalogItems, 20);

  if (matches.length === 0) {
    resultsSection.hidden = true;
    zeroResultsSection.hidden = false;
    zeroQueryText.textContent = query;
    zeroFallbackLink.href = buildSearchFallbackUrl(query, activeMedium);
    resultsList.textContent = "";
    return;
  }

  zeroResultsSection.hidden = true;
  resultsSection.hidden = false;
  resultsCount.textContent = `${matches.length} alternative${matches.length === 1 ? "" : "s"} found`;

  // Render cards
  resultsList.textContent = "";
  for (const product of matches) {
    resultsList.appendChild(createResultCard(product));
  }

  // Debounce live verification on top 3 visible matches
  if (liveVerifyTimeout) {
    clearTimeout(liveVerifyTimeout);
  }
  if (liveVerifyController) {
    liveVerifyController.abort();
  }

  liveVerifyTimeout = setTimeout(async () => {
    const controller = new AbortController();
    liveVerifyController = controller;
    const topHandles = matches.slice(0, 3).map((m) => m.handle);
    try {
      const liveStatuses = await verifyLiveProducts(topHandles, catalogUpdatedAt, controller.signal);
      if (controller.signal.aborted) return;
      for (const [handle, status] of liveStatuses.entries()) {
        updateCardLiveStatus(handle, status);
      }
    } catch {
      // Verification failed or aborted, keep cached state
    }
  }, 220);
}

// Clear button event listener
clearBtn.addEventListener("click", () => {
  searchInput.value = "";
  handleSearchInput("");
  searchInput.focus();
});

// Search input listener
searchInput.addEventListener("input", (e) => {
  handleSearchInput(e.target.value);
});

// Fallback search link click
zeroFallbackLink.addEventListener("click", (e) => {
  e.preventDefault();
  saveRecentSearch(searchInput.value);
  const targetUrl = zeroFallbackLink.href;
  if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url: targetUrl });
  } else {
    window.open(targetUrl, "_blank");
  }
});

/**
 * Loads or syncs the ScentSaver catalog silently in the background.
 */
async function syncCatalog() {
  const statusSpinner = statusBanner.querySelector(".status-spinner");
  try {
    if (catalogItems.length === 0) {
      statusBanner.hidden = false;
      if (statusSpinner) statusSpinner.hidden = false;
      statusText.textContent = "Loading ScentSaver catalog...";
    }

    const res = await getCachedOrSyncCatalog((progressItems) => {
      catalogItems = progressItems;
      if (catalogItems.length > 0) {
        statusBanner.hidden = true;
      }
      if (searchInput.value) {
        handleSearchInput(searchInput.value);
      }
    });

    catalogItems = res.items || [];
    catalogUpdatedAt = res.updatedAt || Date.now();
    statusBanner.hidden = true;

    if (searchInput.value) {
      handleSearchInput(searchInput.value);
    }
  } catch (err) {
    console.warn("Catalog sync warning:", err);
    if (catalogItems.length > 0) {
      statusBanner.hidden = true;
    } else {
      statusBanner.hidden = false;
      if (statusSpinner) statusSpinner.hidden = true;
      statusText.textContent = `Unable to reach scentsaver.co.uk (${err.message || "network error"}).`;
    }
  }
}

/**
 * Initializes the popup on DOMContentLoaded.
 */
document.addEventListener("DOMContentLoaded", async () => {
  renderPopularChips();

  // Load recent searches from storage
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      const data = await chrome.storage.local.get([RECENT_SEARCHES_STORAGE_KEY]);
      renderRecentChips(data[RECENT_SEARCHES_STORAGE_KEY] || []);
    } catch {
      // Ignore read error
    }
  }

  // Check URL query parameters for context menu source
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("source") === "context_menu") {
    activeMedium = "context_menu";
  }

  // Check pending lookup from context menu in chrome.storage.local
  let pendingQuery = "";
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      const pendingData = await chrome.storage.local.get([PENDING_LOOKUP_KEY]);
      const pending = pendingData[PENDING_LOOKUP_KEY];
      if (pending && pending.query && Date.now() - (pending.timestamp || 0) < 60 * 1000) {
        pendingQuery = pending.query;
        if (pending.source === "context_menu") {
          activeMedium = "context_menu";
        }
        await chrome.storage.local.remove([PENDING_LOOKUP_KEY]);
      }
    } catch {
      // Ignore
    }
  }

  if (pendingQuery) {
    searchInput.value = pendingQuery;
  }

  await syncCatalog(false);
});

