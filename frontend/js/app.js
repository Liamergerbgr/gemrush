// GemRush — Main App Logic
let currentUser = null;
let currentPage = 'home';
let userBalance = 0;

// Active game states
let minesGameId = null;
let towersGameId = null;
let bjGameId = null;

// Choices
let cfChoice = 'heads';
let rlChoice = 'red';
let towersDiff = 'easy';
let plinkoRisk = 'low';

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('gr_token');
  const savedUser = localStorage.getItem('gr_user');

  if (token && savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      api.token = token;
      const me = await api.getMe();
      currentUser = { ...currentUser, ...me };
      userBalance = me.balance || 0;
      showApp();
    } catch {
      localStorage.removeItem('gr_token');
      localStorage.removeItem('gr_user');
      showAuth();
    }
  } else {
    showAuth();
  }

  renderPlinkoBuckets();
  renderMinesGrid();
});

function showAuth() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  updateBalance(userBalance);
  document.getElementById('user-name').textContent = currentUser?.username || 'User';
  document.getElementById('user-avatar').textContent = (currentUser?.username || '?')[0].toUpperCase();
}

function showLogin() {
  document.getElementById('login-form').classList.remove('hidden');
  document.getElementById('register-form').classList.add('hidden');
}

function showRegister() {
  document.getElementById('login-form').classList.add('hidden');
  document.getElementById('register-form').classList.remove('hidden');
}

// --- Auth ---
async function doLogin() {
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';

  try {
    const data = await api.login(email, password);
    currentUser = data.user;
    userBalance = data.user.balance || 0;
    localStorage.setItem('gr_user', JSON.stringify(data.user));
    showApp();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  }
}

async function doRegister() {
  const username = document.getElementById('reg-username').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;
  const roblox = document.getElementById('reg-roblox').value;
  const errEl = document.getElementById('register-error');
  errEl.style.display = 'none';

  try {
    const data = await api.register(email, password, username, roblox);
    currentUser = data.user;
    userBalance = data.user.balance || 0;
    localStorage.setItem('gr_user', JSON.stringify(data.user));
    showApp();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  }
}

function doLogout() {
  api.logout();
  currentUser = null;
  showAuth();
}

// --- Navigation ---
function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.game-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const panel = document.getElementById('page-' + page);
  if (panel) panel.classList.add('active');

  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');

  // Load data for certain pages
  if (page === 'history') loadHistory();
  if (page === 'withdraw') loadWithdrawHistory();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}

// --- Balance ---
function updateBalance(amount) {
  userBalance = amount;
  document.getElementById('balance-amount').textContent = Number(amount).toLocaleString();
}

// --- Bet helpers ---
function betQuick(inputId, action) {
  const input = document.getElementById(inputId);
  let val = parseInt(input.value) || 0;
  if (action === 'half') val = Math.max(1, Math.floor(val / 2));
  if (action === '2x') val = val * 2;
  if (action === 'max') val = userBalance;
  input.value = val;
}

function selectChoice(group, choice) {
  const container = document.getElementById(group + '-group');
  if (!container) return;
  container.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('selected'));
  const btn = container.querySelector(`[data-choice="${choice}"]`);
  if (btn) btn.classList.add('selected');

  if (group === 'cf') cfChoice = choice;
  if (group === 'rl') rlChoice = choice;
  if (group === 'towers-diff') towersDiff = choice;
  if (group === 'plinko-risk') plinkoRisk = choice;
}

function toast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// =====================
//       GAMES
// =====================

// --- Coin Flip ---
async function playCoinflip() {
  const amount = parseInt(document.getElementById('cf-amount').value);
  if (!amount || amount < 1) return toast('Enter a valid bet', 'error');

  const btn = document.getElementById('cf-play-btn');
  btn.disabled = true;

  try {
    const res = await api.coinflipPlay(amount, cfChoice);
    updateBalance(res.balance);

    const area = document.getElementById('cf-game-area');
    const won = res.won;
    area.innerHTML = `
      <div class="game-result ${won ? 'win' : 'lose'}">
        <div style="font-size:4rem;margin-bottom:12px;">${res.result === 'heads' ? '&#129689;' : '&#129693;'}</div>
        <div class="result-multiplier">${won ? res.multiplier + 'x' : '0.00x'}</div>
        <div class="result-payout">${won ? '+' + res.payout + ' gems' : '-' + amount + ' gems'}</div>
        <p class="text-muted mt-8">Result: ${res.result.toUpperCase()}</p>
      </div>
    `;
  } catch (e) {
    toast(e.message, 'error');
  }

  btn.disabled = false;
}

