module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#FAFAF9',
        ink: '#1A1A1A',
        muted: '#595959',
        line: '#DDDDDB',
        surface: '#F2F2F1',
        accent: {
          DEFAULT: '#273D35',
          hover: '#192D25',
        },
      },
      boxShadow: {
        panel: '0 1px 2px rgb(0 0 0 / 0.035)',
      },
      fontFamily: {
        sans: ['"Helvetica Neue"', '"PingFang SC"', '"Microsoft YaHei"', '"Noto Sans CJK SC"', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
