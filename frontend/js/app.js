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

// Valid pages for URL routing
const VALID_PAGES = ['home', 'coinflip', 'crash', 'mines', 'towers', 'plinko', 'roulette', 'blackjack', 'history', 'withdraw', 'fairness'];
const AUTH_PAGES = ['login', 'register'];

function getPageFromURL() {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  if (!path || path === 'index.html') return 'home';
  if (AUTH_PAGES.includes(path)) return path;
  return VALID_PAGES.includes(path) ? path : 'home';
}

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('gr_token');
  const savedUser = localStorage.getItem('gr_user');

  const initialPage = getPageFromURL();

  if (token && savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      api.token = token;
      const me = await api.getMe();
      currentUser = { ...currentUser, ...me, isAdmin: me.isAdmin || false };
      userBalance = me.balance || 0;
      // If logged in but on auth page, redirect to home
      if (AUTH_PAGES.includes(initialPage)) {
        showApp();
        navigate('home', true);
      } else {
        showApp();
        if (initialPage !== 'home') navigate(initialPage, false);
      }
    } catch {
      localStorage.removeItem('gr_token');
      localStorage.removeItem('gr_user');
      showAuth(initialPage);
    }
  } else {
    showAuth(initialPage);
  }

  renderPlinkoBoard();
  renderMinesGrid();
  buildRouletteStrip();
  updateTowersPreview();
});

// Handle browser back/forward buttons
window.addEventListener('popstate', () => {
  const page = getPageFromURL();
  if (AUTH_PAGES.includes(page)) {
    if (!currentUser) {
      showAuth(page);
    } else {
      navigate('home', true);
    }
  } else {
    if (!currentUser) {
      showAuth('login');
    } else {
      navigate(page, false);
    }
  }
});

function showAuth(page) {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
  if (page === 'register') {
    showRegister();
  } else {
    showLogin();
  }
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  updateBalance(userBalance);
  document.getElementById('user-name').textContent = currentUser?.username || 'User';
  document.getElementById('user-avatar').textContent = (currentUser?.username || '?')[0].toUpperCase();
  // Show admin link if admin
  const adminLink = document.getElementById('admin-nav-item');
  if (adminLink) {
    adminLink.style.display = currentUser?.isAdmin ? 'flex' : 'none';
  }
  // If on an auth URL, redirect to home
  const page = getPageFromURL();
  if (AUTH_PAGES.includes(page)) {
    navigate('home', true);
  }
}

function showLogin() {
  document.getElementById('login-form').classList.remove('hidden');
  document.getElementById('register-form').classList.add('hidden');
  history.pushState({ page: 'login' }, '', '/login');
  document.title = 'Login — GemRush';
}

function showRegister() {
  document.getElementById('login-form').classList.add('hidden');
  document.getElementById('register-form').classList.remove('hidden');
  history.pushState({ page: 'register' }, '', '/register');
  document.title = 'Register — GemRush';
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
  showAuth('login');
}

