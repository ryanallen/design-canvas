#!/usr/bin/env node
// The launcher behind "Design Canvas.cmd" (Windows) and "Design Canvas.command" (Mac): pick a
// folder of prototypes in the system's own folder picker, pick what to do from a numbered menu,
// and see the result, with nothing to remember or type. The canvas it makes edits itself once
// opened (Chrome or Edge: click Edit), so nothing is left running.
//
//   node scripts/app.mjs                                  ask for the folder and the action
//   node scripts/app.mjs --folder <dir> --action <build|check|serve>
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildCanvas, serveCanvas } from './canvas.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const remembered = path.join(here, '..', '.last-folder')
const args = process.argv.slice(2)
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = async (q) => (await rl.question(q)).trim()

/** The system's own folder picker; null when cancelled. */
function pickFolder(start) {
  try {
    if (process.platform === 'win32') {
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
        "$d.Description = 'The folder of HTML prototypes'",
        '$d.ShowNewFolderButton = $false',
        start ? `$d.SelectedPath = '${start.replace(/'/g, "''")}'` : '',
        "if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }",
      ].join('; ')
      return execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { encoding: 'utf8' }).trim() || null
    }
    if (process.platform === 'darwin') {
      // An AppleScript string: a backslash escaped before a quote, or `\"` in a path would end it early.
      const from = start ? ` default location (POSIX file "${start.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")` : ''
      return execFileSync('osascript', ['-e', `POSIX path of (choose folder with prompt "The folder of HTML prototypes"${from})`], { encoding: 'utf8' }).trim().replace(/\/$/, '') || null
    }
  } catch {
    return null
  }
  return null
}
/** Open a file or an address the way a double-click would. */
function open(target) {
  const [cmd, list] = process.platform === 'win32' ? ['explorer.exe', [target]] : process.platform === 'darwin' ? ['open', [target]] : ['xdg-open', [target]]
  spawn(cmd, list, { detached: true, stdio: 'ignore' }).unref()
}
const line = (s = '') => console.log(s)

async function build(folder) {
  try {
    return await buildCanvas({ folder })
  } catch (err) {
    if (!/changed since the canvas last edited/.test(err.message)) throw err
    line(`\n${err.message}`)
    if (!args.includes('--folder') && (await ask('\nBuild anyway, recording those files as carried over? (y/n) ')).toLowerCase().startsWith('y')) return buildCanvas({ folder, accept: true })
    throw new Error('Nothing built.')
  }
}

async function main() {
  line('Design canvas\n')
  let folder = option('--folder')
  if (!folder) {
    const last = fs.existsSync(remembered) ? fs.readFileSync(remembered, 'utf8').trim() : ''
    line('Pick the folder of HTML prototypes in the window that opens…')
    folder = pickFolder(last && fs.existsSync(last) ? last : os.homedir())
    if (!folder) {
      line('No folder picked.')
      return
    }
  }
  folder = path.resolve(folder)
  if (!fs.existsSync(folder)) throw new Error(`${folder} does not exist`)
  try {
    fs.writeFileSync(remembered, folder)
  } catch {}
  line(`Folder: ${folder}\n`)

  let action = option('--action')
  if (!action) {
    line('  1  Build the canvas and open it (then click Edit in Chrome or Edge)')
    line('  2  Open the canvas as it is')
    line('  3  Check it: every kind of edit through a browser, nothing written')
    line('  4  Serve it, for editing in Firefox or Safari (stays running until this window closes)')
    action = { 1: 'build', 2: 'open', 3: 'check', 4: 'serve' }[await ask('\nNumber: ')]
    if (!action) {
      line('Nothing chosen.')
      return
    }
  }
  const canvas = path.join(folder, 'canvas.html')
  if (action === 'build') {
    await build(folder)
    if (!args.includes('--no-open')) open(canvas)
  } else if (action === 'open') {
    if (!fs.existsSync(canvas)) throw new Error('There is no canvas.html in that folder yet: build it first.')
    open(canvas)
    line('Opened.')
  } else if (action === 'check') {
    const { check } = await import('./check.mjs')
    process.exitCode = await check({ folder }, { buildCanvas, serveCanvas })
  } else if (action === 'serve') {
    const built = await build(folder)
    const server = serveCanvas(built, { port: 4410 })
    server.on('listening', () => open(`http://127.0.0.1:${server.address().port}/`))
    await new Promise(() => {})
  } else throw new Error(`unknown action ${action}`)
}

try {
  await main()
} catch (err) {
  line(`\n${err.message}`)
  process.exitCode = 1
}
if (!args.includes('--folder')) await ask('\nPress Enter to close. ')
rl.close()
