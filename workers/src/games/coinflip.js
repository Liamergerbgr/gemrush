import { getSupabase } from '../db.js';
import { generateSeed, sha256, generateGameResult } from '../fairness.js';

// Coin Flip: 50/50, pays 1.90x (5% house edge)
const PAYOUT = 1.90;

export async function play(request, env, userId) {
  const { amount, choice } = await request.json();

  if (!amount || amount < 1) return error('Minimum bet is 1 gem');
  if (!['heads', 'tails'].includes(choice)) return error('Choose heads or tails');

  const db = getSupabase(env);

  // Deduct bet atomically
  const { data: balData, error: balErr } = await db.rpc('place_bet', { p_user_id: userId, p_amount: amount });
  if (balErr) return error('Insufficient balance');

  // Generate provably fair result
  const serverSeed = generateSeed();
  const serverSeedHash = await sha256(serverSeed);
  const clientSeed = generateSeed(); // Auto-generated for now
  const nonce = Date.now();

  const float = await generateGameResult(serverSeed, clientSeed, nonce);
  const result = float < 0.5 ? 'heads' : 'tails';
  const won = result === choice;
  const payout = won ? Math.floor(amount * PAYOUT) : 0;
  const multiplier = won ? PAYOUT : 0;

  // Credit winnings if won
  if (payout > 0) {
    await db.rpc('credit_winnings', { p_user_id: userId, p_amount: payout });
  }

  // Record bet
  await db.from('bets').insert({
    user_id: userId,
    game_type: 'coinflip',
    bet_amount: amount,
    multiplier,
    payout,
    server_seed_hash: serverSeedHash,
    server_seed: serverSeed,
    client_seed: clientSeed,
    nonce,
    game_state: { choice, result, float }
  });

  // Get updated balance
  const { data: player } = await db.from('players').select('balance').eq('id', userId).single();

  return json({
    result,
    choice,
    won,
    bet: amount,
    payout,
    multiplier,
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