// --- Navigation ---
function navigate(page, pushState = true) {
  currentPage = page;
  document.querySelectorAll('.game-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const panel = document.getElementById('page-' + page);
  if (panel) panel.classList.add('active');

  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');

  // Update URL
  if (pushState) {
    const url = page === 'home' ? '/' : '/' + page;
    history.pushState({ page }, '', url);
  }

  // Update page title
  const titles = {
    home: 'GemRush — Casino',
    coinflip: 'Coin Flip — GemRush',
    crash: 'Crash — GemRush',
    mines: 'Mines — GemRush',
    towers: 'Towers — GemRush',
    plinko: 'Plinko — GemRush',
    roulette: 'Roulette — GemRush',
    blackjack: 'Blackjack — GemRush',
    history: 'Bet History — GemRush',
    withdraw: 'Withdraw — GemRush',
    fairness: 'Provably Fair — GemRush'
  };
  document.title = titles[page] || 'GemRush — Casino';

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');

  // Scroll to top
  window.scrollTo(0, 0);

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
const TOWER_CONFIGS = {
  easy:   { columns: 3, safe: 2, floors: 10 },
  medium: { columns: 3, safe: 1, floors: 8 },
  hard:   { columns: 4, safe: 1, floors: 7 }
};

function towerFloorMult(columns, safe) {
  return 0.95 * (columns / safe);
}

function towerCumulMult(columns, safe, floorsClimbed) {
  return Math.floor(Math.pow(towerFloorMult(columns, safe), floorsClimbed) * 100) / 100;
}

function updateTowersPreview() {
  const config = TOWER_CONFIGS[towersDiff];
  const amount = parseInt(document.getElementById('towers-amount').value) || 0;
  const firstMult = towerCumulMult(config.columns, config.safe, 1);
  const winEl = document.getElementById('towers-win-preview');
  const potEl = document.getElementById('towers-potential-win');
  if (winEl) {
    if (amount > 0) {
      winEl.textContent = Math.floor(amount * firstMult) + ' gems (' + firstMult + 'x)';
    } else {
      winEl.textContent = firstMult + 'x';
    }
  }
  if (potEl) {
    const label = potEl.querySelector('.label');
    if (label) label.textContent = 'Potential Win (Floor 1)';
  }
  // Render preview grid if no active game
  if (!towersGameId) {
    renderTowersPreviewGrid(config.columns, config.floors, config.safe);
  }
}

function renderTowersPreviewGrid(columns, floors, safe) {
  const grid = document.getElementById('towers-grid');
  grid.innerHTML = '';

  for (let f = 0; f < floors; f++) {
    const row = document.createElement('div');
    row.className = 'tower-row';
    const mult = towerCumulMult(columns, safe, f + 1);

    for (let c = 0; c < columns; c++) {
      const col = document.createElement('div');
      col.className = 'tower-col';
      col.innerHTML = `<span class="tower-mult">${mult}x</span>`;
      row.appendChild(col);
    }

    grid.appendChild(row);
  }
}

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
    document.getElementById('towers-potential-win').classList.add('hidden');
    document.getElementById('towers-current-payout').textContent = '0';
    document.getElementById('towers-status').textContent = 'Pick a column on the highlighted floor!';
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderTowersGrid(columns, floors, currentFloor, tower = null) {
  const grid = document.getElementById('towers-grid');
  grid.innerHTML = '';
  const config = TOWER_CONFIGS[towersDiff];

  for (let f = 0; f < floors; f++) {
    const row = document.createElement('div');
    row.className = 'tower-row';
    const mult = towerCumulMult(config.columns, config.safe, f + 1);

    for (let c = 0; c < columns; c++) {
      const col = document.createElement('div');
      col.className = 'tower-col';

      if (tower && f < (tower.length)) {
        if (f < currentFloor || (tower === null ? false : true)) {
          // Show past results
          if (tower[f].dangerous.includes(c)) {
            col.classList.add('danger');
            col.innerHTML = '&#10005;';
          } else {
            col.classList.add('safe');
            col.innerHTML = '&#10003;';
          }
        }
      } else if (f === currentFloor && towersGameId) {
        col.classList.add('current-row');
        col.innerHTML = `<span class="tower-mult">${mult}x</span>`;
        col.onclick = () => pickTower(c);
      } else {
        col.innerHTML = `<span class="tower-mult">${mult}x</span>`;
      }

      row.appendChild(col);
    }

    grid.appendChild(row);
  }
}

async function pickTower(column) {
  if (!towersGameId) return;

  const config = TOWER_CONFIGS[towersDiff];

  try {
    const res = await api.towersPick(towersGameId, column);

    if (res.result === 'dead') {
      const cols = res.tower[0]?.dangerous?.length === 1 && res.tower.length <= 7 ? 4 : 3;
      renderTowersGrid(cols, res.tower.length, res.tower.length, res.tower);
      updateBalance(res.balance);
      towersGameId = null;
      document.getElementById('towers-start-btn').classList.remove('hidden');
      document.getElementById('towers-cashout-section').classList.add('hidden');
      document.getElementById('towers-potential-win').classList.remove('hidden');
      document.getElementById('towers-status').textContent = 'You fell!';
      toast('You fell!', 'error');
      updateTowersPreview();
    } else if (res.reachedTop) {
      const cols = res.tower[0]?.dangerous?.length === 1 && res.tower.length <= 7 ? 4 : 3;
      renderTowersGrid(cols, res.tower.length, res.tower.length, res.tower);
      updateBalance(res.balance);
      towersGameId = null;
      document.getElementById('towers-start-btn').classList.remove('hidden');
      document.getElementById('towers-cashout-section').classList.add('hidden');
      document.getElementById('towers-potential-win').classList.remove('hidden');
      document.getElementById('towers-current-mult').textContent = res.multiplier + 'x';
      toast(`Reached the top! ${res.multiplier}x — +${res.payout} gems!`);
      updateTowersPreview();
    } else {
      document.getElementById('towers-current-mult').textContent = res.currentMultiplier + 'x';
      document.getElementById('towers-current-payout').textContent = res.currentPayout + ' gems';
      // Re-render with updated floor
      const floors = res.floorsLeft + res.currentFloor;
      renderTowersGrid(config.columns, floors, res.currentFloor);
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
    document.getElementById('towers-potential-win').classList.remove('hidden');
    document.getElementById('towers-current-mult').textContent = res.multiplier + 'x';
    toast(`Cashed out ${res.multiplier}x! +${res.payout} gems`);
    updateTowersPreview();
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

const PLINKO_ROWS = { low: 8, medium: 12, high: 16 };

function renderPlinkoBoard() {
  const pegsContainer = document.getElementById('plinko-pegs');
  if (!pegsContainer) return;
  pegsContainer.innerHTML = '';

  const rows = PLINKO_ROWS[plinkoRisk];
  for (let r = 0; r < rows; r++) {
    const row = document.createElement('div');
    row.className = 'plinko-peg-row';
    const pegsInRow = r + 2;
    for (let p = 0; p < pegsInRow; p++) {
      const peg = document.createElement('div');
      peg.className = 'plinko-peg';
      row.appendChild(peg);
    }
    pegsContainer.appendChild(row);
  }

  renderPlinkoBuckets();
}

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

function animatePlinkoBall(path, bucket, callback) {
  const pegsContainer = document.getElementById('plinko-pegs');
  const board = document.getElementById('plinko-board');
  if (!pegsContainer || !board) { callback(); return; }

  const rows = pegsContainer.querySelectorAll('.plinko-peg-row');
  if (rows.length === 0) { callback(); return; }

  const ball = document.createElement('div');
  ball.className = 'plinko-ball';
  board.style.position = 'relative';
  board.appendChild(ball);

  // Calculate peg positions relative to board
  const boardRect = board.getBoundingClientRect();
  const pegPositions = [];

  // Starting position — above first row, center
  const firstRow = rows[0];
  const firstRowRect = firstRow.getBoundingClientRect();
  const startX = firstRowRect.left + firstRowRect.width / 2 - boardRect.left - 7;
  const startY = firstRowRect.top - boardRect.top - 20;
  pegPositions.push({ x: startX, y: startY });

  // For each row, compute where ball goes based on path
  let position = 0; // which "slot" the ball is in (0 = leftmost)
  for (let r = 0; r < path.length; r++) {
    position += path[r]; // 0 = left, 1 = right
    const row = rows[r];
    if (!row) break;
    const pegs = row.querySelectorAll('.plinko-peg');
    // Ball position is between peg[position] and peg[position] based on direction
    const targetPeg = pegs[position];
    if (!targetPeg) break;
    const pegRect = targetPeg.getBoundingClientRect();
    const x = pegRect.left + pegRect.width / 2 - boardRect.left - 7;
    const y = pegRect.top + pegRect.height / 2 - boardRect.top - 7;
    pegPositions.push({ x, y });
  }

  // Add bucket final position
  const bucketEls = document.querySelectorAll('#plinko-buckets .plinko-bucket');
  if (bucketEls[bucket]) {
    const bRect = bucketEls[bucket].getBoundingClientRect();
    pegPositions.push({
      x: bRect.left + bRect.width / 2 - boardRect.left - 7,
      y: bRect.top - boardRect.top - 5
    });
  }

  let step = 0;
  ball.style.left = pegPositions[0].x + 'px';
  ball.style.top = pegPositions[0].y + 'px';

  function nextStep() {
    step++;
    if (step >= pegPositions.length) {
      setTimeout(() => {
        ball.remove();
        callback();
      }, 300);
      return;
    }
    ball.style.transition = 'left 0.12s ease-in, top 0.12s ease-in';
    ball.style.left = pegPositions[step].x + 'px';
    ball.style.top = pegPositions[step].y + 'px';
    setTimeout(nextStep, 130);
  }
  setTimeout(nextStep, 50);
}

let plinkoDropping = false;

async function playPlinko() {
  const amount = parseInt(document.getElementById('plinko-amount').value);
  if (!amount || amount < 1) return toast('Enter a valid bet', 'error');

  try {
    const res = await api.plinkoDrop(amount, plinkoRisk);
    updateBalance(res.balance);

    animatePlinkoBall(res.path, res.bucket, () => {
      // Highlight bucket
      const bucketEls = document.querySelectorAll('#plinko-buckets .plinko-bucket');
      if (bucketEls[res.bucket]) {
        bucketEls[res.bucket].classList.add('hit');
        bucketEls[res.bucket].style.background = res.won ? 'var(--accent)' : 'var(--danger)';
        bucketEls[res.bucket].style.color = '#000';
        // Reset after a moment
        setTimeout(() => {
          bucketEls[res.bucket].classList.remove('hit');
          renderPlinkoBuckets();
        }, 2000);
      }

      if (res.payout > amount) {
        toast(`${res.multiplier}x! +${res.payout} gems`);
      } else if (res.payout > 0) {
        toast(`${res.multiplier}x — ${res.payout} gems returned`, 'error');
      } else {
        toast(`Lost! 0x`, 'error');
      }
    });
  } catch (e) {
    toast(e.message, 'error');
  }
}

// --- Roulette ---
// American roulette layout: 38 slots
const ROULETTE_SEQUENCE = [];
(function buildRouletteSequence() {
  // Build a repeating strip: 18 red, 18 black, 2 green spread naturally
  // Using American roulette wheel order approximation
  const order = [
    'green','red','black','red','black','red','black','red','black','red','black',
    'black','red','black','red','black','red','black','red',
    'green','red','black','red','black','red','black','red','black','red','black',
    'black','red','black','red','black','red','black','red'
  ];
  for (let i = 0; i < order.length; i++) ROULETTE_SEQUENCE.push(order[i]);
})();

function buildRouletteStrip() {
  const strip = document.getElementById('rl-strip');
  strip.innerHTML = '';
  strip.style.transform = 'translateX(0)';
  strip.classList.remove('spinning');

  // Build 80 blocks (enough to scroll through)
  const totalBlocks = 80;
  for (let i = 0; i < totalBlocks; i++) {
    const color = ROULETTE_SEQUENCE[i % ROULETTE_SEQUENCE.length];
    const block = document.createElement('div');
    block.className = 'rl-block ' + color;
    const label = color === 'green' ? 'GREEN' : color.toUpperCase();
    const mult = color === 'green' ? '14x' : '1.90x';
    block.innerHTML = `<span>${label}</span><span class="rl-block-mult">${mult}</span>`;
    block.dataset.index = i;
    strip.appendChild(block);
  }
}

async function playRoulette() {
  const amount = parseInt(document.getElementById('rl-amount').value);
  if (!amount || amount < 1) return toast('Enter a valid bet', 'error');

  const strip = document.getElementById('rl-strip');
  const container = strip.parentElement;
  const statusEl = document.getElementById('rl-status');

  // Reset strip
  buildRouletteStrip();

  statusEl.textContent = 'Spinning...';

  try {
    const res = await api.rouletteBet(amount, rlChoice);
    updateBalance(res.balance);

    // Find the target block index (we want the winning color to land under pointer)
    // We need to scroll so the winning slot ends up at center
    const blockWidth = 74; // 70px + 4px gap
    const containerCenter = container.offsetWidth / 2;

    // Pick a target block far enough into the strip that we get a good spin
    // Find blocks matching the result color, pick one around index 55-65
    const blocks = strip.querySelectorAll('.rl-block');
    let targetIdx = 55;
    for (let i = 50; i < 70; i++) {
      if (ROULETTE_SEQUENCE[i % ROULETTE_SEQUENCE.length] === res.result) {
        targetIdx = i;
        break;
      }
    }

    const targetOffset = (targetIdx * blockWidth) + (blockWidth / 2) - containerCenter;

    // Animate
    requestAnimationFrame(() => {
      strip.classList.add('spinning');
      strip.style.transform = `translateX(-${targetOffset}px)`;
    });

    // After animation, highlight winner
    setTimeout(() => {
      blocks[targetIdx]?.classList.add('winner');
      if (res.won) {
        statusEl.innerHTML = `<span class="text-accent" style="font-weight:700;font-size:1.1rem;">${res.multiplier}x — +${res.payout} gems!</span>`;
        toast(`${res.multiplier}x! +${res.payout} gems`);
      } else {
        statusEl.innerHTML = `<span class="text-danger" style="font-weight:700;font-size:1.1rem;">Lost! Landed on ${res.result}</span>`;
        toast(`Landed on ${res.result}`, 'error');
      }
    }, 4200);
  } catch (e) {
    toast(e.message, 'error');
    statusEl.textContent = 'Pick a color and spin!';
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

// Watch choice changes to re-render visuals
const _selectChoice = selectChoice;
window.selectChoice = function(group, choice) {
  _selectChoice(group, choice);
  if (group === 'plinko-risk') renderPlinkoBoard();
  if (group === 'towers-diff') updateTowersPreview();
};

// Watch towers bet amount changes for potential win preview
document.addEventListener('DOMContentLoaded', () => {
  const towersInput = document.getElementById('towers-amount');
  if (towersInput) {
    towersInput.addEventListener('input', updateTowersPreview);
  }
});