// --- Crash ---
async function playCrash() {
  const amount = parseInt(document.getElementById('crash-amount').value);
  const autoCashout = parseFloat(document.getElementById('crash-auto').value);
  if (!amount || amount < 1) return toast('Enter a valid bet', 'error');

  const btn = document.getElementById('crash-play-btn');
  btn.disabled = true;

  try {
    const res = await api.crashBet(amount, autoCashout || undefined);
    updateBalance(res.balance);

    const display = document.getElementById('crash-multiplier');

    if (res.status === 'cashed_out') {
      display.className = 'crash-display rising';
      display.textContent = res.autoCashout.toFixed(2) + 'x';
      toast(`Cashed out at ${res.autoCashout}x! +${res.payout} gems`);
    } else if (res.status === 'busted') {
      display.className = 'crash-display busted';
      display.textContent = res.crashPoint.toFixed(2) + 'x';
      toast(`Busted at ${res.crashPoint}x`, 'error');
    }
  } catch (e) {
    toast(e.message, 'error');
  }

  btn.disabled = false;
}

// --- Mines ---
function renderMinesGrid(clickable = false) {
  const grid = document.getElementById('mines-grid');
  grid.innerHTML = '';
  for (let i = 0; i < 25; i++) {
    const tile = document.createElement('div');
    tile.className = 'mine-tile';
    tile.dataset.index = i;
    if (clickable) {
      tile.onclick = () => revealMine(i);
    }
    grid.appendChild(tile);
  }
}

