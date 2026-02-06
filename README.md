# 🔍 Pentesting Reference Search (PRS)

- A **fast, local search engine for pentesting reference material**.  
- Designed for offline use with fuzzy search, smart relevance ranking, and a modern web UI.
---

## ✨ Key-Features

- Fast index and search
- 🎯 Search algorithm with multi-level scoring
- ℹ️ Uses online (GitBook) sources or local sources (.MD files)
- 📚 Source overview on the homepage
- 💬 Snippet previews showing keyword context
- 🔍 Fuzzy search for misspellings


## 🔢 How Relevance Scoring Works

- PRS ranks results using a **weighted relevance scoring system**.  
- Instead of simple keyword matching, each result earns points based on *where* and *how* the search term appears.

- Results are sorted by **total score**, highest first.

---

### 🧠 Scoring Concept

- Not all matches are equal.
- A page where the search term appears in the **title** is usually far more relevant than a page where it is mentioned once in the content.  
- The scoring system reflects this by assigning **higher weights to stronger signals**.

---

### 📊 Scoring Rules

Each result can receive points from multiple categories:

| Match Type | Score | Explanation |
|-----------|-------|-------------|
| **Exact title match** | +100 | Page title exactly matches the search term |
| **Title contains term** | +50 | Search term appears in the page title |
| **Page name match** | +30 | Match in the URL-derived page name (e.g. `/services/kerberos`) |
| **URL match** | +20 | Search term appears anywhere in the URL |
| **Content match** | +2 per occurrence | Each mention in page content adds score |
| **Short title bonus** | +5 | Titles shorter than 50 characters |
| **Fuzzy match** | +10 | ≥70% similarity for misspelled queries |

Scores are cumulative — a single result can gain points from several categories.

---

### 🥇 Ranking Priority

In practice, this means results are prioritized roughly in the following order:

1. Exact title matches  
2. Titles containing the search term  
3. Page name matches  
4. URL matches  
5. Content mentions  
6. Fuzzy (misspelled) matches  

This ensures that **authoritative, topic-focused pages rank higher than generic references**.

---

## ➕ Sources

All searchable content is defined in `sources.json`.
Either online sources(primarily gitbooks) or offline sources(primarily .md markdown files)

### Steps

1. Open `sources.json`
2. Add a new online/offline source object
```json
{
  "online_sources": [
    {
      "id": "source-1",
      "name": "Source",
      "type": "gitbook",
      "search_url": "https://example.gitbook.io/example/?q={query}",
      "index_url": "https://example.gitbook.io/example",
      "enabled": true,
      "description": "Description of Example Site"
    },
    ....
    ....
],
  "offline_sources": [
    {
      "id": "local-notes",
      "name": "Offline Notes",
      "type": "local",
      "path": "/path/to/offline-notes",
      "file_extensions": [
        ".md"
      ],
      "enabled": true,
      "description": "Local notes"
    }
  ]
}
```

3. Run the indexer
4. Restart the server

---

## 🚀 Quick Start

```bash
npm install
npm run index
npm start
