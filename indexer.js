const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const cheerio = require('cheerio');
const crypto = require('crypto');

class ContentIndexer {
    constructor() {
        this.indexPath = path.join(__dirname, 'data', 'index.json');
        this.sourcesPath = path.join(__dirname, 'sources.json');
        this.index = { pages: [], last_updated: null, sources: [] };
    }

    async initialize() {
        const dataDir = path.join(__dirname, 'data');
        const cacheDir = path.join(__dirname, 'data', 'cache', 'online');
        try {
            await fs.mkdir(dataDir, { recursive: true });
            await fs.mkdir(cacheDir, { recursive: true });
        } catch (err) {
            // Directories exist
        }

        try {
            const indexData = await fs.readFile(this.indexPath, 'utf-8');
            this.index = JSON.parse(indexData);
            console.log(`✅ Loaded existing index with ${this.index.pages.length} pages`);
        } catch (err) {
            console.log('📝 No existing index found, creating new one');
        }
    }

    async loadSources() {
        const sourcesData = await fs.readFile(this.sourcesPath, 'utf-8');
        const config = JSON.parse(sourcesData);
        
        const onlineSources = (config.online_sources || config.sources || []).filter(s => s.enabled);
        const offlineSources = (config.offline_sources || []).filter(s => s.enabled);
        
        return {
            online: onlineSources,
            offline: offlineSources,
            all: [...onlineSources, ...offlineSources]
        };
    }

    resolvePath(configPath) {
        // If relative path, resolve from project root
        if (configPath.startsWith('./') || configPath.startsWith('../')) {
            return path.resolve(__dirname, configPath);
        }
        // If absolute path, use as-is
        return configPath;
    }

    async findMarkdownFiles(directory, extensions = ['.md']) {
        const files = [];
        
        async function traverse(dir) {
            try {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    
                    if (entry.isDirectory()) {
                        // Skip directories that end with .md (edge case)
                        if (entry.name.endsWith('.md')) {
                            console.log(`  ⏭️  Skipping directory: ${entry.name}`);
                            continue;
                        }
                        await traverse(fullPath);
                    } else if (entry.isFile()) {
                        const ext = path.extname(entry.name).toLowerCase();
                        if (extensions.includes(ext)) {
                            files.push(fullPath);
                        }
                    }
                }
            } catch (error) {
                console.error(`  ❌ Error reading directory ${dir}:`, error.message);
            }
        }
        
