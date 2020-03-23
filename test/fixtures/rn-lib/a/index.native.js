let { b } = require('../b')
require('../c')

let a = () => {
  b()
  console.log('native a')
}

module.exports = { a }
