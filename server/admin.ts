import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'

const [command, value] = process.argv.slice(2)
if (!['backup', 'delete-best', 'delete-share'].includes(command ?? '') || !value) {
  console.error('Usage: online:admin -- backup <new-file.sqlite> | delete-best <playerId> | delete-share <shareId>')
  process.exitCode = 1
} else {
  const path = resolve(process.env.DB_PATH ?? 'data/online.sqlite')
  if (!existsSync(path)) throw new Error(`Database not found: ${path}`)
  const database = new DatabaseSync(path)
  try {
    database.exec('PRAGMA busy_timeout = 5000')
    if (command === 'backup') {
      const destination = resolve(value)
      if (existsSync(destination)) throw new Error('Backup destination already exists; choose a new filename')
      mkdirSync(dirname(destination), { recursive: true })
      await backup(database, destination)
      console.log(`Consistent SQLite backup saved: ${destination}`)
    } else if (command === 'delete-best') {
      const result = database.prepare('DELETE FROM bests WHERE player_id = ?').run(value)
      console.log(`Deleted best results: ${result.changes}`)
    } else {
      const result = database.prepare('DELETE FROM shared_runs WHERE id = ?').run(value)
      console.log(`Deleted shared runs: ${result.changes}`)
    }
  } finally { database.close() }
}
