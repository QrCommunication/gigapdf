import type { AppProps } from "next/app";
import "../styles/globals.css";

// Minimal App for Pages Router (404/500 pages only)
export default function MyApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
