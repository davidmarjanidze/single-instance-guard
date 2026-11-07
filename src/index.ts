import { linkSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface LockOptions {
  /** Folder for the lock file. Default: `os.tmpdir()`. */
  directory?: string
}

export interface InstanceLock {
  /** Path of the lock file. */
  readonly path: string
  /**
   * Removes the lock file. Called on process exit automatically, so you
   * only need it to release the lock earlier.
   */
  release(): void
}

function getPath(name: string, options: LockOptions): string {
  if (!/^[\w.-]+$/.test(name) || name === '.' || name === '..') {
    throw new TypeError(
      `"name" can only contain letters, numbers, ".", "_" and "-", got ${JSON.stringify(name)}`
    )
  }
  return join(options.directory ?? tmpdir(), `${name}.lock`)
}

function readOwner(path: string): number | null {
  try {
    const pid = Number(readFileSync(path, 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function removeFile(path: string): void {
  try {
    unlinkSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

// Creates the lock file with our PID in it. The PID is written to a temp
// file first and then linked to the lock path, so other processes never
// see an empty lock file. `linkSync` fails if the lock file already exists.
function tryCreate(path: string): boolean {
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, String(process.pid))
  try {
    linkSync(temp, path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  } finally {
    removeFile(temp)
  }
}

/**
 * Returns the PID of the process that holds the lock, or `null` if nobody
 * holds it.
 */
export function getLockOwner(
  name: string,
  options: LockOptions = {}
): number | null {
  const owner = readOwner(getPath(name, options))
  return owner !== null && isRunning(owner) ? owner : null
}

/**
 * Takes the lock if no other running process holds it. Returns `null` if
 * the lock is taken. A lock file left by a process that's no longer
 * running is taken over.
 */
export function acquireLock(
  name: string,
  options: LockOptions = {}
): InstanceLock | null {
  const path = getPath(name, options)

  let created = tryCreate(path)
  if (!created) {
    const owner = readOwner(path)
    if (owner !== null && isRunning(owner)) return null

    // The process that made the lock file is gone.
    removeFile(path)
    created = tryCreate(path)
    if (!created) return null
  }

  const release = () => {
    process.off('exit', release)
    // Don't remove a lock file that another process has taken over.
    if (readOwner(path) === process.pid) removeFile(path)
  }
  process.on('exit', release)

  return { path, release }
}
