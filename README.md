# 🔍 Pentest KB Indexer (PKBI)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A fast local tool for searching indexed pages of pentesting documentation. 

Use for personal usage only.

## ✨ Features

-   **Fast Indexing & Search**: Built with performance in mind for quick documentation retrieval.
-   **Smart Relevance Ranking**: Scoring based on match quality (exact > partial > fuzzy) and position (title > URL > content).
-   **GUI Toggles**: Easily switch between **Local** and **Online** results, or toggle **Fuzzy Search** on/off directly from the interface.
-   **Offline Caching**: Download and store online sources locally for zero-latency searching and offline preview.
-   **Rate-Limit Protection**: Uses smart jitter (random delay) and sequential requests to avoid being blocked by documentation hosts.
-   **Snippet Previews**: Shows where your search term appears in the content with surrounding context.

## 🔢 How Results Are Ranked

Results are ranked by **relevance**, not just keyword count.

Scoring breakdown:
-   **Exact Title Match**: 100 pts (Highest priority)
-   **Title Contains Term**: 50 pts
-   **Page Name (URL) Match**: 30 pts
-   **URL Fragment Match**: 20 pts
-   **Content Match**: 10 pts
-   **Fuzzy Match**: Always used as a penalized fallback for typos.

## ➕ Sources

All sources are defined in `sources.json`.

### Supports:
-   **GitBook**: Advanced crawling with sitemap support.
-   **Docusaurus**: Sequential indexing of specified paths.
-   **Markdown**: Track specific raw URLs (e.g., from GitHub).
-   **Local Documentation**: Index directories of markdown files on your drive.

## 🚀 Getting Started

Follow these steps to set up and run the project locally.

### 1. Install dependencies
```bash
npm install
```

### 2. Configure sources
Open `sources.json` and add your favorite documentation sources. Set `"enabled": true` for those you want to search.

### 3. Build the Index
```bash
# Full build of all enabled sources (online + offline)
npm run index

# Cache online content for full offline-mode (Requires "cache_offline": true in sources.json)
npm run cache
```

### 4. Search & Run
```bash
# Start the web interface
npm start

# Or search directly from terminal
npm run search -- "query"
```

## 🛠️ CLI Commands

| Command | Description |
| :--- | :--- |
| `npm run index` | Build/Refresh the entire search index. |
| `npm run cache` | Cache online sources (limit 5) for persistent offline use. |
| `npm run cache-status`| Show storage usage and cached page statistics. |
| `npm run update <path>`| Force-update a specific local file in the index. |
| `npm run info` | View index statistics (total pages, sources, last update). |
| `npm run search` | Fast CLI-based search. |

## ⚙️ Performance Tuning

You can adjust the `RATE` variable at the top of `indexer.js` to change indexing speed. 
-   **1000ms**: 1 req/sec *Very conservative)*
-   **200ms**: 5 req/sec *(Default, good balance)*
-   **100ms**: 10 req/sec *(Fast, risk of blocks)*

---
*Created by VJakoby. Feel free to use for your own needs.*

