/** Starts the Vite dev server (UI) and the Zendo server (API, database, calendar) together; Ctrl+C stops both. */
import { spawn } from 'node:child_process'

const procs = []
const run = (label, cmd, args) => {
  const p = spawn(cmd, args, { stdio: 'inherit', env: process.env })
  p.on('exit', (code) => {
    if (code && code !== 0) console.error(`[${label}] exited with code ${code}${label === 'server' ? ' – the UI will show "server not reachable" until this is fixed and npm run dev is restarted' : ''}`)
  })
  procs.push(p)
}

run('server', process.execPath, ['server/index.ts'])
run('web', process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5173', '--host', '127.0.0.1'])

const stop = () => {
  for (const p of procs) p.kill('SIGTERM')
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
