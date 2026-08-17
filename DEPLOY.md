# Deployment Guide

## Netlify Setup

1. **Connect repository**
   - Go to https://app.netlify.com
   - Click "Add new site" → "Import an existing project"
   - Connect your GitHub repo `minty-web/buster`

2. **Build settings**
   - Build command: `echo 'No build step needed'`
   - Publish directory: `.`
   - Functions directory: `netlify/functions`

3. **Environment variables**
Add in Netlify dashboard → Site settings → Environment variables:
```
GEMINI_API_KEY=your_key_here
```

4. **Deploy**
   - Click "Deploy site"
   - Netlify will automatically build and deploy

## How it works

- Static files (HTML/CSS/JS) served from root
- API calls to `/api/*` are redirected to serverless functions
- Functions run Node.js with access to environment variables
- No backend server needed - fully serverless

## Testing locally

```bash
npm install -g netlify-cli
netlify dev
```

This runs the site locally with functions working on port 8888.

## Troubleshooting

- **Functions not working?** Check Netlify function logs in dashboard
- **API key missing?** Functions fall back to mock responses
- **CORS errors?** Functions include CORS headers for all origins