async function startMines() {
  const amount = parseInt(document.getElementById('mines-amount').value);
  const mineCount = parseInt(document.getElementById('mines-count').value);
  if (!amount || amount < 1) return toast('Enter a valid bet', 'error');

  try {
    const res = await api.minesStart(amount, mineCount);
    minesGameId = res.gameId;
    updateBalance(userBalance - amount);
    renderMinesGrid(true);
    document.getElementById('mines-next-mult').textContent = res.nextMultiplier + 'x';
    document.getElementById('mines-start-btn').classList.add('hidden');
    document.getElementById('mines-cashout-section').classList.remove('hidden');
    document.getElementById('mines-current-payout').textContent = '0';
    document.getElementById('mines-status').textContent = 'Click tiles to reveal!';
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function revealMine(index) {
  if (!minesGameId) return;

  const tile = document.querySelector(`.mine-tile[data-index="${index}"]`);
  if (tile.classList.contains('revealed')) return;

  try {
    const res = await api.minesReveal(minesGameId, index);

    if (res.result === 'mine') {
      // Hit a mine — game over
      tile.classList.add('revealed', 'mine');
      tile.innerHTML = '&#128163;';

      // Reveal all mines
      res.minePositions.forEach(pos => {
        const t = document.querySelector(`.mine-tile[data-index="${pos}"]`);
        if (t && !t.classList.contains('revealed')) {
          t.classList.add('revealed', 'mine');
          t.innerHTML = '&#128163;';
        }
      });

      updateBalance(res.balance);
      minesGameId = null;
      document.getElementById('mines-start-btn').classList.remove('hidden');
      document.getElementById('mines-cashout-section').classList.add('hidden');
      document.getElementById('mines-status').textContent = 'You hit a mine!';
      toast('You hit a mine!', 'error');
    } else {
      tile.classList.add('revealed', 'safe');
      tile.innerHTML = '&#128142;';
      document.getElementById('mines-next-mult').textContent = (res.nextMultiplier || res.currentMultiplier) + 'x';
      document.getElementById('mines-current-payout').textContent = res.currentPayout + ' gems';

      if (res.allClear) {
        updateBalance(res.balance);
        minesGameId = null;
        document.getElementById('mines-start-btn').classList.remove('hidden');
        document.getElementById('mines-cashout-section').classList.add('hidden');
        toast(`All clear! Won ${res.payout} gems!`);
      }
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function minesCashout() {
  if (!minesGameId) return;
  try {
    const res = await api.minesCashout(minesGameId);
    updateBalance(res.balance);
    minesGameId = null;
    document.getElementById('mines-start-btn').classList.remove('hidden');
    document.getElementById('mines-cashout-section').classList.add('hidden');
    document.getElementById('mines-status').textContent = `Cashed out! Won ${res.payout} gems`;

    // Reveal mines
    res.minePositions.forEach(pos => {
      const t = document.querySelector(`.mine-tile[data-index="${pos}"]`);
      if (t && !t.classList.contains('revealed')) {
        t.classList.add('revealed', 'mine');
        t.innerHTML = '&#128163;';
      }
    });

    toast(`Cashed out ${res.multiplier}x! +${res.payout} gems`);
  } catch (e) {
    toast(e.message, 'error');
  }
}

// --- Towers ---
async function startTowers() {
  const amount = parseInt(document.getElementById('towers-amount').value);
  if (!amount || amount < 1) return toast('Enter a valid bet', 'error');

  try {
    const res = await api.towersStart(amount, towersDiff);
    towersGameId = res.gameId;
    updateBalance(userBalance - amount);
    renderTowersGrid(res.columns, res.floors, 0);
    document.getElementById('towers-current-mult').textContent = '1.00x';
    document.getElementById('towers-start-btn').classList.add('hidden');
    document.getElementById('towers-cashout-section').classList.remove('hidden');
    document.getElementById('towers-status').textContent = 'Pick a column on the highlighted floor!';
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderTowersGrid(columns, floors, currentFloor, tower = null) {
  const grid = document.getElementById('towers-grid');
  grid.innerHTML = '';

  for (let f = 0; f < floors; f++) {
    const row = document.createElement('div');
    row.className = 'tower-row';

    for (let c = 0; c < columns; c++) {
      const col = document.createElement('div');
      col.className = 'tower-col';

      if (f === currentFloor && towersGameId) {
        col.classList.add('current-row');
        col.onclick = () => pickTower(c);
      }

      if (tower && f < currentFloor) {
        // Show past results
        if (tower[f].dangerous.includes(c)) {
          col.classList.add('danger');
          col.innerHTML = '&#10005;';
        } else {
          col.classList.add('safe');
          col.innerHTML = '&#10003;';
        }
      }

      row.appendChild(col);
    }

    grid.appendChild(row);
  }
}

async function pickTower(column) {
  if (!towersGameId) return;

  try {
    const res = await api.towersPick(towersGameId, column);

    if (res.result === 'dead') {
      renderTowersGrid(res.tower[0]?.dangerous?.length ? 3 : 4, res.tower.length, res.tower.length, res.tower);
      updateBalance(res.balance);
      towersGameId = null;
      document.getElementById('towers-start-btn').classList.remove('hidden');
      document.getElementById('towers-cashout-section').classList.add('hidden');
      document.getElementById('towers-status').textContent = 'You fell!';
      toast('You fell!', 'error');
    } else if (res.reachedTop) {
      renderTowersGrid(res.tower[0]?.dangerous?.length ? 3 : 4, res.tower.length, res.tower.length, res.tower);
      updateBalance(res.balance);
      towersGameId = null;
      document.getElementById('towers-start-btn').classList.remove('hidden');
      document.getElementById('towers-cashout-section').classList.add('hidden');
      document.getElementById('towers-current-mult').textContent = res.multiplier + 'x';
      toast(`Reached the top! ${res.multiplier}x — +${res.payout} gems!`);
    } else {
      document.getElementById('towers-current-mult').textContent = res.currentMultiplier + 'x';
      // Re-render with updated floor
      const floors = res.floorsLeft + res.currentFloor;
      renderTowersGrid(3, floors, res.currentFloor);
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function towersCashout() {
  if (!towersGameId) return;
  try {
    const res = await api.towersCashout(towersGameId);
    updateBalance(res.balance);
    towersGameId = null;
    document.getElementById('towers-start-btn').classList.remove('hidden');
    document.getElementById('towers-cashout-section').classList.add('hidden');
    document.getElementById('towers-current-mult').textContent = res.multiplier + 'x';
    toast(`Cashed out ${res.multiplier}x! +${res.payout} gems`);
  } catch (e) {
    toast(e.message, 'error');
  }
}

// --- Plinko ---
const PLINKO_MULTS = {
  low: [5.6, 2.1, 1.1, 1.0, 0.5, 1.0, 1.1, 2.1, 5.6],
  medium: [25, 8, 3, 1.5, 1.1, 0.5, 0.3, 0.5, 1.1, 1.5, 3, 8, 25],
  high: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110]
};

function renderPlinkoBuckets() {
  const buckets = document.getElementById('plinko-buckets');
  if (!buckets) return;
  const mults = PLINKO_MULTS[plinkoRisk];
  buckets.innerHTML = '';
  mults.forEach(m => {
    const b = document.createElement('div');
    b.className = 'plinko-bucket';
    b.textContent = m + 'x';
    const intensity = Math.min(m / 10, 1);
    b.style.background = `rgba(0, 231, 1, ${0.1 + intensity * 0.4})`;
    b.style.color = intensity > 0.3 ? '#000' : 'var(--accent)';
    buckets.appendChild(b);
  });
}

async function playPlinko() {
  const amount = parseInt(document.getElementById('plinko-amount').value);
  if (!amount || amount < 1) return toast('Enter a valid bet', 'error');

  try {
    const res = await api.plinkoDrop(amount, plinkoRisk);
    updateBalance(res.balance);

    // Highlight bucket
    renderPlinkoBuckets();
    const bucketEls = document.querySelectorAll('#plinko-buckets .plinko-bucket');
    if (bucketEls[res.bucket]) {
      bucketEls[res.bucket].style.background = res.won ? 'var(--accent)' : 'var(--danger)';
      bucketEls[res.bucket].style.color = '#000';
      bucketEls[res.bucket].style.transform = 'scale(1.2)';
      bucketEls[res.bucket].style.fontWeight = '800';
    }

    if (res.payout > amount) {
      toast(`${res.multiplier}x! +${res.payout} gems`);
    } else if (res.payout > 0) {
      toast(`${res.multiplier}x — ${res.payout} gems returned`, 'error');
    } else {
      toast(`Lost! 0x`, 'error');
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

// --- Roulette ---
async function playRoulette() {
  const amount = parseInt(document.getElementById('rl-amount').value);
  if (!amount || amount < 1) return toast('Enter a valid bet', 'error');

  try {
    const res = await api.rouletteBet(amount, rlChoice);
    updateBalance(res.balance);

    const display = document.getElementById('rl-display');
    display.className = 'roulette-result-display ' + res.result + '-result';
    display.textContent = res.result.toUpperCase();

    const area = document.getElementById('rl-game-area');
    const resultHTML = res.won
      ? `<p class="text-accent mt-8" style="font-size:1.2rem;font-weight:700;">${res.multiplier}x — +${res.payout} gems!</p>`
      : `<p class="text-danger mt-8" style="font-size:1.2rem;font-weight:700;">Lost! Result: ${res.result}</p>`;

    // Keep display, append result
    const existing = area.querySelector('.rl-result-text');
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.className = 'rl-result-text';
    div.innerHTML = resultHTML;
    area.appendChild(div);
  } catch (e) {
    toast(e.message, 'error');
  }
}

// --- Blackjack ---
function renderCard(card, hidden = false) {
  if (hidden) return '<div class="bj-card hidden-card">?</div>';
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  const suitSymbol = { hearts: '&#9829;', diamonds: '&#9830;', clubs: '&#9827;', spades: '&#9824;' }[card.suit];
  return `<div class="bj-card ${isRed ? 'red' : ''}">${card.rank}${suitSymbol}</div>`;
}

async function startBlackjack() {
  const amount = parseInt(document.getElementById('bj-amount').value);
  if (!amount || amount < 1) return toast('Enter a valid bet', 'error');

  try {
    const res = await api.blackjackStart(amount);

    if (res.result) {
      // Instant result (blackjack)
      updateBalance(res.balance);
      showBjHands(res.playerCards, res.dealerCards, res.playerValue, res.dealerValue, false);
      document.getElementById('bj-status').textContent = formatBjResult(res.result, res.payout);
      document.getElementById('bj-actions').classList.add('hidden');
      document.getElementById('bj-deal-btn').classList.remove('hidden');
      bjGameId = null;
    } else {
      bjGameId = res.gameId;
      updateBalance(userBalance - amount);
      showBjHands(res.playerCards, [res.dealerUpCard], res.playerValue, '?', true);
      document.getElementById('bj-status').textContent = '';
      document.getElementById('bj-actions').classList.remove('hidden');
      document.getElementById('bj-deal-btn').classList.add('hidden');
      document.getElementById('bj-double-btn').style.display = res.canDouble ? '' : 'none';
    }

    document.getElementById('bj-dealer-section').classList.remove('hidden');
    document.getElementById('bj-player-section').classList.remove('hidden');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function showBjHands(playerCards, dealerCards, playerVal, dealerVal, hideSecond) {
  const dealerHand = document.getElementById('bj-dealer-hand');
  const playerHand = document.getElementById('bj-player-hand');

  dealerHand.innerHTML = dealerCards.map((c, i) => (hideSecond && i === 1) ? renderCard(c, true) : renderCard(c)).join('');
  if (hideSecond && dealerCards.length === 1) {
    dealerHand.innerHTML += renderCard({}, true);
  }
  playerHand.innerHTML = playerCards.map(c => renderCard(c)).join('');

  document.getElementById('bj-dealer-value').textContent = dealerVal;
  document.getElementById('bj-player-value').textContent = playerVal;
}

async function bjAction(action) {
  if (!bjGameId) return;

  try {
    const res = await api.blackjackAction(bjGameId, action);

    if (res.result) {
      // Game over
      updateBalance(res.balance);
      showBjHands(res.playerCards, res.dealerCards, res.playerValue, res.dealerValue, false);
      document.getElementById('bj-status').textContent = formatBjResult(res.result, res.payout);
      document.getElementById('bj-actions').classList.add('hidden');
      document.getElementById('bj-deal-btn').classList.remove('hidden');
      bjGameId = null;

      if (res.payout > 0) {
        toast(`${formatBjResult(res.result, res.payout)}`);
      } else {
        toast(formatBjResult(res.result, res.payout), 'error');
      }
    } else {
      // Still playing (hit)
      showBjHands(res.playerCards, [res.dealerUpCard], res.playerValue, '?', true);
      document.getElementById('bj-double-btn').style.display = res.canDouble ? '' : 'none';
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

function formatBjResult(result, payout) {
  const labels = {
    'blackjack': `Blackjack! +${payout} gems`,
    'win': `You win! +${payout} gems`,
    'dealer_bust': `Dealer busted! +${payout} gems`,
    'push': `Push — bet returned`,
    'bust': `Bust! You lose`,
    'lose': `Dealer wins`,
    'dealer_blackjack': `Dealer blackjack!`
  };
  return labels[result] || result;
}

// --- History ---
async function loadHistory(page = 1) {
  try {
    const res = await api.getBetHistory(page);
    const tbody = document.getElementById('history-body');
    tbody.innerHTML = '';

    if (!res.bets || res.bets.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding:40px;">No bets yet</td></tr>';
      return;
    }

    res.bets.forEach(bet => {
      const won = bet.payout > 0;
      const date = new Date(bet.created_at).toLocaleDateString();
      tbody.innerHTML += `
        <tr>
          <td>${bet.game_type}</td>
          <td>${bet.bet_amount}</td>
          <td>${bet.multiplier}x</td>
          <td class="${won ? 'text-accent' : 'text-danger'}">${won ? '+' : ''}${bet.payout}</td>
          <td><span class="badge ${won ? 'badge-win' : 'badge-loss'}">${won ? 'Win' : 'Loss'}</span></td>
          <td class="text-muted">${date}</td>
        </tr>
      `;
    });

    // Pagination
    const pagDiv = document.getElementById('history-pagination');
    if (res.pages > 1) {
      let html = '';
      for (let p = 1; p <= res.pages; p++) {
        html += `<button class="btn btn-sm ${p === page ? 'btn-primary' : 'btn-secondary'}" onclick="loadHistory(${p})" style="margin:0 4px;">${p}</button>`;
      }
      pagDiv.innerHTML = html;
    } else {
      pagDiv.innerHTML = '';
    }
  } catch (e) {
    toast('Failed to load history', 'error');
  }
}

// --- Withdraw ---
async function requestWithdraw() {
  const amount = parseInt(document.getElementById('wd-amount').value);
  const roblox = document.getElementById('wd-roblox').value;

  if (!amount || amount < 10) return toast('Minimum 10 gems', 'error');
  if (!roblox) return toast('Enter Roblox username', 'error');

  try {
    const res = await api.requestWithdrawal(amount, roblox);
    updateBalance(res.balance);
    toast('Withdrawal requested!');
    document.getElementById('wd-amount').value = '';
    loadWithdrawHistory();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadWithdrawHistory() {
  try {
    const res = await api.getWithdrawHistory();
    const container = document.getElementById('wd-history');

    if (!res.withdrawals || res.withdrawals.length === 0) {
      container.innerHTML = '<p class="text-muted">No withdrawals yet</p>';
      return;
    }

    container.innerHTML = res.withdrawals.map(w => `
      <div class="info-row">
        <span class="label">${w.amount} gems to ${w.roblox_username}</span>
        <span class="badge ${w.status === 'approved' ? 'badge-win' : w.status === 'rejected' ? 'badge-loss' : ''}">${w.status}</span>
      </div>
    `).join('');
  } catch (e) {
    // silent
  }
}

// --- Provably Fair Verification ---
async function verifyFairness() {
  const serverSeed = document.getElementById('pf-server-seed').value;
  const clientSeed = document.getElementById('pf-client-seed').value;
  const nonce = document.getElementById('pf-nonce').value;

  if (!serverSeed || !clientSeed || !nonce) return toast('Fill in all fields', 'error');

  const resultDiv = document.getElementById('pf-result');

  try {
    // Hash server seed
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(serverSeed));
    const serverSeedHash = Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, '0')).join('');

    // HMAC
    const cryptoKey = await crypto.subtle.importKey(
      'raw', encoder.encode(serverSeed),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(`${clientSeed}:${nonce}`));
    const hmac = Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');

    const int = parseInt(hmac.slice(0, 8), 16);
    const float = int / 0x100000000;

    resultDiv.innerHTML = `
      <div style="background:var(--bg-tertiary);padding:16px;border-radius:8px;">
        <div class="info-row"><span class="label">Server Seed Hash</span><span class="value" style="font-size:0.7rem;word-break:break-all;">${serverSeedHash}</span></div>
        <div class="info-row"><span class="label">HMAC</span><span class="value" style="font-size:0.7rem;word-break:break-all;">${hmac.slice(0, 16)}...</span></div>
        <div class="info-row"><span class="label">Game Float</span><span class="value text-accent">${float.toFixed(8)}</span></div>
        <div class="info-row"><span class="label">Coin Flip</span><span class="value">${float < 0.5 ? 'Heads' : 'Tails'}</span></div>
        <div class="info-row"><span class="label">Roulette Slot</span><span class="value">${Math.floor(float * 38)}/37</span></div>
      </div>
    `;
  } catch (e) {
    resultDiv.innerHTML = `<p class="text-danger">Verification failed: ${e.message}</p>`;
  }
}

// Watch risk level changes for plinko
const origSelectChoice = selectChoice;
const _selectChoice = selectChoice;
// Override to also re-render plinko buckets
window.selectChoice = function(group, choice) {
  _selectChoice(group, choice);
  if (group === 'plinko-risk') renderPlinkoBuckets();
};
