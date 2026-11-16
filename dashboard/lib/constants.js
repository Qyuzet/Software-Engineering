export const DEFAULT_LIMIT = 10;          // matches CROWD_LIMIT in config.py
export const REFRESH_MS = 10_000;         // the Python script logs every 10 s
export const EDGE_URL = process.env.NEXT_PUBLIC_EDGE_URL || "http://127.0.0.1:8080";
export const NEAR_LIMIT_RATIO = 0.8;      // "near limit" = at least 80% of the limit
