import { bgRed } from 'nanocolors'

function error(message) {
  process.stderr.write(bgRed(' ERROR ') + ' ' + message + '\n')
}

function print(...lines) {
  process.stdout.write(lines.join('\n') + '\n')
}

export async function cli(cb) {
  try {
    await cb(process.argv.slice(2), print, error)
  } catch (e) {
    if (e.own) {
      error(e.message)
    } else {
      error(e.stack)
    }
    process.exit(1)
  }
}
