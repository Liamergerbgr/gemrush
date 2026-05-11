import { verifyAuth, verifyAdmin, getSupabase } from './db.js';
import { play as coinflipPlay } from './games/coinflip.js';
import { bet as crashBet, cashout as crashCashout } from './games/crash.js';
import { start as minesStart, reveal as minesReveal, cashout as minesCashout } from './games/mines.js';
import { start as towersStart, pick as towersPick, cashout as towersCashout } from './games/towers.js';
import { drop as plinkoDrop } from './games/plinko.js';
import { bet as rouletteBet } from './games/roulette.js';
import { start as blackjackStart, action as blackjackAction } from './games/blackjack.js';
import {
  listPlayers, getPlayer, creditPlayer, debitPlayer,
  listWithdrawals, actionWithdrawal, toggleBan, getStats
} from './admin.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Key',
  'Access-Control-Max-Age': '86400'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

function addCors(response) {
  const newResponse = new Response(response.body, response);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    newResponse.headers.set(key, value);
  }
  return newResponse;
}

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // --- Auth routes (no auth required) ---
      if (path === '/api/auth/register' && method === 'POST') {
        return addCors(await handleRegister(request, env));
      }
      if (path === '/api/auth/login' && method === 'POST') {
        return addCors(await handleLogin(request, env));
      }

      // --- Admin routes (admin key required) ---
      if (path.startsWith('/api/admin/')) {
        if (!verifyAdmin(request, env)) {
          return json({ error: 'Unauthorized' }, 401);
        }
        return addCors(await routeAdmin(request, env, path, method));
      }

      // --- Authenticated routes ---
      const user = await verifyAuth(request, env);
      if (!user) {
        return json({ error: 'Unauthorized' }, 401);
      }

      // Check if banned
      const db = getSupabase(env);
      const { data: player } = await db.from('players').select('is_banned').eq('id', user.id).single();
      if (player?.is_banned) {
        return json({ error: 'Account suspended' }, 403);
      }

      // Profile
      if (path === '/api/me' && method === 'GET') {
        return addCors(await handleMe(env, user.id));
      }

      // Game routes
      if (path.startsWith('/api/games/')) {
        return addCors(await routeGames(request, env, user.id, path, method));
      }

      // Bet history
      if (path === '/api/bets/history' && method === 'GET') {
        return addCors(await handleBetHistory(request, env, user.id));
      }

      // Withdrawals
      if (path === '/api/withdraw/request' && method === 'POST') {
        return addCors(await handleWithdrawRequest(request, env, user.id));
      }
      if (path === '/api/withdraw/history' && method === 'GET') {
        return addCors(await handleWithdrawHistory(env, user.id));
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error('Unhandled error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  }
};

// --- Auth handlers ---

async function handleRegister(request, env) {
  const { email, password, username, roblox_username } = await request.json();

  if (!email || !password || !username) {
    return json({ error: 'Email, password, and username required' }, 400);
  }
  if (password.length < 6) {
    return json({ error: 'Password must be at least 6 characters' }, 400);
  }

  const db = getSupabase(env);

  // Check username uniqueness
  const { data: existing } = await db.from('players').select('id').eq('username', username).single();
  if (existing) return json({ error: 'Username taken' }, 400);

  // Create auth user via Supabase
  const { createClient } = await import('@supabase/supabase-js');
  const authClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: authData, error: authErr } = await authClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (authErr) return json({ error: authErr.message }, 400);

  // Create player row
  await db.from('players').insert({
    id: authData.user.id,
    username,
    roblox_username: roblox_username || null
  });

  // Log them in
  const { data: session, error: loginErr } = await authClient.auth.signInWithPassword({ email, password });
  if (loginErr) return json({ error: 'Account created but login failed' }, 500);

  return json({
    user: {
      id: authData.user.id,
      email,
      username,
      roblox_username: roblox_username || null,
      balance: 0
    },
    token: session.session.access_token
  });
}

async function handleLogin(request, env) {
  const { email, password } = await request.json();

  if (!email || !password) return json({ error: 'Email and password required' }, 400);

  const { createClient } = await import('@supabase/supabase-js');
  const authClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: session, error: loginErr } = await authClient.auth.signInWithPassword({ email, password });
  if (loginErr) return json({ error: 'Invalid credentials' }, 401);

  const db = getSupabase(env);
  const { data: player } = await db.from('players').select('*').eq('id', session.user.id).single();

  if (player?.is_banned) return json({ error: 'Account suspended' }, 403);

  return json({
    user: {
      id: session.user.id,
      email,
      username: player?.username,
      roblox_username: player?.roblox_username,
      balance: player?.balance ?? 0
    },
    token: session.session.access_token
  });
}

