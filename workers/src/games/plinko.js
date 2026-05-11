import { getSupabase } from '../db.js';
import { generateSeed, sha256, generateGameResults } from '../fairness.js';

// Plinko: ball drops through pegs, lands in bucket
// 5% house edge baked into multipliers

const RISK_LEVELS = {
  low: {
    rows: 8,
    // 9 buckets, symmetric — center is common, edges are rare
    multipliers: [5.6, 2.1, 1.1, 1.0, 0.5, 1.0, 1.1, 2.1, 5.6]
  },
  medium: {
    rows: 12,
    // 13 buckets
    multipliers: [25, 8, 3, 1.5, 1.1, 0.5, 0.3, 0.5, 1.1, 1.5, 3, 8, 25]
  },
  high: {
    rows: 16,
    // 17 buckets
    multipliers: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110]
  }
};

export async function drop(request, env, userId) {
  const { amount, risk } = await request.json();

  if (!amount || amount < 1) return error('Minimum bet is 1 gem');
  if (!RISK_LEVELS[risk]) return error('Risk must be low, medium, or high');

  const config = RISK_LEVELS[risk];
  const db = getSupabase(env);

  const { error: balErr } = await db.rpc('place_bet', { p_user_id: userId, p_amount: amount });
  if (balErr) return error('Insufficient balance');

  // Generate ball path
  const serverSeed = generateSeed();
  const serverSeedHash = await sha256(serverSeed);
  const clientSeed = generateSeed();
  const nonce = Date.now();

  // Each row, ball goes left (0) or right (1)
  const results = await generateGameResults(serverSeed, clientSeed, nonce, config.rows);
  const path = results.map(r => (r < 0.5 ? 0 : 1)); // 0 = left, 1 = right

  // Count rights to determine bucket (bucket = number of right bounces)
  const bucket = path.reduce((sum, dir) => sum + dir, 0);
  const multiplier = config.multipliers[bucket];
  const payout = Math.floor(amount * multiplier);

  if (payout > 0) {
    await db.rpc('credit_winnings', { p_user_id: userId, p_amount: payout });
  }

  await db.from('bets').insert({
    user_id: userId,
    game_type: 'plinko',
    bet_amount: amount,
    multiplier,
    payout,
    server_seed_hash: serverSeedHash,
    server_seed: serverSeed,
    client_seed: clientSeed,
    nonce,
    game_state: { risk, rows: config.rows, path, bucket }
  });

  const { data: player } = await db.from('players').select('balance').eq('id', userId).single();

  return json({
    path,
    bucket,
    multiplier,
    bet: amount,
    payout,
    won: payout > amount,
    balance: player?.balance ?? 0,
    fairness: { serverSeedHash, serverSeed, clientSeed, nonce }
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function error(msg, status = 400) {
  return json({ error: msg }, status);
}
