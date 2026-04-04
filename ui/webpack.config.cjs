const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

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
      // Use the host's pre-loaded SDK instance if available, else fall back to bundled
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
    new HtmlWebpackPlugin({
      template: "./src/planTab.html",
      filename: "planTab.html",
      inject: "body",
      scriptLoading: "blocking",
    }),
  ],
  externals: {},
};
