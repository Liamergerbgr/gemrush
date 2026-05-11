import { getSupabase } from '../db.js';
import { generateSeed, sha256, generateGameResults } from '../fairness.js';

// Towers: climb floors by picking the safe column(s)
// Easy: 3 columns, 2 safe (1.425x per floor)
// Medium: 3 columns, 1 safe (2.85x per floor) — actually 3 cols 2 safe is ~1.425x, 1 safe is ~2.85x
// Hard: 4 columns, 1 safe (3.80x per floor)

const DIFFICULTIES = {
  easy:   { columns: 3, safe: 2, floors: 10 },
  medium: { columns: 3, safe: 1, floors: 8 },
  hard:   { columns: 4, safe: 1, floors: 7 }
};

function floorMultiplier(columns, safe) {
  return 0.95 * (columns / safe);
}

function cumulativeMultiplier(columns, safe, floorsClimbed) {
  return Math.floor(Math.pow(floorMultiplier(columns, safe), floorsClimbed) * 100) / 100;
}

export async function start(request, env, userId) {
  const { amount, difficulty } = await request.json();

  if (!amount || amount < 1) return error('Minimum bet is 1 gem');
  if (!DIFFICULTIES[difficulty]) return error('Difficulty must be easy, medium, or hard');

  const config = DIFFICULTIES[difficulty];
  const db = getSupabase(env);

  const { error: balErr } = await db.rpc('place_bet', { p_user_id: userId, p_amount: amount });
  if (balErr) return error('Insufficient balance');

  // Generate tower layout
  const serverSeed = generateSeed();
  const serverSeedHash = await sha256(serverSeed);
  const clientSeed = generateSeed();
  const nonce = Date.now();

  // Generate random values for each floor to determine safe columns
  const results = await generateGameResults(serverSeed, clientSeed, nonce, config.floors);

  // For each floor, determine which columns are dangerous
  const tower = results.map(float => {
    const dangerousCount = config.columns - config.safe;
    // Pick which column(s) are dangerous
    const dangerousCol = Math.floor(float * config.columns);
    if (dangerousCount === 1) {
      return { dangerous: [dangerousCol] };
    }
    // For multiple dangerous: use modular arithmetic
    const dangerous = [];
    let baseCol = Math.floor(float * config.columns);
    for (let i = 0; i < dangerousCount; i++) {
      dangerous.push((baseCol + i) % config.columns);
    }
    return { dangerous };
  });

  const gameId = crypto.randomUUID();
  await db.from('active_games').insert({
    id: gameId,
    user_id: userId,
    game_type: 'towers',
    bet_amount: amount,
    game_state: {
      difficulty,
      config,
      tower,
      currentFloor: 0,
      picks: [],
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
    difficulty,
    columns: config.columns,
    floors: config.floors,
    nextMultiplier: cumulativeMultiplier(config.columns, config.safe, 1)
  });
}

export async function pick(request, env, userId) {
  const { gameId, column } = await request.json();

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

  if (column < 0 || column >= state.config.columns) return error('Invalid column');

  const floor = state.tower[state.currentFloor];
  const hitDanger = floor.dangerous.includes(column);

  if (hitDanger) {
    // Game over
    await db.from('bets').insert({
      user_id: userId,
      game_type: 'towers',
      bet_amount: game.bet_amount,
      multiplier: 0,
      payout: 0,
      server_seed_hash: state.serverSeedHash,
      server_seed: state.serverSeed,
      client_seed: state.clientSeed,
      nonce: state.nonce,
      game_state: {
        difficulty: state.difficulty,
        tower: state.tower,
        picks: [...state.picks, { floor: state.currentFloor, column }],
        hitFloor: state.currentFloor
      }
    });

    await db.from('active_games').delete().eq('id', gameId);

    const { data: player } = await db.from('players').select('balance').eq('id', userId).single();

    return json({
      result: 'dead',
      floor: state.currentFloor,
      column,
      tower: state.tower,
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

  // Safe — advance floor
  const newFloor = state.currentFloor + 1;
  const newPicks = [...state.picks, { floor: state.currentFloor, column }];
  const currentMultiplier = cumulativeMultiplier(state.config.columns, state.config.safe, newFloor);

  // Check if reached the top
  if (newFloor >= state.config.floors) {
    const payout = Math.floor(game.bet_amount * currentMultiplier);
    await db.rpc('credit_winnings', { p_user_id: userId, p_amount: payout });

    await db.from('bets').insert({
      user_id: userId,
      game_type: 'towers',
      bet_amount: game.bet_amount,
      multiplier: currentMultiplier,
      payout,
      server_seed_hash: state.serverSeedHash,
      server_seed: state.serverSeed,
      client_seed: state.clientSeed,
      nonce: state.nonce,
      game_state: {
        difficulty: state.difficulty,
        tower: state.tower,
        picks: newPicks,
        reachedTop: true
      }
    });

    await db.from('active_games').delete().eq('id', gameId);

    const { data: player } = await db.from('players').select('balance').eq('id', userId).single();

    return json({
      result: 'safe',
      floor: state.currentFloor,
      column,
      reachedTop: true,
      multiplier: currentMultiplier,
      payout,
      tower: state.tower,
      balance: player?.balance ?? 0,
      fairness: {
        serverSeedHash: state.serverSeedHash,
        serverSeed: state.serverSeed,
        clientSeed: state.clientSeed,
        nonce: state.nonce
      }
    });
  }

  // Update game state
  await db.from('active_games').update({
    game_state: { ...state, currentFloor: newFloor, picks: newPicks }
  }).eq('id', gameId);

  const nextMultiplier = cumulativeMultiplier(state.config.columns, state.config.safe, newFloor + 1);

  return json({
    result: 'safe',
    floor: state.currentFloor,
    column,
    currentFloor: newFloor,
    currentMultiplier,
    currentPayout: Math.floor(game.bet_amount * currentMultiplier),
    nextMultiplier,
    floorsLeft: state.config.floors - newFloor
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

  if (state.currentFloor === 0) return error('Must complete at least one floor');

  const multiplier = cumulativeMultiplier(state.config.columns, state.config.safe, state.currentFloor);
  const payout = Math.floor(game.bet_amount * multiplier);

  await db.rpc('credit_winnings', { p_user_id: userId, p_amount: payout });

  await db.from('bets').insert({
    user_id: userId,
    game_type: 'towers',
    bet_amount: game.bet_amount,
    multiplier,
    payout,
    server_seed_hash: state.serverSeedHash,
    server_seed: state.serverSeed,
    client_seed: state.clientSeed,
    nonce: state.nonce,
    game_state: {
      difficulty: state.difficulty,
      tower: state.tower,
      picks: state.picks,
      cashedOut: true,
      cashedOutFloor: state.currentFloor
    }
  });

  await db.from('active_games').delete().eq('id', gameId);

  const { data: player } = await db.from('players').select('balance').eq('id', userId).single();

  return json({
    won: true,
    multiplier,
    payout,
    bet: game.bet_amount,
    tower: state.tower,
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
