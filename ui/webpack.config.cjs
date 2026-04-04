const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");

module.exports = {
  entry: "./src/planTab.ts",
  output: {
    filename: "planTab.bundle.js",
    path: path.resolve(__dirname, "dist"),
    clean: true,
  },
  resolve: {
    extensions: [".ts", ".js"],
    alias: {
      "azure-devops-extension-sdk": path.resolve(__dirname, "src/sdk-shim.js"),
    },
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
    new CopyPlugin({ patterns: [{ from: "src/planTab.html", to: "planTab.html" }] }),
  ],
  externals: {},
};
