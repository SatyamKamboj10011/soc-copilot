module.exports = {
  style: {
    postcss: {
      plugins: [require("tailwindcss"), require("autoprefixer")],
    },
  },
  webpack: {
    configure: (webpackConfig) => {
      const rule = webpackConfig.module.rules.find(r => r.oneOf);
      rule.oneOf.unshift({
        test: /\.m?js$/,
        include: /node_modules\/@react-aria\/ssr/,
        use: [],
      });
      // Public demo: swap Firestore for a localStorage-backed stand-in.
      if (process.env.REACT_APP_DEMO === "true") {
        webpackConfig.resolve.alias = {
          ...(webpackConfig.resolve.alias || {}),
          "firebase/firestore$": require("path").resolve(__dirname, "src/demo/firestoreLocal.js"),
        };
      }
      return webpackConfig;
    },
  },
};