let g

if (process.env.NODE_ENV === 'production') {
  g = 'cjs g-browser-prod'
} else {
  g = 'cjs g-browser-dev'
}

module.exports = { g }
