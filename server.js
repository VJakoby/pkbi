const express = require('express');
const cors = require('cors');
const ContentIndexer = require('./indexer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initiera indexer
const indexer = new ContentIndexer();
let indexReady = false;

// Ladda index vid start
(async () => {
    try {
        await indexer.initialize();
        const info = indexer.getIndexInfo();
        
        if (info.total_pages > 0) {
            console.log(`\n✅ Index laddat med ${info.total_pages} sidor`);
            console.log(`📅 Senast uppdaterat: ${info.last_updated || 'Aldrig'}`);
            console.log(`📚 Källor:`);
            info.sources.forEach(s => {
                console.log(`   - ${s.name}: ${s.page_count} sidor`);
            });
            console.log();
            indexReady = true;
        } else {
            console.log('\n⚠️  Index är tomt. Kör "npm run index" för att bygga indexet.\n');
        }
    } catch (error) {
        console.error('❌ Fel vid laddning av index:', error.message);
    }
})();

// API: Hämta status och källor
app.get('/api/status', (req, res) => {
    const info = indexer.getIndexInfo();
    res.json({
        ready: indexReady,
        version: '3.0',
        ...info
    });
});

// API: Sök
app.post('/api/search', (req, res) => {
    const { query, fuzzy = true } = req.body;
    
    if (!indexReady) {
        return res.status(503).json({
            error: 'Index inte redo. Kör "npm run index" först.',
            results: [],
            count: 0
        });
    }
    
    if (!query || query.trim() === '') {
        return res.json({ results: [], count: 0, query: '' });
    }

    try {
        const startTime = Date.now();
        const results = indexer.search(query, { fuzzy });
        const searchTime = Date.now() - startTime;
        
        // Begränsa till top 50 resultat för bättre prestanda
        const topResults = results.slice(0, 50).map(r => ({
            source_name: r.source_name,
            source_id: r.source_id,
            title: r.title,
            page_name: r.page_name,
            url: r.url,
            relevance_score: r.relevance_score,
            match_type: r.match_type,
            snippet: r.snippet
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

// API: Hämta alla källor
app.get('/api/sources', (req, res) => {
    const info = indexer.getIndexInfo();
    res.json({
        sources: info.sources || [],
        total: info.sources?.length || 0
    });
});

// API: Bygg om index (async)
app.post('/api/rebuild-index', async (req, res) => {
    if (!indexReady) {
        return res.status(503).json({
            error: 'Indexering pågår redan eller kan inte startas'
        });
    }

    try {
        console.log('🔄 Startar ombyggnad av index...');
        res.json({ message: 'Indexering startad i bakgrunden' });
        
        indexReady = false;
        await indexer.buildIndex();
        indexReady = true;
        
        console.log('✅ Index ombyggt!');
    } catch (error) {
        console.error('❌ Fel vid ombyggnad:', error);
        indexReady = true; // Återställ status
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

app.listen(PORT, () => {
    console.log(`\n✅ Pentest Reference Search v3.0`);
    console.log(`🌐 Server körs på http://localhost:${PORT}`);
    console.log(`📂 Öppna http://localhost:${PORT} i din webbläsare\n`);
    
    if (!indexReady) {
        console.log('⚠️  OBS: Index är inte redo!');
        console.log('   Kör: npm run index\n');
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('\n🛑 Stänger ner servern...');
    process.exit(0);
});
