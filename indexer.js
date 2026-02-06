const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const cheerio = require('cheerio');

class ContentIndexer {
    constructor() {
        this.indexPath = path.join(__dirname, 'data', 'index.json');
        this.sourcesPath = path.join(__dirname, 'sources.json');
        this.index = { pages: [], last_updated: null, sources: [] };
    }

    async initialize() {
        const dataDir = path.join(__dirname, 'data');
        try {
            await fs.mkdir(dataDir, { recursive: true });
        } catch (err) {
            // Directory exists
        }

        try {
            const indexData = await fs.readFile(this.indexPath, 'utf-8');
            this.index = JSON.parse(indexData);
            console.log(`✅ Laddat befintligt index med ${this.index.pages.length} sidor`);
        } catch (err) {
            console.log('📝 Inget befintligt index hittat, skapar nytt');
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
        console.log(`\n📁 Indexerar ${source.name}...`);
        const pages = [];
        
        const resolvedPath = this.resolvePath(source.path);
        console.log(`  Sökväg: ${resolvedPath}`);
        
        try {
            await fs.access(resolvedPath);
        } catch (error) {
            console.log(`  ⚠️  Mappen finns inte: ${resolvedPath}`);
            console.log(`  💡 Skapa mappen eller uppdatera path i sources.json`);
            return pages;
        }
        
        const extensions = source.file_extensions || ['.md'];
        const files = await this.findMarkdownFiles(resolvedPath, extensions);
        
        console.log(`  Hittade ${files.length} filer`);
        
        if (files.length === 0) {
            console.log(`  ℹ️  Inga filer att indexera`);
            return pages;
        }
        
        for (const filePath of files) {
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                const title = this.extractMarkdownTitle(content, filePath);
                
                // Create relative path from source root for page name
                const relativePath = path.relative(resolvedPath, filePath);
                const pageName = relativePath.replace(/\\/g, '/').replace(/\.(md|txt)$/i, '');
                
                // Use file:// protocol for local files
                const fileUrl = `file://${filePath}`;
                
                pages.push({
                    source_id: source.id,
                    source_name: source.name,
                    url: fileUrl,
                    file_path: filePath,  // Store actual file path for preview
                    display_path: pageName,
                    title: title,
                    page_name: pageName,
                    content: content.toLowerCase(),
                    indexed_at: new Date().toISOString(),
                    is_local: true
                });
                
            } catch (error) {
                console.error(`  ❌ Error reading ${filePath}:`, error.message);
            }
        }
        
        console.log(`  ✅ Indexerade ${pages.length} filer från ${source.name}`);
        return pages;
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
            // Fallback: extrahera från URL
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
        // Extrahera sidnamnet från URL
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        const pageName = pathParts[pathParts.length - 1] || 'index';
        return pageName.replace(/-/g, ' ').replace(/_/g, ' ');
    }

    extractSnippet(content, searchTerm, length = 150) {
        const index = content.toLowerCase().indexOf(searchTerm.toLowerCase());
        if (index === -1) return '';
        
        const start = Math.max(0, index - length / 2);
        const end = Math.min(content.length, index + searchTerm.length + length / 2);
        
        let snippet = content.substring(start, end);
        if (start > 0) snippet = '...' + snippet;
        if (end < content.length) snippet = snippet + '...';
        
        return snippet;
    }

    async indexGitBookSource(source) {
        console.log(`\n📚 Indexerar ${source.name}...`);
        const pages = [];
        
        console.log(`  Hämtar huvudsida: ${source.index_url}`);
        const html = await this.fetchPage(source.index_url);
        if (!html) {
            console.log(`  ❌ Kunde inte hämta huvudsida`);
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

        console.log(`  Hittade ${links.size} interna länkar`);
        
        if (links.size === 0) {
            console.log(`  ⚠️  Inga länkar hittades - försöker indexera huvudsidan`);
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
                indexed_at: new Date().toISOString()
            });
            
            return pages;
        }

