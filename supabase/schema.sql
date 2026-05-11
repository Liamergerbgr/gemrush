-- ============================================================
-- GemRush Casino — Supabase Schema
-- Run this in Supabase SQL Editor after creating your project
-- ============================================================

-- Players table (extends auth.users)
CREATE TABLE players (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  roblox_username TEXT,
  balance BIGINT NOT NULL DEFAULT 0,
  total_wagered BIGINT NOT NULL DEFAULT 0,
  total_won BIGINT NOT NULL DEFAULT 0,
  is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Game bets (provably fair records)
CREATE TABLE bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  game_type TEXT NOT NULL CHECK (game_type IN ('crash','mines','towers','coinflip','blackjack','roulette','plinko')),
  bet_amount BIGINT NOT NULL CHECK (bet_amount > 0),
  multiplier DECIMAL(10,4) NOT NULL DEFAULT 0,
  payout BIGINT NOT NULL DEFAULT 0,
  server_seed_hash TEXT NOT NULL,
  server_seed TEXT,
  client_seed TEXT NOT NULL,
  nonce INTEGER NOT NULL,
  game_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Transactions log (every balance change)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('credit','debit','bet','win','withdrawal_request','withdrawal_approve','withdrawal_reject')),
  amount BIGINT NOT NULL,
  note TEXT,
  admin_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Withdrawal requests
CREATE TABLE withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL CHECK (amount > 0),
  roblox_username TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actioned_at TIMESTAMPTZ
);

-- Active game sessions (mines, towers, blackjack — multi-step games)
CREATE TABLE active_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  game_type TEXT NOT NULL,
  bet_amount BIGINT NOT NULL,
  state JSONB NOT NULL,           -- game-specific state (mine positions, tower layout, cards, etc.)
  server_seed TEXT NOT NULL,
  server_seed_hash TEXT NOT NULL,
  client_seed TEXT NOT NULL,
  nonce INTEGER NOT NULL,
  current_multiplier DECIMAL(10,4) NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_bets_user ON bets(user_id, created_at DESC);
CREATE INDEX idx_bets_game ON bets(game_type, created_at DESC);
CREATE INDEX idx_transactions_user ON transactions(user_id, created_at DESC);
CREATE INDEX idx_withdrawals_status ON withdrawals(status, created_at DESC);
CREATE INDEX idx_withdrawals_user ON withdrawals(user_id, created_at DESC);
CREATE INDEX idx_active_games_user ON active_games(user_id, game_type);

-- ============================================================
-- Row Level Security
-- ============================================================

-- Players: authenticated users can read their own row only
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "players_select_own" ON players FOR SELECT
  TO authenticated USING (auth.uid() = id);
-- No INSERT/UPDATE/DELETE policies = blocked for authenticated/anon

-- Bets: read own only
ALTER TABLE bets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bets_select_own" ON bets FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

-- Transactions: read own only
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "txns_select_own" ON transactions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

-- Withdrawals: read own, insert own (amount checked by Workers)
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "withdrawals_select_own" ON withdrawals FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "withdrawals_insert_own" ON withdrawals FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

-- Active games: read own only
ALTER TABLE active_games ENABLE ROW LEVEL SECURITY;
CREATE POLICY "active_games_select_own" ON active_games FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- Helper function: atomic balance update (used by Workers via RPC)
-- ============================================================
CREATE OR REPLACE FUNCTION update_balance(
  p_user_id UUID,
  p_amount BIGINT,
  p_type TEXT,
  p_note TEXT DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
  new_balance BIGINT;
BEGIN
  UPDATE players
    SET balance = balance + p_amount
    WHERE id = p_user_id AND (balance + p_amount) >= 0
    RETURNING balance INTO new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient balance or player not found';
  END IF;

  INSERT INTO transactions (user_id, type, amount, note)
    VALUES (p_user_id, p_type, p_amount, p_note);

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: place bet (deduct balance atomically)
CREATE OR REPLACE FUNCTION place_bet(
  p_user_id UUID,
  p_amount BIGINT
) RETURNS BIGINT AS $$
DECLARE
  new_balance BIGINT;
BEGIN
  UPDATE players
    SET balance = balance - p_amount,
        total_wagered = total_wagered + p_amount
    WHERE id = p_user_id AND balance >= p_amount AND NOT is_banned
    RETURNING balance INTO new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient balance, player not found, or banned';
  END IF;

  INSERT INTO transactions (user_id, type, amount, note)
    VALUES (p_user_id, 'bet', -p_amount, NULL);

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: credit winnings
CREATE OR REPLACE FUNCTION credit_winnings(
  p_user_id UUID,
  p_amount BIGINT
) RETURNS BIGINT AS $$
DECLARE
  new_balance BIGINT;
BEGIN
  UPDATE players
    SET balance = balance + p_amount,
        total_won = total_won + p_amount
    WHERE id = p_user_id
    RETURNING balance INTO new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player not found';
  END IF;

  INSERT INTO transactions (user_id, type, amount, note)
    VALUES (p_user_id, 'win', p_amount, NULL);

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
