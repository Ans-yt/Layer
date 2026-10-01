import { spawn } from 'node:child_process'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const args = process.argv.slice(2)
const production = args[0]?.toLowerCase() === 'prod' || args.includes('--prod')
const serverArgs = production ? args.slice(1).filter((arg) => arg !== '--prod') : args

const run = (command, commandArgs) => {
  const usesWindowsNpmShim = process.platform === 'win32' && command === npmCommand
  const spawnCommand = usesWindowsNpmShim ? (process.env.ComSpec || 'cmd.exe') : command
  const spawnArgs = usesWindowsNpmShim
    ? ['/d', '/s', '/c', [command, ...commandArgs].map((arg) => /[\s"&|<>^]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg).join(' ')]
    : commandArgs
  const child = spawn(spawnCommand, spawnArgs, {
    stdio: 'inherit',
    env: process.env,
  })
  child.on('error', (error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  return child
}

const startServer = () => {
  const child = run(process.execPath, ['server/index.mjs', ...serverArgs])
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    else process.exitCode = code ?? 1
  })
}

if (!production) {
  startServer()
} else {
  const build = run(npmCommand, ['run', 'build'])
  build.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    else if (code === 0) startServer()
    else process.exitCode = code ?? 1
  })
}
