// GemRush API Client
const API_BASE = 'https://gemrush-api.taskautomateai.workers.dev';

class GemRushAPI {
  constructor() {
    this.token = localStorage.getItem('gr_token');
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('gr_token', token);
    } else {
      localStorage.removeItem('gr_token');
    }
  }

  async request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    if (options.adminKey) headers['X-Admin-Key'] = options.adminKey;

    const res = await fetch(`${API_BASE}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // Auth
  async register(email, password, username, roblox_username) {
    const data = await this.request('/api/auth/register', {
      method: 'POST',
      body: { email, password, username, roblox_username }
    });
    this.setToken(data.token);
    return data;
  }

  async login(email, password) {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: { email, password }
    });
    this.setToken(data.token);
    return data;
  }

  logout() {
    this.setToken(null);
    localStorage.removeItem('gr_user');
  }

  async getMe() {
    return this.request('/api/me');
  }

  // Games
  async coinflipPlay(amount, choice) {
    return this.request('/api/games/coinflip/play', { method: 'POST', body: { amount, choice } });
  }

  async crashBet(amount, autoCashout) {
    return this.request('/api/games/crash/bet', { method: 'POST', body: { amount, autoCashout } });
  }

  async crashCashout(gameId, cashoutAt) {
    return this.request('/api/games/crash/cashout', { method: 'POST', body: { gameId, cashoutAt } });
  }

  async minesStart(amount, mineCount) {
    return this.request('/api/games/mines/start', { method: 'POST', body: { amount, mineCount } });
  }

  async minesReveal(gameId, tileIndex) {
    return this.request('/api/games/mines/reveal', { method: 'POST', body: { gameId, tileIndex } });
  }

  async minesCashout(gameId) {
    return this.request('/api/games/mines/cashout', { method: 'POST', body: { gameId } });
  }

  async towersStart(amount, difficulty) {
    return this.request('/api/games/towers/start', { method: 'POST', body: { amount, difficulty } });
  }

  async towersPick(gameId, column) {
    return this.request('/api/games/towers/pick', { method: 'POST', body: { gameId, column } });
  }

  async towersCashout(gameId) {
    return this.request('/api/games/towers/cashout', { method: 'POST', body: { gameId } });
  }

  async plinkoDrop(amount, risk) {
    return this.request('/api/games/plinko/drop', { method: 'POST', body: { amount, risk } });
  }

  async rouletteBet(amount, choice) {
    return this.request('/api/games/roulette/bet', { method: 'POST', body: { amount, choice } });
  }

  async blackjackStart(amount) {
    return this.request('/api/games/blackjack/start', { method: 'POST', body: { amount } });
  }

  async blackjackAction(gameId, action) {
    return this.request('/api/games/blackjack/action', { method: 'POST', body: { gameId, action } });
  }

  // History
  async getBetHistory(page = 1, game = null) {
    let url = `/api/bets/history?page=${page}`;
    if (game) url += `&game=${game}`;
    return this.request(url);
  }

  // Withdrawals
  async requestWithdrawal(amount, roblox_username) {
    return this.request('/api/withdraw/request', { method: 'POST', body: { amount, roblox_username } });
  }

  async getWithdrawHistory() {
    return this.request('/api/withdraw/history');
  }
}

window.api = new GemRushAPI();
