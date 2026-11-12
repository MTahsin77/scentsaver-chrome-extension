/**
 * Unit Test Suite for matcher.js
 * Executed via: node --test "ScentSaver Extension/tests/"*.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeText,
  expandAliases,
  computeDiceSimilarity,
  searchCatalog
} from "../src/search/matcher.js";

describe("normalizeText()", () => {
  it("lowercases and removes Unicode diacritics", () => {
    assert.equal(normalizeText("Baccarat ROUGE 540 Extrait"), "baccarat rouge 540");
    assert.equal(normalizeText("Café Rose"), "cafe rose");
    assert.equal(normalizeText("Terre d'Hermès"), "terre d hermes");
  });

  it("strips concentration and packaging stop words", () => {
    assert.equal(normalizeText("Dior Sauvage Eau de Parfum 100ml"), "dior sauvage");
    assert.equal(normalizeText("Creed Aventus for Men 50ml EDP"), "creed aventus");
    assert.equal(normalizeText("Inspired by Maison Francis Kurkdjian"), "maison francis kurkdjian");
  });

  it("preserves 'de' and 'eau' inside canonical brand names", () => {
    assert.equal(normalizeText("Parfums de Marly Delina"), "parfums de marly delina");
    assert.equal(normalizeText("Bleu de Chanel"), "bleu de chanel");
  });
});

describe("expandAliases()", () => {
  it("expands shorthand abbreviations on whole token boundaries", () => {
    assert.equal(expandAliases("br540"), "baccarat rouge 540");
    assert.equal(expandAliases("br 540"), "baccarat rouge 540");
    assert.equal(expandAliases("mfk"), "maison francis kurkdjian");
    assert.equal(expandAliases("tf lost cherry"), "tom ford lost cherry");
    assert.equal(expandAliases("pdm delina"), "parfums de marly delina");
  });

  it("does not corrupt words that contain alias characters (no partial match)", () => {
    // 'lv' inside 'silver' or 'velvet'
    assert.equal(expandAliases("silver"), "silver");
    assert.equal(expandAliases("velvet rose"), "velvet rose");
    // 'tf' inside 'platform'
    assert.equal(expandAliases("platform"), "platform");
  });
});

describe("computeDiceSimilarity()", () => {
  it("returns 1.0 for identical strings", () => {
    assert.equal(computeDiceSimilarity("aventus", "aventus"), 1.0);
  });

  it("returns high similarity for slight typos", () => {
    const sim = computeDiceSimilarity("bacarat rouge", "baccarat rouge");
    assert.ok(sim >= 0.75, `Expected >= 0.75, got ${sim}`);
  });

  it("returns 0 for completely disjoint strings", () => {
    assert.equal(computeDiceSimilarity("aventus", "lost cherry"), 0.0);
  });
});

describe("searchCatalog()", () => {
  const mockCatalog = [
    {
      id: 1,
      handle: "barakkat-rouge-540",
      title: "Barakkat Rouge 540 100ml EDP",
      vendor: "Fragrance World",
      inspired_by: "Maison Francis Kurkdjian Baccarat Rouge 540",
      available: true,
      price_pence: 1999,
      compare_at_price_pence: 3499
    },
    {
      id: 2,
      handle: "club-de-nuit-intense-man",
      title: "Club De Nuit Intense Man",
      vendor: "Armaf",
      inspired_by: "Creed Aventus",
      available: false, // Out of stock
      price_pence: 2999,
      compare_at_price_pence: 4500
    },
    {
      id: 3,
      handle: "afnan-supremacy-silver",
      title: "Afnan Supremacy Silver",
      vendor: "Afnan",
      inspired_by: "Creed Aventus",
      available: true, // In stock
      price_pence: 3200,
      compare_at_price_pence: 4200
    },
    {
      id: 4,
      handle: "lattafa-khamrah",
      title: "Khamrah 100ml EDP",
      vendor: "Lattafa",
      inspired_by: "Kilian Angels' Share",
      available: true,
      price_pence: 2899,
      compare_at_price_pence: 3999
    }
  ];

  it("matches shorthand alias 'br540' to Baccarat Rouge 540", () => {
    const results = searchCatalog("br540", mockCatalog);
    assert.ok(results.length > 0);
    assert.equal(results[0].handle, "barakkat-rouge-540");
    assert.ok(results[0].score >= 85);
  });

  it("always ranks in-stock alternatives ahead of out-of-stock alternatives", () => {
    // Both items 2 & 3 match "Creed Aventus"
    // Item 3 is available=true; Item 2 is available=false
    const results = searchCatalog("Creed Aventus", mockCatalog);
    assert.equal(results.length, 2);
    assert.equal(results[0].handle, "afnan-supremacy-silver");
    assert.equal(results[0].available, true);
    assert.equal(results[1].handle, "club-de-nuit-intense-man");
    assert.equal(results[1].available, false);
  });

  it("handles typos using fuzzy bigram similarity", () => {
    const results = searchCatalog("bacarat rouge", mockCatalog);
    assert.ok(results.length > 0);
    assert.equal(results[0].handle, "barakkat-rouge-540");
  });

  it("falls back to vendor or title match if inspired_by is not matched", () => {
    const results = searchCatalog("Lattafa Khamrah", mockCatalog);
    assert.ok(results.length > 0);
    assert.equal(results[0].handle, "lattafa-khamrah");
  });

  it("returns empty array for non-matching query", () => {
    const results = searchCatalog("completely unknown fragrance xyz", mockCatalog);
    assert.equal(results.length, 0);
  });
});
