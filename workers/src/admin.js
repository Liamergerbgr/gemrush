import { getSupabase } from './db.js';

// List all players (paginated)
export async function listPlayers(request, env) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const search = url.searchParams.get('search') || '';
  const offset = (page - 1) * limit;

  const db = getSupabase(env);

  let query = db.from('players')
    .select('id, username, roblox_username, balance, total_wagered, total_won, is_banned, created_at', { count: 'exact' });

  if (search) {
    query = query.or(`username.ilike.%${search}%,roblox_username.ilike.%${search}%`);
  }

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return json({ error: 'Failed to fetch players' }, 500);

  return json({
    players: data,
    total: count,
    page,
    pages: Math.ceil(count / limit)
  });
}

// Get player details
export async function getPlayer(env, playerId) {
  const db = getSupabase(env);

  const { data: player, error: pErr } = await db
    .from('players')
    .select('*')
    .eq('id', playerId)
    .single();

  if (pErr || !player) return json({ error: 'Player not found' }, 404);

  // Get recent bets
  const { data: bets } = await db
    .from('bets')
    .select('*')
    .eq('user_id', playerId)
    .order('created_at', { ascending: false })
    .limit(20);

  // Get recent transactions
  const { data: transactions } = await db
    .from('transactions')
    .select('*')
    .eq('user_id', playerId)
    .order('created_at', { ascending: false })
    .limit(20);

  return json({ player, bets: bets || [], transactions: transactions || [] });
}

// Credit gems to player
export async function creditPlayer(request, env) {
  const { userId, amount, note } = await request.json();

  if (!userId || !amount || amount < 1) return json({ error: 'userId and positive amount required' }, 400);

  const db = getSupabase(env);

  // Update balance
  const { error: upErr } = await db.rpc('update_balance', { p_user_id: userId, p_amount: amount });
  if (upErr) return json({ error: 'Failed to credit: ' + upErr.message }, 500);

  // Record transaction
  await db.from('transactions').insert({
    user_id: userId,
    type: 'credit',
    amount,
    note: note || 'Admin credit',
    admin_id: 'admin'
  });

  const { data: player } = await db.from('players').select('balance').eq('id', userId).single();

  return json({ success: true, newBalance: player?.balance ?? 0 });
}

// Debit gems from player
export async function debitPlayer(request, env) {
  const { userId, amount, note } = await request.json();

  if (!userId || !amount || amount < 1) return json({ error: 'userId and positive amount required' }, 400);

  const db = getSupabase(env);

  // Check balance
  const { data: player } = await db.from('players').select('balance').eq('id', userId).single();
  if (!player || player.balance < amount) return json({ error: 'Insufficient balance' }, 400);

  const { error: upErr } = await db.rpc('update_balance', { p_user_id: userId, p_amount: -amount });
  if (upErr) return json({ error: 'Failed to debit: ' + upErr.message }, 500);

  await db.from('transactions').insert({
    user_id: userId,
    type: 'debit',
    amount: -amount,
    note: note || 'Admin debit',
    admin_id: 'admin'
  });

  const { data: updated } = await db.from('players').select('balance').eq('id', userId).single();

  return json({ success: true, newBalance: updated?.balance ?? 0 });
}

// List withdrawals
export async function listWithdrawals(request, env) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';

  const db = getSupabase(env);

  let query = db.from('withdrawals')
    .select('*, players(username, roblox_username)')
    .order('created_at', { ascending: false });

  if (status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, error } = await query.limit(100);

  if (error) return json({ error: 'Failed to fetch withdrawals' }, 500);

  return json({ withdrawals: data || [] });
}

// Action a withdrawal
export async function actionWithdrawal(request, env, withdrawalId) {
  const { action, note } = await request.json();

  if (!['approve', 'reject'].includes(action)) return json({ error: 'Action must be approve or reject' }, 400);

  const db = getSupabase(env);

  const { data: withdrawal, error: wErr } = await db
    .from('withdrawals')
    .select('*')
    .eq('id', withdrawalId)
    .single();

  if (wErr || !withdrawal) return json({ error: 'Withdrawal not found' }, 404);
  if (withdrawal.status !== 'pending') return json({ error: 'Withdrawal already actioned' }, 400);

  if (action === 'reject') {
    // Refund the player
    await db.rpc('update_balance', { p_user_id: withdrawal.user_id, p_amount: withdrawal.amount });

    await db.from('transactions').insert({
      user_id: withdrawal.user_id,
      type: 'credit',
      amount: withdrawal.amount,
      note: 'Withdrawal rejected — refunded',
      admin_id: 'admin'
    });
  }

  await db.from('withdrawals').update({
    status: action === 'approve' ? 'approved' : 'rejected',
    admin_note: note || '',
    actioned_at: new Date().toISOString()
  }).eq('id', withdrawalId);

  return json({ success: true, status: action === 'approve' ? 'approved' : 'rejected' });
}

// Ban/unban player
export async function toggleBan(request, env) {
  const { userId, banned } = await request.json();

  if (!userId) return json({ error: 'userId required' }, 400);

  const db = getSupabase(env);

  const { error: upErr } = await db
    .from('players')
    .update({ is_banned: !!banned })
    .eq('id', userId);

  if (upErr) return json({ error: 'Failed to update ban status' }, 500);

  return json({ success: true, banned: !!banned });
}

// Platform stats
export async function getStats(env) {
  const db = getSupabase(env);

  const { data: players } = await db.from('players').select('balance, total_wagered, total_won', { count: 'exact' });
  const { count: totalPlayers } = await db.from('players').select('id', { count: 'exact', head: true });

  const totalBalance = (players || []).reduce((sum, p) => sum + (p.balance || 0), 0);
  const totalWagered = (players || []).reduce((sum, p) => sum + (p.total_wagered || 0), 0);
  const totalWon = (players || []).reduce((sum, p) => sum + (p.total_won || 0), 0);
  const houseProfit = totalWagered - totalWon;

  // Today's bets
  const today = new Date().toISOString().split('T')[0];
  const { count: todayBets } = await db
    .from('bets')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', today);

  // Pending withdrawals
  const { count: pendingWithdrawals } = await db
    .from('withdrawals')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  return json({
    totalPlayers: totalPlayers || 0,
    totalBalance,
    totalWagered,
    totalWon,
    houseProfit,
    todayBets: todayBets || 0,
    pendingWithdrawals: pendingWithdrawals || 0
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
