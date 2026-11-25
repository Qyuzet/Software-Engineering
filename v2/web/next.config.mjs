import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // This folder is the whole Vercel project; don't let a lockfile higher up confuse Next
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),

  // The laptop installer is fetched by PowerShell (irm ... | iex): serve it as text, always fresh
  async headers() {
    return [{
      source: "/install.ps1",
      headers: [
        { key: "Content-Type", value: "text/plain; charset=utf-8" },
        { key: "Cache-Control", value: "no-cache" },
      ],
    }];
  },
};

export default nextConfig;
