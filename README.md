# single-instance-guard

[![npm version](https://img.shields.io/npm/v/single-instance-guard.svg)](https://www.npmjs.com/package/single-instance-guard)
[![license](https://img.shields.io/npm/l/single-instance-guard.svg)](https://www.npmjs.com/package/single-instance-guard)

Makes sure only one copy of a script runs at a time. For example, a cron job
that runs every minute but sometimes takes longer than a minute.

It creates a lock file with the process ID (PID) in it. If the lock file
already exists and that process is still running, the lock is taken. If the
process is gone (it crashed or was killed), the old lock file is replaced.
The lock file is removed when the process exits.

Works with both `import` and `require`. Requires Node.js 18 or newer. No
dependencies.

## Installation

```console
npm i single-instance-guard
```

## Usage

```ts
import { acquireLock } from 'single-instance-guard'

const lock = acquireLock('sync-orders')

if (!lock) {
  console.log('Already running')
  process.exit(0)
}

await syncOrders()
// The lock is released when the process exits, or call lock.release()
```

To see who holds the lock:

```ts
import { getLockOwner } from 'single-instance-guard'

getLockOwner('sync-orders') // 48213, or null if nobody holds it
```

By default the lock file is `<os.tmpdir()>/<name>.lock`. Use the `directory`
option to put it somewhere else, for example when the scripts run as
different users:

```ts
acquireLock('sync-orders', { directory: '/var/lock' })
```

## API

### acquireLock(name, options?)

- `name` - name of the lock. Only letters, numbers, `.`, `_` and `-`.
- `options.directory` - folder for the lock file. Default: `os.tmpdir()`.
- Returns: `InstanceLock`, or `null` if another running process holds the
  lock.

Calling it again in the same process while you hold the lock returns `null`.

### getLockOwner(name, options?)

- Returns: the PID of the running process that holds the lock, or `null`.

### InstanceLock

- `path` - path of the lock file.
- `release()` - removes the lock file. It's called on exit automatically.

## Limitations

- Only works for processes on the same machine. Don't put the lock file on a
  network drive.
- If a process is killed and the system later gives its PID to another
  running process, the old lock file looks taken until that process ends.
  This is rare.
- The lock file isn't removed when the process is killed with `SIGKILL` or
  crashes hard. The next `acquireLock` call cleans it up.

## License

ISC
