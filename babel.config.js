// For jest only (RN app builds use metro's own babel). Strips TS + targets node.
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    '@babel/preset-typescript',
  ],
};
