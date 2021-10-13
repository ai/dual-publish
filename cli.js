import pico from 'picocolors'

function error(message) {
  process.stderr.write(pico.bgRed(' ERROR ') + ' ' + message + '\n')
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
