// A file written so it is never seen half written: the bytes go to a hidden file beside it, flushed
// to disk, which is then renamed over it. A crash, a full disk or a failed write leaves the file as it
// was, so a prototype keeps its markup and canvas.html keeps every comment, edit and board line.
// A symbolic link stays a link, its target replaced, and the file keeps its permissions.
import fs from 'node:fs'
import path from 'node:path'

let writes = 0

/** Write `text` to `file` in one step: the old bytes or the new ones, never a part of either. */
export function writeFileAtomic(file, text) {
  let target = file
  try {
    target = fs.realpathSync(file)
  } catch {}
  let mode = null
  try {
    mode = fs.statSync(target).mode & 0o777
  } catch {}
  // A dot name with no .html ending: the folder's listing and its watcher pass over it.
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}-${++writes}.canvas-write`)
  try {
    const fd = fs.openSync(temporary, 'wx', mode ?? 0o666)
    try {
      fs.writeFileSync(fd, text)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    if (mode !== null) fs.chmodSync(temporary, mode)
    renameOver(temporary, target)
  } catch (error) {
    fs.rmSync(temporary, { force: true })
    throw error
  }
}

// Windows refuses a rename over a file another program holds open for a moment (an editor, a
// virus scanner, a sync client), so it is tried again briefly before giving up.
function renameOver(from, to) {
  for (let tries = 0; ; tries++) {
    try {
      return fs.renameSync(from, to)
    } catch (error) {
      if (tries >= 20 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
  }
}
