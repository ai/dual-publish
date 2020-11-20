let f

if (process.env.NODE_ENV === 'production') {
  f = 'cjs f-prod'
} else {
  f = 'cjs f-dev'
}

module.exports = { f }
