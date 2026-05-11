import { getSupabase } from '../db.js';
import { generateSeed, sha256, generateGameResult } from '../fairness.js';

// Roulette: simplified — Red, Black, or Green
// 38 slots (American-style): 18 red, 18 black, 2 green
// Red/Black: pays 1.90x (win rate 18/38 = 47.37%, edge ~5.26%)
// Green: pays 14x (win rate 2/38 = 5.26%, EV = 0.7368 → blended ~5% edge)

const SLOTS = 38;
const RED_COUNT = 18;
const BLACK_COUNT = 18;
const GREEN_COUNT = 2;

// Payout multipliers
const PAYOUTS = {
  red: 1.90,
  black: 1.90,
  green: 14
};

export async function bet(request, env, userId) {
  const { amount, choice } = await request.json();

  if (!amount || amount < 1) return error('Minimum bet is 1 gem');
  if (!['red', 'black', 'green'].includes(choice)) return error('Choose red, black, or green');

  const db = getSupabase(env);

  const { error: balErr } = await db.rpc('place_bet', { p_user_id: userId, p_amount: amount });
  if (balErr) return error('Insufficient balance');

  // Generate result
  const serverSeed = generateSeed();
  const serverSeedHash = await sha256(serverSeed);
  const clientSeed = generateSeed();
  const nonce = Date.now();

  const float = await generateGameResult(serverSeed, clientSeed, nonce);
  const slotNumber = Math.floor(float * SLOTS); // 0-37

  let result;
  if (slotNumber < RED_COUNT) {
    result = 'red';
  } else if (slotNumber < RED_COUNT + BLACK_COUNT) {
    result = 'black';
  } else {
    result = 'green';
  }

  const won = result === choice;
  const multiplier = won ? PAYOUTS[choice] : 0;
  const payout = won ? Math.floor(amount * multiplier) : 0;

  if (payout > 0) {
    await db.rpc('credit_winnings', { p_user_id: userId, p_amount: payout });
  }

  await db.from('bets').insert({
    user_id: userId,
    game_type: 'roulette',
    bet_amount: amount,
    multiplier,
    payout,
    server_seed_hash: serverSeedHash,
    server_seed: serverSeed,
    client_seed: clientSeed,
    nonce,
    game_state: { choice, result, slotNumber, float }
  });

  const { data: player } = await db.from('players').select('balance').eq('id', userId).single();

  return json({
    result,
    slotNumber,
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
