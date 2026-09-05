// Built-by: @projectx.sui · Co-authored-by: Claude
/*
  Tailwind v4, for the Weir layer.

  Next picks this file up by name; nothing imports it. Its single job is to run
  `@tailwindcss/postcss` over the stylesheets, which is what makes `@theme` and the utility classes
  in `app/weir.css` real.

  # What this deliberately does not do
*/
const config = {
  plugins: { '@tailwindcss/postcss': {} },
};

export default config;
