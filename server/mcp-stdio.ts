/**
 * Zendo MCP server over stdio, for agents that start a local process (Claude Desktop, Claude Code):
 *
 *   npm run mcp        uses data/zendo.db (or ZENDO_DATA_DIR) on this machine
 *
 * It opens the same SQLite database as the Zendo server (WAL allows both at once); the app shows
 * the changes on its next refresh. Logs go to stderr, stdout belongs to the protocol.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { openDb } from './db.ts'
import { Repo } from './repo.ts'
import { createMcpServer } from './mcp.ts'

if (existsSync('.env')) process.loadEnvFile('.env')

const DB_FILE = path.join(process.env.ZENDO_DATA_DIR || 'data', 'zendo.db')
const db = openDb(DB_FILE)
const server = createMcpServer(new Repo(db), { hidePrivate: process.env.ZENDO_MCP_HIDE_PRIVATE === '1' })
await server.connect(new StdioServerTransport())
console.error(`Zendo MCP (stdio) on ${DB_FILE}`)
