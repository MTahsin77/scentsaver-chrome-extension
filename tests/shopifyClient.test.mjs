/**
 * Unit Test Suite for shopifyClient.js
 * Executed via: node --test "ScentSaver Extension/tests/"*.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeImageUrl,
  extractCatalogJsonFromSectionHtml,
  buildProductUrl,
  buildSearchFallbackUrl,
  verifyLiveProducts,
  STORE_BASE_URL
} from "../src/api/shopifyClient.js";

describe("normalizeImageUrl()", () => {
  it("prepends https: to protocol-relative URLs", () => {
    assert.equal(
      normalizeImageUrl("//scentsaver.co.uk/cdn/shop/files/khamrah.jpg"),
      "https://scentsaver.co.uk/cdn/shop/files/khamrah.jpg"
    );
  });

  it("leaves already absolute https:// URLs untouched", () => {
    assert.equal(
      normalizeImageUrl("https://cdn.shopify.com/files/image.jpg"),
      "https://cdn.shopify.com/files/image.jpg"
    );
  });

  it("returns null for null, undefined, or empty values", () => {
    assert.equal(normalizeImageUrl(null), null);
    assert.equal(normalizeImageUrl(""), null);
    assert.equal(normalizeImageUrl(undefined), null);
  });
});

describe("extractCatalogJsonFromSectionHtml()", () => {
  it("extracts and parses valid JSON from Shopify section HTML wrapper", () => {
    const mockHtml = `
      <div id="shopify-section-extension-catalog" class="shopify-section">
        <script type="application/json" id="scentsaver-extension-catalog-json">
        {
          "version": 1,
          "generated_at": "2026-11-10T22:00:00Z",
          "page": 1,
          "total_pages": 2,
          "has_next_page": true,
          "products": [
            {
              "id": 12345,
              "handle": "khamrah-edp-lattafa",
              "title": "Khamrah 100ml EDP Lattafa",
              "vendor": "Lattafa",
              "inspired_by": "Kilian Angels Share",
              "available": true,
              "price_pence": 2899,
              "compare_at_price_pence": 3999,
              "image_url": "//scentsaver.co.uk/cdn/shop/files/khamrah.jpg",
              "product_url": "/products/khamrah-edp-lattafa"
            }
          ]
        }
        </script>
      </div>
    `;

    const parsed = extractCatalogJsonFromSectionHtml(mockHtml);
    assert.equal(parsed.version, 1);
    assert.equal(parsed.page, 1);
    assert.equal(parsed.total_pages, 2);
    assert.equal(parsed.has_next_page, true);
    assert.equal(parsed.products.length, 1);
    assert.equal(parsed.products[0].handle, "khamrah-edp-lattafa");
    // Verify image URL was normalized to https://
    assert.equal(
      parsed.products[0].image_url,
      "https://scentsaver.co.uk/cdn/shop/files/khamrah.jpg"
    );
  });

  it("throws a descriptive error when script block is missing", () => {
    assert.throws(
      () => extractCatalogJsonFromSectionHtml("<div>No JSON here</div>"),
      /missing #scentsaver-extension-catalog-json/
    );
  });
});

describe("buildProductUrl()", () => {
  it("builds canonical URL with default popup UTM attribution", () => {
    const url = buildProductUrl("khamrah-edp-lattafa");
    assert.equal(
      url,
      `${STORE_BASE_URL}/products/khamrah-edp-lattafa?utm_source=chrome_extension&utm_medium=popup&utm_campaign=inspired_by_finder`
    );
  });

  it("builds canonical URL with context_menu UTM attribution", () => {
    const url = buildProductUrl("khamrah-edp-lattafa", "context_menu");
    assert.equal(
      url,
      `${STORE_BASE_URL}/products/khamrah-edp-lattafa?utm_source=chrome_extension&utm_medium=context_menu&utm_campaign=inspired_by_finder`
    );
  });
});

describe("buildSearchFallbackUrl()", () => {
  it("builds search fallback URL with query encoding and UTM attribution", () => {
    const url = buildSearchFallbackUrl("Maison Francis Kurkdjian 540");
    assert.equal(
      url,
      `${STORE_BASE_URL}/search?q=Maison%20Francis%20Kurkdjian%20540&utm_source=chrome_extension&utm_medium=popup&utm_campaign=inspired_by_finder`
    );
  });
});

describe("verifyLiveProducts()", () => {
  it("caps staggered requests to 3 unique handles and short-circuits on HTTP 429", async () => {
    const originalFetch = globalThis.fetch;
    const calledUrls = [];

    try {
      globalThis.fetch = async (url) => {
        calledUrls.push(String(url));
        return {
          ok: true,
          status: 200,
          json: async () => ({ available: true, price: 1999, compare_at_price: 2999 })
        };
      };

      const res = await verifyLiveProducts(["h1", "h2", "h1", "h3", "h4", "h5"], 0);
      assert.equal(calledUrls.length, 3);
      assert.equal(res.size, 3);
      assert.equal(res.get("h1").price_pence, 1999);

      // Now simulate HTTP 429 on an uncached handle and verify cooldown suppresses next call
      calledUrls.length = 0;
      globalThis.fetch = async (url) => {
        calledUrls.push(String(url));
        return {
          ok: false,
          status: 429,
          headers: { get: () => "60" }
        };
      };

      await verifyLiveProducts(["rate-limited-1", "rate-limited-2"], 0);
      assert.equal(calledUrls.length, 1);

      await verifyLiveProducts(["rate-limited-3"], 0);
      assert.equal(calledUrls.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

