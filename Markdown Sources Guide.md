# 📄 Markdown Sources Guide

Guide to adding raw markdown files as sources.

## 🎯 Use Cases

**Markdown type is perfect for:**
- Raw markdown files from GitHub
- Markdown files from Gists
- Direct .md links from other websites
- README files
- Documentation in markdown format

## 📝 Configure Markdown Source

### Basic Example:

```json
{
  "online_sources": [
    {
      "id": "github-notes",
      "name": "GitHub Security Notes",
      "type": "markdown",
      "enabled": true,
      "description": "Security notes from GitHub",
      "urls": [
        "https://raw.githubusercontent.com/user/repo/main/README.md",
        "https://raw.githubusercontent.com/user/repo/main/SECURITY.md"
      ]
    }
  ]
}
```

### Field Descriptions:

| Field | Required | Description |
|------|----------|-------------|
| `id` | ✅ Yes | Unique ID for the source |
| `name` | ✅ Yes | Display name in UI |
| `type` | ✅ Yes | Must be `"markdown"` |
| `enabled` | ✅ Yes | `true` or `false` |
| `urls` | ✅ Yes | Array of markdown URLs |
| `description` | ❌ No | Description (shown in UI) |

## 🌟 Examples

### 1. GitHub Repository README

```json
{
  "id": "awesome-pentest",
  "name": "Awesome Pentest",
  "type": "markdown",
  "enabled": true,
  "description": "Curated pentest resources",
  "urls": [
    "https://raw.githubusercontent.com/enaqx/awesome-pentest/master/README.md"
  ]
}
```

### 2. Multiple GitHub Gists

```json
{
  "id": "my-gists",
  "name": "My Security Gists",
  "type": "markdown",
  "enabled": true,
  "urls": [
    "https://gist.githubusercontent.com/username/abc123/raw/exploit-notes.md",
    "https://gist.githubusercontent.com/username/def456/raw/recon-guide.md",
    "https://gist.githubusercontent.com/username/ghi789/raw/privesc-checklist.md"
  ]
}
```

### 3. Multiple READMEs from the Same Repository

```json
{
  "id": "tool-docs",
  "name": "Security Tools Docs",
  "type": "markdown",
  "enabled": true,
  "description": "Documentation from various tools",
  "urls": [
    "https://raw.githubusercontent.com/org/tool1/main/README.md",
    "https://raw.githubusercontent.com/org/tool1/main/USAGE.md",
    "https://raw.githubusercontent.com/org/tool2/main/README.md",
    "https://raw.githubusercontent.com/org/tool3/master/docs/guide.md"
  ]
}
```

### 4. Mix of Sources

```json
{
  "id": "cheatsheets",
  "name": "Security Cheatsheets",
  "type": "markdown",
  "enabled": true,
  "urls": [
    "https://raw.githubusercontent.com/user/cheatsheets/main/sql-injection.md",
    "https://raw.githubusercontent.com/user/cheatsheets/main/xss.md",
    "https://example.com/static/pentest-checklist.md"
  ]
}
```

## 🔍 How Indexing Works

### 1. Title Extraction
The indexer searches for the first `# Heading` in the markdown file:

```markdown
# Windows Privilege Escalation

Content here...
```
→ Title becomes: **"Windows Privilege Escalation"**

**Fallback:** If no heading is found, the filename from the URL is used:
- `https://.../.../privesc-guide.md` → **"privesc guide"**

