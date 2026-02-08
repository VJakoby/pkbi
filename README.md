# 🔍 Pentesting Reference Search (PRS)

A fast local search tool for pentesting documentation.

Works with online docs or local markdown files.
 
Idea by me, implemented with help from Claude.

## ✨ Features

- Fast indexing and search
- Smart relevance-based ranking
- Supports GitBook, Docusaurus, web docs, and local markdown
- Source overview on the homepage
- Snippet previews with context
- Fuzzy search for typos (used as fallback)

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

### Add a source
1. Edit `sources.json`
2. Add an online or offline source
3. Run the indexer
4. Restart the server

## 🚀 Quick Start
```
npm install
npm run index
npm start
```