const crypto = require('crypto');
const express = require('express');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const app = express();

const port = Number.parseInt(process.env.PORT || '3000', 10);
const requestTimeoutMs = Number.parseInt(process.env.REQUEST_TIMEOUT_MS || '180000', 10);
const maxConcurrentScrapes = Number.parseInt(process.env.MAX_CONCURRENT_SCRAPES || '1', 10);
const keepStorage = process.env.KEEP_SCRAPER_STORAGE === 'true';

let activeScrapes = 0;

app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => {
    res.json({ ok: true, activeScrapes });
});

app.get('/', (_req, res) => {
    res.json({
        ok: true,
        service: 'tiktok.luxe-yacht.com',
        endpoints: {
            health: 'GET /health',
            scrapeGet: 'GET /scrape?hashtags=yacht,luxury&maxResultsPerPage=5',
            scrapePost: 'POST /scrape',
        },
    });
});

app.get('/scrape', async (req, res) => {
    try {
        const input = normalizeInput(req.query);
        const result = await runScraper(input);
        res.json(result);
    } catch (error) {
        sendError(res, error);
    }
});

app.post('/scrape', async (req, res) => {
    try {
        const input = normalizeInput(req.body || {});
        const result = await runScraper(input);
        res.json(result);
    } catch (error) {
        sendError(res, error);
    }
});

function normalizeInput(raw) {
    const hashtags = toArray(raw.hashtags)
        .map((value) => value.replace(/^#/, '').trim())
        .filter(Boolean);

    const startURLs = toArray(raw.startURLs || raw.startUrls || raw.urls)
        .map((value) => value.trim())
        .filter(Boolean)
        .map((url) => ({ url }));

    const maxResultsPerPage = parseInteger(raw.maxResultsPerPage, 10);
    const proxyUrls = toArray(raw.proxyUrls || raw.proxyURL || raw.proxyUrl)
        .map((value) => value.trim())
        .filter(Boolean);

    if (!hashtags.length && !startURLs.length) {
        const error = new Error('Provide at least one hashtag or start URL.');
        error.statusCode = 400;
        throw error;
    }

    const input = { maxResultsPerPage };
    if (hashtags.length) input.hashtags = hashtags;
    if (startURLs.length) input.startURLs = startURLs;
    if (proxyUrls.length) input.proxyConfiguration = { proxyUrls };

    return input;
}

function toArray(value) {
    if (Array.isArray(value)) return value.flatMap(toArray);
    if (typeof value !== 'string') return [];
    return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed;
}

async function runScraper(input) {
    if (activeScrapes >= maxConcurrentScrapes) {
        const error = new Error('Another scrape is already running. Try again shortly.');
        error.statusCode = 429;
        throw error;
    }

    activeScrapes += 1;
    const requestId = crypto.randomUUID();
    const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), `tiktok-scraper-${requestId}-`));

    try {
        await writeInput(storageDir, input);
        const run = await runActor(storageDir);
        const items = await readDataset(storageDir);

        return {
            ok: run.exitCode === 0,
            requestId,
            count: items.length,
            items,
            logs: run.logs,
        };
    } finally {
        activeScrapes -= 1;
        if (!keepStorage) {
            await fs.rm(storageDir, { recursive: true, force: true });
        }
    }
}

async function writeInput(storageDir, input) {
    const inputDir = path.join(storageDir, 'key_value_stores', 'default');
    await fs.mkdir(inputDir, { recursive: true });
    await fs.writeFile(path.join(inputDir, 'INPUT.json'), JSON.stringify(input, null, 2));
}

function runActor(storageDir) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['src/main.js'], {
            cwd: path.resolve(__dirname, '..'),
            env: {
                ...process.env,
                APIFY_HEADLESS: '1',
                APIFY_LOCAL_STORAGE_DIR: storageDir,
                APIFY_LOG_LEVEL: process.env.APIFY_LOG_LEVEL || 'INFO',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let output = '';
        const timeout = setTimeout(() => {
            child.kill('SIGTERM');
        }, requestTimeoutMs);

        child.stdout.on('data', (chunk) => {
            output += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            output += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (exitCode) => {
            clearTimeout(timeout);
            const logs = output.trim().split('\n').slice(-80);
            if (exitCode !== 0) {
                const error = new Error(`Scraper exited with code ${exitCode}.`);
                error.statusCode = 502;
                error.logs = logs;
                reject(error);
                return;
            }
            resolve({ exitCode, logs });
        });
    });
}

async function readDataset(storageDir) {
    const datasetDir = path.join(storageDir, 'datasets', 'default');
    let files = [];
    try {
        files = await fs.readdir(datasetDir);
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }

    const items = [];
    for (const file of files.filter((name) => name.endsWith('.json')).sort()) {
        const content = await fs.readFile(path.join(datasetDir, file), 'utf8');
        items.push(JSON.parse(content));
    }
    return items;
}

function sendError(res, error) {
    res.status(error.statusCode || 500).json({
        ok: false,
        error: error.message,
        logs: error.logs,
    });
}

app.listen(port, () => {
    console.log(`TikTok scraper API listening on ${port}`);
});
