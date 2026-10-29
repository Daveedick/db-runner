import { spawn } from 'node:child_process'

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('D&B Runner online development requires Node.js 24 or newer.')
  process.exit(1)
}

const processes = [
  spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'watch', 'server/index.ts'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...process.argv.slice(2)], { stdio: 'inherit' }),
]
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of processes) child.kill('SIGTERM')
  const timer = setTimeout(() => process.exit(code), 1_000)
  timer.unref()
  process.exitCode = code
}
for (const child of processes) {
  child.on('error', (error) => { console.error(error.message); stop(1) })
  child.on('exit', (code) => { if (!stopping) stop(code ?? 1) })
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
