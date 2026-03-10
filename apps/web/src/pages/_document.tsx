import { Html, Head, Main, NextScript } from "next/document";

// Minimal Document for Pages Router (404/500 pages only)
export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