async function handleMe(env, userId) {
  const db = getSupabase(env);
  const { data: player } = await db.from('players').select('*').eq('id', userId).single();
  if (!player) return json({ error: 'Player not found' }, 404);

  return json({
    id: player.id,
    username: player.username,
    roblox_username: player.roblox_username,
    balance: player.balance,
    total_wagered: player.total_wagered,
    total_won: player.total_won,
    created_at: player.created_at
  });
}

// --- Game routing ---

async function routeGames(request, env, userId, path, method) {
  if (method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  switch (path) {
    case '/api/games/coinflip/play': return coinflipPlay(request, env, userId);
    case '/api/games/crash/bet': return crashBet(request, env, userId);
    case '/api/games/crash/cashout': return crashCashout(request, env, userId);
    case '/api/games/mines/start': return minesStart(request, env, userId);
    case '/api/games/mines/reveal': return minesReveal(request, env, userId);
    case '/api/games/mines/cashout': return minesCashout(request, env, userId);
    case '/api/games/towers/start': return towersStart(request, env, userId);
    case '/api/games/towers/pick': return towersPick(request, env, userId);
    case '/api/games/towers/cashout': return towersCashout(request, env, userId);
    case '/api/games/plinko/drop': return plinkoDrop(request, env, userId);
    case '/api/games/roulette/bet': return rouletteBet(request, env, userId);
    case '/api/games/blackjack/start': return blackjackStart(request, env, userId);
    case '/api/games/blackjack/action': return blackjackAction(request, env, userId);
    default: return json({ error: 'Game endpoint not found' }, 404);
  }
}

// --- Admin routing ---

async function routeAdmin(request, env, path, method) {
  if (path === '/api/admin/players' && method === 'GET') {
    return listPlayers(request, env);
  }

  const playerMatch = path.match(/^\/api\/admin\/player\/(.+)$/);
  if (playerMatch && method === 'GET') {
    return getPlayer(env, playerMatch[1]);
  }

  if (path === '/api/admin/credit' && method === 'POST') {
    return creditPlayer(request, env);
  }
  if (path === '/api/admin/debit' && method === 'POST') {
    return debitPlayer(request, env);
  }
  if (path === '/api/admin/withdrawals' && method === 'GET') {
    return listWithdrawals(request, env);
  }

  const withdrawalMatch = path.match(/^\/api\/admin\/withdrawal\/(.+)$/);
  if (withdrawalMatch && method === 'POST') {
    return actionWithdrawal(request, env, withdrawalMatch[1]);
  }

  if (path === '/api/admin/ban' && method === 'POST') {
    return toggleBan(request, env);
  }
  if (path === '/api/admin/stats' && method === 'GET') {
    return getStats(env);
  }

  return json({ error: 'Admin endpoint not found' }, 404);
}

// --- Bet history ---

async function handleBetHistory(request, env, userId) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const gameType = url.searchParams.get('game');
  const offset = (page - 1) * limit;

  const db = getSupabase(env);

  let query = db.from('bets')
    .select('id, game_type, bet_amount, multiplier, payout, created_at, game_state', { count: 'exact' })
    .eq('user_id', userId);

  if (gameType) query = query.eq('game_type', gameType);

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return json({ error: 'Failed to fetch history' }, 500);

  return json({ bets: data || [], total: count, page, pages: Math.ceil(count / limit) });
}

// --- Withdrawals ---

async function handleWithdrawRequest(request, env, userId) {
  const { amount, roblox_username } = await request.json();

  if (!amount || amount < 10) return json({ error: 'Minimum withdrawal is 10 gems' }, 400);
  if (!roblox_username) return json({ error: 'Roblox username required' }, 400);

  const db = getSupabase(env);

  // Deduct balance
  const { data: player } = await db.from('players').select('balance').eq('id', userId).single();
  if (!player || player.balance < amount) return json({ error: 'Insufficient balance' }, 400);

  const { error: upErr } = await db.rpc('update_balance', { p_user_id: userId, p_amount: -amount });
  if (upErr) return json({ error: 'Failed to process withdrawal' }, 500);

  // Create withdrawal request
  await db.from('withdrawals').insert({
    user_id: userId,
    amount,
    roblox_username
  });

  // Record transaction
  await db.from('transactions').insert({
    user_id: userId,
    type: 'withdrawal_request',
    amount: -amount,
    note: `Withdrawal request to ${roblox_username}`
  });

  const { data: updated } = await db.from('players').select('balance').eq('id', userId).single();

  return json({ success: true, balance: updated?.balance ?? 0 });
}

async function handleWithdrawHistory(env, userId) {
  const db = getSupabase(env);

  const { data, error } = await db.from('withdrawals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return json({ error: 'Failed to fetch withdrawals' }, 500);

  return json({ withdrawals: data || [] });
}
