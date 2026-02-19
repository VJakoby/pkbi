const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const ContentIndexer = require('./indexer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initiate indexer
const indexer = new ContentIndexer();
let indexReady = false;

// Load index and start server
async function startServer() {
    try {
        await indexer.initialize();
        const info = indexer.getIndexInfo();

        if (info.total_pages > 0) {
            indexReady = true;
            console.log(`\n✅ Index loaded with ${info.total_pages} pages`);
            console.log(`📅 Last updated: ${info.last_updated || 'Never'}`);
            console.log(`📚 Sources:`);
            info.sources.forEach(s => {
                console.log(`   - ${s.name}: ${s.page_count} pages`);
            });
            console.log();
        } else {
            console.log('\n⚠️  Index is empty. Run "npm run index" to build the index.\n');
        }
    } catch (error) {
        console.error('❌ Error loading index:', error.message);
    }

    // Start server after index is loaded
    app.listen(PORT, () => {
        console.log(`✅ Pentesting Knowledge Base Indexer server started`);
        console.log(`🌐 Server is being run at:  http://localhost:${PORT}`);
        if (!indexReady) {
            console.log('⚠️  OBS: Index not ready!');
            console.log('   Run: npm run index\n');
        }
    });
}

startServer();

// API: Hämta status och källor
app.get('/api/status', (req, res) => {
    const info = indexer.getIndexInfo();
    res.json({
        ready: indexReady,
        version: '1.0',
        ...info
    });
});

// API: Search
app.post('/api/search', (req, res) => {
    const { query, fuzzy = true, fuzzy_prefer = false } = req.body;

    if (!indexReady) {
        return res.status(503).json({
            error: 'Index not ready. Run "npm run index" först.',
            results: [],
            count: 0
        });
    }

    if (!query || query.trim() === '') {
        return res.json({ results: [], count: 0, query: '' });
    }

    try {
        const startTime = Date.now();
        const results = indexer.search(query, { fuzzy, fuzzy_prefer });
        const searchTime = Date.now() - startTime;

        // Limit to top 50 results for better performance
        const topResults = results.slice(0, 50).map(r => ({
            source_name: r.source_name,
            source_id: r.source_id,
            title: r.title,
            page_name: r.page_name,
            url: r.url,
            file_path: r.file_path,
            relevance_score: r.relevance_score,
            match_type: r.match_type,
            snippet: r.snippet,  // Now includes {text, highlightStart, highlightLength}
            is_local: r.is_local
        }));

        res.json({
            results: topResults,
            count: topResults.length,
            total_matches: results.length,
            query: query,
            search_time_ms: searchTime,
            total_searched: indexer.index.pages.length
        });
    } catch (error) {
        console.error('Sökfel:', error);
        res.status(500).json({
            error: 'Fel vid sökning',
            results: [],
            count: 0
        });
    }
});

// API: Get all sources
app.get('/api/sources', (req, res) => {
    const info = indexer.getIndexInfo();
    res.json({
        sources: info.sources || [],
        total: info.sources?.length || 0
    });
});

// API: Preview local markdown file
app.get('/api/preview', async (req, res) => {
    const { file } = req.query;

    if (!file) {
        return res.status(400).json({ error: 'No file specified' });
    }

    try {
        // Security: Only allow files that are in the index
        const page = indexer.index.pages.find(p => p.file_path === file);
        if (!page) {
            return res.status(404).json({ error: 'File not found in index' });
        }

        const content = await fs.readFile(file, 'utf-8');

        // Simple markdown to HTML conversion (basic)
        const html = simpleMarkdownToHTML(content);

        res.json({
            title: page.title,
            page_name: page.page_name,
            html: html,
            raw: content,
            file_path: file
        });
    } catch (error) {
        console.error('Preview error:', error);
        res.status(500).json({ error: 'Could not read file' });
    }
});

// Simple markdown to HTML converter (basic but works)
function simpleMarkdownToHTML(markdown) {
    let html = markdown;

    // Headers
    html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/_(.*?)_/g, '<em>$1</em>');

    // Code blocks
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // Line breaks
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');

    // Wrap in paragraph
    html = '<p>' + html + '</p>';

    // Clean up
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p><h/g, '<h');
    html = html.replace(/<\/h([1-6])><\/p>/g, '</h$1>');
    html = html.replace(/<p><pre>/g, '<pre>');
    html = html.replace(/<\/pre><\/p>/g, '</pre>');

    return html;
}

// API: Incremental update of local file
app.post('/api/update-file', async (req, res) => {
    const { file } = req.body;

    if (!file) {
        return res.status(400).json({ error: 'No file specified' });
    }

    try {
        const success = await indexer.updateLocalFile(file);
        if (success) {
            res.json({
                success: true,
                message: 'File updated in index',
                total_pages: indexer.index.pages.length
            });
        } else {
            res.status(400).json({
                success: false,
                error: 'Could not update file'
            });
        }
    } catch (error) {
        console.error('Update file error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Remove file from index
app.post('/api/remove-file', async (req, res) => {
    const { file } = req.body;

    if (!file) {
        return res.status(400).json({ error: 'No file specified' });
    }

    try {
        const success = await indexer.removeLocalFile(file);
        if (success) {
            res.json({
                success: true,
                message: 'File removed from index',
                total_pages: indexer.index.pages.length
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'File not found in index'
            });
        }
    } catch (error) {
        console.error('Remove file error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Get cached page (for offline preview)
app.get('/api/cached-page', async (req, res) => {
    const { source_id, url } = req.query;

    if (!source_id || !url) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    try {
        const crypto = require('crypto');
        const hash = crypto.createHash('md5').update(url).digest('hex');
        const cachePath = path.join(__dirname, 'data', 'cache', 'online', source_id, `${hash}.html`);

        const html = await fs.readFile(cachePath, 'utf-8');

        res.json({
            html: html,
            cached: true,
            source_id: source_id,
            url: url
        });
    } catch (error) {
        res.status(404).json({
            error: 'Page not cached',
            message: 'Run: npm run cache to cache offline pages'
        });
    }
});

// API: Get cache status
app.get('/api/cache-status', async (req, res) => {
    try {
        const status = await indexer.getCacheStatus();
        res.json({ sources: status });
    } catch (error) {
        console.error('Cache status error:', error);
        res.json({ sources: [] });
    }
});

// API: Rebuild index (async)
app.post('/api/rebuild-index', async (req, res) => {
    if (!indexReady) {
        return res.status(503).json({
            error: 'Index rebuild in progress or cannot start'
        });
    }

    try {
        console.log('🔄 Rebuilding index...');
        res.json({ message: 'Index rebuild started in background' });

        indexReady = false;
        await indexer.buildIndex();
        indexReady = true;

        console.log('✅ Index rebuilt!');
    } catch (error) {
        console.error('❌ Error rebuilding index:', error);
        indexReady = true; // Restore status
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        index_ready: indexReady,
        uptime: process.uptime()
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down server...');
    process.exit(0);
});