        await traverse(directory);
        return files;
    }

    extractMarkdownTitle(content, filePath) {
        // Try to extract title from first # heading
        const lines = content.split('\n');
        for (const line of lines) {
            const match = line.match(/^#\s+(.+)/);
            if (match) {
                return match[1].trim();
            }
        }
        
        // Fallback to filename without extension
        return path.basename(filePath, path.extname(filePath));
    }

    async indexLocalSource(source) {
        console.log(`\n📁 Indexing ${source.name}...`);
        const pages = [];
        
        const resolvedPath = this.resolvePath(source.path);
        console.log(`  Path: ${resolvedPath}`);
        
        try {
            await fs.access(resolvedPath);
        } catch (error) {
            console.log(`  ⚠️  Directory does not exist: ${resolvedPath}`);
            console.log(`  💡 Create the directory or update path in sources.json`);
            return pages;
        }
        
        const extensions = source.file_extensions || ['.md'];
        const files = await this.findMarkdownFiles(resolvedPath, extensions);
        
        console.log(`  Found ${files.length} files`);
        
        if (files.length === 0) {
            console.log(`  ℹ️  No files to index`);
            return pages;
        }
        
        // Smart incremental: Check which files changed
        let newFiles = 0;
        let updatedFiles = 0;
        let unchangedFiles = 0;
        
        for (const filePath of files) {
            try {
                const stats = await fs.stat(filePath);
                const lastModified = stats.mtime.toISOString();
                
                // Check if file exists in index and hasn't changed
                const existingPage = this.index.pages.find(p => p.file_path === filePath);
                
                if (existingPage && existingPage.file_modified === lastModified) {
                    // File unchanged, keep existing entry
                    pages.push(existingPage);
                    unchangedFiles++;
                    continue;
                }
                
                // File is new or modified, re-index it
                const page = await this.indexSingleLocalFile(filePath, source, resolvedPath);
                if (page) {
                    page.file_modified = lastModified; // Track modification time
                    pages.push(page);
                    
                    if (existingPage) {
                        updatedFiles++;
                    } else {
                        newFiles++;
                    }
                }
            } catch (error) {
                console.error(`  ❌ Error processing ${filePath}:`, error.message);
            }
        }
        
        console.log(`  ✅ Indexed ${pages.length} files from ${source.name}`);
        if (newFiles > 0) console.log(`     🆕 ${newFiles} new files`);
        if (updatedFiles > 0) console.log(`     🔄 ${updatedFiles} updated files`);
        if (unchangedFiles > 0) console.log(`     ⏭️  ${unchangedFiles} unchanged files`);
        
        return pages;
    }

    // Helper method to index a single local file
    async indexSingleLocalFile(filePath, source, resolvedPath) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const title = this.extractMarkdownTitle(content, filePath);
            
            // Create relative path from source root for page name
            const relativePath = path.relative(resolvedPath, filePath);
            const pageName = relativePath.replace(/\\/g, '/').replace(/\.(md|txt)$/i, '');
            
            // Use file:// protocol for local files
            const fileUrl = `file://${filePath}`;
            
            return {
                source_id: source.id,
                source_name: source.name,
                url: fileUrl,
                file_path: filePath,
                title: title,
                page_name: pageName,
                content: content.toLowerCase(),
                indexed_at: new Date().toISOString(),
                is_local: true
            };
        } catch (error) {
            console.error(`  ❌ Error reading ${filePath}:`, error.message);
            return null;
        }
    }

    // INCREMENTAL UPDATE: Update single local file without full re-index
    async updateLocalFile(filePath) {
        console.log(`\n🔄 Uppdaterar fil: ${filePath}`);
        
        // Find which source this file belongs to
        const sources = await this.loadSources();
        let sourceMatch = null;
        let resolvedPath = null;
        
        for (const source of sources.offline) {
            const sourcePath = this.resolvePath(source.path);
            if (filePath.startsWith(sourcePath)) {
                sourceMatch = source;
                resolvedPath = sourcePath;
                break;
            }
        }
        
        if (!sourceMatch) {
            console.log('  ❌ Filen tillhör ingen känd källa');
            return false;
        }
        
        // Index the single file
        const newPage = await this.indexSingleLocalFile(filePath, sourceMatch, resolvedPath);
        
        if (!newPage) {
            console.log('  ❌ Kunde inte indexera filen');
            return false;
        }
        
        // Find and replace existing entry, or add new
        const existingIndex = this.index.pages.findIndex(p => p.file_path === filePath);
        
        if (existingIndex >= 0) {
            this.index.pages[existingIndex] = newPage;
            console.log('  ✅ Fil uppdaterad i index');
        } else {
            this.index.pages.push(newPage);
            console.log('  ✅ Ny fil tillagd i index');
        }
        
        // Update index metadata
        this.index.last_updated = new Date().toISOString();
        this.index.total_pages = this.index.pages.length;
        
        // Update source page count
        const sourceInIndex = this.index.sources.find(s => s.id === sourceMatch.id);
        if (sourceInIndex) {
            sourceInIndex.page_count = this.index.pages.filter(p => p.source_id === sourceMatch.id).length;
        }
        
        await this.saveIndex();
        console.log('  💾 Index sparat\n');
        
        return true;
    }

    // INCREMENTAL DELETE: Remove deleted local file from index
    async removeLocalFile(filePath) {
        console.log(`\n🗑️  Tar bort fil from index: ${filePath}`);
        
        const existingIndex = this.index.pages.findIndex(p => p.file_path === filePath);
        
        if (existingIndex >= 0) {
            const removedPage = this.index.pages[existingIndex];
            this.index.pages.splice(existingIndex, 1);
            
            // Update metadata
            this.index.last_updated = new Date().toISOString();
            this.index.total_pages = this.index.pages.length;
            
            // Update source page count
            const sourceInIndex = this.index.sources.find(s => s.id === removedPage.source_id);
            if (sourceInIndex) {
                sourceInIndex.page_count = this.index.pages.filter(p => p.source_id === removedPage.source_id).length;
            }
            
            await this.saveIndex();
            console.log('  ✅ Fil borttagen from index');
            console.log('  💾 Index sparat\n');
            return true;
        } else {
            console.log('  ⚠️  Filen fanns inte i index');
            return false;
        }
    }

    async fetchPage(url, timeout = 15000) {
        try {
            const response = await axios.get(url, {
                timeout,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                },
                maxRedirects: 5
            });
            return response.data;
        } catch (error) {
            if (error.code === 'ECONNABORTED') {
                console.error(`  ⏱️  Timeout: ${url}`);
            } else if (error.response) {
                console.error(`  ❌ HTTP ${error.response.status}: ${url}`);
            } else {
                console.error(`  ❌ ${error.message}: ${url}`);
            }
            return null;
        }
    }

    extractTextContent(html) {
        const $ = cheerio.load(html);
        $('script, style, nav, header, footer, .sidebar, .menu').remove();
        
        const textContent = $('body').text()
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
        
        return textContent;
    }

    extractTitle(html, url) {
        const $ = cheerio.load(html);
        
        // Försök flera metoder för att få bästa titel
        let title = $('h1').first().text().trim();
        
        if (!title) {
            title = $('title').text().trim();
        }
        
        if (!title) {
            // Fallback: extrahera from URL
            const urlParts = url.split('/');
            title = urlParts[urlParts.length - 1].replace(/-/g, ' ');
        }
        
        // Rensa titeln
        title = title
            .replace(/\s*\|\s*.*/g, '') // Ta bort "| Site Name"
            .replace(/\s*-\s*.*/g, '')  // Ta bort "- Site Name"
            .trim();
        
        return title || 'Untitled';
    }

    extractPageName(url) {
        // Extrahera sidnamnet from URL
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        const pageName = pathParts[pathParts.length - 1] || 'index';
        return pageName.replace(/-/g, ' ').replace(/_/g, ' ');
    }

    extractSnippet(content, searchTerm, length = 150) {
        const lowerContent = content.toLowerCase();
        const lowerTerm = searchTerm.toLowerCase();
        const index = lowerContent.indexOf(lowerTerm);
        
        if (index === -1) {
            return {
                text: '',
                highlightStart: -1,
                highlightLength: 0
            };
        }
        
        const start = Math.max(0, index - length / 2);
        const end = Math.min(content.length, index + searchTerm.length + length / 2);
        
        let snippet = content.substring(start, end);
        let highlightStart = snippet.toLowerCase().indexOf(lowerTerm);
        
        // Add ellipsis
        if (start > 0) {
            snippet = '...' + snippet;
            highlightStart += 3; // Adjust for ellipsis
        }
        if (end < content.length) {
            snippet = snippet + '...';
        }
        
        return {
            text: snippet,
            highlightStart: highlightStart,
            highlightLength: searchTerm.length
        };
    }

    async indexGitBookSource(source) {
        console.log(`\n📚 Indexing ${source.name}...`);
        const pages = [];
        
        console.log(`  Fetching main page: ${source.index_url}`);
        const html = await this.fetchPage(source.index_url);
        if (!html) {
            console.log(`  ❌ Could not fetch main page`);
            return pages;
        }

        const $ = cheerio.load(html);
        const links = new Set();

        $('a[href]').each((i, elem) => {
            let href = $(elem).attr('href');
            if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto:')) {
                try {
                    const fullUrl = new URL(href, source.index_url).href;
                    // Filtrera bort externa länkar
                    if (fullUrl.startsWith(source.index_url)) {
                        links.add(fullUrl);
                    }
                } catch (e) {
                    // Invalid URL, skip
                }
            }
        });

        console.log(`  Found ${links.size} internal links`);
        
        if (links.size === 0) {
            console.log(`  ⚠️  No links found - trying to index main page`);
            const content = this.extractTextContent(html);
            const title = this.extractTitle(html, source.index_url);
            const pageName = this.extractPageName(source.index_url);
            
            pages.push({
                source_id: source.id,
                source_name: source.name,
                url: source.index_url,
                title: title,
                page_name: pageName,
                content: content.substring(0, 10000),
                indexed_at: new Date().toISOString(),
                is_local: false
            });
            
            return pages;
        }

        // Parallel crawling for faster indexing
        const linkArray = Array.from(links).slice(0, 50);
        const chunkSize = 5;
        let indexed = 0;
        let successful = 0;

        for (let i = 0; i < linkArray.length; i += chunkSize) {
            const chunk = linkArray.slice(i, i + chunkSize);
            const promises = chunk.map(async (link) => {
                const pageHtml = await this.fetchPage(link);
                if (pageHtml) {
                    const content = this.extractTextContent(pageHtml);
                    const title = this.extractTitle(pageHtml, link);
                    const pageName = this.extractPageName(link);
                    
                    return {
                        source_id: source.id,
                        source_name: source.name,
                        url: link,
                        title: title,
                        page_name: pageName,
                        content: content.substring(0, 10000),
                        indexed_at: new Date().toISOString(),
                        is_local: false
                    };
                }
                return null;
            });

            const results = await Promise.all(promises);
            const validResults = results.filter(p => p !== null);
            pages.push(...validResults);
            successful += validResults.length;
            
            indexed += chunk.length;
            console.log(`  Indexerade ${indexed}/${linkArray.length} pages (${successful} successful)...`);
            
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log(`  ✅ Indexed total ${pages.length} pages from ${source.name}`);
        return pages;
    }

    async indexDocusaurusSource(source) {
        console.log(`\n📘 Indexing ${source.name}...`);
        const pages = [];

        if (!source.pages || source.pages.length === 0) {
            console.log('  ⚠️  Inga pages specificerade');
            return pages;
        }

        // Parallell crawling
        const chunkSize = 5;
        for (let i = 0; i < source.pages.length; i += chunkSize) {
            const chunk = source.pages.slice(i, i + chunkSize);
            const promises = chunk.map(async (page) => {
                const url = `${source.base_url}/${page}`;
                const html = await this.fetchPage(url);
                
                if (html) {
                    const content = this.extractTextContent(html);
                    const title = this.extractTitle(html, url);
                    const pageName = page.replace(/-/g, ' ');
                    
                    return {
                        source_id: source.id,
                        source_name: source.name,
                        url: url,
                        title: title,
                        page_name: pageName,
                        content: content.substring(0, 10000),
                        indexed_at: new Date().toISOString(),
                        is_local: false
                    };
                }
                return null;
            });

            const results = await Promise.all(promises);
            pages.push(...results.filter(p => p !== null));
            
            console.log(`  Indexerade ${i + chunk.length}/${source.pages.length} pages...`);
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log(`  ✅ Indexerade ${pages.length} pages from ${source.name}`);
        return pages;
    }

    async indexMarkdownSource(source) {
        console.log(`\n📄 Indexing ${source.name}...`);
        const pages = [];

        if (!source.urls || source.urls.length === 0) {
            console.log('  ⚠️  Inga URLs specificerade');
            return pages;
        }

        console.log(`  Found ${source.urls.length} markdown-filer att indexera`);

        // Parallell crawling
        const chunkSize = 5;
        let indexed = 0;
        let successful = 0;

        for (let i = 0; i < source.urls.length; i += chunkSize) {
            const chunk = source.urls.slice(i, i + chunkSize);
            const promises = chunk.map(async (url) => {
                const markdownContent = await this.fetchPage(url);
                
                if (markdownContent) {
                    // Extract title from first # heading in markdown
                    const lines = markdownContent.split('\n');
                    let title = null;
                    for (const line of lines) {
                        const match = line.match(/^#\s+(.+)/);
                        if (match) {
                            title = match[1].trim();
                            break;
                        }
                    }
                    
                    // Fallback: use filename from URL
                    if (!title) {
                        const urlParts = url.split('/');
                        title = urlParts[urlParts.length - 1]
                            .replace(/\.md$/i, '')
                            .replace(/[-_]/g, ' ');
                    }
                    
                    // Extract page name from URL
                    const urlObj = new URL(url);
                    const pathParts = urlObj.pathname.split('/').filter(p => p);
                    const pageName = pathParts[pathParts.length - 1]
                        .replace(/\.md$/i, '')
                        .replace(/[-_]/g, ' ');
                    
                    // Convert markdown content to lowercase for search
                    const content = markdownContent
                        .replace(/```[\s\S]*?```/g, ' ') // Remove code blocks
                        .replace(/`[^`]+`/g, ' ') // Remove inline code
                        .replace(/[#*_\[\]()]/g, ' ') // Remove markdown symbols
                        .replace(/\s+/g, ' ')
                        .trim()
                        .toLowerCase();
                    
                    return {
                        source_id: source.id,
                        source_name: source.name,
                        url: url,
                        title: title,
                        page_name: pageName,
                        content: content.substring(0, 10000),
                        indexed_at: new Date().toISOString(),
                        is_local: false  // Markdown sources are online
                    };
                }
                return null;
            });

            const results = await Promise.all(promises);
            const validResults = results.filter(p => p !== null);
            pages.push(...validResults);
            successful += validResults.length;
            
            indexed += chunk.length;
            console.log(`  Indexerade ${indexed}/${source.urls.length} filer (${successful} successful)...`);
            
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log(`  ✅ Indexed total ${pages.length} markdown-filer from ${source.name}`);
        return pages;
    }

    async buildIndex() {
        console.log('\n🚀 Starting indexing of all sources...\n');
        
        const sources = await this.loadSources();
        const allPages = [];

        // Index online sources
        console.log('🌐 ONLINE SOURCES:');
        for (const source of sources.online) {
            try {
                let pages = [];
                
                if (source.type === 'gitbook') {
                    pages = await this.indexGitBookSource(source);
                } else if (source.type === 'docusaurus') {
                    pages = await this.indexDocusaurusSource(source);
                } else if (source.type === 'markdown') {
                    pages = await this.indexMarkdownSource(source);
                } else {
                    console.log(`⚠️  Okänd källtyp: ${source.type} för ${source.name}`);
                }
                
                allPages.push(...pages);
            } catch (error) {
                console.error(`❌ Error indexing ${source.name}:`, error.message);
            }
        }

        // Index offline sources
        if (sources.offline.length > 0) {
            console.log('\n📁 OFFLINE SOURCES:');
            for (const source of sources.offline) {
                try {
                    const pages = await this.indexLocalSource(source);
                    allPages.push(...pages);
                } catch (error) {
                    console.error(`❌ Error indexing ${source.name}:`, error.message);
                }
            }
        }

        this.index = {
            pages: allPages,
            last_updated: new Date().toISOString(),
            total_pages: allPages.length,
            sources: sources.all.map(s => ({
                id: s.id,
                name: s.name,
                type: s.type,
                description: s.description || '',
                page_count: allPages.filter(p => p.source_id === s.id).length,
                is_local: s.type === 'local'
            }))
        };

        // Ensure all pages have is_local flag (fix for markdown sources)
        this.index.pages.forEach(page => {
            if (page.is_local === undefined) {
                page.is_local = false; // Default to online if not set
            }
        });

        await this.saveIndex();
        
        console.log('\n✅ Indexing complete!');
        console.log(`📊 Total indexed pages: ${allPages.length}`);
        console.log(`   🌐 Online: ${allPages.filter(p => !p.is_local).length}`);
        console.log(`   📁 Offline: ${allPages.filter(p => p.is_local).length}`);
        console.log(`💾 Index saved to: ${this.indexPath}\n`);
    }

    async saveIndex() {
        // Prepare index for saving
        const indexData = JSON.stringify(this.index, null, 2);
        const sizeKB = (indexData.length / 1024).toFixed(2);
        
        console.log(`💾 Sparar index (${sizeKB} KB)...`);
        
        await fs.writeFile(
            this.indexPath,
            indexData,
            'utf-8'
        );
        
        // Optional: Save metadata about index size for future optimization
        const metadataPath = this.indexPath.replace('.json', '.meta.json');
        await fs.writeFile(
            metadataPath,
            JSON.stringify({
                size_bytes: indexData.length,
                size_kb: parseFloat(sizeKB),
                pages_count: this.index.pages.length,
                last_saved: new Date().toISOString()
            }, null, 2),
            'utf-8'
        );
    }

    // SEARCH-ALGORITHM
    search(query, options = {}) {
        const searchTerm = query.toLowerCase().trim();
        const results = [];
        const fuzzyMatch = options.fuzzy !== false; // Default true

        for (const page of this.index.pages) {
            let score = 0;
            let matchType = null;
            
            const titleLower = page.title.toLowerCase();
            const pageNameLower = page.page_name.toLowerCase();
            const contentLower = page.content;
            const urlLower = page.url.toLowerCase();
            
            // 1. EXACT TITLE (highest weight)
            if (titleLower === searchTerm) {
                score += 100;
                matchType = 'exact_title';
            }
            // 2. TITLE CONTAINS SEARCHTERM
            else if (titleLower.includes(searchTerm)) {
                score += 50;
                matchType = 'title_contains';
            }
            
            // 3. PAGENAME-MATCH (from URL)
            if (pageNameLower.includes(searchTerm)) {
                score += 30;
                if (!matchType) matchType = 'page_name';
            }
            
            // 4. URL-MATCH (important for specific pages)
            if (urlLower.includes(searchTerm)) {
                score += 20;
                if (!matchType) matchType = 'url';
            }
            
            // 5. CONTENT-MATCH
            const occurrences = (contentLower.match(new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
            if (occurrences > 0) {
                score += occurrences * 2;
                if (!matchType) matchType = 'content';
            }
            
            // 6. FUZZY MATCH (for miss-spellings)
            if (fuzzyMatch && score === 0) {
                const fuzzyScore = this.fuzzySearch(searchTerm, titleLower) +
                                  this.fuzzySearch(searchTerm, pageNameLower);
                if (fuzzyScore > 0.7) {
                    score += Math.floor(fuzzyScore * 10);
                    matchType = 'fuzzy';
                }
            }
            
            // 7. BOOST FOR SHORTER TITLES (more relevant)
            if (score > 0 && titleLower.length < 50) {
                score += 5;
            }

            if (score > 0) {
                results.push({
                    ...page,
                    relevance_score: score,
                    match_type: matchType,
                    snippet: this.extractSnippet(page.content, searchTerm)
                });
            }
        }

        // Sort after relevance
        results.sort((a, b) => b.relevance_score - a.relevance_score);
        
        return results;
    }

    // Easy fuzzy search (Levenshtein-similar)
    fuzzySearch(pattern, text) {
        if (pattern.length === 0) return 0;
        if (text.includes(pattern)) return 1;
        
        let matches = 0;
        let patternIndex = 0;
        
        for (let i = 0; i < text.length && patternIndex < pattern.length; i++) {
            if (text[i] === pattern[patternIndex]) {
                matches++;
                patternIndex++;
            }
        }
        
        return matches / pattern.length;
    }

    // ============ OFFLINE CACHE METHODS ============
    
    hashUrl(url) {
        return crypto.createHash('md5').update(url).digest('hex');
    }

    removeImages(html) {
        const $ = cheerio.load(html);
        
        // Remove all images to save space
        $('img').remove();
        $('picture').remove();
        $('svg').remove();
        $('video').remove();
        $('audio').remove();
        
        // Remove lazy loading attributes
        $('[data-src]').removeAttr('data-src');
        $('[srcset]').removeAttr('srcset');
        
        return $.html();
    }

    async getCacheSize(dir) {
        try {
            let totalSize = 0;
            const files = await fs.readdir(dir);
            for (const file of files) {
                if (file === 'metadata.json') continue;
                const stats = await fs.stat(path.join(dir, file));
                totalSize += stats.size;
            }
            return (totalSize / 1024 / 1024).toFixed(2); // MB
        } catch (error) {
            return '0.00';
        }
    }

    async saveCacheMetadata(sourceId, metadata) {
        const cacheDir = path.join(__dirname, 'data', 'cache', 'online', sourceId);
        await fs.mkdir(cacheDir, { recursive: true });
        const metaPath = path.join(cacheDir, 'metadata.json');
        await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
    }

    async cacheSourcePages(source, pages) {
        const cacheDir = path.join(__dirname, 'data', 'cache', 'online', source.id);
        await fs.mkdir(cacheDir, { recursive: true });
        
        console.log(`  💾 Caching pages for offline use...`);
        
        let cached = 0;
        let failed = 0;
        
        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            
            try {
                // Fetch full HTML
                const html = await this.fetchPage(page.url);
                if (!html) {
                    failed++;
                    continue;
                }
                
                // Remove images to save space
                const cleanHtml = this.removeImages(html);
                
                // Generate hash for filename
                const hash = this.hashUrl(page.url);
                const cachePath = path.join(cacheDir, `${hash}.html`);
                
                await fs.writeFile(cachePath, cleanHtml, 'utf-8');
                
                // Store cache metadata in page
                page.cache_path = cachePath;
                page.cache_hash = hash;
                page.cached_at = new Date().toISOString();
                page.is_cached = true;
                
                cached++;
                
                // Progress indicator
                if ((i + 1) % 10 === 0 || i === pages.length - 1) {
                    console.log(`    Cached ${cached}/${pages.length} pages...`);
                }
                
                // Small delay to avoid hammering server
                await new Promise(resolve => setTimeout(resolve, 200));
                
            } catch (error) {
                console.error(`    ❌ Cache failed for: ${page.title}`);
                failed++;
            }
        }
        
        const sizeInMB = await this.getCacheSize(cacheDir);
        
        console.log(`    ✅ Cached ${cached}/${pages.length} pages (${failed} failed)`);
        console.log(`    💾 Total size: ${sizeInMB} MB`);
        
        // Save metadata
        await this.saveCacheMetadata(source.id, {
            source_name: source.name,
            source_id: source.id,
            total_pages: pages.length,
            cached_pages: cached,
            failed_pages: failed,
            cached_at: new Date().toISOString(),
            size_mb: parseFloat(sizeInMB)
        });
        
        return { cached, failed, size_mb: sizeInMB };
    }

    async getCacheStatus() {
        const cacheDir = path.join(__dirname, 'data', 'cache', 'online');
        const status = [];
        
        try {
            const sources = await fs.readdir(cacheDir);
            
            for (const sourceId of sources) {
                try {
                    const metaPath = path.join(cacheDir, sourceId, 'metadata.json');
                    const metadata = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
                    status.push(metadata);
                } catch (e) {
                    // No metadata for this source
                }
            }
        } catch (error) {
            // Cache directory doesn't exist yet
        }
        
        return status;
    }

    getIndexInfo() {
        return {
            total_pages: this.index.pages.length,
            last_updated: this.index.last_updated,
            sources: this.index.sources || []
        };
    }
}

// CLI-interface
if (require.main === module) {
    const indexer = new ContentIndexer();
    const command = process.argv[2];
    
    (async () => {
        await indexer.initialize();
        
        if (command === 'build' || command === 'rebuild') {
            await indexer.buildIndex();
        } else if (command === 'cache') {
            // NEW: Cache offline sources
            console.log('\n💾 Starting offline caching...\n');
            const sources = await indexer.loadSources();
            const offlineSources = sources.online.filter(s => s.cache_offline === true);
            
            if (offlineSources.length === 0) {
                console.log('⚠️  No sources configured for offline caching');
                console.log('💡 Add "cache_offline": true to sources in sources.json');
                console.log('\nExample:');
                console.log('  {');
                console.log('    "id": "hacktricks",');
                console.log('    "name": "HackTricks",');
                console.log('    "cache_offline": true  ← Add this');
                console.log('  }');
                return;
            }
            
            if (offlineSources.length > 5) {
                console.log(`❌ Too many sources configured for caching!`);
                console.log(`   Configured: ${offlineSources.length}`);
                console.log(`   Maximum allowed: 5`);
                console.log(`   \n💡 Please reduce to 5 or fewer sources for caching`);
                return;
            }
            
            console.log(`📦 Found ${offlineSources.length} source(s) to cache:`);
            offlineSources.forEach(s => console.log(`   - ${s.name} (${s.id})`));
            console.log();
            
            let totalCached = 0;
            let totalSize = 0;
            
            for (const source of offlineSources) {
                console.log(`\n📚 Processing ${source.name}...`);
                
                // Index the source
                let pages = [];
                if (source.type === 'gitbook') {
                    pages = await indexer.indexGitBookSource(source);
                } else if (source.type === 'docusaurus') {
                    pages = await indexer.indexDocusaurusSource(source);
                } else if (source.type === 'markdown') {
                    pages = await indexer.indexMarkdownSource(source);
                }
                
                if (pages.length > 0) {
                    // Cache the pages
                    const result = await indexer.cacheSourcePages(source, pages);
                    totalCached += result.cached;
                    totalSize += parseFloat(result.size_mb);
                    
                    // Remove old pages from this source (if re-caching)
                    indexer.index.pages = indexer.index.pages.filter(p => p.source_id !== source.id);
        
                    // Add newly cached pages to index
                    indexer.index.pages.push(...pages);
                }
            }

            // Update sources metadata (so UI can display cached sources)
            indexer.index.sources = offlineSources.map(s => ({
                id: s.id,
                name: s.name,
                type: s.type,
                description: s.description || '',
                page_count: indexer.index.pages.filter(p => p.source_id === s.id).length,
                is_local: false  // Cached sources are online sources
            }));
            
            indexer.index.last_updated = new Date().toISOString();
            
            await indexer.saveIndex();
            
            console.log('\n✅ Offline caching complete!');
            console.log(`   Total cached: ${totalCached} pages`);
            console.log(`   Total size: ${totalSize.toFixed(2)} MB`);
            
        } else if (command === 'cache-status') {
            // NEW: Show cache status
            console.log('\n📊 Offline Cache Status:\n');
            const status = await indexer.getCacheStatus();
            
            if (status.length === 0) {
                console.log('  No cached sources found.');
                console.log('  Run: npm run cache');
            } else {
                let totalSize = 0;
                let totalPages = 0;
                
                status.forEach(s => {
                    console.log(`📦 ${s.source_name} (${s.source_id})`);
                    console.log(`   Cached: ${s.cached_pages}/${s.total_pages} pages`);
                    console.log(`   Size: ${s.size_mb} MB`);
                    console.log(`   Last cached: ${new Date(s.cached_at).toLocaleString()}`);
                    console.log();
                    
                    totalSize += s.size_mb;
                    totalPages += s.cached_pages;
                });
                
                console.log(`Total: ${totalPages} pages, ${totalSize.toFixed(2)} MB`);
            }
            
        } else if (command === 'update' && process.argv[3]) {
            const filePath = process.argv[3];
            await indexer.updateLocalFile(filePath);
        } else if (command === 'remove' && process.argv[3]) {
            const filePath = process.argv[3];
            await indexer.removeLocalFile(filePath);
        } else if (command === 'search' && process.argv[3]) {
            const query = process.argv.slice(3).join(' ');
            const results = indexer.search(query);
            
            console.log(`\n🔍 Search results for "${query}":\n`);
            if (results.length === 0) {
                console.log('No results found.');
            } else {
                results.slice(0, 10).forEach((result, i) => {
                    console.log(`${i + 1}. ${result.title} (${result.page_name})`);
                    console.log(`   ${result.url}`);
                    console.log(`   Score: ${result.relevance_score} (${result.match_type})`);
                    if (result.snippet && result.snippet.text) {
                        console.log(`   Snippet: ${result.snippet.text.substring(0, 80)}...`);
                    }
                    console.log();
                });
                console.log(`Total ${results.length} results found.\n`);
            }
        } else if (command === 'info') {
            const info = indexer.getIndexInfo();
            console.log('\n📊 Index information:');
            console.log(`Total pages: ${info.total_pages}`);
            console.log(`Last updated: ${info.last_updated || 'Never'}`);
            console.log(`Sources: ${info.sources.length}\n`);
            info.sources.forEach(s => {
                console.log(`  - ${s.name}: ${s.page_count} pages`);
            });
            console.log();
        } else {
            console.log('\n📚 Pentest - Knowledge Base Indexer (P-KBI)\n');
            console.log('Usage:');
            console.log('  node indexer.js build              - Rebuild entire index');
            console.log('  node indexer.js cache              - Cache offline sources');
            console.log('  node indexer.js cache-status       - Show cache status');
            console.log('  node indexer.js update <filepath>  - Update a local file');
            console.log('  node indexer.js remove <filepath>  - Remove file from index');
            console.log('  node indexer.js search <term>      - Search in index');
            console.log('  node indexer.js info               - Show index information\n');
        }
    })();
}

module.exports = ContentIndexer;
