import { getSupabase } from '../db.js';
import { generateSeed, sha256, generateCrashPoint } from '../fairness.js';

// Crash: multiplier rises until it crashes
// 5% instant bust at 1.00x, exponential distribution × 0.95

export async function bet(request, env, userId) {
  const { amount, autoCashout } = await request.json();

  if (!amount || amount < 1) return error('Minimum bet is 1 gem');
  if (autoCashout !== undefined && autoCashout < 1.01) return error('Auto cashout must be at least 1.01x');

  const db = getSupabase(env);

  // Deduct bet
  const { error: balErr } = await db.rpc('place_bet', { p_user_id: userId, p_amount: amount });
  if (balErr) return error('Insufficient balance');

  // Generate crash point
  const serverSeed = generateSeed();
  const serverSeedHash = await sha256(serverSeed);
  const clientSeed = generateSeed();
  const nonce = Date.now();
  const crashPoint = await generateCrashPoint(serverSeed, clientSeed, nonce);

  // If auto cashout, resolve immediately
  let won = false;
  let payout = 0;
  let multiplier = 0;
  let status = 'pending';

  if (autoCashout) {
    if (autoCashout <= crashPoint) {
      won = true;
      multiplier = autoCashout;
      payout = Math.floor(amount * autoCashout);
      status = 'cashed_out';
      await db.rpc('credit_winnings', { p_user_id: userId, p_amount: payout });
    } else {
      multiplier = 0;
      payout = 0;
      status = 'busted';
    }

    // Record bet
    await db.from('bets').insert({
      user_id: userId,
      game_type: 'crash',
      bet_amount: amount,
      multiplier,
      payout,
      server_seed_hash: serverSeedHash,
      server_seed: serverSeed,
      client_seed: clientSeed,
      nonce,
      game_state: { crashPoint, autoCashout, status }
    });

    const { data: player } = await db.from('players').select('balance').eq('id', userId).single();

    return json({
      won,
      crashPoint,
      autoCashout,
      bet: amount,
      payout,
      multiplier,
      balance: player?.balance ?? 0,
      status,
      fairness: { serverSeedHash, serverSeed, clientSeed, nonce }
    });
  }

  // Manual mode — store active game
  const gameId = crypto.randomUUID();
  await db.from('active_games').insert({
    id: gameId,
    user_id: userId,
    game_type: 'crash',
    bet_amount: amount,
    game_state: {
      crashPoint,
      serverSeed,
      serverSeedHash,
      clientSeed,
      nonce,
      status: 'rising'
    }
  });

  return json({
    gameId,
    serverSeedHash,
    bet: amount,
    status: 'rising'
  });
}

export async function cashout(request, env, userId) {
  const { gameId, cashoutAt } = await request.json();

  if (!gameId) return error('Game ID required');
  if (!cashoutAt || cashoutAt < 1.01) return error('Cashout multiplier must be at least 1.01x');

  const db = getSupabase(env);

  // Get active game
  const { data: game, error: gameErr } = await db
    .from('active_games')
    .select('*')
    .eq('id', gameId)
    .eq('user_id', userId)
    .single();

  if (gameErr || !game) return error('Game not found');
  if (game.game_state.status !== 'rising') return error('Game already ended');

  const crashPoint = game.game_state.crashPoint;
  const won = cashoutAt <= crashPoint;
  const multiplier = won ? cashoutAt : 0;
  const payout = won ? Math.floor(game.bet_amount * cashoutAt) : 0;

  if (payout > 0) {
    await db.rpc('credit_winnings', { p_user_id: userId, p_amount: payout });
  }

  // Record bet
  await db.from('bets').insert({
    user_id: userId,
    game_type: 'crash',
    bet_amount: game.bet_amount,
    multiplier,
    payout,
    server_seed_hash: game.game_state.serverSeedHash,
    server_seed: game.game_state.serverSeed,
    client_seed: game.game_state.clientSeed,
    nonce: game.game_state.nonce,
    game_state: { crashPoint, cashoutAt, status: won ? 'cashed_out' : 'busted' }
  });

  // Remove active game
  await db.from('active_games').delete().eq('id', gameId);

  const { data: player } = await db.from('players').select('balance').eq('id', userId).single();

  return json({
    won,
    crashPoint,
    cashoutAt,
    bet: game.bet_amount,
    payout,
    multiplier,
    balance: player?.balance ?? 0,
    fairness: {
      serverSeedHash: game.game_state.serverSeedHash,
      serverSeed: game.game_state.serverSeed,
      clientSeed: game.game_state.clientSeed,
      nonce: game.game_state.nonce
    }
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function error(msg, status = 400) {
  return json({ error: msg }, status);
}
