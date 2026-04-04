const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");

module.exports = {
  entry: { "planTab.bundle": "./src/planTab.ts" },
  output: {
    filename: "[name].js",
    path: path.resolve(__dirname, "dist"),
    libraryTarget: "amd",
    clean: true,
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: { loader: "ts-loader", options: { transpileOnly: true } },
        exclude: /node_modules/,
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  plugins: [
    new CopyPlugin({
      patterns: [{ from: "src/planTab.html", to: "planTab.html" }],
    }),
  ],
  externals: [
    /^azure-devops-extension-sdk(\/.*)?$/,
    /^azure-devops-extension-api(\/.*)?$/,
  ],
};
