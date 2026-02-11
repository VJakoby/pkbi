# 🔍 Pentest - Knowledge Base Indexer (P-KBI)

A fast local tool for searching indexed knowledge base pages for pentesting documentation.

Works with online docs or local markdown files.

Feel free to use if for your own needs, for other type of information.
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

All sources are defined in sources.json.

Supports:

- Online: GitBook, Docusaurus, Markdown sites
- Offline: Local markdown files
- Sources can be chosen for offline-mode by adding the `"cache_offline":true`

### Add a source
1. Edit `sources.json`
2. Add an online or offline source
3. Run the indexer
4. Restart the server

### Offline caching a online source
1. Add `"cache_offline":true` in the relevant source in the `sources.json` file.
2. Run `npm run cache` to cache the online source
3. Start the server

## 🚀 Quick Start
```
npm install
npm run index
npm start
```
