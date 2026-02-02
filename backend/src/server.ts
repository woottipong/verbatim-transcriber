/**
 * Thai Verbatim Transcriber - Backend Server
 * 
 * Modular relay server supporting multiple ASR providers
 * - Deepgram (real-time streaming)
 * - Gemini 2.0 Flash (batch processing)
 */

import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import { parse } from 'url';

// Load environment variables
dotenv.config();

// Imports
import { SERVER_CONFIG, validateConfig } from './config.js';
import { providers, listProviders } from './providers/index.js';

// ============================================
// Server Setup
// ============================================

const app = express();
app.use(cors());
app.use(express.json());

// HTTP Server
const server = http.createServer(app);

// WebSocket Server (path-based routing)
const wss = new WebSocketServer({ server });

// ============================================
// REST Endpoints
// ============================================

// Health check
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        providers: listProviders(),
    });
});

// List available providers
app.get('/providers', (_req, res) => {
    res.json({
        providers: listProviders(),
    });
});

// ============================================
// WebSocket Routing
// ============================================

wss.on('connection', (socket: WebSocket, req) => {
    const pathname = parse(req.url || '').pathname || '';

    console.log(`🔗 WebSocket connection: ${pathname}`);

    // Route by path: /deepgram, /gemini
    // Strip leading slash to get provider name
    const providerName = pathname.replace(/^\//, '').toLowerCase();

    // Look up provider
    const provider = providers[providerName];

    if (!provider) {
        console.error(`❌ Unknown provider: ${providerName}`);
        socket.send(JSON.stringify({
            type: 'error',
            error: `Unknown provider: ${providerName}. Available: ${Object.keys(providers).join(', ')}`
        }));
        socket.close();
        return;
    }

    if (!provider.isAvailable()) {
        console.error(`❌ Provider ${providerName} is not available (missing API key?)`);
        socket.send(JSON.stringify({
            type: 'error',
            error: `Provider ${providerName} is not configured. Check server API keys.`
        }));
        socket.close();
        return;
    }

    // Delegate to provider
    provider.handleConnection(socket);
});

// ============================================
// Startup
// ============================================

function start() {
    // Validate configuration
    const configResult = validateConfig();
    if (configResult.errors.length > 0) {
        console.warn('⚠️  Configuration warnings:');
        configResult.errors.forEach(err => console.warn(`   - ${err}`));
    }

    // Show available providers
    console.log('\n📦 Available ASR Providers:');
    listProviders().forEach(p => {
        const status = p.available ? '✅' : '❌';
        console.log(`   ${status} ${p.name} (/${p.key})`);
    });

    // Start server
    server.listen(SERVER_CONFIG.PORT, () => {
        console.log(`\n🚀 Server running on port ${SERVER_CONFIG.PORT}`);
        console.log(`   Health: http://localhost:${SERVER_CONFIG.PORT}/health`);
        console.log(`   WebSocket endpoints:`);
        Object.keys(providers).forEach(key => {
            console.log(`     - ws://localhost:${SERVER_CONFIG.PORT}/${key}`);
        });
        console.log('');
    });
}

start();
