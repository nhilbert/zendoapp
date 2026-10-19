/** Starts the Vite dev server and the calendar service together; Ctrl+C stops both. */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const procs = []
const run = (label, cmd, args) => {
  const p = spawn(cmd, args, { stdio: 'inherit', env: process.env })
  p.on('exit', (code) => {
    if (code && code !== 0) console.error(`[${label}] exited with code ${code}${label === 'calendar' ? ' – Settings will show "calendar service not running" until this is fixed and npm run dev is restarted' : ''}`)
  })
  procs.push(p)
}

run('web', process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5173', '--host', '127.0.0.1'])
if (existsSync('.env')) run('calendar', process.execPath, ['server/calendar.mjs'])
else console.log('No .env found – starting without the calendar service (see docs/outlook-setup.md).')

const stop = () => {
  for (const p of procs) p.kill('SIGTERM')
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