        // Parallell crawling för snabbare indexering
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
                        indexed_at: new Date().toISOString()
                    };
                }
                return null;
            });

            const results = await Promise.all(promises);
            const validResults = results.filter(p => p !== null);
            pages.push(...validResults);
            successful += validResults.length;
            
            indexed += chunk.length;
            console.log(`  Indexerade ${indexed}/${linkArray.length} sidor (${successful} lyckade)...`);
            
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log(`  ✅ Indexerade totalt ${pages.length} sidor från ${source.name}`);
        return pages;
    }

    async indexDocusaurusSource(source) {
        console.log(`\n📘 Indexerar ${source.name}...`);
        const pages = [];

        if (!source.pages || source.pages.length === 0) {
            console.log('  ⚠️  Inga sidor specificerade');
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
                        indexed_at: new Date().toISOString()
                    };
                }
                return null;
            });

            const results = await Promise.all(promises);
            pages.push(...results.filter(p => p !== null));
            
            console.log(`  Indexerade ${i + chunk.length}/${source.pages.length} sidor...`);
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log(`  ✅ Indexerade ${pages.length} sidor från ${source.name}`);
        return pages;
    }

    async buildIndex() {
        console.log('\n🚀 Startar indexering av alla källor...\n');
        
        const sources = await this.loadSources();
        const allPages = [];

        // Index online sources
        console.log('🌐 ONLINE KÄLLOR:');
        for (const source of sources.online) {
            try {
                let pages = [];
                
                if (source.type === 'gitbook') {
                    pages = await this.indexGitBookSource(source);
                } else if (source.type === 'docusaurus') {
                    pages = await this.indexDocusaurusSource(source);
                }
                
                allPages.push(...pages);
            } catch (error) {
                console.error(`❌ Fel vid indexering av ${source.name}:`, error.message);
            }
        }

        // Index offline sources
        if (sources.offline.length > 0) {
            console.log('\n📁 OFFLINE KÄLLOR:');
            for (const source of sources.offline) {
                try {
                    const pages = await this.indexLocalSource(source);
                    allPages.push(...pages);
                } catch (error) {
                    console.error(`❌ Fel vid indexering av ${source.name}:`, error.message);
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

        await this.saveIndex();
        
        console.log('\n✅ Indexering klar!');
        console.log(`📊 Totalt indexerade sidor: ${allPages.length}`);
        console.log(`   🌐 Online: ${allPages.filter(p => !p.is_local).length}`);
        console.log(`   📁 Offline: ${allPages.filter(p => p.is_local).length}`);
        console.log(`💾 Index sparat i: ${this.indexPath}\n`);
    }

    async saveIndex() {
        await fs.writeFile(
            this.indexPath,
            JSON.stringify(this.index, null, 2),
            'utf-8'
        );
    }

    // FÖRBÄTTRAD SÖKALGORITM v3.0
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
            
            // 1. EXAKT TITEL-MATCH (högst vikt)
            if (titleLower === searchTerm) {
                score += 100;
                matchType = 'exact_title';
            }
            // 2. TITEL INNEHÅLLER SÖKTERM
            else if (titleLower.includes(searchTerm)) {
                score += 50;
                matchType = 'title_contains';
            }
            
            // 3. SIDNAMN-MATCH (från URL)
            if (pageNameLower.includes(searchTerm)) {
                score += 30;
                if (!matchType) matchType = 'page_name';
            }
            
            // 4. URL-MATCH (viktigt för specifika sidor)
            if (urlLower.includes(searchTerm)) {
                score += 20;
                if (!matchType) matchType = 'url';
            }
            
            // 5. INNEHÅLLS-MATCH
            const occurrences = (contentLower.match(new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
            if (occurrences > 0) {
                score += Math.min(occurrences * 2, 10);
                if (!matchType) matchType = 'content';
            }
            
            if (
              fuzzyMatch &&
              score === 0 &&
              searchTerm.length >= 4
            ) {
              const fuzzyScore =
              this.fuzzySearch(searchTerm, titleLower) +
              this.fuzzySearch(searchTerm, pageNameLower);

            if (fuzzyScore >= 0.8) {
              matchType = 'fuzzy';
              score = Math.min(Math.floor(fuzzyScore * 6), 6); // MAX 6 POÄNG
            }
        }
            
            // 7. BOOST FÖR KORTARE TITLAR (mer relevanta)
            if (score > 0 && titleLower.length < 50) {
                score += 5;
            }

            if (!page.is_local) {
                score *= 1.15;   // externa källor prioriteras
            } else {
                score *= 0.95;   // lokala något lägre
            }

            if (matchType === 'fuzzy' && !page.is_local) {
              score *= 0.4;
            }

            if (score > 0) {
                results.push({
                    ...page,
                    relevance_score: Math.round(score),
                    match_type: matchType,
                    snippet: this.extractSnippet(page.content, searchTerm)
                });
            }
        }

        results.sort((a, b) => b.relevance_score - a.relevance_score);

        const nonFuzzy = results.filter(r => r.match_type !== 'fuzzy');
        const fuzzy = results.filter(r => r.match_type === 'fuzzy');

        return [...nonFuzzy, ...fuzzy];
    }

    // Enkel fuzzy search (Levenshtein-liknande)
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
        
        const ratio = matches / pattern.length;
        const lengthPenalty = pattern.length / text.length;

        return ratio * lengthPenalty;
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
        } else if (command === 'search' && process.argv[3]) {
            const query = process.argv.slice(3).join(' ');
            const results = indexer.search(query);
            
            console.log(`\n🔍 Sökresultat för "${query}":\n`);
            if (results.length === 0) {
                console.log('Inga resultat hittades.');
            } else {
                results.slice(0, 10).forEach((result, i) => {
                    console.log(`${i + 1}. ${result.title} (${result.page_name})`);
                    console.log(`   ${result.url}`);
                    console.log(`   Score: ${result.relevance_score} (${result.match_type})\n`);
                });
                console.log(`Totalt ${results.length} resultat hittades.\n`);
            }
        } else if (command === 'info') {
            const info = indexer.getIndexInfo();
            console.log('\n📊 Index information:');
            console.log(`Total sidor: ${info.total_pages}`);
            console.log(`Senast uppdaterad: ${info.last_updated || 'Aldrig'}`);
            console.log(`Källor: ${info.sources.length}\n`);
            info.sources.forEach(s => {
                console.log(`  - ${s.name}: ${s.page_count} sidor`);
            });
            console.log();
        } else {
            console.log('\n📚 Pentest Reference Indexer v3.0\n');
            console.log('Användning:');
            console.log('  node indexer.js build          - Bygg om hela indexet');
            console.log('  node indexer.js search <term>  - Sök i indexet');
            console.log('  node indexer.js info           - Visa index-information\n');
        }
    })();
}

module.exports = ContentIndexer;