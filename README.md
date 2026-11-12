# ScentSaver — Arabian Perfume Alternative Finder

![ScentSaver Dupe Finder](./store-assets/promo-marquee-1400x560.png)

An on-demand Manifest V3 Chrome extension for **[ScentSaver.co.uk](https://scentsaver.co.uk)** that lets fragrance shoppers search for designer scents—or right-click highlighted perfume names anywhere on the web—to discover matching Arabian-inspired alternatives with live GBP pricing and UK stock availability.

---

## Key Features

- **Instant Catalog Search**: Bundles a pre-seeded catalog snapshot (`src/data/seedCatalog.json`, 973 products) and syncs updates cleanly in the background with a 6-hour local cache in `chrome.storage.local`.
- **Smart Alias & Fuzzy Matching**: Matches designer abbreviations, handles common typos with Dice bigram similarity, and ignores filler words automatically.
- **In-Stock First Ranking**: Always prioritizes in-stock alternatives ahead of out-of-stock items while displaying clear `IN STOCK` / `OUT OF STOCK` badges and savings percentages.
- **Staggered Live Verification**: Refreshes live GBP prices and stock status for the top 3 displayed results with `60s` memoization and rate-limit cooldown protection.
- **Right-Click Context Menu Lookup**: Highlight any perfume name on a webpage, right-click, and choose **Find ScentSaver alternative for '...'**—no intrusive `content_scripts` or third-party page scraping.
- **Strict Manifest V3 CSP**: Zero `innerHTML`; all UI elements are rendered safely via `document.createElement` and `textContent`.

---

## Repository Structure

```text
scentsaver-chrome-extension/
├── manifest.json             # Manifest V3 configuration
├── popup.html                # Popup UI markup
├── popup.css                 # Crisp white + #020202 brand theme
├── assets/                   # Extension runtime icons & SVG logo
├── src/
│   ├── background.js         # Context menu service worker
│   ├── api/shopifyClient.js  # Catalog sync, live price/stock check & URL helpers
│   ├── search/aliases.js     # Stop words, alias dictionary & popular chips
│   ├── search/matcher.js     # Normalization, fuzzy scoring & ranking
│   ├── ui/popup.js           # Popup controller & safe DOM renderer
│   └── data/seedCatalog.json # Pre-seeded catalog snapshot
├── store-assets/             # Chrome Web Store icons, screenshots & promo tiles
└── tests/                    # Node.js built-in unit test suites
```

---

## Local Installation (Developer Mode)

1. Clone this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select this repository folder.
5. Pin **ScentSaver** from the Chrome extensions toolbar menu.

---

## Running Tests

Requires Node.js 18+:

```bash
node --test tests/*.test.mjs
```
