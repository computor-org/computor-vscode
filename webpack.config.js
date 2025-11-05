const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

/**
 * @param {Record<string, unknown>} env
 * @param {{ mode?: 'development' | 'production' | 'none' }} argv
 */
module.exports = (_env = {}, argv = {}) => {
  const mode = argv.mode && typeof argv.mode === 'string' ? argv.mode : 'production';

  return {
    mode,
    target: 'node',
    entry: path.resolve(__dirname, 'src', 'extension.ts'),
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'extension.js',
      libraryTarget: 'commonjs2'
    },
    devtool: mode === 'development' ? 'eval-source-map' : 'source-map',
    externals: {
      vscode: 'commonjs vscode'
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.json']
    },
    module: {
      rules: [
        {
          test: /\.[tj]s$/,
          exclude: /node_modules/,
          use: [
            {
              loader: 'ts-loader',
              options: {
                transpileOnly: true
              }
            }
          ]
        }
      ]
    },
    plugins: [
      new CopyWebpackPlugin({
        patterns: [
          {
            from: path.resolve(__dirname, 'src', 'exceptions', 'error-catalog.vscode.json'),
            to: path.resolve(__dirname, 'dist', 'exceptions', 'error-catalog.vscode.json')
          }
        ]
      })
    ],
    optimization: {
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            // compress: {
            //   drop_console: mode === 'production', // Remove console.log in production
            // },
            format: {
              comments: false,
            },
          },
          extractComments: false,
        }),
      ],
    },
    infrastructureLogging: {
      level: 'warn'
    }
  };
};
