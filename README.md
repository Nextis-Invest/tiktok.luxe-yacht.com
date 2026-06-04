# TikTok Scraper API

HTTP deployment wrapper for `jfyne/Tiktok-Scraper`.

## Endpoints

```http
GET /health
GET /scrape?hashtags=yacht,luxury&maxResultsPerPage=5
POST /scrape
```

`POST /scrape` accepts:

```json
{
  "hashtags": ["yacht", "luxury"],
  "startURLs": ["https://www.tiktok.com/tag/yacht"],
  "maxResultsPerPage": 5,
  "proxyUrls": ["http://user:pass@host:port"]
}
```

The service runs the upstream Apify actor in isolated local storage for each request and returns the collected dataset items as JSON.

## Deployment

Coolify should build this repository with the Dockerfile build pack. Dependencies are installed with Bun.

```text
Port: 3000
Domain: https://tiktok.luxe-yacht.com
Health check: /health
```

Useful environment variables:

```env
PORT=3000
MAX_CONCURRENT_SCRAPES=1
REQUEST_TIMEOUT_MS=180000
APIFY_LOG_LEVEL=INFO
```

## Upstream

Based on `jfyne/Tiktok-Scraper` commit `ace717718cde4534d7caa59c887aeaaca22f58e5`.
