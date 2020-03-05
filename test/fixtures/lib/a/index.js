function a () {
  console.log('cjs a')
}

let toShare = 'shaked-export'

module.exports = { a, toShare }
