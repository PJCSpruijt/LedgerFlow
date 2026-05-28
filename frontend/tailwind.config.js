/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d9eaff",
          200: "#bbd7ff",
          300: "#8fbcff",
          400: "#5e97ff",
          500: "#3a73ff",
          600: "#2554f0",
          700: "#1d40c8",
          800: "#1a37a0",
          900: "#1b3380",
        },
      },
    },
  },
  plugins: [],
};
