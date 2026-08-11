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
      return webpackConfig;
    },
  },
};