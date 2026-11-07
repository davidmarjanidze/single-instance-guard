import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { after, test } from 'node:test'
import { acquireLock, getLockOwner } from '../dist/index.js'

const directory = mkdtempSync(join(tmpdir(), 'single-instance-guard-'))
const options = { directory }
const lib = import.meta.resolve('../dist/index.js')

after(() => rmSync(directory, { recursive: true, force: true }))

// Starts a child process that takes the lock and prints "locked" or "busy".
function startChild(name, code = 'setInterval(() => {}, 1000)') {
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { acquireLock } from ${JSON.stringify(lib)}
      const lock = acquireLock(${JSON.stringify(name)}, ${JSON.stringify(options)})
      console.log(lock ? 'locked' : 'busy')
      ${code}`
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] }
  )
  const output = new Promise((resolve) => {
    child.stdout.once('data', (data) => resolve(String(data).trim()))
  })
  const exited = new Promise((resolve) => child.once('exit', resolve))
  return { child, output, exited }
}

test('takes and releases a lock', () => {
  const lock = acquireLock('basic', options)
  assert.ok(lock)
  assert.equal(lock.path, join(directory, 'basic.lock'))
  assert.equal(getLockOwner('basic', options), process.pid)

  assert.equal(acquireLock('basic', options), null)

  lock.release()
  assert.equal(existsSync(lock.path), false)
  assert.equal(getLockOwner('basic', options), null)
})

test('another process cannot take a held lock', async () => {
  const lock = acquireLock('shared', options)
  const { output } = startChild('shared', '')
  assert.equal(await output, 'busy')
  lock.release()
})

test('the lock file is removed when the process exits', async () => {
  const { output, exited } = startChild('child', '')
  assert.equal(await output, 'locked')
  await exited
  // The child removed the lock file on exit
  assert.equal(existsSync(join(directory, 'child.lock')), false)
  const lock = acquireLock('child', options)
  assert.ok(lock)
  lock.release()
})

test(
  'takes over the lock of a killed process',
  { skip: process.platform === 'win32' },
  async () => {
    const { child, output, exited } = startChild('killed')
    assert.equal(await output, 'locked')
    assert.equal(getLockOwner('killed', options), child.pid)
    assert.equal(acquireLock('killed', options), null)

    child.kill('SIGKILL')
    await exited
    // The file is still there, but its process is gone
    assert.equal(existsSync(join(directory, 'killed.lock')), true)
    assert.equal(getLockOwner('killed', options), null)

    const lock = acquireLock('killed', options)
    assert.ok(lock)
    lock.release()
  }
)

test('takes over a lock file with invalid content', () => {
  writeFileSync(join(directory, 'broken.lock'), 'not a pid')
  const lock = acquireLock('broken', options)
  assert.ok(lock)
  lock.release()
})

test('release does not remove a lock taken over by someone else', () => {
  const lock = acquireLock('other', options)
  writeFileSync(lock.path, '1')
  lock.release()
  assert.equal(existsSync(lock.path), true)
})

test('throws on names that are not safe file names', () => {
  assert.throws(() => acquireLock('../evil', options), TypeError)
  assert.throws(() => acquireLock('', options), TypeError)
})

test('CommonJS build works', () => {
  const cjs = createRequire(import.meta.url)('../dist/index.cjs')
  const lock = cjs.acquireLock('cjs', options)
  assert.ok(lock)
  assert.equal(cjs.getLockOwner('cjs', options), process.pid)
  lock.release()
})
