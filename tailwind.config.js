/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/renderer/**/*.{js,ts,jsx,tsx,html}",
    "./src/renderer/index.html"
  ],
  theme: {
    extend: {
      keyframes: {
        fadeSlideUp: {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeOut: {
          "0%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
      },
      animation: {
        "fade-slide-up": "fadeSlideUp 0.6s ease-out forwards",
        "fade-out": "fadeOut 0.35s ease-in forwards",
      },
    },
  },
  plugins: [],
};