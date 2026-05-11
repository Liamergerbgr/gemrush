import { getSupabase } from '../db.js';
import { generateSeed, sha256, generateGameResults } from '../fairness.js';

// Blackjack: standard rules, dealer stands on 17
// Blackjack pays 3:2 (2.5x), regular win pays 2x
// No splitting, no surrender, double down on any two cards
// House edge ~5% from restricted rules + player busting first

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

function shuffleDeck(deck, floats) {
  // Fisher-Yates shuffle using provably fair floats
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const floatIdx = i % floats.length;
    const j = Math.floor(floats[floatIdx] * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function cardValue(rank) {
  if (['J', 'Q', 'K'].includes(rank)) return 10;
  if (rank === 'A') return 11;
  return parseInt(rank);
}

function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardValue(card.rank);
    if (card.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards) === 21;
}

export async function start(request, env, userId) {
  const { amount } = await request.json();

  if (!amount || amount < 1) return error('Minimum bet is 1 gem');

  const db = getSupabase(env);

  const { error: balErr } = await db.rpc('place_bet', { p_user_id: userId, p_amount: amount });
  if (balErr) return error('Insufficient balance');

  // Generate shuffled deck
  const serverSeed = generateSeed();
  const serverSeedHash = await sha256(serverSeed);
  const clientSeed = generateSeed();
  const nonce = Date.now();

  const floats = await generateGameResults(serverSeed, clientSeed, nonce, 52);
  const deck = shuffleDeck(createDeck(), floats);

  // Deal initial cards
  const playerCards = [deck[0], deck[2]];
  const dealerCards = [deck[1], deck[3]];
  let deckIndex = 4;

  const playerValue = handValue(playerCards);
  const dealerValue = handValue(dealerCards);

  // Check for blackjacks
  const playerBJ = isBlackjack(playerCards);
  const dealerBJ = isBlackjack(dealerCards);

  if (playerBJ || dealerBJ) {
    let multiplier = 0;
    let payout = 0;
    let result;

    if (playerBJ && dealerBJ) {
      result = 'push';
      multiplier = 1;
      payout = amount; // Return bet
    } else if (playerBJ) {
      result = 'blackjack';
      multiplier = 2.5;
      payout = Math.floor(amount * 2.5);
    } else {
      result = 'dealer_blackjack';
      multiplier = 0;
      payout = 0;
    }

    if (payout > 0) {
      await db.rpc('credit_winnings', { p_user_id: userId, p_amount: payout });
    }

    await db.from('bets').insert({
      user_id: userId,
      game_type: 'blackjack',
      bet_amount: amount,
      multiplier,
      payout,
      server_seed_hash: serverSeedHash,
      server_seed: serverSeed,
      client_seed: clientSeed,
      nonce,
      game_state: {
        playerCards,
        dealerCards,
        playerValue: handValue(playerCards),
        dealerValue: handValue(dealerCards),
        result
      }
    });

    const { data: player } = await db.from('players').select('balance').eq('id', userId).single();

    return json({
      result,
      playerCards,
      dealerCards,
      playerValue: handValue(playerCards),
      dealerValue: handValue(dealerCards),
      payout,
      multiplier,
      balance: player?.balance ?? 0,
      fairness: { serverSeedHash, serverSeed, clientSeed, nonce }
    });
  }

  // No blackjack — store active game
  const gameId = crypto.randomUUID();
  await db.from('active_games').insert({
    id: gameId,
    user_id: userId,
    game_type: 'blackjack',
    bet_amount: amount,
    game_state: {
      deck,
      deckIndex,
      playerCards,
      dealerCards,
      doubled: false,
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
    playerCards,
    dealerUpCard: dealerCards[0], // Only show first dealer card
    playerValue,
    canDouble: true
  });
}

export async function action(request, env, userId) {
  const { gameId, action: playerAction } = await request.json();

  if (!gameId) return error('Game ID required');
  if (!['hit', 'stand', 'double'].includes(playerAction)) return error('Action must be hit, stand, or double');

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

  // Double down
  if (playerAction === 'double') {
    if (state.playerCards.length !== 2) return error('Can only double on first two cards');
    if (state.doubled) return error('Already doubled');

    // Deduct additional bet
    const { error: balErr } = await db.rpc('place_bet', { p_user_id: userId, p_amount: game.bet_amount });
    if (balErr) return error('Insufficient balance for double');

    state.doubled = true;

    // Deal one card and stand
    state.playerCards.push(state.deck[state.deckIndex]);
    state.deckIndex++;

    if (handValue(state.playerCards) > 21) {
      return await resolveGame(db, game, state, userId, 'bust');
    }

    // Auto-stand after double
    return await dealerPlay(db, game, state, userId);
  }

  // Hit
  if (playerAction === 'hit') {
    state.playerCards.push(state.deck[state.deckIndex]);
    state.deckIndex++;

    const playerValue = handValue(state.playerCards);

    if (playerValue > 21) {
      return await resolveGame(db, game, state, userId, 'bust');
    }

    if (playerValue === 21) {
      // Auto-stand on 21
      return await dealerPlay(db, game, state, userId);
    }

    // Update game state
    await db.from('active_games').update({
      game_state: state
    }).eq('id', gameId);

    return json({
      playerCards: state.playerCards,
      dealerUpCard: state.dealerCards[0],
      playerValue,
      canDouble: false // Can't double after hitting
    });
  }

  // Stand
  if (playerAction === 'stand') {
    return await dealerPlay(db, game, state, userId);
  }
}

async function dealerPlay(db, game, state, userId) {
  // Dealer draws until 17+
  while (handValue(state.dealerCards) < 17) {
    state.dealerCards.push(state.deck[state.deckIndex]);
    state.deckIndex++;
  }

  const dealerValue = handValue(state.dealerCards);

  if (dealerValue > 21) {
    return await resolveGame(db, game, state, userId, 'dealer_bust');
  }

  const playerValue = handValue(state.playerCards);

  if (playerValue > dealerValue) {
    return await resolveGame(db, game, state, userId, 'win');
  } else if (playerValue < dealerValue) {
    return await resolveGame(db, game, state, userId, 'lose');
  } else {
    return await resolveGame(db, game, state, userId, 'push');
  }
}

async function resolveGame(db, game, state, userId, result) {
  const totalBet = state.doubled ? game.bet_amount * 2 : game.bet_amount;
  let multiplier = 0;
  let payout = 0;

  switch (result) {
    case 'win':
    case 'dealer_bust':
      multiplier = 2;
      payout = totalBet * 2;
      break;
    case 'push':
      multiplier = 1;
      payout = totalBet; // Return bet
      break;
    case 'bust':
    case 'lose':
      multiplier = 0;
      payout = 0;
      break;
  }

  if (payout > 0) {
    await db.rpc('credit_winnings', { p_user_id: userId, p_amount: payout });
  }

  await db.from('bets').insert({
    user_id: userId,
    game_type: 'blackjack',
    bet_amount: totalBet,
    multiplier,
    payout,
    server_seed_hash: state.serverSeedHash,
    server_seed: state.serverSeed,
    client_seed: state.clientSeed,
    nonce: state.nonce,
    game_state: {
      playerCards: state.playerCards,
      dealerCards: state.dealerCards,
      playerValue: handValue(state.playerCards),
      dealerValue: handValue(state.dealerCards),
      doubled: state.doubled,
      result
    }
  });

  await db.from('active_games').delete().eq('id', game.id);

  const { data: player } = await db.from('players').select('balance').eq('id', userId).single();

  return json({
    result,
    playerCards: state.playerCards,
    dealerCards: state.dealerCards,
    playerValue: handValue(state.playerCards),
    dealerValue: handValue(state.dealerCards),
    bet: totalBet,
    payout,
    multiplier,
    doubled: state.doubled,
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