### 2. Content Processing
Markdown content is processed:
- ✅ Text is extracted
- ❌ Code blocks are removed (```...```)
- ❌ Inline code is removed (`...`)
- ❌ Markdown symbols are removed (#, *, _, etc.)
- ✅ Converted to lowercase for searching

### 3. Page Names
Extracted from the URL:
- `https://.../tools/nmap-guide.md` → **"nmap guide"**
- `https://.../README.md` → **"README"**

## 📊 Output Example

When you run `npm run index`:

```bash
🌐 ONLINE SOURCES:

📄 Indexing GitHub Security Notes...
  Found 3 markdown files to index
  Indexed 3/3 files (3 successful)...
  ✅ Successfully indexed 3 markdown files from GitHub Security Notes
```

## 🎯 Best Practices

### ✅ DO:

1. **Use raw URLs from GitHub:**
   ```
   ✅ https://raw.githubusercontent.com/user/repo/main/file.md
   ❌ https://github.com/user/repo/blob/main/file.md
   ```

2. **Group related files:**
   ```json
   {
     "id": "web-security",
     "urls": [
       "https://.../sqli.md",
       "https://.../xss.md",
       "https://.../csrf.md"
     ]
   }
   ```

3. **Use descriptive names:**
   ```json
   {
     "name": "OWASP Top 10 Notes",  // ✅ Good
     "name": "Notes"                 // ❌ Bad
   }
   ```

### ❌ DON'T:

1. **Don't mix types in the same source:**
   ```json
   // ❌ Bad
   {
     "type": "markdown",
     "urls": [
       "https://example.com/file.md",      // OK
       "https://example.com/page.html"     // ERROR! Not markdown
     ]
   }
   ```

2. **Avoid dead links:**
   - Test that the URL works before adding it
   - Check that it returns raw markdown

3. **Avoid too many files per source:**
   - Max ~50 files per source for best performance
   - Split into multiple sources if you have more

## 🔧 Troubleshooting

### Problem: "No URLs specified"
**Cause:** `urls` field is missing or empty  
**Solution:** Add `"urls": [...]` array

### Problem: File is not indexed
**Causes:**
1. URL does not return markdown
2. URL is incorrect
3. URL blocked by CORS/firewall

**Solution:**
```bash
# Test URL manually
curl https://raw.githubusercontent.com/user/repo/main/file.md

# If it works, add it to sources.json
```

### Problem: No title extracted
**Cause:** Markdown file has no `# Heading`  
**Solution:** Either:
1. Add `# Title` to the markdown file
2. Or accept that the filename is used

### Problem: Search results missing
**Cause:** Content was removed during processing (was only code)  
**Solution:** Check that the markdown file has actual text, not just code blocks

## 📈 Performance Tips

### Parallel Indexing
Files are indexed 5 at a time for speed.

### Timeout
Default: 15 seconds per file.  
Adjust in `sources.json`:
```json
{
  "index_settings": {
    "timeout_seconds": 20
  }
}
```

### Rate Limiting
Adds 100ms pause between chunks to avoid overloading servers.

## 🔄 Update Content

Markdown sources are re-indexed with each `npm run index`:

```bash
npm run index
```

**Tip:** For GitHub files, use raw URLs from the `main` branch to always get the latest version.

## 🌟 Advanced Examples

### Auto-generated from GitHub API

```bash
# Fetch all .md files from a repo
curl https://api.github.com/repos/user/repo/contents/docs \
  | jq -r '.[] | select(.name | endswith(".md")) | .download_url'

# Output: List of raw URLs that can be copied to sources.json
```

### Markdown from Notion (exported)

```json
{
  "id": "notion-export",
  "name": "Notion Notes",
  "type": "markdown",
  "enabled": true,
  "urls": [
    "https://myserver.com/exported-notes/page1.md",
    "https://myserver.com/exported-notes/page2.md"
  ]
}
```

## 📚 Example sources.json

Complete example:

```json
{
  "online_sources": [
    {
      "id": "pentest-everything",
      "name": "PenTest Everything",
      "type": "gitbook",
      "index_url": "https://viperone.gitbook.io/pentest-everything",
      "enabled": true
    },
    {
      "id": "github-cheatsheets",
      "name": "GitHub Cheatsheets",
      "type": "markdown",
      "enabled": true,
      "description": "Community pentest cheatsheets",
      "urls": [
        "https://raw.githubusercontent.com/user/cheatsheets/main/sqli.md",
        "https://raw.githubusercontent.com/user/cheatsheets/main/xss.md",
        "https://raw.githubusercontent.com/user/cheatsheets/main/lfi.md"
      ]
    }
  ],
  "offline_sources": [
    {
      "id": "local-notes",
      "name": "My Notes",
      "type": "local",
      "path": "./offline-notes",
      "enabled": true
    }
  ]
}
```

---

**Version:** 3.2  
**Compatibility:** v3.0+  
**Created:** 2026-02-07