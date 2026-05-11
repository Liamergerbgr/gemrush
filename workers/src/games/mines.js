import { getSupabase } from '../db.js';
import { generateSeed, sha256, generateGameResults } from '../fairness.js';

// Mines: 5×5 grid, player picks tiles, avoids mines
// Payout increases with each safe reveal, 5% house edge baked into multipliers

const GRID_SIZE = 25;
const MIN_MINES = 1;
const MAX_MINES = 24;

// Calculate multiplier for revealing n safe tiles with m mines on a 25-tile grid
function calculateMultiplier(mineCount, revealsCount) {
  let multiplier = 1;
  for (let i = 0; i < revealsCount; i++) {
    const remaining = GRID_SIZE - i;
    const safe = remaining - mineCount;
    multiplier *= remaining / safe;
  }
  return Math.floor(multiplier * 0.95 * 100) / 100; // 5% house edge, round down
}

export async function start(request, env, userId) {
  const { amount, mineCount } = await request.json();

  if (!amount || amount < 1) return error('Minimum bet is 1 gem');
  if (!mineCount || mineCount < MIN_MINES || mineCount > MAX_MINES) {
    return error(`Mine count must be between ${MIN_MINES} and ${MAX_MINES}`);
  }

  const db = getSupabase(env);

  // Deduct bet
  const { error: balErr } = await db.rpc('place_bet', { p_user_id: userId, p_amount: amount });
  if (balErr) return error('Insufficient balance');

  // Generate mine positions using provably fair system
  const serverSeed = generateSeed();
  const serverSeedHash = await sha256(serverSeed);
  const clientSeed = generateSeed();
  const nonce = Date.now();

  // Generate 25 random values, pick top mineCount indices as mines
  const results = await generateGameResults(serverSeed, clientSeed, nonce, GRID_SIZE);
  const indexed = results.map((val, idx) => ({ val, idx }));
  indexed.sort((a, b) => a.val - b.val);
  const minePositions = indexed.slice(0, mineCount).map(x => x.idx).sort((a, b) => a - b);

  const gameId = crypto.randomUUID();
  await db.from('active_games').insert({
    id: gameId,
    user_id: userId,
    game_type: 'mines',
    bet_amount: amount,
    game_state: {
      mineCount,
      minePositions,
      revealed: [],
      serverSeed,
      serverSeedHash,
      clientSeed,
      nonce,
      status: 'playing'
    }
  });

  return json({
    gameId,
    serverSeedHash,
    bet: amount,
    mineCount,
    gridSize: GRID_SIZE,
    nextMultiplier: calculateMultiplier(mineCount, 1)
  });
}

