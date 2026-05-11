// Provably fair system — SHA-256 based

// Generate a random hex seed
export function generateSeed() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

// SHA-256 hash
export async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, '0')).join('');
}

// HMAC-SHA256
export async function hmacSha256(key, message) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
}

// Generate a game result from seeds — returns a float 0..1
export async function generateGameResult(serverSeed, clientSeed, nonce) {
  const hash = await hmacSha256(serverSeed, `${clientSeed}:${nonce}`);
  // Use first 8 hex chars (32 bits) to get a float
  const int = parseInt(hash.slice(0, 8), 16);
  return int / 0x100000000; // 0 to 0.99999...
}

// Generate multiple results (for games needing multiple random values)
export async function generateGameResults(serverSeed, clientSeed, nonce, count) {
  const results = [];
  for (let i = 0; i < count; i++) {
    const hash = await hmacSha256(serverSeed, `${clientSeed}:${nonce}:${i}`);
    const int = parseInt(hash.slice(0, 8), 16);
    results.push(int / 0x100000000);
  }
  return results;
}

// Crash game: convert float to crash point with 5% house edge
export function floatToCrashPoint(float) {
  // 5% chance of instant bust
  if (float < 0.05) return 1.0;
  // Otherwise, exponential distribution scaled by 0.95 (house edge)
  return Math.max(1, Math.floor(100 * 0.95 / (1 - float)) / 100);
}

// Generate crash point from seeds
export async function generateCrashPoint(serverSeed, clientSeed, nonce) {
  const float = await generateGameResult(serverSeed, clientSeed, nonce);
  return floatToCrashPoint(float);
}
