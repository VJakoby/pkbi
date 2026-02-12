# 🔍 Pentest KB Indexer (PKBI)

A fast local tool for searching indexed pages of pentesting documentation.

Feel free to use for your own needs, for other type of information other than pentest.

## ✨ Features

- Fast indexing and search
- Smart relevance-based ranking
- Supports GitBook, Docusaurus, web docs, and local markdown
- Source overview on the homepage
- Snippet previews with context
- Fuzzy search for typos (used as fallback)
- Supports offline caching for sources including offline-preview.

## 🔢 How Results Are Ranked

Results are ranked by **relevance**, not just keyword count.

Scoring is based on:
- Match quality (exact > partial > fuzzy)
- Where the match appears (title > URL > content)
- Source type (external > local)

Higher score = higher result.

## 🥇 Ranking Priority

- Exact/partial matches in external docs
- Exact/partial matches in local files
- Content-only matches
- Fuzzy matches (shown last)
- Fuzzy matches are always fallback and heavily penalized.

## ➕ Sources

All sources are defined in `sources.json`.

### Supports:

- Online: 
    - GitBook
    - Docusaurus
    - Markdown pages.
- Offline: 
    - Local markdown files

Sources can be chosen for offline-mode by adding the `"cache_offline":true`




## 🚀 Getting Started

Follow these steps to set up and run the project locally.

### 1. Install dependencies
```bash
npm install
```
### 2. Configure sources
1. Open `sources.json`
2. Add, enable or disable online and offline sources as needed

### 3 . Index and cache content

After updating your sources, run:
```bash
# Index online sources
npm run index

# Cache content for offline preview
npm run cache
```
Run both commands if you want full online + offline support.

### 4. Start the server
```bash
npm start
```