export async function reveal(request, env, userId) {
  const { gameId, tileIndex } = await request.json();

  if (!gameId) return error('Game ID required');
  if (tileIndex === undefined || tileIndex < 0 || tileIndex >= GRID_SIZE) {
    return error('Invalid tile index');
  }

  const db = getSupabase(env);

  const { data: game, error: gameErr } = await db
    .from('active_games')
    .select('*')
    .eq('id', gameId)
    .eq('user_id', userId)
    .single();

  if (gameErr || !game) return error('Game not found');
  if (game.game_state.status !== 'playing') return error('Game already ended');

  const state = game.game_state;

  if (state.revealed.includes(tileIndex)) return error('Tile already revealed');

  const hitMine = state.minePositions.includes(tileIndex);

  if (hitMine) {
    // Game over — lost
    await db.from('bets').insert({
      user_id: userId,
      game_type: 'mines',
      bet_amount: game.bet_amount,
      multiplier: 0,
      payout: 0,
      server_seed_hash: state.serverSeedHash,
      server_seed: state.serverSeed,
      client_seed: state.clientSeed,
      nonce: state.nonce,
      game_state: {
        mineCount: state.mineCount,
        minePositions: state.minePositions,
        revealed: [...state.revealed, tileIndex],
        hitMine: tileIndex
      }
    });

    await db.from('active_games').delete().eq('id', gameId);

    const { data: player } = await db.from('players').select('balance').eq('id', userId).single();

    return json({
      result: 'mine',
      tileIndex,
      minePositions: state.minePositions,
      payout: 0,
      balance: player?.balance ?? 0,
      fairness: {
        serverSeedHash: state.serverSeedHash,
        serverSeed: state.serverSeed,
        clientSeed: state.clientSeed,
        nonce: state.nonce
      }
    });
  }

  // Safe tile
  const newRevealed = [...state.revealed, tileIndex];
  const currentMultiplier = calculateMultiplier(state.mineCount, newRevealed.length);
  const safeTilesLeft = GRID_SIZE - state.mineCount - newRevealed.length;

  // Update game state
  await db.from('active_games').update({
    game_state: { ...state, revealed: newRevealed }
  }).eq('id', gameId);

  // Check if all safe tiles revealed (auto-win)
  if (safeTilesLeft === 0) {
    const payout = Math.floor(game.bet_amount * currentMultiplier);
    await db.rpc('credit_winnings', { p_user_id: userId, p_amount: payout });

    await db.from('bets').insert({
      user_id: userId,
      game_type: 'mines',
      bet_amount: game.bet_amount,
      multiplier: currentMultiplier,
      payout,
      server_seed_hash: state.serverSeedHash,
      server_seed: state.serverSeed,
      client_seed: state.clientSeed,
      nonce: state.nonce,
      game_state: {
        mineCount: state.mineCount,
        minePositions: state.minePositions,
        revealed: newRevealed
      }
    });

    await db.from('active_games').delete().eq('id', gameId);

    const { data: player } = await db.from('players').select('balance').eq('id', userId).single();

    return json({
      result: 'safe',
      tileIndex,
      allClear: true,
      multiplier: currentMultiplier,
      payout,
      minePositions: state.minePositions,
      balance: player?.balance ?? 0,
      fairness: {
        serverSeedHash: state.serverSeedHash,
        serverSeed: state.serverSeed,
        clientSeed: state.clientSeed,
        nonce: state.nonce
      }
    });
  }

  const nextMultiplier = calculateMultiplier(state.mineCount, newRevealed.length + 1);

  return json({
    result: 'safe',
    tileIndex,
    revealed: newRevealed,
    currentMultiplier,
    currentPayout: Math.floor(game.bet_amount * currentMultiplier),
    nextMultiplier,
    safeTilesLeft
  });
}

export async function cashout(request, env, userId) {
  const { gameId } = await request.json();

  if (!gameId) return error('Game ID required');

  const db = getSupabase(env);

  const { data: game, error: gameErr } = await db
    .from('active_games')
    .select('*')
    .eq('id', gameId)
    .eq('user_id', userId)
    .single();

  if (gameErr || !game) return error('Game not found');
  if (game.game_state.status !== 'playing') return error('Game already ended');

  const state = game.game_state;

  if (state.revealed.length === 0) return error('Must reveal at least one tile');

  const multiplier = calculateMultiplier(state.mineCount, state.revealed.length);
  const payout = Math.floor(game.bet_amount * multiplier);

  await db.rpc('credit_winnings', { p_user_id: userId, p_amount: payout });

  await db.from('bets').insert({
    user_id: userId,
    game_type: 'mines',
    bet_amount: game.bet_amount,
    multiplier,
    payout,
    server_seed_hash: state.serverSeedHash,
    server_seed: state.serverSeed,
    client_seed: state.clientSeed,
    nonce: state.nonce,
    game_state: {
      mineCount: state.mineCount,
      minePositions: state.minePositions,
      revealed: state.revealed,
      cashedOut: true
    }
  });

  await db.from('active_games').delete().eq('id', gameId);

  const { data: player } = await db.from('players').select('balance').eq('id', userId).single();

  return json({
    won: true,
    multiplier,
    payout,
    bet: game.bet_amount,
    minePositions: state.minePositions,
    revealed: state.revealed,
    balance: player?.balance ?? 0,
    fairness: {
      serverSeedHash: state.serverSeedHash,
      serverSeed: state.serverSeed,
      clientSeed: state.clientSeed,
      nonce: state.nonce
    }
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function error(msg, status = 400) {
  return json({ error: msg }, status);
}
