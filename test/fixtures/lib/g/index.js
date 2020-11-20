let g

if (process.env.NODE_ENV === 'production') {
  g = 'cjs g-node-prod'
} else {
  g = 'cjs g-node-dev'
}

module.exports = { g }
