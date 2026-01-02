// ========== MULTIPLAYER NETWORK LAYER ==========
// Use current hostname for LAN access (falls back to localhost for local dev)
const SERVER_HOST = window.location.hostname || 'localhost';
const SERVER_URL = `http://${SERVER_HOST}:5004`;
const WS_URL = `ws://${SERVER_HOST}:5004/ws`;
const CONNECTION_TIMEOUT = 8000; // 8 seconds timeout for connections

// Fetch with timeout wrapper
async function fetchWithTimeout(url, options = {}, timeout = CONNECTION_TIMEOUT) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    if (error.name === 'AbortError') {
      throw new Error('Connection timeout - server unreachable');
    }
    throw error;
  }
}

const NET = {
  token: null,
  ws: null,
  playerId: null,
  isOnline: false,
  isConnecting: false,
  isBanned: false,
  reconnectAttempts: 0,
  maxReconnectAttempts: 5,
  messageHandlers: {},
  syncInterval: null,

  // Initialize network connection
  async init() {
    // Check if this account was banned
    if (localStorage.getItem('arena_banned') === 'true') {
      this.showBannedScreen();
      return false;
    }

    this.updateConnectionStatus('connecting');
    const savedToken = localStorage.getItem('arena_token');
    if (savedToken) {
      this.token = savedToken;
      try {
        const result = await this.api('/api/auth/validate', 'POST');
        if (result.valid) {
          this.playerId = result.player.id;
          await this.connectWebSocket();
          await this.loadPlayerData(result.player);
          this.hideLoginScreen();
          this.startSyncInterval();
          return true;
        }
      } catch (e) {
        console.log('Token validation failed:', e);
        localStorage.removeItem('arena_token');
        this.token = null;
        // Check if banned
        if (e.message && e.message.includes('banned')) {
          this.showBannedScreen();
          return false;
        }
      }
    }
    this.updateConnectionStatus('offline');
    return false;
  },

  showBannedScreen() {
    // Mark as banned to prevent reconnection attempts
    this.isBanned = true;

    // Hide all game UI
    const gameApp = document.querySelector('.app');
    const loginScreen = document.getElementById('loginScreen');
    if (gameApp) gameApp.style.display = 'none';
    if (loginScreen) loginScreen.style.display = 'none';

    // Clear token and mark as banned in localStorage
    localStorage.removeItem('arena_token');
    localStorage.setItem('arena_banned', 'true');
    this.token = null;
    this.isOnline = false;

    // Close WebSocket if open
    if (this.ws) {
      try { this.ws.close(); } catch(e) {}
      this.ws = null;
    }

    // Create full-screen banned overlay
    let bannedScreen = document.getElementById('bannedScreen');
    if (!bannedScreen) {
      bannedScreen = document.createElement('div');
      bannedScreen.id = 'bannedScreen';
      document.body.appendChild(bannedScreen);
    }
    bannedScreen.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:linear-gradient(135deg,#1a0a0a 0%,#2d1010 50%,#1a0a0a 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99999;font-family:Arial,sans-serif;overflow:hidden';
    bannedScreen.innerHTML = `
      <style>
        @keyframes banPulse { 0%,100%{transform:scale(1);opacity:0.8} 50%{transform:scale(1.1);opacity:1} }
        @keyframes banGlow { 0%,100%{box-shadow:0 0 60px rgba(231,76,60,0.4)} 50%{box-shadow:0 0 100px rgba(231,76,60,0.7)} }
        @keyframes banShake { 0%,100%{transform:translateX(0)} 10%,30%,50%,70%,90%{transform:translateX(-5px)} 20%,40%,60%,80%{transform:translateX(5px)} }
        .ban-icon { font-size:120px;animation:banPulse 2s ease-in-out infinite;filter:drop-shadow(0 0 30px rgba(231,76,60,0.8)) }
        .ban-title { font-size:48px;font-weight:900;color:#e74c3c;text-shadow:0 0 30px rgba(231,76,60,0.8);margin:20px 0;letter-spacing:8px }
        .ban-subtitle { font-size:18px;color:#ff6b6b;margin-bottom:10px }
        .ban-message { font-size:14px;color:#888;max-width:400px;text-align:center;line-height:1.6;margin-bottom:40px }
        .ban-box { background:rgba(0,0,0,0.5);border:2px solid #e74c3c;border-radius:20px;padding:50px;text-align:center;animation:banGlow 3s ease-in-out infinite }
        .ban-btn { padding:15px 40px;background:linear-gradient(180deg,#444,#222);border:2px solid #555;border-radius:10px;color:#fff;font-weight:800;font-size:14px;cursor:pointer;transition:all 0.3s;text-transform:uppercase;letter-spacing:2px }
        .ban-btn:hover { background:linear-gradient(180deg,#555,#333);border-color:#777;transform:translateY(-2px) }
        .ban-particles { position:absolute;width:100%;height:100%;overflow:hidden;pointer-events:none }
        .ban-particle { position:absolute;width:4px;height:4px;background:#e74c3c;border-radius:50%;opacity:0.3;animation:float 10s infinite }
        @keyframes float { 0%{transform:translateY(100vh) rotate(0deg);opacity:0} 10%{opacity:0.3} 90%{opacity:0.3} 100%{transform:translateY(-100vh) rotate(720deg);opacity:0} }
      </style>
      <div class="ban-particles" id="banParticles"></div>
      <div class="ban-box">
        <div class="ban-icon">🚫</div>
        <div class="ban-title">BANNED</div>
        <div class="ban-subtitle">Account Permanently Suspended</div>
        <div class="ban-message">
          Your account has been banned from Arena Royale for violating our terms of service.<br><br>
          If you believe this was a mistake, please contact support.
        </div>
      </div>
      `;
    // Add particles via JavaScript instead of inline script
    const banParticles = bannedScreen.querySelector('#banParticles');
    if (banParticles) {
      for (let i = 0; i < 30; i++) {
        const p = document.createElement('div');
        p.className = 'ban-particle';
        p.style.left = Math.random() * 100 + '%';
        p.style.animationDelay = Math.random() * 10 + 's';
        p.style.animationDuration = (8 + Math.random() * 10) + 's';
        banParticles.appendChild(p);
      }
    }
  },

  showDisconnectWarning() {
    // Don't show if already showing or if we just started
    if (document.getElementById('disconnectWarning')) return;

    const warning = document.createElement('div');
    warning.id = 'disconnectWarning';
    warning.style.cssText = 'position:fixed;top:0;left:0;right:0;background:linear-gradient(180deg,#e74c3c,#c0392b);padding:12px;text-align:center;z-index:9999;animation:slideDown 0.3s ease';
    warning.innerHTML = `
      <div style="font-weight:900;font-size:14px;margin-bottom:4px">⚠️ SERVER DISCONNECTED</div>
      <div style="font-size:11px;opacity:0.9">Your progress may be reset if not saved. Attempting to reconnect...</div>
    `;
    document.body.appendChild(warning);

    // Add animation style if not exists
    if (!document.getElementById('disconnectStyle')) {
      const style = document.createElement('style');
      style.id = 'disconnectStyle';
      style.textContent = '@keyframes slideDown{from{transform:translateY(-100%)}to{transform:translateY(0)}}';
      document.head.appendChild(style);
    }
  },

  hideDisconnectWarning() {
    const warning = document.getElementById('disconnectWarning');
    if (warning) warning.remove();
  },

  // REST API calls
  async api(endpoint, method = 'GET', data = null) {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      }
    };
    if (this.token) {
      options.headers['Authorization'] = `Bearer ${this.token}`;
    }
    if (data) options.body = JSON.stringify(data);

    const response = await fetch(`${SERVER_URL}${endpoint}`, options);
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Request failed');
    }
    return result;
  },

  // WebSocket connection
  async connectWebSocket() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(WS_URL);

        this.ws.onopen = () => {
          this.ws.send(JSON.stringify({ type: 'auth', data: { token: this.token } }));
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'auth_ok') {
              this.isOnline = true;
              this.isConnecting = false;
              this.reconnectAttempts = 0;
              this.updateConnectionStatus('online');
              this.hideDisconnectWarning();
              this.updateOnlineIndicator();
              resolve();
            } else if (msg.type === 'auth_error') {
              this.updateConnectionStatus('offline');
              // Check if error is due to ban
              if (msg.data.banned) {
                this.showBannedScreen();
              }
              reject(new Error(msg.data.error));
            } else if (this.messageHandlers[msg.type]) {
              this.messageHandlers[msg.type](msg.data);
            }
          } catch (e) {
            console.error('WebSocket message error:', e);
          }
        };

        this.ws.onclose = () => {
          this.isOnline = false;
          this.updateConnectionStatus('offline');
          // Don't show warning or reconnect if banned
          if (!this.isBanned) {
            this.showDisconnectWarning();
            this.attemptReconnect();
          }
        };

        this.ws.onerror = (err) => {
          console.error('WebSocket error:', err);
          this.updateConnectionStatus('offline');
        };

        // Timeout after 5 seconds
        setTimeout(() => {
          if (this.isConnecting) {
            reject(new Error('Connection timeout'));
          }
        }, 5000);

      } catch (e) {
        reject(e);
      }
    });
  },

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts && this.token) {
      this.reconnectAttempts++;
      console.log(`Reconnecting... attempt ${this.reconnectAttempts}`);
      setTimeout(() => {
        this.connectWebSocket().catch(console.error);
      }, 2000 * this.reconnectAttempts);
    }
  },

  send(type, data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data, token: this.token }));
    }
  },

  on(type, handler) {
    this.messageHandlers[type] = handler;
  },

  // Auth methods
  async register(username, password) {
    const result = await this.api('/api/auth/register', 'POST', { username, password });
    this.token = result.token;
    this.playerId = result.player.id;
    localStorage.setItem('arena_token', this.token);
    await this.connectWebSocket();
    await this.loadPlayerData(result.player);
    this.startSyncInterval();
    return result.player;
  },

  async login(username, password) {
    const result = await this.api('/api/auth/login', 'POST', { username, password });
    this.token = result.token;
    this.playerId = result.player.id;
    localStorage.setItem('arena_token', this.token);
    localStorage.removeItem('arena_banned'); // Clear ban flag on successful login
    await this.connectWebSocket();
    await this.loadPlayerData(result.player);
    this.startSyncInterval();
    return result.player;
  },

  async guestLogin() {
    const result = await this.api('/api/auth/guest', 'POST');
    this.token = result.token;
    this.playerId = result.player.id;
    localStorage.setItem('arena_token', this.token);
    localStorage.setItem('arena_guest', 'true');
    await this.connectWebSocket();
    await this.loadPlayerData(result.player);
    this.startSyncInterval();
    return result.player;
  },

  logout() {
    this.token = null;
    this.playerId = null;
    this.isOnline = false;
    localStorage.removeItem('arena_token');
    localStorage.removeItem('arena_guest');
    if (this.ws) this.ws.close();
    if (this.syncInterval) clearInterval(this.syncInterval);
    showLoginScreen();
  },

  // Load player data from server
  async loadPlayerData(serverPlayer) {
    // Merge server data with local format
    if (serverPlayer.profile) {
      P.name = serverPlayer.profile.name || P.name;
    }
    if (serverPlayer.stats) {
      P.tr = serverPlayer.stats.trophies || 0;
      P.wins = serverPlayer.stats.wins || 0;
      P.losses = serverPlayer.stats.losses || 0;
      P.crowns = serverPlayer.stats.crowns || 0;
      P.maxStr = serverPlayer.stats.max_streak || 0;
      P.medals = serverPlayer.stats.medals || 0;
      P.compWins = serverPlayer.stats.comp_wins || 0;
      P.compLosses = serverPlayer.stats.comp_losses || 0;
      P.compTrophies = serverPlayer.stats.comp_trophies || 0;
    }
    if (serverPlayer.resources) {
      P.gold = serverPlayer.resources.gold || 0;
      P.gems = serverPlayer.resources.gems || 0;
      P.crystals = serverPlayer.resources.crystals || 0;
      P.starPoints = serverPlayer.resources.star_points || 0;
    }
    if (serverPlayer.cards) {
      if (serverPlayer.cards.unlocked) P.unlocked = serverPlayer.cards.unlocked;
      if (serverPlayer.cards.levels) P.lvls = serverPlayer.cards.levels;
      if (serverPlayer.cards.shards) P.shards = serverPlayer.cards.shards;
    }
    if (serverPlayer.decks) {
      P.decks = serverPlayer.decks;
      P.deck = P.decks[serverPlayer.current_deck || 0] || P.deck;
    }
    if (serverPlayer.clan_id) {
      // Fetch full clan data from server
      try {
        const clanData = await this.api(`/api/clan/${serverPlayer.clan_id}`);
        if (clanData.clan) {
          P.clan = clanData.clan;
          P.clanId = serverPlayer.clan_id;
          // Subscribe to clan chat channel
          if(typeof subscribeToClanChannel==='function')subscribeToClanChannel();
        }
      } catch (e) {
        console.log('Failed to fetch clan data:', e);
        P.clan = null;
        P.clanId = null;
      }
    } else {
      P.clan = null;
      P.clanId = null;
    }
    // Sync admin status from server
    P.admin = serverPlayer.admin === true;
    save();
  },

  // Sync player data to server
  async syncPlayer() {
    if (!this.isOnline || !this.playerId) return;
    try {
      const syncData = {
        stats: {
          trophies: P.tr || 0,
          wins: P.wins || 0,
          losses: P.losses || 0,
          crowns: P.crowns || 0,
          max_streak: P.maxStr || 0,
          medals: P.medals || 0,
          comp_wins: P.compWins || 0,
          comp_losses: P.compLosses || 0,
          comp_trophies: P.compTrophies || 0,
        },
        resources: {
          gold: P.gold || 0,
          gems: P.gems || 0,
          crystals: P.crystals || 0,
          star_points: P.starPoints || 0,
        },
        cards: {
          unlocked: P.unlocked || [],
          levels: P.lvls || {},
          shards: P.shards || {},
        },
        decks: P.decks || [],
        current_deck: P.decks ? P.decks.indexOf(P.deck) : 0,
        profile: {
          name: P.name,
        }
      };
      await this.api(`/api/player/${this.playerId}/sync`, 'POST', syncData);
    } catch (e) {
      console.error('Sync failed:', e);
    }
  },

  startSyncInterval() {
    if (this.syncInterval) clearInterval(this.syncInterval);
    this.syncInterval = setInterval(() => {
      this.syncPlayer();
    }, 30000); // Sync every 30 seconds
  },

  updateConnectionStatus(status) {
    const el = document.getElementById('connectionStatus');
    if (!el) return;
    if (status === 'online') {
      el.innerHTML = '<span class="status-dot online"></span> Connected';
    } else if (status === 'connecting') {
      el.innerHTML = '<span class="status-dot connecting"></span> Connecting...';
    } else {
      el.innerHTML = '<span class="status-dot"></span> Offline';
    }
  },

  updateOnlineIndicator() {
    const indicator = document.getElementById('onlineIndicator');
    if (indicator) {
      indicator.style.display = this.isOnline ? 'flex' : 'none';
    }
  },

  hideLoginScreen() {
    const screen = document.getElementById('loginScreen');
    if (screen) screen.classList.add('hidden');
  },

  showLoginScreen() {
    const screen = document.getElementById('loginScreen');
    if (screen) screen.classList.remove('hidden');
  }
};

// Setup WebSocket message handlers
NET.on('online_count', (data) => {
  const countEl = document.getElementById('onlineCount');
  if (countEl) {
    countEl.textContent = `${data.count} Online`;
  }
});

NET.on('online_players', (data) => {
  showOnlinePlayersModal(data.players);
});

NET.on('challenge_received', (data) => {
  showChallengeReceivedModal(data);
});

NET.on('challenge_sent', (data) => {
  showNotify('Challenge sent! Waiting for response...', 'info', '⚔️');
});

NET.on('challenge_accepted', (data) => {
  console.log('Challenge accepted event received:', data);
  closePvpModals();
  showNotify('Challenge accepted! Starting battle...', 'success', '⚔️');
  startMultiplayerBattle(data);
});

NET.on('challenge_declined', (data) => {
  showNotify('Challenge was declined', 'info', '❌');
});

NET.on('challenge_cancelled', (data) => {
  closePvpModals();
  showNotify('Challenge was cancelled', 'info', '❌');
});

NET.on('challenge_failed', (data) => {
  showNotify(data.error || 'Challenge failed', 'error', '❌');
});

// Handle account banned - immediately show banned screen
NET.on('account_banned', (data) => {
  console.log('Account banned:', data);
  // Stop any ongoing battle
  if (B && B.on) {
    B.on = false;
    if (B.loop) cancelAnimationFrame(B.loop);
  }
  // Hide disconnect warning if showing
  NET.hideDisconnectWarning();
  // Clear token and show banned screen
  localStorage.removeItem('arena_token');
  NET.token = null;
  NET.showBannedScreen();
});

NET.on('queue_status', (data) => {
  const status = document.getElementById('matchmakingStatus');
  if (status) {
    status.textContent = `Position: ${data.position} | ~${Math.round(data.estimated_wait)}s wait`;
  }
});

NET.on('match_found', (data) => {
  hideMatchmakingOverlay();
  startMultiplayerBattle(data);
});

NET.on('battle_start', (data) => {
  console.log('Battle started:', data);
  if (typeof B !== 'undefined' && B.isMultiplayer) {
    B.startTime = data.start_time;
    B.duration = data.duration;
  }
});

NET.on('battle_action', (data) => {
  if (typeof B !== 'undefined' && B.isMultiplayer) {
    handleOpponentAction(data);
  }
});

NET.on('battle_state', (data) => {
  if (typeof B !== 'undefined' && B.isMultiplayer) {
    syncBattleState(data);
  }
});

NET.on('battle_result', async (data) => {
  console.log('Battle result received:', data);
  if (typeof B !== 'undefined' && B.isMultiplayer) {
    B.on = false;
    if (B.loop) cancelAnimationFrame(B.loop);
    await applyBattleResult(data.your_result);
    showMultiplayerBattleResult(data);
  }
});

NET.on('chat_message', (data) => {
  if (data.channel === 'clan' && P.clan) {
    if (!P.clan.chatHistory) P.clan.chatHistory = [];
    P.clan.chatHistory.push({
      sender: data.sender_name,
      msg: data.message,
      time: data.timestamp * 1000
    });
    if (P.clan.chatHistory.length > 100) P.clan.chatHistory.shift();
    if (typeof updateClanChat === 'function') updateClanChat();
  }
});

// Login/Register Functions
function showLoginForm() {
  document.getElementById('loginForm').style.display = 'block';
  document.getElementById('registerForm').style.display = 'none';
  document.getElementById('loginError').textContent = '';
}

function showRegisterForm() {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('registerForm').style.display = 'block';
  document.getElementById('loginError').textContent = '';
}

function showLoginScreen() {
  NET.showLoginScreen();
  showLoginForm();
}

function confirmLogout() {
  // Create confirmation modal
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:1000';
  modal.innerHTML = `
    <div style="background:linear-gradient(180deg,#1b2838,#0d1b2a);border:3px solid #e74c3c;border-radius:16px;padding:25px;text-align:center;max-width:300px">
      <div style="font-size:40px;margin-bottom:10px">🚪</div>
      <div style="font-size:18px;font-weight:800;margin-bottom:10px">LOG OUT?</div>
      <div style="font-size:12px;color:#888;margin-bottom:20px">Are you sure you want to log out?</div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button onclick="this.closest('.modal-overlay').remove()" style="padding:10px 25px;background:linear-gradient(180deg,#555,#333);border:none;border-radius:8px;color:#fff;font-weight:800;cursor:pointer">Cancel</button>
        <button onclick="this.closest('.modal-overlay').remove();NET.logout()" style="padding:10px 25px;background:linear-gradient(180deg,#e74c3c,#c0392b);border:none;border-radius:8px;color:#fff;font-weight:800;cursor:pointer">Log Out</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function doLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');

  if (!username || !password) {
    errorEl.textContent = 'Please enter username and password';
    return;
  }

  try {
    errorEl.textContent = '';
    NET.updateConnectionStatus('connecting');
    await NET.login(username, password);
    NET.hideLoginScreen();
    showNotify('Welcome back, ' + P.name + '!', 'success');
    if (typeof updateAll === 'function') updateAll();
  } catch (e) {
    // Check if banned
    if (e.message && e.message.includes('banned')) {
      NET.showBannedScreen();
    } else {
      errorEl.textContent = e.message || 'Login failed';
    }
    NET.updateConnectionStatus('offline');
  }
}

async function doRegister() {
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirm = document.getElementById('regConfirm').value;
  const errorEl = document.getElementById('loginError');

  if (!username || !password) {
    errorEl.textContent = 'Please fill in all fields';
    return;
  }
  if (password !== confirm) {
    errorEl.textContent = 'Passwords do not match';
    return;
  }
  if (password.length < 6) {
    errorEl.textContent = 'Password must be at least 6 characters';
    return;
  }

  try {
    errorEl.textContent = '';
    NET.updateConnectionStatus('connecting');
    await NET.register(username, password);
    NET.hideLoginScreen();
    showNotify('Account created! Welcome, ' + P.name + '!', 'success');
    if (typeof updateAll === 'function') updateAll();
  } catch (e) {
    errorEl.textContent = e.message || 'Registration failed';
    NET.updateConnectionStatus('offline');
  }
}

async function doGuestLogin() {
  const errorEl = document.getElementById('loginError');
  try {
    errorEl.textContent = '';
    NET.updateConnectionStatus('connecting');
    await NET.guestLogin();
    NET.hideLoginScreen();
    showNotify('Playing as guest. Create an account to save progress!', 'info');
    if (typeof updateAll === 'function') updateAll();
  } catch (e) {
    errorEl.textContent = e.message || 'Failed to connect';
    NET.updateConnectionStatus('offline');
  }
}

// Matchmaking UI
function showMatchmakingOverlay() {
  document.getElementById('matchmakingOverlay').classList.remove('hidden');
}

function hideMatchmakingOverlay() {
  document.getElementById('matchmakingOverlay').classList.add('hidden');
}

function cancelMatchmaking() {
  NET.send('queue_leave', {});
  hideMatchmakingOverlay();
}

// Multiplayer battle functions
function startMultiplayerBattle(matchData) {
  // Store opponent info
  window.multiplayerOpponent = matchData.opponent || {
    name: matchData.opponent_name,
    trophies: matchData.opponent_trophies
  };
  window.multiplayerBattleId = matchData.battle_id;
  window.multiplayerRole = matchData.you_are || 'player1';

  console.log('Starting multiplayer battle:', matchData);

  // Start battle with opponent data
  startBattleWithOpponent(matchData);
}

function startBattleWithOpponent(matchData) {
  console.log('startBattleWithOpponent called with:', matchData);

  // Fill deck if needed
  if (P.deck.length < 8) randomDeck();

  const opponentName = matchData.opponent_name || matchData.opponent?.name || 'Opponent';
  const opponentTrophies = matchData.opponent_trophies || matchData.opponent?.trophies || 0;
  console.log('Opponent:', opponentName, 'Trophies:', opponentTrophies);

  // Initialize battle state for multiplayer
  B = {
    on: true,
    isMultiplayer: true,
    battleId: matchData.battle_id,
    myRole: matchData.you_are || 'player1',
    elixir: 5,
    botElixir: 5,
    hand: [],
    queue: [...P.deck].sort(() => 0.5 - Math.random()),
    next: null,
    sel: -1,
    troops: [],
    buildings: [],
    elixirPumps: [],
    towers: {
      pL: { hp: getPrincessHP(), max: getPrincessHP(), dead: 0 },
      pR: { hp: getPrincessHP(), max: getPrincessHP(), dead: 0 },
      pK: { hp: getKingTowerHP(), max: getKingTowerHP(), dead: 0 },
      aL: { hp: getPrincessHP(), max: getPrincessHP(), dead: 0 },
      aR: { hp: getPrincessHP(), max: getPrincessHP(), dead: 0 },
      aK: { hp: getKingTowerHP(), max: getKingTowerHP(), dead: 0 }
    },
    tCD: { pL: 0, pR: 0, pK: 0, aL: 0, aR: 0, aK: 0 },
    kingOn: { p: 0, a: 0 },
    crowns: { me: 0, ai: 0 },
    time: 0,
    arena: getArena(P.tr),
    botLvl: 1,
    botMult: 1,
    botCards: [],
    botHand: [],
    botQueue: [],
    loop: null,
    gameMode: 'pvp',
    spellEffects: [],
    troopPoisons: [],
    cardCycle: [],
    opponentName: opponentName,
    opponentTrophies: opponentTrophies
  };

  // Fill hand
  for (let i = 0; i < 4; i++) B.hand.push(B.queue.shift());
  B.next = B.queue.shift();

  // Show battle UI
  document.getElementById('battle').classList.add('on');
  try {
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  } catch (e) {}

  renderArena();

  // Tell server we're ready
  NET.send('battle_ready', { battle_id: matchData.battle_id });

  // Start the game loop
  startLoop();
}

function handleOpponentAction(data) {
  if (!B || !B.on || !B.isMultiplayer) return;

  const action = data.action;
  if (!action) return;

  console.log('Opponent action:', action);

  // Handle troop spawn
  if (action.type === 'spawn_troop') {
    const card = getCard(action.card_id);
    if (card) {
      const lvlCard = { ...card, hp: card.hp, dmg: card.dmg, lvl: action.level || 1 };
      // Flip coordinates for opponent (mirror Y axis)
      const a = document.getElementById('arena');
      const mirrorY = a.offsetHeight - action.y;
      spawnTroopForOpponent(lvlCard, action.x, mirrorY, action.lane);
    }
  }

  // Handle spell cast
  if (action.type === 'cast_spell') {
    const card = getCard(action.card_id);
    if (card) {
      const a = document.getElementById('arena');
      const mirrorY = a.offsetHeight - action.y;
      castSpellForOpponent(card, action.x, mirrorY);
    }
  }

  // Handle building spawn
  if (action.type === 'spawn_building') {
    const card = getCard(action.card_id);
    if (card) {
      const a = document.getElementById('arena');
      const mirrorY = a.offsetHeight - action.y;
      spawnBuildingForOpponent(card, action.x, mirrorY, action.lane);
    }
  }
}

function spawnTroopForOpponent(card, x, y, lane) {
  const a = document.getElementById('arena');
  const cnt = card.cnt || 1;

  const fx = document.createElement('div');
  fx.className = 'spawn-effect ai';
  fx.style.left = (x - 20) + 'px';
  fx.style.top = (y - 20) + 'px';
  a.appendChild(fx);
  setTimeout(() => fx.remove(), 400);

  for (let i = 0; i < cnt; i++) {
    const ox = cnt > 1 ? (i - (cnt - 1) / 2) * 12 : 0;
    const tx = Math.max(10, Math.min(a.offsetWidth - 10, x + ox));
    const ty = y + (Math.random() - 0.5) * 6;

    const el = document.createElement('div');
    el.className = 'troop ai' + (card.fly ? ' fly' : '');
    el.style.left = tx + 'px';
    el.style.top = ty + 'px';
    el.innerHTML = `<div class="sprite">${card.icon}</div><div class="hp-bar"><div class="hp-fill" style="width:100%"></div></div>`;
    a.appendChild(el);

    B.troops.push({
      el, x: tx, y: ty, lane,
      hp: card.hp, maxHp: card.hp, dmg: card.dmg,
      spd: card.spd, rng: (card.rng || 1) * 16, as: card.as || 1,
      side: 'ai', card, cd: 0, charge: 0, chargeBuildup: 0, stun: 0, hitCount: 0, abilityUsed: false
    });
  }
}

function castSpellForOpponent(card, x, y) {
  // Handle opponent spells (simplified - reuse existing spell logic)
  const a = document.getElementById('arena');
  const r = card.radius * 16;

  // Visual effect
  const fx = document.createElement('div');
  fx.className = 'spell-effect';
  fx.style.left = (x - r) + 'px';
  fx.style.top = (y - r) + 'px';
  fx.style.width = (r * 2) + 'px';
  fx.style.height = (r * 2) + 'px';
  a.appendChild(fx);
  setTimeout(() => fx.remove(), 500);

  // Apply spell damage to player troops
  if (card.dmg) {
    B.troops.filter(t => t.side === 'player').forEach(t => {
      const dx = t.x - x, dy = t.y - y;
      if (Math.sqrt(dx * dx + dy * dy) <= r) {
        t.hp -= card.dmg;
      }
    });
  }
}

function spawnBuildingForOpponent(card, x, y, lane) {
  const a = document.getElementById('arena');

  const fx = document.createElement('div');
  fx.className = 'spawn-effect ai';
  fx.style.left = (x - 20) + 'px';
  fx.style.top = (y - 20) + 'px';
  a.appendChild(fx);
  setTimeout(() => fx.remove(), 400);

  const el = document.createElement('div');
  el.className = 'building ai';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.innerHTML = `<div class="sprite" style="font-size:28px">${card.icon}</div><div class="hp-bar"><div class="hp-fill" style="width:100%"></div></div>`;
  a.appendChild(el);

  if (!B.buildings) B.buildings = [];
  B.buildings.push({
    el, x, y, lane,
    hp: card.hp, maxHp: card.hp, dmg: card.dmg || 0,
    rng: card.rng || 5, as: card.as || 1, air: card.air || 0,
    side: 'ai', card, cd: 0, icon: card.icon,
    lifetime: card.lifetime || 0, remaining: card.lifetime || 0
  });
}

// Send troop spawn to server for multiplayer sync
function sendTroopSpawn(card, x, y, lane) {
  if (B && B.isMultiplayer) {
    NET.send('battle_action', {
      battle_id: B.battleId,
      action: {
        type: 'spawn_troop',
        card_id: card.id,
        level: card.lvl || 1,
        x: x,
        y: y,
        lane: lane
      }
    });
  }
}

// Send spell cast to server for multiplayer sync
function sendSpellCast(card, x, y) {
  if (B && B.isMultiplayer) {
    NET.send('battle_action', {
      battle_id: B.battleId,
      action: {
        type: 'cast_spell',
        card_id: card.id,
        x: x,
        y: y
      }
    });
  }
}

// Send building spawn to server for multiplayer sync
function sendBuildingSpawn(card, x, y, lane) {
  if (B && B.isMultiplayer) {
    NET.send('battle_action', {
      battle_id: B.battleId,
      action: {
        type: 'spawn_building',
        card_id: card.id,
        x: x,
        y: y,
        lane: lane
      }
    });
  }
}

// Send battle end to server (for multiplayer wins)
function sendBattleEnd(iWon) {
  if (B && B.isMultiplayer && B.battleId) {
    console.log('Sending battle end, I won:', iWon);
    // Stop the game loop
    B.on = false;
    if (B.loop) cancelAnimationFrame(B.loop);

    // Send tower damage to finalize the battle state
    const myRole = B.myRole || 'player1';
    NET.send('tower_damage', {
      battle_id: B.battleId,
      target: 'king',
      damage: 9999,
      target_player: iWon ? (myRole === 'player1' ? 'player2' : 'player1') : myRole
    });
  }
}

function syncBattleState(data) {
  if (!B || !B.on) return;

  // Sync tower HP from server
  const myRole = B.myRole || 'player1';
  const myHP = myRole === 'player1' ? data.player1_hp : data.player2_hp;
  const enemyHP = myRole === 'player1' ? data.player2_hp : data.player1_hp;

  if (myHP) {
    B.towers.pK.hp = myHP.king;
    B.towers.pL.hp = myHP.left;
    B.towers.pR.hp = myHP.right;
  }
  if (enemyHP) {
    B.towers.aK.hp = enemyHP.king;
    B.towers.aL.hp = enemyHP.left;
    B.towers.aR.hp = enemyHP.right;
  }

  // Update crown display
  const myCrowns = myRole === 'player1' ? data.player1_crowns : data.player2_crowns;
  const enemyCrowns = myRole === 'player1' ? data.player2_crowns : data.player1_crowns;

  B.crowns.me = myCrowns || 0;
  B.crowns.ai = enemyCrowns || 0;

  document.getElementById('myCrowns').textContent = B.crowns.me;
  document.getElementById('aiCrowns').textContent = B.crowns.ai;
}

async function applyBattleResult(result) {
  P.tr = Math.max(0, (P.tr || 0) + (result.trophy_change || 0));
  P.gold = (P.gold || 0) + (result.gold_earned || 0);
  if (result.won) {
    P.wins = (P.wins || 0) + 1;
  } else {
    P.losses = (P.losses || 0) + 1;
  }
  P.crowns = (P.crowns || 0) + (result.crowns || 0);
  save();
  await NET.syncPlayer();
}

function showBattleResultScreen(data) {
  // Show battle result notification
  const result = data.your_result;
  if (result.won) {
    showNotify(`Victory! +${result.trophy_change} trophies, +${result.gold_earned} gold`, 'success');
  } else {
    showNotify(`Defeat! ${result.trophy_change} trophies`, 'error');
  }
}

function showMultiplayerBattleResult(data) {
  const result = data.your_result;
  const won = result.won;
  const crowns = result.crowns || 0;

  // Remove battle UI
  document.getElementById('battle').classList.remove('on');
  try {
    if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
  } catch (e) {}

  // Show result overlay
  const ov = document.createElement('div');
  ov.className = 'result-overlay';
  ov.innerHTML = `
    <div class="result-title ${won ? 'win' : 'lose'}">${won ? '🏆 VICTORY!' : '💀 DEFEAT!'}</div>
    <div style="color:#e74c3c;font-size:14px;font-weight:900;margin-bottom:10px">⚔️ PVP BATTLE</div>
    <div style="color:#fff;font-size:12px;margin-bottom:10px">vs ${window.multiplayerOpponent?.name || 'Opponent'}</div>
    <div class="result-crowns">
      <span class="crown ${crowns >= 1 ? 'earned' : ''}">👑</span>
      <span class="crown ${crowns >= 2 ? 'earned' : ''}">👑</span>
      <span class="crown ${crowns >= 3 ? 'earned' : ''}">👑</span>
    </div>
    <div style="margin:15px 0;font-size:12px">
      <div style="color:${result.trophy_change >= 0 ? '#2ecc71' : '#e74c3c'}">🏆 ${result.trophy_change >= 0 ? '+' : ''}${result.trophy_change} Trophies</div>
      <div style="color:#f1c40f">💰 +${result.gold_earned} Gold</div>
    </div>
    <div class="result-btns">
      <button class="result-btn primary" onclick="closeResult()">🏠 Menu</button>
    </div>
  `;
  document.body.appendChild(ov);
  playSound(won ? 'victory' : 'defeat');
}

// Initialize network on page load
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const loggedIn = await NET.init();
    if (!loggedIn) {
      NET.showLoginScreen();
    }
  } catch (e) {
    console.error('Network init failed:', e);
    NET.showLoginScreen();
  }
});

// Responsive Scaling System - Auto-adjust for any screen size
(function initResponsiveScaling() {
  const BASE_WIDTH = 375; // Design base width (iPhone SE)
  const BASE_HEIGHT = 667; // Design base height
  const MIN_SCALE = 0.5;
  const MAX_SCALE = 1.2;

  function applyResponsiveScale() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Calculate scale based on width (primary) and height (secondary)
    const scaleX = vw / BASE_WIDTH;
    const scaleY = vh / BASE_HEIGHT;

    // Use the smaller scale to ensure everything fits, with limits
    let scale = Math.min(scaleX, scaleY);
    scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));

    // For very small screens, allow more aggressive scaling
    if (vw < 320) {
      scale = Math.max(0.5, vw / BASE_WIDTH);
    }

    // Apply scale via CSS custom property
    document.documentElement.style.setProperty('--app-scale', scale.toFixed(3));

    // Apply transform to app container
    const app = document.querySelector('.app');
    if (app && scale < 1) {
      app.style.transform = `scale(${scale})`;
      app.style.transformOrigin = 'top center';
      app.style.width = `${100 / scale}%`;
      app.style.height = `${100 / scale}%`;
    } else if (app) {
      app.style.transform = '';
      app.style.width = '';
      app.style.height = '';
    }

    // Also scale fixed elements like nav
    const nav = document.querySelector('.nav');
    if (nav && scale < 1) {
      nav.style.transform = `scale(${scale})`;
      nav.style.transformOrigin = 'bottom center';
      nav.style.width = `${100 / scale}%`;
      nav.style.left = `${(100 - 100 / scale) / 2}%`;
    } else if (nav) {
      nav.style.transform = '';
      nav.style.width = '';
      nav.style.left = '';
    }

    // Scale modals
    const loginBox = document.querySelector('.login-box');
    if (loginBox && scale < 0.9) {
      loginBox.style.transform = `scale(${Math.max(0.7, scale)})`;
    } else if (loginBox) {
      loginBox.style.transform = '';
    }
  }

  // Apply on load and resize
  window.addEventListener('resize', applyResponsiveScale);
  window.addEventListener('orientationchange', () => setTimeout(applyResponsiveScale, 100));
  applyResponsiveScale();

  // Re-apply after a short delay to catch any late layout changes
  setTimeout(applyResponsiveScale, 500);
})();

// In-Game Toast Notification System
function showNotify(message, type = 'default', icon = null, duration = 3500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  // Parse message for title and body
  let title = '', msg = message;
  if (message.includes('\n')) {
    const parts = message.split('\n');
    title = parts[0];
    msg = parts.slice(1).join('<br>');
  }

  // Auto-detect icon from message if not provided
  if (!icon) {
    if (message.includes('⚒️') || message.includes('FORGE')) icon = '⚒️';
    else if (message.includes('⚡') || message.includes('BOOST')) icon = '⚡';
    else if (message.includes('🔄') || message.includes('TRANSMUTE')) icon = '🔄';
    else if (message.includes('✨') || message.includes('SUMMON')) icon = '✨';
    else if (message.includes('🏆') || message.includes('TOURNAMENT') || message.includes('WON')) icon = '🏆';
    else if (message.includes('Upgraded') || message.includes('⬆️')) icon = '⬆️';
    else if (message.includes('Unlocked') || message.includes('🎉')) icon = '🎉';
    else if (message.includes('Not enough') || message.includes('Need') || message.includes('❌')) { icon = '❌'; type = 'error'; }
    else if (message.includes('max level') || message.includes('already')) { icon = '⚠️'; type = 'info'; }
    else if (message.includes('Claimed') || message.includes('+')) icon = '✅';
    else if (message.includes('gold') || message.includes('Gold') || message.includes('💰')) icon = '💰';
    else if (message.includes('gems') || message.includes('Gems') || message.includes('💎')) icon = '💎';
    else icon = '📢';
  }

  const toast = document.createElement('div');
  toast.className = `game-toast ${type}`;
  toast.innerHTML = `
    <button class="game-toast-close" onclick="this.parentElement.remove()">×</button>
    <span class="game-toast-icon">${icon}</span>
    ${title ? `<div class="game-toast-title">${title}</div>` : ''}
    <div class="game-toast-msg">${msg || message}</div>
  `;

  container.appendChild(toast);

  // Auto-remove after duration
  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add('hiding');
      setTimeout(() => toast.remove(), 300);
    }
  }, duration);

  // Limit to 3 toasts max
  while (container.children.length > 3) {
    container.firstChild.remove();
  }

  // Play sound
  try { playSound('click'); } catch(e) {}
}

// Star Points Shop Data
const STAR_SHOP_ITEMS = [
  {id:'star_gold_1',name:'Gold Bundle',icon:'💰',desc:'1,000 Gold',price:100,type:'gold',amount:1000},
  {id:'star_gold_2',name:'Gold Mega Pack',icon:'💰',desc:'10,000 Gold',price:800,type:'gold',amount:10000,tier:'epic'},
  {id:'star_gems_1',name:'Gem Pouch',icon:'💎',desc:'25 Gems',price:250,type:'gems',amount:25},
  {id:'star_gems_2',name:'Gem Chest',icon:'💎',desc:'100 Gems',price:900,type:'gems',amount:100,tier:'epic'},
  {id:'star_wild_1',name:'Wild Card',icon:'🃏',desc:'1 Wild Card',price:300,type:'wild',amount:1},
  {id:'star_wild_2',name:'Wild Card Bundle',icon:'🃏',desc:'5 Wild Cards',price:1200,type:'wild',amount:5,tier:'legendary'},
  {id:'star_chest_1',name:'Golden Chest',icon:'📦',desc:'1 Golden Chest',price:400,type:'chest',chest:'gold'},
  {id:'star_chest_2',name:'Magical Chest',icon:'✨',desc:'1 Magical Chest',price:750,type:'chest',chest:'magic',tier:'epic'},
  {id:'star_chest_3',name:'Legendary Chest',icon:'🔥',desc:'1 Legendary Chest',price:1500,type:'chest',chest:'legendary',tier:'legendary'},
  {id:'star_shards_1',name:'Random Epic Shards',icon:'💜',desc:'+15 Epic Shards',price:500,type:'shards',rarity:'epic',amount:15},
  {id:'star_shards_2',name:'Random Legendary Shards',icon:'❤️',desc:'+10 Legendary Shards',price:1000,type:'shards',rarity:'legendary',amount:10,tier:'legendary'},
  {id:'star_boost_1',name:'XP Boost (1hr)',icon:'⚡',desc:'2x Battle XP for 1 hour',price:350,type:'boost',boostType:'xp'},
];

const ADMIN_CODE='ak24';
const MAX_TROPHIES=20000;
const RANKED_THRESHOLD=15000;
const MAX_CHESTS=50;
const PATCH_NOTES=[
{version:'2.5.0',date:'Dec 2024',title:'Titles, Clans & Medals Update',notes:['🏷️ NEW: 45+ PLAYER TITLES - Unlock titles for wins, trophies, win rate, crowns, streaks, wealth and more!','🏅 MEDALS LEADERBOARD - Dedicated leaderboard for Medals mode rankings in More tab!','🏰 CLAN BROWSER - Browse and join 15 different clans with trophy requirements!','🔍 Search clans, request to join invite-only clans, or join open clans instantly!','📦 TREASURE HUNT - New kid-friendly mini-game replaces jackpot! Pick 3 chests to find hidden treasures!','🎯 Titles shown in leaderboard entries with unique icons!','📊 Full Titles tab in More section - view all 45+ titles, requirements, and progress!','🏆 Win rate titles: Consistent (60%), Skilled (70%), Pro (80%), Unstoppable (90%), Perfectionist (95%)!','👑 Trophy titles: Bronze to Godlike (1M trophies)!','🔥 Streak titles: Hot Streak (5) to Invincible (100)!','💰 Wealth titles: Wealthy (50k) to Billionaire (10M)!','🎴 Collection titles: Collector to Completionist!','👑 Crown titles: Crown Seeker to Crown God!']},
{version:'2.4.1',date:'Dec 2024',title:'Draft Mode & Balance Update',notes:['🎲 DRAFT MODE FIXED - Draft battles now work correctly!','🔧 Fixed draft card selection with proper Fisher-Yates shuffle','📝 Added sound feedback when picking draft cards','🛡️ Draft deck now saves properly before battle starts','📊 NEW: Win Streak display added to quick stats (W/L/C/Streak)','⚖️ BALANCE CHANGES:','🗡️ Knight BUFFED: HP 1400→1600, DMG 160→180 (now better value for 3 cost)','👺 Goblins NERFED: HP 170→140, DMG 100→85 (was too strong for 2 cost)','🔥 Fire Spirits NERFED: HP 100→80, DMG 180→150 (too efficient)','💣 Bomber BUFFED: HP 300→350, DMG 200→220 (needed more survivability)','🧙‍♀️ Witch BUFFED: HP 700→850, DMG 120→140, spawns 4 skeletons every 4s (was 3 every 7s)','✨ Evo Witch BUFFED: spawns 5 skeletons every 3s (was 4 every 5s)','🦾 Giant BUFFED: HP 5000→5500, DMG 300→320 (tank should tank more)','🦿 P.E.K.K.A BUFFED: HP 3500→4000, DMG 700→750 (7 cost deserves top stats)','💡 Balance Philosophy: Cheap cards slightly nerfed, expensive cards buffed']},
{version:'2.4.0',date:'Dec 2024',title:'Wild Card Workshop Update',notes:['🔮 NEW FEATURE: WILD CARD WORKSHOP - A powerful new crafting system!','⚒️ CARD FORGE - Convert 10 Wild Cards into shards of ANY card you choose!','✨ WILD SUMMON - Gacha-style card summoning with awesome drop rates!','⚡ POWER BOOST - Buy temporary battle buffs: +15% damage, +20% HP, +1 elixir, and more!','🔄 CARD TRANSMUTER - Convert 20 shards of one card into 10 shards of another!','💥 MEGA POWER BOOST - ALL boosts combined for one epic battle!','🃏 Win 1-3 Wild Cards from every battle victory!','📊 Workshop stats tracking: forges, summons, boosts, transmutes!','🎁 Active boosts display shows remaining battle charges!','🎖️ MEGA CHEST BUFFED - Now gives 50k Gold, 2.5k Gems, 5k Star Points, 2 Super Chests + Legendary!','📜 Mega Rewards now available in FREE Battle Pass track at tiers 35, 60, 75, 90!']},
{version:'2.3.5',date:'Dec 2024',title:'Holiday & Battle Update',notes:['❄️ SEASONAL SNOW EFFECT - Festive snowflakes now fall during battles!','🐗 TROOP PUSHING MECHANIC - Fast troops now push slower friendly troops!','💬 SMART CLAN CHAT - AI clanmates now respond contextually to your messages!','🏷️ Removed trophy count clutter from opponent name display','📊 Fixed Battle Pass XP display to correctly show +150 XP on wins','🎄 Holiday-themed visual updates for the season','⚖️ BALANCE CHANGES: Hog Rider nerfed (-50% HP & damage), Giant buffed (+51% HP, +43% damage)']},
{version:'2.3.4',date:'Dec 2024',title:'Medals & Abilities Update',notes:['🏅 NEW GAME MODE: MEDALS - Super competitive ranked mode!','⚔️ Win +30 Medals per victory, lose -15 on defeat!','⏳ Queue system with matchmaking timer and progress bar!','📊 Medals stats tracking: wins, losses, and highest medals!','🛡️ CHAMPION ABILITY BUTTON - Activate abilities during battle!','💜 Purple glowing button appears when champion is on field!','🔮 26+ unique champion abilities: Dash, Shadow, Storm, Phoenix, Cloak, Summon, Earthquake, Blizzard, Chain Lightning, Teleport, Radiance, Moonbeam, Rally, Dragonfire, Soul Harvest, Time Warp, Rune Explosion, Lifesteal, Spirit Bomb, Crystal Shield, Backstab, Hellfire, Tornado, Counter, Mass Summon and more!','🧙‍♀️ WITCH FIX - Witch now spawns 3 skeletons every 7 seconds!','✨ EVO WITCH FIX - Evo Witch spawns 4 skeletons every 5 seconds!','💀 Skeleton spawn visual effect with rising animation!','🎮 BATTLE MODE SELECTOR - Switch game modes during battle!','📋 MODE button in battle header lets you change modes mid-game!','🎨 Compact mode bar on Play tab replacing large mode cards!','✏️ EDIT CUSTOM CARDS - Now you can modify custom cards after creation!','🔧 Admin panel updates: Medals control, edit card button!']},
{version:'2.3.3',date:'Dec 2024',title:'Evolution Update',notes:['✨ EVOLUTION CARDS ARE HERE! 19 brand new Evolution-rarity cards!','🔥 Evolutions are enhanced versions of classic cards with unique abilities!','⚔️ Evo Knight - Shield Charge: Charges forward with an impenetrable shield!','🏹 Evo Archer - Triple Shot: Fires 3 arrows at once that pierce enemies!','🗿 Evo Giant - Ground Pound: Slams the ground stunning all nearby enemies!','🔮 Evo Wizard - Chain Lightning: Spells chain between multiple targets!','🧙‍♀️ Evo Witch - Mass Summon: Summons an entire skeleton army instantly!','⚔️ Evo Valkyrie - Whirlwind Rage: Spins faster gaining damage with each hit!','🐗 Evo Hog Rider - Jump Smash: Leaps over buildings to smash from above!','🤖 Evo Mini PEKKA - Berserker: Attack speed doubles below 50% HP!','🔫 Evo Musketeer - Piercing Shot: Shots pierce through all enemies in a line!','🤴 Evo Prince - Double Charge: Can charge twice before cooldown!','👺 Evo Goblin Gang - Stealth Strike: Goblins turn invisible for 2 seconds!','🐲 Evo Baby Dragon - Inferno Blast: Breath attack intensifies over time!','🎈 Evo Balloon - Cluster Bomb: Drops multiple bombs in an area!','💀 Evo Skeleton Army - Bone Revive: Fallen skeletons revive once!','🪨 Evo Golem - Rock Armor: Gains damage reduction as HP drops!','🤖 Evo PEKKA - Executioner: Instantly defeats enemies below 15% HP!','🦇 Evo Night Witch - Bat Swarm: Releases massive bat swarm on death!','🪓 Evo Lumberjack - Rage Aura: Constantly emits rage to nearby allies!','⚡ Evo Electro Wizard - Overload: Stuns all enemies in range on spawn!','🎨 New Evolution card styling with orange/gold glowing effects!','📊 Evolution cards appear in new dedicated section in Cards tab']},
{version:'2.3.2',date:'Dec 2024',title:'Massive Card Expansion',notes:['🃏 Added 38 NEW CARDS - The biggest card update ever!','👑 19 NEW CHAMPION CARDS with unique abilities:','⚔️ Blade Master - Multi-strike ability hits 3 times!','🗿 Earth Titan - Earthquake stomps deal area damage!','❄️ Frost Queen - Blizzard freezes all enemies!','⛈️ Thunder Lord - Chain lightning jumps between enemies!','🌀 Void Walker - Teleports behind furthest enemy!','☀️ Sun Warrior - Radiance damages nearby foes!','🌙 Moon Priestess - Moonbeam heals allies, damages enemies!','🪖 War Chief - Rally boosts ally attack speed!','🐉 Dragon Slayer - Breathes captured dragon fire!','💀 Soul Reaper - Harvests souls to heal and power up!','⏰ Time Mage - Time warp slows all enemies!','🔷 Rune Knight - Rune explosions deal massive damage!','🦇 Blood Baron - Lifesteal drains enemy HP!','👁️ Spirit Shaman - Spirit bombs explode on impact!','💎 Crystal Guardian - Grants shields to allies!','🗡️ Shadow Assassin - Backstab deals triple damage!','🔥 Inferno Lord - Summons pillars of hellfire!','💨 Wind Dancer - Tornado pulls enemies in!','🛡️ Battle Master - Counter attack with double damage!','⭐ 19 NEW LEGENDARY CARDS:','☄️ Meteor Golem, 🧊 Frost Giant, 🐲 Shadow Dragon, 🦅 Thunder Phoenix, 🕷️ Void Spider, 🌞 Sun Archer, 🐺 Moon Wolf, 🐘 War Elephant, 🗡️ Dragon Knight, 👻 Soul Hunter, ⏳ Time Walker, 🔮 Rune Master, 🩸 Blood Knight, 🐻 Spirit Bear, 💠 Crystal Golem, 🦁 Shadow Beast, 🔥 Inferno Beast, 🐍 Wind Serpent, 🧙‍♂️ Battle Mage']},
{version:'2.3.1',date:'Dec 2024',title:'Clan System & Bug Fixes',notes:['🏰 Added 15 new Clan features: Chat, Donations, Member Management, Clan Games, Clan Chest, Clan Perks, Clan League, Clan Mail, and Clan Settings','💬 Clan Chat system with real-time messaging','🎁 Card donation system with request/donate functionality','🎮 Clan Games with daily and weekly challenges','📊 Clan Level progression with XP system','🛡️ Clan Perks that unlock as clan levels up','🏆 Clan League rankings with seasonal rewards','⚙️ Clan Settings for leaders to manage clan','🐛 CRITICAL FIX: Fixed infinite recursion crash in endBattle function','🔧 Fixed undefined function errors for clan features','🏗️ Consolidated duplicate function definitions for better performance']},
{version:'2.3.0',date:'Dec 2024',title:'Battle Mechanics Overhaul',notes:['🪦 Fixed Graveyard spell - now spawns 15 skeletons over 9 seconds','🏰 Pocket Access - destroy enemy princess tower to unlock deployment behind it','⚔️ Improved troop targeting AI and pathfinding','🎯 Better splash damage calculations','💀 Skeleton spawns now have rising animation effect','🔧 Various battle balance adjustments']},
{version:'2.2.0',date:'Dec 2024',title:'Battle Pass Expansion',notes:['📜 Battle Pass expanded to 90 tiers (was 35)','🎁 New tier rewards: Mega Lightning Chest, Royal Wild Chest','💎 Premium track now has exclusive emotes and cosmetics','⭐ XP requirements adjusted after tier 20','🏆 New milestone rewards at tiers 50, 70, and 90','📊 Battle Pass progress now shows in profile']},
{version:'2.1.5',date:'Dec 2024',title:'Tournament Update',notes:['🏅 Added Daily Challenge mode (free entry)','🎮 Classic Challenge: 10 gems, casual ruleset','👑 Grand Challenge: 100 gems, competitive rewards','📈 Tournament leaderboards with live rankings','🎯 Challenge-exclusive card pools','💰 Improved tournament reward scaling']},
{version:'2.1.2',date:'Dec 2024',title:'Quality of Life',notes:['🔊 New procedural sound effects for all cards','📱 Improved touch controls for mobile','⚡ Faster card cycling animations','🎨 Arena-specific visual themes unlocked by trophies','💾 Better save data management','🐛 Fixed various UI glitches']},
{version:'2.1.0',date:'Dec 2024',title:'Massive Card Update',notes:['Added 32 new cards across all rarities','8 new Common cards: Barbarian, Fire Spirits, Ice Spirit, Bats, Royal Giant, Spear Thrower, Shield Maiden, Heal Spirit','8 new Rare cards: Witch, Balloon, Tombstone, Cannon, Elite Barbs, Royal Hogs, Tornado, Snowball','8 new Epic cards: Bowler, Executioner, Dark Prince, Hunter, Goblin Barrel, Lightning, Mirror, Rage','6 new Legendary cards: Princess, Bandit, Night Witch, Magic Archer, Ram Rider, Graveyard','2 new Champion cards: Archer Queen, Skeleton King','Added Patch Notes system to More tab','Fixed Testing Zone giving trophies']},
{version:'2.0.5',date:'Dec 2024',title:'Economy Rebalance',notes:['💰 Increased gold rewards from battles by 25%','💎 Daily gem rewards added to shop','🎁 New chest types: Super Magical, Legendary King','📦 Chest slots increased to 50','🛒 Shop refresh now shows better deals','⚖️ Card upgrade costs rebalanced']},
{version:'2.0.2',date:'Dec 2024',title:'Ranked Mode Launch',notes:['🏆 Ranked mode unlocked at 15,000 trophies','📊 Seasonal rankings with exclusive rewards','⭐ Skill-based matchmaking system','🎖️ New rank badges and profile flair','📈 Trophy decay above 20,000 trophies','🏅 End-of-season chest rewards']},
{version:'2.0.0',date:'Dec 2024',title:'Arena Royale 2.0',notes:['Complete game overhaul and redesign','New battle engine with improved mechanics','Added Champions with special abilities','Added Testing Zone game mode','Improved UI and animations','Added Custom Card Creator','Added Competitive Leaderboard','Added Wild Items system','Added Clan system','Added 50+ emotes']},
{version:'1.5.0',date:'Nov 2024',title:'Arena Expansion',notes:['🌍 Added 30+ new arenas up to 1 million trophies','🎨 Each arena has unique visual theme','🏆 New trophy milestones with better rewards','🌟 Legendary Arena redesigned','⚡ Electro Valley special effects added','🎃 Seasonal arena themes (Spooky Town Halloween)']},
{version:'1.2.0',date:'Nov 2024',title:'Card Balance',notes:['⚖️ Rebalanced 20+ cards based on win rates','🗡️ Knight HP increased by 5%','🐗 Hog Rider damage reduced by 3%','🧙‍♀️ Witch spawn rate adjusted','💥 Fireball radius slightly reduced','🛡️ Tesla damage increased by 8%']},
{version:'1.0.0',date:'Nov 2024',title:'Initial Release',notes:['First release of Arena Royale','Core battle mechanics','Trophy Road progression','Card collection system','Chest system','Shop and economy','Leaderboards']}
];
const ARENAS=[{name:'Newbie',min:0,icon:'🐣',rew:10,skin:{grass:'#228B22',river:'#1e90ff',bridge:'#8B4513',tower:'🏯'}},{name:'Training Camp',min:50,icon:'🏕️',rew:12,skin:{grass:'#2d5a27',river:'#4169e1',bridge:'#654321',tower:'🏕️'}},{name:'Goblin Hut',min:100,icon:'🛖',rew:14,skin:{grass:'#3a5f0b',river:'#32cd32',bridge:'#556b2f',tower:'🛖'}},{name:'Bone Pit',min:200,icon:'💀',rew:16,skin:{grass:'#2f2f2f',river:'#800080',bridge:'#1a1a1a',tower:'💀'}},{name:'Barbarian Bowl',min:350,icon:'🪓',rew:18,skin:{grass:'#8b4513',river:'#cd853f',bridge:'#a0522d',tower:'🪓'}},{name:'Spell Valley',min:500,icon:'🔮',rew:20,skin:{grass:'#4b0082',river:'#9400d3',bridge:'#8b008b',tower:'🔮'}},{name:'Royal Arena',min:1200,icon:'👑',rew:26,skin:{grass:'#1a5f1a',river:'#4169e1',bridge:'#daa520',tower:'👑'}},{name:'Frozen Peak',min:2000,icon:'❄️',rew:30,skin:{grass:'#87ceeb',river:'#00ced1',bridge:'#b0c4de',tower:'❄️'}},{name:'Jungle Arena',min:3000,icon:'🌴',rew:35,skin:{grass:'#006400',river:'#20b2aa',bridge:'#8b4513',tower:'🌴'}},{name:'Hog Mountain',min:4000,icon:'🐗',rew:40,skin:{grass:'#654321',river:'#8b4513',bridge:'#a0522d',tower:'🐗'}},{name:'Electro Valley',min:5000,icon:'⚡',rew:45,skin:{grass:'#1a1a3a',river:'#00ffff',bridge:'#4169e1',tower:'⚡'}},{name:'Spooky Town',min:6000,icon:'🎃',rew:50,skin:{grass:'#1a0a1a',river:'#ff4500',bridge:'#2f1a2f',tower:'🎃'}},{name:'Rascals Hideout',min:7000,icon:'😈',rew:55,skin:{grass:'#3d3d3d',river:'#ff1493',bridge:'#4a4a4a',tower:'😈'}},{name:'Serenity Peak',min:8000,icon:'🏔️',rew:60,skin:{grass:'#e0e0e0',river:'#87ceeb',bridge:'#c0c0c0',tower:'🏔️'}},{name:'Legendary Arena',min:10000,icon:'🏆',rew:70,skin:{grass:'#2a1a0a',river:'#ffd700',bridge:'#daa520',tower:'🏆'}},{name:'Masters I',min:12000,icon:'💫',rew:80,skin:{grass:'#0a0a2a',river:'#ff00ff',bridge:'#4b0082',tower:'💫'}},{name:'Masters II',min:14000,icon:'🌟',rew:90,skin:{grass:'#1a0a2a',river:'#ffd700',bridge:'#9932cc',tower:'🌟'}},{name:'Champion',min:15000,icon:'💎',rew:100,skin:{grass:'#0a1a2a',river:'#00ffff',bridge:'#4169e1',tower:'💎'}},{name:'Grand Champion',min:17000,icon:'👑',rew:120,skin:{grass:'#2a0a0a',river:'#ff0000',bridge:'#8b0000',tower:'👑'}},{name:'Ultimate Champion',min:19000,icon:'🔱',rew:150,skin:{grass:'#0a2a1a',river:'#00ff7f',bridge:'#228b22',tower:'🔱'}},{name:'Mythic Champion',min:21000,icon:'🌌',rew:180,skin:{grass:'#0a0a1a',river:'#9400d3',bridge:'#4b0082',tower:'🌌'}},{name:'Cosmic Arena',min:23000,icon:'🌠',rew:200,skin:{grass:'#000020',river:'#00bfff',bridge:'#191970',tower:'🌠'}},{name:'Nebula Peak',min:25000,icon:'🌌',rew:220,skin:{grass:'#1a0020',river:'#ff69b4',bridge:'#4b0082',tower:'🌌'}},{name:'Stellar Valley',min:27000,icon:'⭐',rew:240,skin:{grass:'#0a0a0a',river:'#ffd700',bridge:'#2f2f2f',tower:'⭐'}},{name:'Galactic Realm',min:29000,icon:'🌀',rew:260,skin:{grass:'#000030',river:'#00ffff',bridge:'#0000cd',tower:'🌀'}},{name:'Quantum Arena',min:31000,icon:'⚛️',rew:280,skin:{grass:'#100020',river:'#7fff00',bridge:'#2f0f3f',tower:'⚛️'}},{name:'Void Champion',min:33000,icon:'🕳️',rew:300,skin:{grass:'#050505',river:'#8b008b',bridge:'#1a1a1a',tower:'🕳️'}},{name:'Eternal Peak',min:35000,icon:'♾️',rew:320,skin:{grass:'#1a1a2a',river:'#00ced1',bridge:'#2f2f4f',tower:'♾️'}},{name:'Divine Arena',min:37000,icon:'👼',rew:340,skin:{grass:'#fffacd',river:'#ffd700',bridge:'#daa520',tower:'👼'}},{name:'Celestial Realm',min:39000,icon:'🌟',rew:360,skin:{grass:'#e6e6fa',river:'#ff69b4',bridge:'#dda0dd',tower:'🌟'}},{name:'Supreme Champion',min:41000,icon:'👑',rew:380,skin:{grass:'#2a0a1a',river:'#ff0000',bridge:'#8b0000',tower:'👑'}},{name:'Infinite Arena',min:43000,icon:'∞',rew:400,skin:{grass:'#0f0f1f',river:'#00ff00',bridge:'#1a1a3a',tower:'∞'}},{name:'Ultimate Master',min:45000,icon:'🏅',rew:420,skin:{grass:'#1a1a0a',river:'#ffa500',bridge:'#b8860b',tower:'🏅'}},{name:'Legendary Overlord',min:47000,icon:'👹',rew:440,skin:{grass:'#2a0a0a',river:'#dc143c',bridge:'#8b0000',tower:'👹'}},{name:'Final Frontier',min:49000,icon:'🚀',rew:460,skin:{grass:'#000010',river:'#4169e1',bridge:'#0a0a2a',tower:'🚀'}},{name:'Arena of Legends',min:50000,icon:'🏆',rew:480,skin:{grass:'#1a1a0a',river:'#ffd700',bridge:'#daa520',tower:'🏆'}},{name:'Hall of Fame',min:100000,icon:'🎖️',rew:500,skin:{grass:'#2a2a0a',river:'#ff8c00',bridge:'#cd853f',tower:'🎖️'}},{name:'Eternal Glory',min:150000,icon:'🌟',rew:550,skin:{grass:'#ffffcc',river:'#ffff00',bridge:'#ffd700',tower:'🌟'}},{name:'Supreme Dominion',min:200000,icon:'👑',rew:600,skin:{grass:'#3a0a0a',river:'#ff0000',bridge:'#8b0000',tower:'👑'}},{name:'Cosmic Mastery',min:250000,icon:'🌌',rew:650,skin:{grass:'#0a0a3a',river:'#9400d3',bridge:'#4b0082',tower:'🌌'}},{name:'Infinite Power',min:300000,icon:'⚡',rew:700,skin:{grass:'#0a1a3a',river:'#00ffff',bridge:'#4169e1',tower:'⚡'}},{name:'Divine Ascension',min:350000,icon:'👼',rew:750,skin:{grass:'#fffff0',river:'#ffd700',bridge:'#f0e68c',tower:'👼'}},{name:'Celestial Throne',min:400000,icon:'🌠',rew:800,skin:{grass:'#f0f0ff',river:'#87cefa',bridge:'#b0c4de',tower:'🌠'}},{name:'Ultimate Realm',min:450000,icon:'🔱',rew:850,skin:{grass:'#0a3a2a',river:'#00ff7f',bridge:'#2e8b57',tower:'🔱'}},{name:'Legendary Zenith',min:500000,icon:'🏔️',rew:900,skin:{grass:'#e8e8e8',river:'#add8e6',bridge:'#d3d3d3',tower:'🏔️'}},{name:'Mythic Pinnacle',min:550000,icon:'🗿',rew:950,skin:{grass:'#c0c0c0',river:'#808080',bridge:'#a9a9a9',tower:'🗿'}},{name:'Grand Mastery',min:600000,icon:'💫',rew:1000,skin:{grass:'#1a0a3a',river:'#ff00ff',bridge:'#9400d3',tower:'💫'}},{name:'Supreme Apex',min:650000,icon:'👹',rew:1050,skin:{grass:'#3a0a1a',river:'#ff1493',bridge:'#c71585',tower:'👹'}},{name:'Cosmic Overlord',min:700000,icon:'🌀',rew:1100,skin:{grass:'#0a0a2a',river:'#00bfff',bridge:'#1e90ff',tower:'🌀'}},{name:'Infinite Emperor',min:750000,icon:'♾️',rew:1150,skin:{grass:'#0f0f0f',river:'#7cfc00',bridge:'#228b22',tower:'♾️'}},{name:'Divine Sovereign',min:800000,icon:'👑',rew:1200,skin:{grass:'#fff8dc',river:'#ffd700',bridge:'#daa520',tower:'👑'}},{name:'Celestial Emperor',min:850000,icon:'🌟',rew:1250,skin:{grass:'#fffaf0',river:'#ff69b4',bridge:'#ffb6c1',tower:'🌟'}},{name:'Ultimate Deity',min:900000,icon:'🔥',rew:1300,skin:{grass:'#2a0a0a',river:'#ff4500',bridge:'#dc143c',tower:'🔥'}},{name:'Legendary God',min:950000,icon:'⚔️',rew:1350,skin:{grass:'#1a1a1a',river:'#c0c0c0',bridge:'#808080',tower:'⚔️'}},{name:'Million Trophy Master',min:1000000,icon:'💎',rew:1500,skin:{grass:'#0a2a3a',river:'#00ffff',bridge:'#40e0d0',tower:'💎'}}];
const ARENA_SKINS=ARENAS.map((a,i)=>({id:'skin_'+i,name:a.name+' Skin',icon:a.icon,arena:i,unlockTrophies:a.min}));
const TROPHY_ROAD=[{tr:0,reward:{gold:100},icon:'💰',desc:'+100 Gold'},{tr:50,reward:{gold:200},icon:'💰',desc:'+200 Gold'},{tr:100,reward:{gems:10},icon:'💎',desc:'+10 Gems'},{tr:200,reward:{chest:'silver'},icon:'📦',desc:'Silver Chest'},{tr:350,reward:{gold:500},icon:'💰',desc:'+500 Gold'},{tr:500,reward:{chest:'gold'},icon:'🎁',desc:'Golden Chest'},{tr:750,reward:{gems:25},icon:'💎',desc:'+25 Gems'},{tr:1000,reward:{gold:1000,gems:20},icon:'🎉',desc:'+1000 Gold +20 Gems'},{tr:1500,reward:{chest:'magic'},icon:'✨',desc:'Magical Chest'},{tr:2000,reward:{shards:{rarity:'rare',amount:20}},icon:'🧡',desc:'+20 Rare Shards'},{tr:2500,reward:{gold:2000},icon:'💰',desc:'+2000 Gold'},{tr:3000,reward:{chest:'giant'},icon:'🏆',desc:'Giant Chest'},{tr:4000,reward:{shards:{rarity:'epic',amount:15}},icon:'💜',desc:'+15 Epic Shards'},{tr:5000,reward:{gems:100},icon:'💎',desc:'+100 Gems'},{tr:6000,reward:{gold:5000},icon:'💰',desc:'+5000 Gold'},{tr:7000,reward:{shards:{rarity:'legendary',amount:5}},icon:'❤️',desc:'+5 Legendary Shards'},{tr:8000,reward:{chest:'giant',gems:50},icon:'🎊',desc:'Giant Chest +50 Gems'},{tr:10000,reward:{gold:10000,gems:100},icon:'🏆',desc:'+10000 Gold +100 Gems'},{tr:12000,reward:{shards:{rarity:'legendary',amount:10}},icon:'❤️',desc:'+10 Legendary Shards'},{tr:15000,reward:{shards:{rarity:'champion',amount:20},gems:200},icon:'👑',desc:'RANKED! +20 Champion'},{tr:17000,reward:{gold:20000,gems:150},icon:'💫',desc:'+20000 Gold +150 Gems'},{tr:19000,reward:{shards:{rarity:'champion',amount:50}},icon:'⚔️',desc:'+50 Champion Shards'},{tr:20000,reward:{gold:50000,gems:500},icon:'🔱',desc:'MAX! +50000 Gold +500 Gems'}];
const CARDS=[
// COMMON TROOPS
{id:'knight',name:'Knight',cost:3,hp:1600,dmg:180,spd:1.2,rng:1,as:1.0,type:'troop',rarity:'common',icon:'🗡️',air:0,desc:'A tough melee fighter with moderate damage. Great for tanking and counter-pushing!'},
{id:'archer',name:'Archers',cost:3,hp:250,dmg:90,spd:1.2,rng:5,as:1.2,type:'troop',rarity:'common',icon:'🏹',air:1,cnt:2,desc:'A pair of deadly archers that attack from range. They can target air and ground units!'},
{id:'goblin',name:'Goblins',cost:2,hp:140,dmg:85,spd:1.6,rng:1,as:1.1,type:'troop',rarity:'common',icon:'👺',air:0,cnt:3,desc:'Three fast and sneaky goblins. Cheap cycle card that deals surprising damage!'},
{id:'skel',name:'Skeletons',cost:1,hp:80,dmg:80,spd:1.4,rng:1,as:1.0,type:'troop',rarity:'common',icon:'💀',air:0,cnt:3,desc:'Three spooky skeletons for just 1 elixir! Perfect for distracting big threats.'},
{id:'minion',name:'Minions',cost:3,hp:200,dmg:80,spd:1.8,rng:2,as:1.0,type:'troop',rarity:'common',icon:'😈',air:1,fly:1,cnt:3,desc:'Three flying demons that deal consistent damage. Great support behind tanks!'},
{id:'bomber',name:'Bomber',cost:3,hp:350,dmg:220,spd:1.0,rng:4.5,as:1.8,type:'troop',rarity:'common',icon:'💣',air:0,spl:1.5,desc:'Throws bombs that deal splash damage. Excellent against swarms of ground troops!'},
{id:'barbarian',name:'Barbarian',cost:2,hp:550,dmg:120,spd:1.2,rng:1,as:1.3,type:'troop',rarity:'common',icon:'🪓',air:0,desc:'A fierce warrior with decent health and damage. Simple but effective!'},
{id:'firespirit',name:'Fire Spirits',cost:2,hp:80,dmg:150,spd:1.8,rng:2,as:1.0,type:'troop',rarity:'common',icon:'🔥',air:0,cnt:3,spl:1,desc:'Three blazing spirits that kamikaze into enemies, dealing splash damage!'},
{id:'icespirit',name:'Ice Spirit',cost:1,hp:200,dmg:100,spd:1.8,rng:2,as:1.0,type:'troop',rarity:'common',icon:'❄️',air:0,freeze:1,desc:'A chilly spirit that freezes enemies on contact. Great value for 1 elixir!'},
{id:'bats',name:'Bats',cost:2,hp:80,dmg:70,spd:2.0,rng:1,as:1.0,type:'troop',rarity:'common',icon:'🦇',air:1,fly:1,cnt:5,desc:'Five speedy flying bats! Swarm enemies with their numbers and speed.'},
{id:'royalgiant',name:'Royal Giant',cost:6,hp:2800,dmg:180,spd:0.8,rng:5,as:1.7,type:'troop',rarity:'common',icon:'🏰',air:0,bldg:1,desc:'A massive ranged tank that targets buildings. Outranges most defenses!'},
{id:'spearthrower',name:'Spear Thrower',cost:2,hp:180,dmg:95,spd:1.3,rng:5,as:1.2,type:'troop',rarity:'common',icon:'🎯',air:1,desc:'A precise ranged attacker that can hit both air and ground units cheaply.'},
{id:'shieldmaiden',name:'Shield Maiden',cost:3,hp:800,dmg:100,spd:1.0,rng:1,as:1.2,type:'troop',rarity:'common',icon:'🛡️',air:0,shield:400,desc:'A warrior with a protective shield that absorbs the first 400 damage!'},
{id:'healspirit',name:'Heal Spirit',cost:1,hp:150,dmg:0,spd:1.8,rng:3,as:1.0,type:'troop',rarity:'common',icon:'💚',air:0,heal:200,desc:'A gentle spirit that heals nearby allies when it reaches them. Support your push!'},
// COMMON SPELLS
{id:'arrows',name:'Arrows',cost:3,dmg:300,radius:4,type:'spell',rarity:'common',icon:'➵',desc:'A volley of arrows covers a large area. Perfect for clearing swarms!'},
{id:'zap',name:'Zap',cost:2,dmg:200,radius:2.5,stun:0.5,type:'spell',rarity:'common',icon:'⚡',desc:'A quick lightning bolt that stuns enemies for 0.5 seconds. Resets charges!'},
// RARE TROOPS
{id:'giant',name:'Giant',cost:5,hp:5500,dmg:320,spd:0.8,rng:1,as:1.5,type:'troop',rarity:'rare',icon:'🦾',air:0,bldg:1,desc:'A slow but powerful tank that only targets buildings. Lead your push with him!'},
{id:'musk',name:'Musketeer',cost:4,hp:600,dmg:180,spd:1.1,rng:6,as:1.0,type:'troop',rarity:'rare',icon:'💂',air:1,desc:'A sharpshooter with long range. Excellent support unit that hits air and ground!'},
{id:'valk',name:'Valkyrie',cost:4,hp:1400,dmg:180,spd:1.2,rng:1,as:1.5,type:'troop',rarity:'rare',icon:'💃',air:0,spl:1.2,desc:'A fierce warrior who spins to deal 360-degree splash damage. Swarm destroyer!'},
{id:'hog',name:'Hog Rider',cost:4,hp:1500,dmg:140,spd:2.6,rng:1,as:0.75,type:'troop',rarity:'rare',icon:'🐗',air:0,bldg:1,desc:'A very fast building-targeting troop. Hog Riiiiider! Rush those towers!'},
{id:'speargob',name:'Spear Goblins',cost:2,hp:100,dmg:80,spd:1.8,rng:1,as:1.0,type:'troop',rarity:'rare',icon:'🗡️',air:0,cnt:3,desc:'Three goblins armed with spears. Fast and cheap, great for chip damage!'},
{id:'bomber2',name:'Super Bomber',cost:4,hp:400,dmg:250,spd:1.0,rng:5,as:1.5,type:'troop',rarity:'rare',icon:'💣',air:0,spl:2,desc:'An upgraded bomber with bigger explosions and longer range. Devastating splash!'},
{id:'archer2',name:'Crossbow Archer',cost:3,hp:200,dmg:120,spd:1.0,rng:7,as:1.0,type:'troop',rarity:'rare',icon:'🏹',air:1,desc:'A long-range crossbow wielder. Snipes enemies from a safe distance!'},
{id:'knight2',name:'Armored Knight',cost:3,hp:1800,dmg:200,spd:1.0,rng:1,as:1.0,type:'troop',rarity:'rare',icon:'🛡️',air:0,desc:'A heavily armored knight with extra health. A walking fortress!'},
{id:'wizard2',name:'Fire Wizard',cost:5,hp:500,dmg:350,spd:1.0,rng:5.5,as:1.2,type:'troop',rarity:'rare',icon:'🔥',air:1,spl:1.5,desc:'A pyromancer who launches devastating fireballs. High damage, fragile body!'},
{id:'witch',name:'Witch',cost:5,hp:850,dmg:140,spd:1.0,rng:5,as:1.0,type:'troop',rarity:'rare',icon:'🧙‍♀️',air:1,spl:1,desc:'A magical witch who deals splash damage and can hit air units. Spooky!'},
{id:'balloon',name:'Balloon',cost:5,hp:1500,dmg:600,spd:1.0,rng:1,as:3.0,type:'troop',rarity:'rare',icon:'🎈',air:0,fly:1,bldg:1,desc:'A flying bomb that drops devastating explosives on buildings. Death from above!'},
{id:'elitebarbarian',name:'Elite Barbs',cost:6,hp:1100,dmg:280,spd:1.6,rng:1,as:1.4,type:'troop',rarity:'rare',icon:'⚔️',air:0,cnt:2,desc:'Two very fast, very strong barbarians. Overwhelming offensive power!'},
{id:'royalhog',name:'Royal Hogs',cost:5,hp:700,dmg:80,spd:1.8,rng:1,as:1.0,type:'troop',rarity:'rare',icon:'🐷',air:0,bldg:1,cnt:4,desc:'Four little piggies that rush buildings. Split lane pressure specialists!'},
// RARE BUILDINGS
{id:'tombstone',name:'Tombstone',cost:3,hp:500,dmg:0,spd:0,rng:0,as:0,type:'building',rarity:'rare',icon:'🪦',desc:'A spawner building that distracts enemies and spawns skeletons. Defensive value!'},
{id:'cannon',name:'Cannon',cost:3,hp:700,dmg:160,spd:0,rng:5.5,as:0.8,type:'building',rarity:'rare',icon:'💥',desc:'A cheap defensive cannon that targets ground troops. Great tank killer!'},
// RARE SPELLS
{id:'fb',name:'Fireball',cost:4,dmg:450,radius:2.5,type:'spell',rarity:'rare',icon:'🔥',desc:'A blazing ball of fire that deals high damage in an area. Medium troops beware!'},
{id:'tornado',name:'Tornado',cost:3,dmg:150,radius:4,type:'spell',rarity:'rare',icon:'🌪️',desc:'A powerful vortex that pulls enemies together. Activate your King Tower!'},
{id:'snowball',name:'Snowball',cost:2,dmg:150,radius:2.5,slow:35,slowDur:2,type:'spell',rarity:'rare',icon:'⛄',desc:'A chilly projectile that deals damage and slows enemies by 35% for 2 seconds!'},
// EPIC TROOPS
{id:'drag',name:'Baby Dragon',cost:4,hp:1000,dmg:130,spd:1.5,rng:3.5,as:1.5,type:'troop',rarity:'epic',icon:'🐲',air:1,fly:1,spl:1,desc:'A flying dragon that breathes fire, dealing splash damage. Versatile support!'},
{id:'mpek',name:'Mini PEKKA',cost:4,hp:1300,dmg:600,spd:1.3,rng:1,as:1.6,type:'troop',rarity:'epic',icon:'🤖',air:0,desc:'A smaller but deadly PEKKA. Deals massive damage per hit. Pancakes!'},
{id:'wiz',name:'Wizard',cost:5,hp:600,dmg:300,spd:1.0,rng:5.5,as:1.4,type:'troop',rarity:'epic',icon:'🧙',air:1,spl:1.5,desc:'A powerful spellcaster who launches fireballs at enemies. Glass cannon!'},
{id:'prince',name:'Prince',cost:5,hp:1500,dmg:350,spd:1.4,rng:1,as:1.4,type:'troop',rarity:'epic',icon:'🤴',air:0,charge:1,desc:'A charging prince who deals double damage when he charges. Watch out for that lance!'},
{id:'golem',name:'Golem',cost:8,hp:5000,dmg:280,spd:0.6,rng:1,as:2.5,type:'troop',rarity:'epic',icon:'🗿',air:0,bldg:1,desc:'A massive stone giant with enormous health. The ultimate tank! Slow but unstoppable.'},
{id:'darkgoblin',name:'Dark Goblin',cost:3,hp:350,dmg:120,spd:1.8,rng:1,as:1.0,type:'troop',rarity:'epic',icon:'🖤',air:0,poison:40,poisonDur:4,cnt:2,desc:'Two corrupted goblins whose attacks poison enemies for damage over time!'},
{id:'bowler',name:'Bowler',cost:5,hp:1800,dmg:280,spd:1.0,rng:4,as:2.5,type:'troop',rarity:'epic',icon:'🎳',air:0,spl:1.5,desc:'Rolls a massive boulder that pushes back and damages all ground troops in its path!'},
{id:'executioner',name:'Executioner',cost:5,hp:1000,dmg:250,spd:1.0,rng:4.5,as:2.4,type:'troop',rarity:'epic',icon:'🪓',air:1,spl:1.5,desc:'Throws a deadly axe that returns to him, hitting enemies twice! Hits air too.'},
{id:'darkprince',name:'Dark Prince',cost:4,hp:1200,dmg:200,spd:1.4,rng:1,as:1.3,type:'troop',rarity:'epic',icon:'🌑',air:0,charge:1,shield:300,spl:1,desc:'A shielded prince who charges and deals splash damage. The dark side of royalty!'},
{id:'hunter',name:'Hunter',cost:4,hp:800,dmg:450,spd:1.0,rng:4,as:2.2,type:'troop',rarity:'epic',icon:'🔫',air:1,desc:'Fires a spread of bullets - devastating at close range, weaker at distance. Tank buster!'},
// EPIC SPELLS
{id:'rocket',name:'Rocket',cost:6,dmg:900,radius:2,type:'spell',rarity:'epic',icon:'🚀',desc:'A devastating rocket that deals massive damage to a small area. Tower finisher!'},
{id:'poison',name:'Poison',cost:4,dmg:90,radius:3.5,duration:8,type:'spell',rarity:'epic',icon:'☠️',desc:'Creates a toxic cloud that damages enemies over 8 seconds. Area denial!'},
{id:'goblinbarrel',name:'Goblin Barrel',cost:3,dmg:0,radius:1.5,type:'spell',rarity:'epic',icon:'🛢️',desc:'Throws a barrel of goblins anywhere on the map. Surprise attack!'},
{id:'lightning',name:'Lightning',cost:6,dmg:700,radius:3.5,type:'spell',rarity:'epic',icon:'⚡',desc:'Strikes the 3 highest HP enemies in an area with devastating lightning bolts!'},
{id:'mirror',name:'Mirror',cost:1,dmg:0,radius:0,type:'spell',rarity:'epic',icon:'🪞',desc:'Copies the last card you played at +1 elixir cost. Double trouble!'},
{id:'rage',name:'Rage',cost:2,dmg:0,radius:5,duration:6,type:'spell',rarity:'epic',icon:'😤',desc:'Boosts movement and attack speed of friendly troops in the area for 6 seconds!'},
// LEGENDARY TROOPS
{id:'pekka',name:'P.E.K.K.A',cost:7,hp:4000,dmg:750,spd:1.0,rng:1,as:1.6,type:'troop',rarity:'legendary',icon:'🦿',air:0,desc:'A heavily armored robot knight dealing devastating blows. She is not a robot... or is she?'},
{id:'mk',name:'Mega Knight',cost:7,hp:3000,dmg:250,spd:1.1,rng:1,as:1.7,type:'troop',rarity:'legendary',icon:'🦸',air:0,spl:1.8,desc:'Lands with a massive splash and leaps to attack! The arena shakes when he arrives.'},
{id:'sparky',name:'Sparky',cost:6,hp:1200,dmg:1000,spd:0.8,rng:4.5,as:4.0,type:'troop',rarity:'legendary',icon:'🔋',air:0,spl:1,desc:'A rolling machine of destruction! Charges up for 4 seconds, then ZAP - 1000 damage!'},
{id:'inferno',name:'Inferno Dragon',cost:4,hp:900,dmg:50,spd:1.2,rng:3.5,as:0.4,type:'troop',rarity:'legendary',icon:'🐉',air:1,fly:1,desc:'A flying dragon with an inferno beam that ramps up damage over time. Tank melter!'},
{id:'lumberjack',name:'Lumberjack',cost:4,hp:1000,dmg:200,spd:2.0,rng:1,as:0.7,type:'troop',rarity:'legendary',icon:'🪓',air:0,desc:'A crazy fast lumberjack! When he dies, he drops a Rage spell for nearby troops.'},
{id:'icewizard',name:'Ice Wizard',cost:3,hp:700,dmg:80,spd:1.0,rng:5.5,as:1.7,type:'troop',rarity:'legendary',icon:'🧊',air:1,spl:2.5,desc:'Freezes and slows enemies with his icy magic. Defensive specialist!'},
{id:'electrowiz',name:'Electro Wizard',cost:4,hp:800,dmg:150,spd:1.2,rng:5,as:1.5,type:'troop',rarity:'legendary',icon:'⚡',air:1,desc:'Zaps enemies with dual lightning bolts, stunning them briefly. Enter with a Zap!'},
{id:'princess',name:'Princess',cost:3,hp:300,dmg:180,spd:1.0,rng:9,as:3.0,type:'troop',rarity:'legendary',icon:'👸',air:1,spl:1,desc:'Incredibly long range archer who fires flaming arrows. Must be addressed or she chips away!'},
{id:'bandit',name:'Bandit',cost:3,hp:800,dmg:180,spd:1.8,rng:1,as:1.0,type:'troop',rarity:'legendary',icon:'🥷',air:0,desc:'Dashes to enemies and becomes invincible during the dash! Fast and elusive.'},
{id:'nightwitch',name:'Night Witch',cost:4,hp:800,dmg:280,spd:1.2,rng:1,as:1.5,type:'troop',rarity:'legendary',icon:'🌙',air:0,desc:'A dark witch who summons bats. Spawns even more bats when she dies!'},
{id:'magearcher',name:'Magic Archer',cost:4,hp:500,dmg:120,spd:1.1,rng:7,as:1.1,type:'troop',rarity:'legendary',icon:'🏹',air:1,desc:'Fires magical arrows that pierce through all enemies in a line. Geometry master!'},
{id:'ramrider',name:'Ram Rider',cost:5,hp:1500,dmg:180,spd:1.5,rng:1,as:1.8,type:'troop',rarity:'legendary',icon:'🐏',air:0,bldg:1,desc:'Rides a charging ram and throws bolas to snare enemies! Building wrecker.'},
// LEGENDARY SPELLS
{id:'graveyard',name:'Graveyard',cost:5,dmg:0,radius:4,duration:9,type:'spell',rarity:'legendary',icon:'⚰️',desc:'Summons skeletons from the ground over time. Overwhelm towers with the undead!'},
// CHAMPION TROOPS
{id:'goldenknight',name:'Golden Knight',cost:4,hp:1800,dmg:180,spd:1.3,rng:1,as:1.1,type:'troop',rarity:'champion',icon:'⚔️',air:0,ability:'dash',abilityDesc:'After 10 hits, dashes through all enemies dealing 500 damage!',desc:'A legendary knight clad in gold. His Dashing Dash ability chains through multiple enemies!'},
{id:'shadowknight',name:'Shadow Knight',cost:4,hp:1600,dmg:190,spd:1.4,rng:1,as:1.2,type:'troop',rarity:'champion',icon:'🌑',air:0,ability:'shadow',abilityDesc:'Becomes invisible for 3 seconds, dealing double damage!',desc:'A mysterious warrior who can vanish into shadows and strike with deadly force!'},
{id:'stormknight',name:'Storm Knight',cost:4,hp:1700,dmg:185,spd:1.2,rng:1,as:1.1,type:'troop',rarity:'champion',icon:'⛈️',air:0,ability:'storm',abilityDesc:'Calls lightning on random enemies every 2 seconds!',desc:'Commands the power of storms! Lightning strikes randomly damage enemies around him.'},
{id:'phoenixknight',name:'Phoenix Knight',cost:4,hp:1500,dmg:200,spd:1.5,rng:1,as:1.0,type:'troop',rarity:'champion',icon:'🔥',air:0,ability:'phoenix',abilityDesc:'Revives with full HP after dying!',desc:'A warrior blessed by the phoenix. When defeated, rises from the ashes fully healed!'},
{id:'archerqueen',name:'Archer Queen',cost:5,hp:1400,dmg:280,spd:1.2,rng:5,as:1.2,type:'troop',rarity:'champion',icon:'👑',air:1,ability:'cloak',abilityDesc:'Becomes invisible and gains attack speed!',desc:'The queen of archers! Her Royal Cloak ability lets her vanish and attack faster.'},
{id:'skeletonking',name:'Skeleton King',cost:4,hp:2400,dmg:200,spd:1.1,rng:1,as:1.5,type:'troop',rarity:'champion',icon:'☠️',air:0,ability:'summon',abilityDesc:'Summons an army of skeletons!',desc:'The ruler of the undead! Collects souls and summons a skeleton army to overwhelm foes.'},
// NEW LEGENDARY TROOPS (v2.3.2)
{id:'meteorgolem',name:'Meteor Golem',cost:6,hp:2800,dmg:350,spd:0.7,rng:1,as:2.0,type:'troop',rarity:'legendary',icon:'☄️',air:0,spl:2,desc:'A massive golem forged from fallen meteors. Crashes down from the sky dealing splash on deploy!'},
{id:'frostgiant',name:'Frost Giant',cost:7,hp:3800,dmg:280,spd:0.6,rng:2,as:2.2,type:'troop',rarity:'legendary',icon:'🧊',air:0,slow:50,slowDur:3,desc:'An ancient ice behemoth that freezes everything it touches. Slow but devastating!'},
{id:'shadowdragon',name:'Shadow Dragon',cost:6,hp:1800,dmg:220,spd:1.3,rng:4,as:1.4,type:'troop',rarity:'legendary',icon:'🐲',air:1,fly:1,spl:1.5,desc:'A dragon from the shadow realm. Its dark breath damages multiple enemies!'},
{id:'thunderphoenix',name:'Thunder Phoenix',cost:5,hp:1200,dmg:180,spd:1.6,rng:3,as:1.2,type:'troop',rarity:'legendary',icon:'🦅',air:1,fly:1,stun:0.3,desc:'A legendary bird crackling with electricity. Stuns enemies with each attack!'},
{id:'voidspider',name:'Void Spider',cost:4,hp:900,dmg:150,spd:1.8,rng:1,as:0.9,type:'troop',rarity:'legendary',icon:'🕷️',air:0,poison:30,poisonDur:5,desc:'A terrifying spider from the void. Its venomous bites poison enemies over time!'},
{id:'sunarcher',name:'Sun Archer',cost:4,hp:600,dmg:200,spd:1.2,rng:7,as:1.4,type:'troop',rarity:'legendary',icon:'🌞',air:1,desc:'Shoots arrows of pure sunlight that pierce through enemies. Burns with radiant damage!'},
{id:'moonwolf',name:'Moon Wolf',cost:4,hp:1100,dmg:170,spd:2.2,rng:1,as:0.8,type:'troop',rarity:'legendary',icon:'🐺',air:0,desc:'A mystical wolf that howls at the moon. Incredibly fast and gains strength at low HP!'},
{id:'warelephant',name:'War Elephant',cost:8,hp:4500,dmg:400,spd:0.5,rng:2,as:2.0,type:'troop',rarity:'legendary',icon:'🐘',air:0,spl:2.5,desc:'A massive war elephant that tramples everything in its path. Ultimate tank!'},
{id:'dragonknight',name:'Dragon Knight',cost:5,hp:1600,dmg:240,spd:1.2,rng:1,as:1.3,type:'troop',rarity:'legendary',icon:'🗡️',air:0,spl:1.2,desc:'A knight riding a baby dragon. Breathes fire while charging into battle!'},
{id:'soulhunter',name:'Soul Hunter',cost:4,hp:850,dmg:190,spd:1.5,rng:4,as:1.3,type:'troop',rarity:'legendary',icon:'👻',air:1,desc:'Hunts enemy souls from a distance. Each kill makes it stronger temporarily!'},
{id:'timewalker',name:'Time Walker',cost:5,hp:1000,dmg:160,spd:1.4,rng:3,as:1.0,type:'troop',rarity:'legendary',icon:'⏳',air:1,desc:'Bends time itself! Can blink short distances and attack twice in quick succession!'},
{id:'runemaster',name:'Rune Master',cost:5,hp:750,dmg:280,spd:1.0,rng:5,as:1.8,type:'troop',rarity:'legendary',icon:'🔮',air:1,spl:1.8,desc:'Casts powerful rune magic that explodes on impact. High damage but fragile!'},
{id:'bloodknight',name:'Blood Knight',cost:5,hp:1800,dmg:220,spd:1.1,rng:1,as:1.4,type:'troop',rarity:'legendary',icon:'🩸',air:0,desc:'A vampiric knight that heals with each attack. Sustains through long fights!'},
{id:'spiritbear',name:'Spirit Bear',cost:6,hp:2200,dmg:300,spd:1.0,rng:1,as:1.6,type:'troop',rarity:'legendary',icon:'🐻',air:0,desc:'A mighty spirit bear summoned from the forest. Roars to intimidate nearby enemies!'},
{id:'crystalgolem',name:'Crystal Golem',cost:6,hp:2600,dmg:260,spd:0.8,rng:1,as:1.8,type:'troop',rarity:'legendary',icon:'💠',air:0,shield:800,desc:'A golem made of pure crystal. Shatters into shards when destroyed, dealing area damage!'},
{id:'shadowbeast',name:'Shadow Beast',cost:5,hp:1400,dmg:200,spd:1.6,rng:1,as:1.1,type:'troop',rarity:'legendary',icon:'🦁',air:0,desc:'A fearsome beast from the shadows. Leaps to its target with increased first-strike damage!'},
{id:'infernobeast',name:'Inferno Beast',cost:5,hp:1300,dmg:60,spd:1.3,rng:3,as:0.4,type:'troop',rarity:'legendary',icon:'🔥',air:0,desc:'A hellish creature with ramping fire breath. Damage increases the longer it attacks!'},
{id:'windserpent',name:'Wind Serpent',cost:4,hp:800,dmg:130,spd:2.0,rng:2,as:0.9,type:'troop',rarity:'legendary',icon:'🐍',air:1,fly:1,desc:'A swift serpent riding the wind. Extremely fast and can hit both air and ground!'},
{id:'battlemage',name:'Battle Mage',cost:5,hp:900,dmg:250,spd:1.1,rng:5,as:1.5,type:'troop',rarity:'legendary',icon:'🧙‍♂️',air:1,spl:2,desc:'A mage trained in combat magic. Launches explosive arcane bolts at enemies!'},
// NEW CHAMPION TROOPS (v2.3.2)
{id:'blademaster',name:'Blade Master',cost:5,hp:1900,dmg:200,spd:1.4,rng:1,as:0.9,type:'troop',rarity:'champion',icon:'⚔️',air:0,ability:'multistrike',abilityDesc:'Every 5th attack hits 3 times rapidly!',desc:'A legendary swordsman with unmatched speed. His blade dance strikes multiple times!'},
{id:'earthtitan',name:'Earth Titan',cost:6,hp:3200,dmg:350,spd:0.7,rng:2,as:2.0,type:'troop',rarity:'champion',icon:'🗿',air:0,ability:'earthquake',abilityDesc:'Stomps the ground dealing area damage!',desc:'An ancient titan of the earth. His earthquakes shatter the ground beneath enemies!'},
{id:'frostqueen',name:'Frost Queen',cost:5,hp:1500,dmg:150,spd:1.2,rng:5,as:1.4,type:'troop',rarity:'champion',icon:'❄️',air:1,ability:'blizzard',abilityDesc:'Summons a blizzard freezing all enemies!',desc:'Queen of the frozen north. Commands ice and snow to freeze her foes solid!'},
{id:'thunderlord',name:'Thunder Lord',cost:5,hp:1700,dmg:190,spd:1.3,rng:4,as:1.3,type:'troop',rarity:'champion',icon:'⛈️',air:1,ability:'chainlightning',abilityDesc:'Lightning chains between 5 enemies!',desc:'Master of storms! His chain lightning jumps from enemy to enemy!'},
{id:'voidwalker',name:'Void Walker',cost:4,hp:1400,dmg:210,spd:1.5,rng:1,as:1.1,type:'troop',rarity:'champion',icon:'🌀',air:0,ability:'teleport',abilityDesc:'Teleports behind the furthest enemy!',desc:'Travels through the void between dimensions. Appears where least expected!'},
{id:'sunwarrior',name:'Sun Warrior',cost:5,hp:1800,dmg:180,spd:1.2,rng:1,as:1.2,type:'troop',rarity:'champion',icon:'☀️',air:0,ability:'radiance',abilityDesc:'Emits blinding light damaging nearby foes!',desc:'Blessed by the sun god. Radiates burning light that sears all nearby enemies!'},
{id:'moonpriestess',name:'Moon Priestess',cost:4,hp:1200,dmg:140,spd:1.1,rng:5,as:1.5,type:'troop',rarity:'champion',icon:'🌙',air:1,ability:'moonbeam',abilityDesc:'Heals allies and damages enemies in an area!',desc:'Priestess of the lunar temple. Her moonbeams both heal allies and harm enemies!'},
{id:'warchief',name:'War Chief',cost:5,hp:2000,dmg:170,spd:1.1,rng:1,as:1.4,type:'troop',rarity:'champion',icon:'🪖',air:0,ability:'rally',abilityDesc:'Boosts all nearby allies attack speed!',desc:'A legendary military leader. His war cry rallies all nearby troops to fight harder!'},
{id:'dragonslayer',name:'Dragon Slayer',cost:5,hp:1600,dmg:280,spd:1.3,rng:1,as:1.5,type:'troop',rarity:'champion',icon:'🐉',air:0,ability:'dragonfire',abilityDesc:'Breathes captured dragon fire in a cone!',desc:'Has slain a hundred dragons! Wields their fire as his weapon!'},
{id:'soulreaper',name:'Soul Reaper',cost:4,hp:1300,dmg:220,spd:1.4,rng:1,as:1.2,type:'troop',rarity:'champion',icon:'💀',air:0,ability:'soulharvest',abilityDesc:'Harvests souls to heal and power up!',desc:'Reaps the souls of fallen enemies. Each soul heals and strengthens him!'},
{id:'timemage',name:'Time Mage',cost:5,hp:1100,dmg:160,spd:1.2,rng:5,as:1.3,type:'troop',rarity:'champion',icon:'⏰',air:1,ability:'timewarp',abilityDesc:'Slows time for all enemies for 3 seconds!',desc:'Manipulates the flow of time itself. Can slow enemies to a crawl!'},
{id:'runeknight',name:'Rune Knight',cost:5,hp:1750,dmg:190,spd:1.2,rng:1,as:1.3,type:'troop',rarity:'champion',icon:'🔷',air:0,ability:'runeexplosion',abilityDesc:'Runes explode dealing massive area damage!',desc:'Covered in ancient runes of power. Detonates them for devastating explosions!'},
{id:'bloodbaron',name:'Blood Baron',cost:5,hp:1650,dmg:200,spd:1.3,rng:1,as:1.2,type:'troop',rarity:'champion',icon:'🦇',air:0,ability:'lifesteal',abilityDesc:'Drains HP from all nearby enemies!',desc:'An ancient vampire lord. Drains the life force of all enemies around him!'},
{id:'spiritshaman',name:'Spirit Shaman',cost:5,hp:1400,dmg:170,spd:1.1,rng:4,as:1.4,type:'troop',rarity:'champion',icon:'👁️',air:1,ability:'spiritbomb',abilityDesc:'Launches a spirit bomb that explodes!',desc:'Communes with ancient spirits. Channels their power into devastating spirit bombs!'},
{id:'crystalguardian',name:'Crystal Guardian',cost:5,hp:2100,dmg:160,spd:1.0,rng:1,as:1.5,type:'troop',rarity:'champion',icon:'💎',air:0,ability:'crystalshield',abilityDesc:'Grants shields to all nearby allies!',desc:'Protector of the crystal realm. Can shield allies with crystalline barriers!'},
{id:'shadowassassin',name:'Shadow Assassin',cost:4,hp:1200,dmg:250,spd:1.8,rng:1,as:1.0,type:'troop',rarity:'champion',icon:'🗡️',air:0,ability:'backstab',abilityDesc:'Teleports behind target for critical hit!',desc:'Strikes from the shadows! Backstab ability deals triple damage!'},
{id:'infernolord',name:'Inferno Lord',cost:6,hp:2000,dmg:240,spd:1.0,rng:3,as:1.6,type:'troop',rarity:'champion',icon:'🔥',air:0,ability:'hellfire',abilityDesc:'Summons pillars of hellfire around him!',desc:'Ruler of the infernal realm. Calls down hellfire to incinerate all enemies!'},
{id:'winddancer',name:'Wind Dancer',cost:4,hp:1300,dmg:180,spd:1.7,rng:1,as:0.9,type:'troop',rarity:'champion',icon:'💨',air:0,ability:'tornado',abilityDesc:'Spins into a tornado pulling in enemies!',desc:'Dances with the wind! Creates tornadoes that pull enemies together!'},
{id:'battlemaster',name:'Battle Master',cost:5,hp:1850,dmg:195,spd:1.2,rng:1,as:1.1,type:'troop',rarity:'champion',icon:'🛡️',air:0,ability:'counter',abilityDesc:'Counters the next attack with double damage!',desc:'Master of all combat arts. Can parry any attack and counter with devastating force!'},
// EVOLUTION TROOPS (v2.3.3)
{id:'evo_knight',name:'Evo Knight',cost:4,hp:2200,dmg:220,spd:1.3,rng:1,as:1.0,type:'troop',rarity:'evolution',icon:'⚔️✨',air:0,ability:'shieldcharge',abilityDesc:'Charges forward with an impenetrable shield!',desc:'The Knight evolved! Now charges into battle with devastating shield attacks!'},
{id:'evo_archer',name:'Evo Archer',cost:4,hp:700,dmg:180,spd:1.2,rng:6,as:0.8,type:'troop',rarity:'evolution',icon:'🏹✨',air:0,ability:'tripleshot',abilityDesc:'Fires 3 arrows at once!',desc:'Evolved Archer with triple arrow volleys that pierce through enemies!'},
{id:'evo_giant',name:'Evo Giant',cost:6,hp:5500,dmg:280,spd:0.8,rng:1,as:1.8,type:'troop',rarity:'evolution',icon:'🗿✨',air:0,ability:'groundpound',abilityDesc:'Slams the ground stunning nearby enemies!',desc:'The Giant evolved into an unstoppable force! Ground pounds stun all enemies!'},
{id:'evo_wizard',name:'Evo Wizard',cost:6,hp:1100,dmg:320,spd:1.0,rng:5.5,as:1.3,type:'troop',rarity:'evolution',icon:'🔮✨',air:0,ability:'chainlightning',abilityDesc:'Spells chain between multiple targets!',desc:'Master of evolved magic! Spells chain between enemies for massive damage!'},
{id:'evo_witch',name:'Evo Witch',cost:6,hp:1000,dmg:160,spd:1.0,rng:5,as:1.1,type:'troop',rarity:'evolution',icon:'🧙‍♀️✨',air:0,ability:'masssummon',abilityDesc:'Summons a horde of skeletons at once!',desc:'Her dark powers evolved! Summons an entire skeleton army instantly!'},
{id:'evo_valkyrie',name:'Evo Valkyrie',cost:5,hp:2400,dmg:260,spd:1.2,rng:1,as:1.3,type:'troop',rarity:'evolution',icon:'⚔️✨',air:0,ability:'whirlwindrage',abilityDesc:'Spins faster gaining damage with each hit!',desc:'Valkyrie evolved with endless rage! Her whirlwind grows stronger each spin!'},
{id:'evo_hog',name:'Evo Hog Rider',cost:5,hp:2100,dmg:380,spd:1.8,rng:1,as:1.4,type:'troop',rarity:'evolution',icon:'🐗✨',air:0,ability:'jumpsmash',abilityDesc:'Leaps over defenses and smashes down!',desc:'Hog Rider evolved! Now leaps over buildings to smash enemies from above!'},
{id:'evo_minipekka',name:'Evo Mini PEKKA',cost:5,hp:1800,dmg:700,spd:1.3,rng:1,as:1.6,type:'troop',rarity:'evolution',icon:'🤖✨',air:0,ability:'berserker',abilityDesc:'Attack speed doubles below 50% HP!',desc:'Mini PEKKA evolved into a berserker! Attacks twice as fast when wounded!'},
{id:'evo_musketeer',name:'Evo Musketeer',cost:5,hp:950,dmg:250,spd:1.0,rng:6.5,as:0.9,type:'troop',rarity:'evolution',icon:'🔫✨',air:0,ability:'piercingshot',abilityDesc:'Shots pierce through all enemies in a line!',desc:'Evolved Musketeer with armor-piercing rounds that hit all enemies in a line!'},
{id:'evo_prince',name:'Evo Prince',cost:6,hp:2200,dmg:420,spd:1.5,rng:1,as:1.2,type:'troop',rarity:'evolution',icon:'🤴✨',air:0,ability:'doublecharge',abilityDesc:'Can charge twice before cooldown!',desc:'The Prince evolved! Can perform two devastating charges in rapid succession!'},
{id:'evo_goblin',name:'Evo Goblin Gang',cost:4,hp:400,dmg:150,spd:1.6,rng:1,as:0.8,type:'troop',rarity:'evolution',icon:'👺✨',air:0,spl:5,ability:'stealthstrike',abilityDesc:'Goblins turn invisible for 2 seconds!',desc:'Evolved goblins with stealth technology! Disappear and strike from the shadows!'},
{id:'evo_dragon',name:'Evo Baby Dragon',cost:5,hp:1600,dmg:180,spd:1.1,rng:3.5,as:1.4,type:'troop',rarity:'evolution',icon:'🐲✨',air:1,ability:'infernoblast',abilityDesc:'Breath attack intensifies over time!',desc:'Baby Dragon evolved! Fire breath grows hotter dealing increasing damage!'},
{id:'evo_balloon',name:'Evo Balloon',cost:6,hp:2200,dmg:800,spd:0.9,rng:1,as:2.5,type:'troop',rarity:'evolution',icon:'🎈✨',air:1,ability:'clusterbomb',abilityDesc:'Drops multiple bombs in an area!',desc:'Evolved Balloon with cluster bomb technology! Rains destruction from above!'},
{id:'evo_skeleton',name:'Evo Skeleton Army',cost:4,hp:100,dmg:120,spd:1.4,rng:1,as:0.7,type:'troop',rarity:'evolution',icon:'💀✨',air:0,spl:15,ability:'bonerevive',abilityDesc:'Fallen skeletons revive once!',desc:'Evolved skeleton army! Each skeleton can reassemble and fight again!'},
{id:'evo_golem',name:'Evo Golem',cost:9,hp:7500,dmg:350,spd:0.6,rng:1,as:2.2,type:'troop',rarity:'evolution',icon:'🪨✨',air:0,ability:'rockarmor',abilityDesc:'Gains damage reduction as HP drops!',desc:'The ultimate Golem evolution! Rock armor hardens as it takes damage!'},
{id:'evo_pekka',name:'Evo PEKKA',cost:8,hp:5000,dmg:950,spd:0.9,rng:1,as:1.6,type:'troop',rarity:'evolution',icon:'🤖✨',air:0,ability:'executioner',abilityDesc:'Instantly defeats enemies below 15% HP!',desc:'PEKKA evolved into an executioner! One-shots weakened enemies!'},
{id:'evo_witch2',name:'Evo Night Witch',cost:5,hp:1100,dmg:180,spd:1.0,rng:1,as:1.2,type:'troop',rarity:'evolution',icon:'🦇✨',air:0,ability:'batswarm',abilityDesc:'Summons a massive bat swarm on death!',desc:'Night Witch evolved! Releases an enormous bat swarm when defeated!'},
{id:'evo_lumberjack',name:'Evo Lumberjack',cost:5,hp:1600,dmg:280,spd:1.5,rng:1,as:0.6,type:'troop',rarity:'evolution',icon:'🪓✨',air:0,ability:'rageaura',abilityDesc:'Constantly emits rage to nearby allies!',desc:'Evolved Lumberjack radiates constant rage energy to empower allies!'},
{id:'evo_electrowiz',name:'Evo Electro Wizard',cost:5,hp:950,dmg:220,spd:1.0,rng:5,as:1.5,type:'troop',rarity:'evolution',icon:'⚡✨',air:0,ability:'overload',abilityDesc:'Stuns all enemies in range on spawn!',desc:'Electro Wizard evolved! Creates a massive EMP blast stunning everything!'},
// NEW CARDS (v2.5.0)
{id:'stormspirit',name:'Storm Spirit',cost:2,hp:180,dmg:90,spd:2.0,rng:3,as:1.0,type:'troop',rarity:'common',icon:'🌩️',air:1,fly:1,desc:'A swift spirit of the storm! Zips through the air zapping enemies with lightning.'},
{id:'gravedigger',name:'Grave Digger',cost:4,hp:900,dmg:200,spd:1.1,rng:1,as:1.3,type:'troop',rarity:'rare',icon:'⛏️',air:0,desc:'Digs through the battlefield! Spawns a skeleton each time he defeats an enemy.'},
{id:'infernaltower',name:'Infernal Tower',cost:5,hp:1200,dmg:40,spd:0,rng:6,as:0.3,type:'building',rarity:'epic',icon:'🗼',desc:'A demonic tower with ramping fire beam that melts tanks over time!'},
{id:'cosmicdragon',name:'Cosmic Dragon',cost:7,hp:2400,dmg:300,spd:1.0,rng:4,as:1.5,type:'troop',rarity:'legendary',icon:'🌌',air:1,fly:1,spl:2,desc:'A dragon from beyond the stars! Breathes cosmic fire that damages all in its path.'},
{id:'evo_sparky',name:'Evo Sparky',cost:7,hp:1800,dmg:1300,spd:0.9,rng:5,as:3.5,type:'troop',rarity:'evolution',icon:'🔋✨',air:0,spl:1.5,ability:'overcharge',abilityDesc:'Charges twice as fast after each kill!',desc:'Sparky evolved with unstable power! Charges faster with each enemy defeated!'}
];
const STARTER_CARDS=['knight','archer','goblin','skel','minion','bomber','arrows','zap','giant','musk','valk','hog'];
const EMOTES=['😄','😢','😠','🤔','👍','👎','😎','🔥','💀'];
// 50 Emotes with categories and unlock requirements
const ALL_EMOTES=[
  // Basic Emotes (unlocked by default or early tiers)
  {id:'e1',icon:'😄',name:'Happy',category:'basic',unlocked:true},
  {id:'e2',icon:'😢',name:'Crying',category:'basic',unlocked:true},
  {id:'e3',icon:'😠',name:'Angry',category:'basic',unlocked:true},
  {id:'e4',icon:'🤔',name:'Thinking',category:'basic',unlocked:true},
  {id:'e5',icon:'👍',name:'Thumbs Up',category:'basic',tier:2},
  {id:'e6',icon:'👎',name:'Thumbs Down',category:'basic',tier:3},
  {id:'e7',icon:'😎',name:'Cool',category:'basic',tier:4},
  {id:'e8',icon:'🔥',name:'Fire',category:'basic',tier:5},
  {id:'e9',icon:'💀',name:'Skull',category:'basic',tier:6},
  {id:'e10',icon:'😱',name:'Shocked',category:'basic',tier:7},
  // Taunt Emotes
  {id:'e11',icon:'😏',name:'Smirk',category:'taunt',tier:8},
  {id:'e12',icon:'😈',name:'Devil',category:'taunt',tier:9},
  {id:'e13',icon:'🤡',name:'Clown',category:'taunt',tier:10},
  {id:'e14',icon:'👻',name:'Ghost',category:'taunt',tier:11},
  {id:'e15',icon:'💪',name:'Flex',category:'taunt',tier:12},
  {id:'e16',icon:'🙄',name:'Eye Roll',category:'taunt',tier:13},
  {id:'e17',icon:'😤',name:'Huffing',category:'taunt',tier:14},
  {id:'e18',icon:'🤫',name:'Shush',category:'taunt',tier:15},
  {id:'e19',icon:'😜',name:'Wink',category:'taunt',tier:16},
  {id:'e20',icon:'🤪',name:'Crazy',category:'taunt',tier:17},
  // Reaction Emotes
  {id:'e21',icon:'😲',name:'Amazed',category:'reaction',tier:18},
  {id:'e22',icon:'🥳',name:'Party',category:'reaction',tier:19},
  {id:'e23',icon:'🤯',name:'Mind Blown',category:'reaction',tier:20},
  {id:'e24',icon:'😵',name:'Dizzy',category:'reaction',tier:21},
  {id:'e25',icon:'🥶',name:'Frozen',category:'reaction',tier:22},
  {id:'e26',icon:'🥵',name:'Hot',category:'reaction',tier:23},
  {id:'e27',icon:'😴',name:'Sleepy',category:'reaction',tier:24},
  {id:'e28',icon:'🤢',name:'Sick',category:'reaction',tier:25},
  {id:'e29',icon:'💔',name:'Heartbreak',category:'reaction',tier:26},
  {id:'e30',icon:'❤️',name:'Love',category:'reaction',tier:27},
  // Celebration Emotes
  {id:'e31',icon:'🎉',name:'Celebrate',category:'celebration',tier:28},
  {id:'e32',icon:'🏆',name:'Trophy',category:'celebration',tier:29},
  {id:'e33',icon:'⭐',name:'Star',category:'celebration',tier:30},
  {id:'e34',icon:'💎',name:'Diamond',category:'celebration',tier:31},
  {id:'e35',icon:'👑',name:'Crown',category:'celebration',tier:32},
  {id:'e36',icon:'🎯',name:'Bullseye',category:'celebration',tier:33},
  {id:'e37',icon:'🚀',name:'Rocket',category:'celebration',tier:34},
  {id:'e38',icon:'💥',name:'Boom',category:'celebration',tier:35},
  {id:'e39',icon:'⚡',name:'Lightning',category:'celebration',premium:true},
  {id:'e40',icon:'🌟',name:'Sparkle',category:'celebration',premium:true},
  // Premium Emotes
  {id:'e41',icon:'🦁',name:'Lion',category:'premium',premium:true},
  {id:'e42',icon:'🐉',name:'Dragon',category:'premium',premium:true},
  {id:'e43',icon:'🦅',name:'Eagle',category:'premium',premium:true},
  {id:'e44',icon:'🐺',name:'Wolf',category:'premium',premium:true},
  {id:'e45',icon:'🦈',name:'Shark',category:'premium',premium:true},
  {id:'e46',icon:'⚔️',name:'Swords',category:'premium',premium:true},
  {id:'e47',icon:'🛡️',name:'Shield',category:'premium',premium:true},
  {id:'e48',icon:'💣',name:'Bomb',category:'premium',premium:true},
  {id:'e49',icon:'🔮',name:'Crystal Ball',category:'premium',premium:true},
  {id:'e50',icon:'🔱',name:'Trident',category:'premium',premium:true}
];
// 15 Tower Skins
const TOWER_SKINS=[
  {id:'tower_default',name:'Default Tower',icon:'🏰',desc:'Classic castle tower',color:'#4a4a6a',unlocked:true},
  {id:'tower_fire',name:'Fire Tower',icon:'🔥',desc:'Burning inferno tower',color:'#ff4500',tier:5,premium:false},
  {id:'tower_ice',name:'Ice Tower',icon:'❄️',desc:'Frozen fortress',color:'#00bfff',tier:10,premium:false},
  {id:'tower_dark',name:'Dark Tower',icon:'🌑',desc:'Shadow realm tower',color:'#2d2d44',tier:15,premium:false},
  {id:'tower_gold',name:'Golden Tower',icon:'👑',desc:'Royal golden palace',color:'#ffd700',tier:20,premium:true},
  {id:'tower_crystal',name:'Crystal Tower',icon:'💎',desc:'Sparkling crystal spire',color:'#e0b0ff',tier:25,premium:true},
  {id:'tower_dragon',name:'Dragon Tower',icon:'🐉',desc:'Ancient dragon lair',color:'#8b0000',tier:30,premium:true},
  {id:'tower_electric',name:'Electric Tower',icon:'⚡',desc:'High voltage fortress',color:'#ffff00',tier:35,premium:true},
  {id:'tower_nature',name:'Nature Tower',icon:'🌿',desc:'Living tree fortress',color:'#228b22',tier:8,premium:false},
  {id:'tower_void',name:'Void Tower',icon:'🕳️',desc:'Portal to the void',color:'#4b0082',tier:28,premium:true},
  {id:'tower_rainbow',name:'Rainbow Tower',icon:'🌈',desc:'Magical prismatic tower',color:'linear-gradient(135deg,red,orange,yellow,green,blue,purple)',tier:33,premium:true},
  {id:'tower_star',name:'Starlight Tower',icon:'⭐',desc:'Celestial beacon',color:'#fffacd',tier:12,premium:false},
  {id:'tower_lava',name:'Lava Tower',icon:'🌋',desc:'Volcanic eruption base',color:'#ff6600',tier:18,premium:false},
  {id:'tower_ocean',name:'Ocean Tower',icon:'🌊',desc:'Underwater palace',color:'#006994',tier:22,premium:true},
  {id:'tower_skeleton',name:'Skeleton Tower',icon:'💀',desc:'Bone fortress of doom',color:'#d3d3d3',tier:7,premium:false}
];
const CHEST_TYPES=[{id:'silver',name:'Silver',icon:'📦',time:180,gold:[200,400],cards:2},{id:'gold',name:'Golden',icon:'🎁',time:480,gold:[500,1000],cards:3},{id:'magic',name:'Magical',icon:'✨',time:720,gold:[1000,2000],cards:4},{id:'giant',name:'Giant',icon:'🏆',time:1440,gold:[2000,4000],cards:5},{id:'legendary',name:'Legendary',icon:'👑',time:2880,gold:[5000,10000],cards:6},{id:'super',name:'Super',icon:'💎',time:4320,gold:[10000,20000],cards:8}];
const BOT_NAMES=['xXSlayerXx','ProGamer99','ClashKing','TowerCrusher','EliteWarrior','DragonMaster','ShadowNinja','BattleLord','ThunderStrike','IceQueen','FirePhoenix','DarkKnight','StormBringer','RoyalChamp','MightyTitan','SwiftArrow','IronFist','GhostRider','StarLord','NightHawk','BlazeMaster','FrostBite','CyberWolf','PixelKing','NoobSlayer','EpicGamer','LegendX','Destroyer99','ChampionX','VictoryKing'];
const SHOP_ITEMS=[{id:'gold1',name:'Pile of Gold',desc:'1,000 Gold',icon:'💰',price:50,currency:'gems',reward:{gold:1000}},{id:'gold2',name:'Sack of Gold',desc:'5,000 Gold',icon:'💰',price:200,currency:'gems',reward:{gold:5000}},{id:'gold3',name:'Vault of Gold',desc:'20,000 Gold',icon:'💰',price:700,currency:'gems',reward:{gold:20000}},{id:'gold4',name:'Treasury',desc:'100,000 Gold',icon:'🏦',price:3000,currency:'gems',reward:{gold:100000},special:true},{id:'gems1',name:'Handful of Gems',desc:'100 Gems',icon:'💎',price:1000,currency:'gold',reward:{gems:100}},{id:'gems2',name:'Pouch of Gems',desc:'500 Gems',icon:'💎',price:4500,currency:'gold',reward:{gems:500}},{id:'gems3',name:'Gem Vault',desc:'2000 Gems',icon:'💎',price:15000,currency:'gold',reward:{gems:2000}},{id:'chest1',name:'Silver Chest',desc:'Instant open!',icon:'📦',price:30,currency:'gems',reward:{chest:'silver'}},{id:'chest2',name:'Golden Chest',desc:'Great rewards!',icon:'🎁',price:80,currency:'gems',reward:{chest:'gold'}},{id:'chest3',name:'Magical Chest',desc:'Epic loot!',icon:'✨',price:200,currency:'gems',reward:{chest:'magic'}},{id:'chest4',name:'Giant Chest',desc:'Massive rewards!',icon:'🏆',price:400,currency:'gems',reward:{chest:'giant'}},{id:'chest5',name:'Legendary Chest',desc:'Guaranteed legendary!',icon:'👑',price:800,currency:'gems',reward:{chest:'legendary'},special:true},{id:'chest6',name:'Super Chest',desc:'Ultimate rewards!',icon:'💎',price:1500,currency:'gems',reward:{chest:'super'},special:true},{id:'common1',name:'Common Shards',desc:'Random +10',icon:'🤍',price:100,currency:'gold',reward:{shards:{rarity:'common',amount:10}}},{id:'common2',name:'Common Bundle',desc:'Random +50',icon:'🤍',price:400,currency:'gold',reward:{shards:{rarity:'common',amount:50}}},{id:'rare1',name:'Rare Shards',desc:'Random +8',icon:'🧡',price:400,currency:'gold',reward:{shards:{rarity:'rare',amount:8}}},{id:'rare2',name:'Rare Bundle',desc:'Random +30',icon:'🧡',price:1200,currency:'gold',reward:{shards:{rarity:'rare',amount:30}}},{id:'epic1',name:'Epic Shards',desc:'Random +5',icon:'💜',price:1500,currency:'gold',reward:{shards:{rarity:'epic',amount:5}}},{id:'epic2',name:'Epic Bundle',desc:'Random +20',icon:'💜',price:5000,currency:'gold',reward:{shards:{rarity:'epic',amount:20}}},{id:'legendary1',name:'Legendary Shards',desc:'Random +3',icon:'❤️',price:300,currency:'gems',reward:{shards:{rarity:'legendary',amount:3}}},{id:'legendary2',name:'Legendary Bundle',desc:'Random +10',icon:'❤️',price:800,currency:'gems',reward:{shards:{rarity:'legendary',amount:10}},special:true},{id:'champion1',name:'Champion Shards',desc:'Random +2',icon:'💙',price:500,currency:'gems',reward:{shards:{rarity:'champion',amount:2}},special:true},{id:'champion2',name:'Champion Bundle',desc:'Random +8',icon:'💙',price:1500,currency:'gems',reward:{shards:{rarity:'champion',amount:8}},special:true},{id:'megapack',name:'MEGA PACK',desc:'+5000G +50💎 +20 Shards',icon:'🎁',price:400,currency:'gems',reward:{gold:5000,gems:50,shards:{rarity:'random',amount:20}},special:true},{id:'ultrapack',name:'ULTRA PACK',desc:'+20000G +200💎 +50 Shards',icon:'🎊',price:1500,currency:'gems',reward:{gold:20000,gems:200,shards:{rarity:'random',amount:50}},special:true},{id:'wild',name:'Wild Card',desc:'Upgrade any card of your choice!',icon:'🎴',price:1000,currency:'gems',reward:{wild:1},special:true},{id:'book',name:'Book of Cards',desc:'Upgrade any card of your choice!',icon:'📖',price:5000,currency:'gems',reward:{book:1},special:true},{id:'crystals1',name:'Crystal Pack',desc:'100 Crystals',icon:'💠',price:500,currency:'gems',reward:{crystals:100}},{id:'crystals2',name:'Crystal Vault',desc:'500 Crystals',icon:'💠',price:2000,currency:'gems',reward:{crystals:500}},{id:'crystals3',name:'Crystal Treasury',desc:'2000 Crystals',icon:'💠',price:7000,currency:'gems',reward:{crystals:2000},special:true},{id:'emote1',name:'Extra Emotes',desc:'Unlock funny emotes',icon:'😜',price:50,currency:'crystals',reward:{emotes:['🤣','😜','🤪','😏','😒']}},{id:'emote2',name:'Pro Emotes',desc:'Unlock pro emotes',icon:'😈',price:100,currency:'crystals',reward:{emotes:['💪','🎯','⭐','🏆','💥']}},{id:'megaupgrade',name:'Mega Upgrade',desc:'Upgrade all cards by 1 level!',icon:'⬆️',price:10000,currency:'crystals',reward:{megaupgrade:1}},{id:'trophyboost',name:'Trophy Boost',desc:'+1000 Trophies',icon:'🏆',price:200,currency:'gems',reward:{trophies:1000}},{id:'starterpack',name:'Starter Pack',desc:'+2000G +100💎 +50💠',icon:'⭐',price:100,currency:'gems',reward:{gold:2000,gems:100,crystals:50},special:true},{id:'dailydeal',name:'Daily Deal',desc:'+500G +25💎 +Chest',icon:'🌟',price:25,currency:'gems',reward:{gold:500,gems:25,chest:'silver'}}];

function getUpgradeCost(level,rarity){const base={common:10,rare:20,epic:40,legendary:80,champion:150};return Math.floor((base[rarity]||10)*(level*1.5));}

let P={name:'Player',deck:[],tr:0,gold:5000,gems:500,crystals:0,emotes:[...EMOTES],wins:0,losses:0,streak:0,maxStr:0,crowns:0,lvls:{},shards:{},unlocked:[...STARTER_CARDS],chests:Array(MAX_CHESTS).fill(null),lbBots:[],lastLbUpdate:0,roadClaimed:[],trophyGainPerWin:150,kingTowerLevel:1,princessLevel:1,compWins:0,compLosses:0,compTrophies:0,compBots:[],compLastUpdate:0,unlockedEmotes:[],equippedEmotes:['e1','e2','e3','e4'],unlockedTowerSkins:[],equippedTowerSkin:'tower_default',starPoints:0,favorites:[],bpLevel:1,bpXp:0,bpPremium:false,bpClaimed:[],crownChestProgress:0,battleLog:[],clan:null,lastDaily:null};
let B=null,holdTimer=null,isHolding=false,currentGameMode='normal';

CARDS.forEach(c=>{P.lvls[c.id]=1;P.shards[c.id]=0;});
try{const s=localStorage.getItem('arena_royale_v3');if(s){const d=JSON.parse(s);P={...P,...d};if(P.chests.length<MAX_CHESTS)P.chests=P.chests.concat(Array(MAX_CHESTS-P.chests.length).fill(null));}}catch(e){}

function initLeaderboard(){if(!P.lbBots||P.lbBots.length===0){P.lbBots=[];for(let i=0;i<99;i++){const name=BOT_NAMES[i%BOT_NAMES.length]+(i>=BOT_NAMES.length?Math.floor(i/BOT_NAMES.length):'');const trophies=Math.min(MAX_TROPHIES,Math.max(0,Math.floor(18000-i*150+Math.random()*200-100)));P.lbBots.push({name,trophies,isBot:true});}P.lastLbUpdate=Date.now();save();}}
initLeaderboard();
checkFirstTimeOpen();
function updateBotTrophies(){P.lbBots.forEach(bot=>{const change = Math.random() < 0.6 ? 10 : -10; bot.trophies = Math.max(0, Math.min(1000000, bot.trophies + change)); bot.change = change;});P.lastLbUpdate=Date.now();save();}
setInterval(()=>{updateBotTrophies(); if(document.getElementById('tabLeaderboard').classList.contains('on')) updateLeaderboard();},1000);
function save(){try{localStorage.setItem('arena_royale_v3',JSON.stringify(P));}catch(e){}}
setInterval(save,5000);
function getArena(t){for(let i=ARENAS.length-1;i>=0;i--)if(t>=ARENAS[i].min)return ARENAS[i];return ARENAS[0];}
function getBotLvl(t){
// Check if forced bot level is set in admin panel
if(P.forceBotLevel)return P.forceBotLevel;
// Bot level scales from 1-100 based on trophies (max 20,000)
// Early game: slow scaling, Late game: faster scaling
if(t<100)return 1;
if(t<300)return 3;
if(t<500)return 5;
if(t<1000)return 10;
if(t<2000)return 15;
if(t<3000)return 20;
if(t<4000)return 28;
if(t<5000)return 35;
if(t<6000)return 42;
if(t<7000)return 50;
if(t<8000)return 58;
if(t<10000)return 65;
if(t<12000)return 72;
if(t<15000)return 82;
if(t<18000)return 90;
return Math.min(100,90+Math.floor((t-18000)/200));
}
function getKingTowerHP(){const baseHP=2500,lvl=Math.min(15,P.kingTowerLevel||1);return Math.floor(baseHP*Math.pow(1.15,lvl-1));}
function getKingTowerDamage(){const baseDMG=50,lvl=Math.min(15,P.kingTowerLevel||1);return Math.floor(baseDMG*Math.pow(1.15,lvl-1));}
function getKingTowerUpgradeCost(){const lvl=P.kingTowerLevel||1;return 1000000*Math.pow(2,lvl-1);}
function upgradeKingTower(){if((P.kingTowerLevel||1)>=15){showNotify('King Tower is already max level!','info','🏰');return;}const cost=getKingTowerUpgradeCost();if(P.gold>=cost){P.gold-=cost;P.kingTowerLevel=(P.kingTowerLevel||1)+1;P.princessLevel=(P.princessLevel||1)+1;save();updateKingTowerUI();updatePrincessUI();updateShop();playSound('upgrade');showNotify('🏰 King Tower Upgraded!\nLevel '+(P.kingTowerLevel||1),'success');}else{showNotify('Not enough gold!','error','💰');}}
function updateKingTowerUI(){const lvlEl=document.getElementById('kingLvlDisplay'),hpEl=document.getElementById('kingHPDisplay'),dmgEl=document.getElementById('kingDMGDisplay'),costEl=document.getElementById('kingUpgradeCost');if(lvlEl)lvlEl.textContent=P.kingTowerLevel||1;if(hpEl)hpEl.textContent=getKingTowerHP();if(dmgEl)dmgEl.textContent=getKingTowerDamage();if(costEl)costEl.textContent=getKingTowerUpgradeCost().toLocaleString();}
function getPrincessHP(){const baseHP=1000,lvl=Math.min(15,P.princessLevel||1);return Math.floor(baseHP*Math.pow(1.15,lvl-1));}
function getPrincessDamage(){const baseDMG=100,lvl=Math.min(15,P.princessLevel||1);return Math.floor(baseDMG*Math.pow(1.15,lvl-1));}
function upgradePrincess(){if((P.princessLevel||1)>=15){showNotify('Princess is already max level!','info','👸');return;}const cost=100000;if(P.gold>=cost){P.gold-=cost;P.princessLevel=(P.princessLevel||1)+1;save();updatePrincessUI();playSound('upgrade');showNotify('👸 Princess Upgraded!\nLevel '+(P.princessLevel||1),'success');}else{showNotify('Not enough gold!','error','💰');}}
function updatePrincessUI(){const lvlEl=document.getElementById('princessLvlDisplay'),hpEl=document.getElementById('princessHPDisplay'),dmgEl=document.getElementById('princessDMGDisplay');if(lvlEl)lvlEl.textContent=P.princessLevel||1;if(hpEl)hpEl.textContent=getPrincessHP();if(dmgEl)dmgEl.textContent=getPrincessDamage();}
function getCard(id){return CARDS.find(c=>c.id===id);}
function getLvlCard(id){const c=getCard(id);if(!c)return null;const l=P.lvls[id]||1,m=1+(l-1)*0.1;return{...c,lvl:l,hp:c.hp?Math.floor(c.hp*m):0,dmg:Math.floor(c.dmg*m)};}
function fmt(s){const m=Math.floor(s/60),ss=Math.floor(s%60);return`${m}:${ss.toString().padStart(2,'0')}`;}
function isRanked(){return P.tr>=RANKED_THRESHOLD;}
function updatePlayerName(){const input=document.getElementById('playerNameInput');if(input&&input.value.trim()){P.name=input.value.trim().substring(0,15);save();updateLeaderboard();}}

function showPatchNotes(){const modal=document.createElement('div');modal.className='confirm-modal';modal.id='patchNotesModal';modal.style.cssText='padding:40px 20px;box-sizing:border-box;overflow-y:auto';modal.onclick=(e)=>{if(e.target===modal)closePatchNotes();};let notesHtml=PATCH_NOTES.map((p,i)=>`<div style="background:linear-gradient(145deg,#1b2838,#152232);border:2px solid ${i===0?'#00d4aa':'#34495e'};border-radius:12px;padding:15px;margin-bottom:12px;${i===0?'box-shadow:0 0 15px rgba(0,212,170,0.3)':''}"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div style="font-family:'Lilita One',cursive;font-size:18px;color:${i===0?'#00d4aa':'var(--gold)'}">${i===0?'🆕 ':''} v${p.version}</div><div style="font-size:10px;color:#6b7c8a">${p.date}</div></div><div style="font-weight:800;font-size:14px;color:#fff;margin-bottom:8px">${p.title}</div><ul style="list-style:none;padding:0;margin:0">${p.notes.map(n=>`<li style="font-size:11px;color:#aaa;padding:4px 0;border-bottom:1px solid #2a3a4a">• ${n}</li>`).join('')}</ul></div>`).join('');modal.innerHTML=`<div style="background:linear-gradient(145deg,#0d1b2a,#1b2838);border:3px solid #00d4aa;border-radius:16px;padding:20px;max-width:360px;width:100%;max-height:calc(100vh - 80px);overflow-y:auto;margin:0 auto"><div style="text-align:center;margin-bottom:15px"><div style="font-family:'Lilita One',cursive;font-size:24px;background:linear-gradient(90deg,#00d4aa,#00ff88);-webkit-background-clip:text;-webkit-text-fill-color:transparent">📋 PATCH NOTES</div><div style="font-size:10px;color:#6b7c8a">What's new in Arena Royale</div></div>${notesHtml}<button onclick="closePatchNotes()" style="width:100%;padding:12px;background:linear-gradient(180deg,#00d4aa,#00a888);border:none;border-radius:10px;color:#fff;font-weight:800;font-size:14px;cursor:pointer;margin-top:10px">Got it!</button></div>`;document.body.appendChild(modal);localStorage.setItem('patchNotesViewed','2.1.0');}
function closePatchNotes(){const modal=document.getElementById('patchNotesModal');if(modal)modal.remove();}
function checkFirstTimeOpen(){const viewed=localStorage.getItem('patchNotesViewed');if(viewed!=='2.1.0')setTimeout(()=>showPatchNotes(),500);}

// PVP Challenge Functions
function showPvpChallenge(){
  if(!NET.isOnline){showNotify('You must be online to challenge players!','error','❌');return;}
  NET.send('get_online_players',{});
}

function showOnlinePlayersModal(players){
  const modal=document.createElement('div');
  modal.className='confirm-modal';
  modal.id='pvpPlayersModal';
  modal.style.cssText='padding:40px 20px;box-sizing:border-box;overflow-y:auto';
  modal.onclick=(e)=>{if(e.target===modal)closePvpModals();};

  let playersHtml='';
  if(players.length===0){
    playersHtml='<div style="text-align:center;color:#6b7c8a;padding:20px">No other players online right now</div>';
  }else{
    playersHtml=players.map(p=>`
      <div style="background:linear-gradient(145deg,#1b2838,#152232);border:2px solid #34495e;border-radius:12px;padding:12px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-weight:800;color:#fff">${p.name}</div>
          <div style="font-size:11px;color:#6b7c8a">🏆 ${p.trophies} trophies</div>
        </div>
        <button onclick="sendChallenge('${p.id}')" style="padding:8px 16px;background:linear-gradient(180deg,#e74c3c,#c0392b);border:none;border-radius:8px;color:#fff;font-weight:800;font-size:12px;cursor:pointer">⚔️ Challenge</button>
      </div>
    `).join('');
  }

  modal.innerHTML=`
    <div style="background:linear-gradient(145deg,#0d1b2a,#1b2838);border:3px solid #e74c3c;border-radius:16px;padding:20px;max-width:360px;width:100%;max-height:calc(100vh - 80px);overflow-y:auto;margin:0 auto">
      <div style="text-align:center;margin-bottom:15px">
        <div style="font-family:'Lilita One',cursive;font-size:24px;background:linear-gradient(90deg,#e74c3c,#c0392b);-webkit-background-clip:text;-webkit-text-fill-color:transparent">⚔️ PVP CHALLENGE</div>
        <div style="font-size:10px;color:#6b7c8a">Challenge a player to battle!</div>
      </div>
      <div style="margin-bottom:15px">${playersHtml}</div>
      <button onclick="closePvpModals()" style="width:100%;padding:12px;background:linear-gradient(180deg,#34495e,#2c3e50);border:none;border-radius:10px;color:#fff;font-weight:800;font-size:14px;cursor:pointer">Close</button>
    </div>`;
  document.body.appendChild(modal);
}

function showChallengeReceivedModal(data){
  closePvpModals();
  const modal=document.createElement('div');
  modal.className='confirm-modal';
  modal.id='pvpChallengeModal';
  modal.style.cssText='padding:40px 20px;box-sizing:border-box';

  modal.innerHTML=`
    <div style="background:linear-gradient(145deg,#0d1b2a,#1b2838);border:3px solid #f39c12;border-radius:16px;padding:20px;max-width:320px;width:100%;margin:0 auto;text-align:center">
      <div style="font-size:48px;margin-bottom:10px">⚔️</div>
      <div style="font-family:'Lilita One',cursive;font-size:20px;color:#f39c12;margin-bottom:5px">CHALLENGE RECEIVED!</div>
      <div style="font-weight:800;font-size:18px;color:#fff;margin-bottom:5px">${data.challenger_name}</div>
      <div style="font-size:12px;color:#6b7c8a;margin-bottom:20px">🏆 ${data.challenger_trophies} trophies</div>
      <div style="display:flex;gap:10px">
        <button onclick="respondToChallenge('${data.challenger_id}',false)" style="flex:1;padding:12px;background:linear-gradient(180deg,#e74c3c,#c0392b);border:none;border-radius:10px;color:#fff;font-weight:800;font-size:14px;cursor:pointer">❌ Decline</button>
        <button onclick="respondToChallenge('${data.challenger_id}',true)" style="flex:1;padding:12px;background:linear-gradient(180deg,#27ae60,#1e8449);border:none;border-radius:10px;color:#fff;font-weight:800;font-size:14px;cursor:pointer">✓ Accept</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  playSound('notify');
}

function sendChallenge(targetId){
  closePvpModals();
  NET.send('challenge_player',{target_id:targetId});
}

function respondToChallenge(challengerId,accepted){
  closePvpModals();
  NET.send('challenge_response',{challenger_id:challengerId,accepted:accepted});
}

function closePvpModals(){
  const modals=['pvpPlayersModal','pvpChallengeModal'];
  modals.forEach(id=>{const m=document.getElementById(id);if(m)m.remove();});
}

function goTab(t){document.querySelectorAll('.tab').forEach(el=>el.classList.remove('on'));document.querySelectorAll('.nav-btn').forEach(el=>el.classList.remove('on'));document.getElementById('tab'+t).classList.add('on');const idx=['Play','Cards','Chests','Shop','Road','Leaderboard','Stats','Arena'].indexOf(t);if(idx>=0)document.querySelectorAll('.nav-btn')[idx].classList.add('on');if(t==='Play')updatePlay();if(t==='Cards')updateCards(),updateKingTowerUI();if(t==='Chests')updateChests();if(t==='Shop')updateShop();if(t==='Road')updateRoad();if(t==='Leaderboard')updateLeaderboard();if(t==='Stats')updateStats();if(t==='Arena')updateArena();if(t==='Titles')updateTitlesTab();if(t==='MedalsLB')updateMedalsLB();}

function updatePlay(){const a=getArena(P.tr);document.getElementById('dispTr').textContent=P.tr.toLocaleString();document.getElementById('dispArena').textContent=a.icon+' '+a.name;document.getElementById('dispW').textContent=P.wins;document.getElementById('dispL').textContent=P.losses;document.getElementById('dispC').textContent=P.crowns;const btn=document.getElementById('battleBtn'),badge=document.getElementById('rankedBadge');if(isRanked()){btn.className='battle-btn ranked';btn.innerHTML='🔥 RANKED BATTLE!';badge.style.display='inline-block';}else{btn.className='battle-btn';btn.innerHTML='⚔️ BATTLE!';badge.style.display='none';}}

function updateCards(){const el=document.getElementById('deckSlots');if(!el)return;el.innerHTML='';for(let i=0;i<8;i++){const id=P.deck[i],d=document.createElement('div');d.className='deck-slot'+(id?' filled':'');if(id){const c=getCard(id);if(c)d.innerHTML=`<span style="font-size:18px">${c.icon}</span><div class="remove" onclick="event.stopPropagation();rmDeck(${i})">×</div>`;else{P.deck.splice(i,1);i--;continue;}}else d.innerHTML='<span style="color:#4a6278;font-size:16px">+</span>';el.appendChild(d);}document.getElementById('deckCount').textContent=P.deck.length;const makeCard=(c)=>{const unlocked=P.unlocked.includes(c.id),inDeck=P.deck.includes(c.id),shards=P.shards[c.id]||0,lvl=P.lvls[c.id]||1,needed=unlocked?getUpgradeCost(lvl,c.rarity):getUpgradeCost(1,c.rarity),pct=Math.min(100,Math.floor((shards/needed)*100)),d=document.createElement('div');d.className=`game-card ${c.rarity}`+(unlocked?'':' locked')+(inDeck?' in-deck':'');d.innerHTML=`<div class="cost">${c.cost}</div>${unlocked?`<div class="lvl">${lvl}</div>`:''}<div class="icon">${c.icon}</div><div class="name">${c.name}</div>${!unlocked?`<div class="lock-icon">🔒</div><div class="shard-bar"><div class="shard-fill" style="width:${pct}%"></div></div>`:''}`;d.addEventListener('pointerdown',()=>{isHolding=false;holdTimer=setTimeout(()=>{isHolding=true;showCardDetail(c.id);},400);});d.addEventListener('pointerup',()=>{clearTimeout(holdTimer);if(!isHolding)toggleDeck(c.id);isHolding=false;});d.addEventListener('pointerleave',()=>{clearTimeout(holdTimer);isHolding=false;});return d;};['evolution','champion','legendary','epic','rare','common'].forEach(r=>{const grid=document.getElementById(r+'Grid');if(!grid)return;grid.innerHTML='';CARDS.filter(c=>c.rarity===r).forEach(c=>grid.appendChild(makeCard(c)));});}

function showCardDetail(id){const c=getCard(id),unlocked=P.unlocked.includes(id),shards=P.shards[id]||0,lvl=P.lvls[id]||1,needed=unlocked?getUpgradeCost(lvl,c.rarity):getUpgradeCost(1,c.rarity),pct=Math.min(100,Math.floor((shards/needed)*100)),inDeck=P.deck.includes(id),lc=getLvlCard(id);let html=`<div class="card-detail"><div class="big-icon">${c.icon}</div><div class="card-name">${c.name}</div>`;if(unlocked)html+=`<div class="card-level">⭐ Level ${lvl}</div>`;html+=`<div class="card-rarity ${c.rarity}">${c.rarity}</div>`;if(c.desc)html+=`<div class="card-desc" style="font-size:11px;color:#8fa3b3;padding:8px 12px;text-align:center;line-height:1.4;font-style:italic">${c.desc}</div>`;if(c.ability)html+=`<div class="ability-box"><div class="ability-title">⚡ Special: ${c.ability.toUpperCase()}</div><div class="ability-desc">${c.abilityDesc}</div></div>`;if(lc.hp||lc.dmg){html+=`<div class="card-stats">`;if(lc.hp)html+=`<div class="card-stat"><div class="val">${lc.hp}</div><div class="lbl">HP</div></div>`;html+=`<div class="card-stat"><div class="val">${lc.dmg}</div><div class="lbl">DMG</div></div><div class="card-stat"><div class="val">${c.cost}</div><div class="lbl">COST</div></div></div>`;}html+=`<div class="shard-progress"><div style="display:flex;justify-content:space-between"><span>${unlocked?'Upgrade':'Unlock'}</span><span>${shards}/${needed}</span></div><div class="bar"><div class="fill" style="width:${pct}%"></div></div></div>`;if(unlocked){const canUpgrade=shards>=needed&&(lvl<15||P.unlimitedLevels);html+=`<button class="upgrade-btn" ${canUpgrade?`onclick="upgradeCard('${id}')"`:'disabled'}>${(lvl>=15&&!P.unlimitedLevels)?'MAX LEVEL':canUpgrade?`⬆️ UPGRADE TO LV.${lvl+1}`:`Need ${needed-shards} more shards`}</button><button onclick="toggleDeckFromModal('${id}')" style="width:100%;padding:10px;background:linear-gradient(180deg,${inDeck?'var(--red)':'var(--blue)'},${inDeck?'#b83227':'#2475ab'});border:none;border-radius:8px;color:#fff;font-weight:800;font-size:12px;cursor:pointer;margin-top:8px">${inDeck?'Remove from Deck':'Add to Deck'}</button>`;}else html+=`<div style="color:#6b7c8a;font-size:10px;margin-top:8px">🔒 Collect ${needed} shards to unlock</div>`;html+=`</div><button class="modal-close" onclick="closeCardModal()">Close</button>`;document.getElementById('cardModalBox').innerHTML=html;document.getElementById('cardModal').classList.add('on');}
function upgradeCard(id){const c=getCard(id),lvl=P.lvls[id]||1,needed=getUpgradeCost(lvl,c.rarity);if(P.shards[id]>=needed&&(lvl<15||P.unlimitedLevelCard===id)){P.shards[id]-=needed;P.lvls[id]=lvl+1;save();showCardDetail(id);updateCards();}}
function closeCardModal(){document.getElementById('cardModal').classList.remove('on');}
function openUpgradeModal(){document.getElementById('upgradeModalBox').innerHTML='<div class="modal-title">Choose a card to upgrade</div>'+CARDS.filter(c=>P.unlocked.includes(c.id)).map(c=>`<div class="upgrade-card" onclick="upgradeCard('${c.id}')">${c.icon} ${c.name} (Lv.${P.lvls[c.id]||1})</div>`).join('')+'<button class="modal-close" onclick="closeUpgradeModal()">Close</button>';document.getElementById('upgradeModal').classList.add('on');}
function closeUpgradeModal(){document.getElementById('upgradeModal').classList.remove('on');}
function upgradeCard(id){if((P.lvls[id]||1)<15||P.unlimitedLevels){P.lvls[id]=(P.lvls[id]||1)+1;save();updateCards();showNotify('⬆️ Card Upgraded!\nNow Level '+(P.lvls[id]||1),'success');closeUpgradeModal();}else showNotify('Already max level!','info','⚠️');}
function showRankUp(newArena){document.getElementById('rankUpModalBox').innerHTML=`<div class="rank-up-title">🏆 RANK UP!</div><div class="rank-up-arena">${newArena.icon} ${newArena.name}</div><div class="rank-up-desc">Congratulations! You've reached a new arena!</div><button class="modal-close" onclick="closeRankUpModal()">Continue</button>`;document.getElementById('rankUpModal').classList.add('on');}
function closeRankUpModal(){document.getElementById('rankUpModal').classList.remove('on');}
function toggleDeckFromModal(id){toggleDeck(id);showCardDetail(id);updateCards();}
function toggleDeck(id){if(!P.unlocked.includes(id))return;const idx=P.deck.indexOf(id);if(idx>=0)P.deck.splice(idx,1);else{if(P.deck.length>=8)return;P.deck.push(id);}save();updateCards();}
function rmDeck(i){P.deck.splice(i,1);save();updateCards();}
function clearDeck(){P.deck=[];save();updateCards();}
function randomDeck(){P.deck=[];const available=CARDS.filter(c=>P.unlocked.includes(c.id)).sort(()=>0.5-Math.random());for(const c of available){if(P.deck.length>=8)break;P.deck.push(c.id);}save();updateCards();}

function getSkipCost(timeLeft){return Math.max(1,Math.ceil(timeLeft/60));}
function getChestTimeLeft(chest){if(!chest||!chest.unlocking)return Infinity;const type=CHEST_TYPES.find(t=>t.id===chest.type);const elapsed=(Date.now()-chest.startTime)/1000;return Math.max(0,type.time-elapsed);}
function updateChestNotif(){const readyCount=P.chests.filter(c=>c&&c.unlocking&&getChestTimeLeft(c)<=0).length;const notif=document.getElementById('chestNotif');if(readyCount>0){notif.textContent=readyCount;notif.style.display='flex';}else notif.style.display='none';}
function updateChests(){const el=document.getElementById('chestSlots');if(!el)return;document.getElementById('dispGoldC').textContent=P.gold.toLocaleString();document.getElementById('dispGemsC').textContent=P.gems.toLocaleString();const chestCount=P.chests.filter(c=>c!==null).length;document.getElementById('chestCount').textContent=`${chestCount}/${MAX_CHESTS} Chests`;el.innerHTML='';const unlockingIdx=P.chests.findIndex(c=>c&&c.unlocking&&getChestTimeLeft(c)>0);P.chests.forEach((chest,i)=>{const slot=document.createElement('div');if(!chest){slot.className='chest-slot empty';slot.innerHTML='<div class="chest-icon" style="font-size:16px">➕</div>';}else{const type=CHEST_TYPES.find(t=>t.id===chest.type);const timeLeft=getChestTimeLeft(chest),isReady=chest.unlocking&&timeLeft<=0,skipCost=getSkipCost(timeLeft);slot.className='chest-slot has-chest'+(isReady?' ready':'');let html=`<div class="chest-icon">${type.icon}</div><div style="font-size:6px;font-weight:800">${type.name}</div>`;if(chest.unlocking){if(isReady)html+=`<div class="chest-action">OPEN!</div>`;else html+=`<div class="chest-timer">${fmt(timeLeft)}</div><button class="skip-btn" onclick="event.stopPropagation();confirmSkip(${i})">💎${skipCost}</button>`;}else html+=unlockingIdx===-1?`<div class="chest-action">Unlock</div>`:`<div class="chest-timer">${fmt(type.time)}</div>`;slot.innerHTML=html;slot.onclick=()=>handleChestClick(i);}el.appendChild(slot);});}
function confirmSkip(idx){const chest=P.chests[idx];if(!chest||!chest.unlocking)return;const timeLeft=getChestTimeLeft(chest);if(timeLeft<=0)return;const skipCost=getSkipCost(timeLeft);const modal=document.createElement('div');modal.className='confirm-modal';modal.innerHTML=`<div class="confirm-box"><div class="confirm-title">⏩ Skip Timer?</div><div class="confirm-cost">💎 ${skipCost}</div>${P.gems<skipCost?'<div style="color:var(--red);font-size:10px">Not enough gems!</div>':''}<div class="confirm-btns"><button class="confirm-btn no" onclick="this.closest('.confirm-modal').remove()">Cancel</button><button class="confirm-btn yes" ${P.gems<skipCost?'disabled style="opacity:0.5"':''} onclick="skipChest(${idx});this.closest('.confirm-modal').remove()">Skip!</button></div></div>`;document.body.appendChild(modal);}
function skipChest(idx){const chest=P.chests[idx];if(!chest||!chest.unlocking)return;const timeLeft=getChestTimeLeft(chest),skipCost=getSkipCost(timeLeft);if(P.gems<skipCost)return;P.gems-=skipCost;const type=CHEST_TYPES.find(t=>t.id===chest.type);chest.startTime=Date.now()-(type.time*1000);save();updateChests();}
function handleChestClick(idx){const chest=P.chests[idx];if(!chest)return;const timeLeft=getChestTimeLeft(chest);if(chest.unlocking&&timeLeft<=0)openChest(idx);else if(!chest.unlocking){const unlockingIdx=P.chests.findIndex(c=>c&&c.unlocking&&getChestTimeLeft(c)>0);if(unlockingIdx===-1){chest.unlocking=true;chest.startTime=Date.now();save();updateChests();}}}
function getChestCards(type){const cardCount=type.cards,rewards=[];for(let i=0;i<cardCount;i++){let roll=Math.random(),rarity='common';if(type.id==='legendary'||type.id==='super')rarity=Math.random()<0.3?'champion':'legendary';else{if(roll<0.005)rarity='champion';else if(roll<0.02)rarity='legendary';else if(roll<0.08)rarity='epic';else if(roll<0.25)rarity='rare';}const available=CARDS.filter(c=>c.rarity===rarity),card=available[Math.floor(Math.random()*available.length)],isNew=!P.unlocked.includes(card.id),shardsGained=Math.floor(Math.random()*10)+5;rewards.push({card,shardsGained,isNew});}return rewards;}
function openChest(idx){const chest=P.chests[idx],type=CHEST_TYPES.find(t=>t.id===chest.type),goldReward=type.gold[0]+Math.floor(Math.random()*(type.gold[1]-type.gold[0])),gemsReward=Math.floor(Math.random()*20)+10,crystalsReward = Math.floor(Math.random()*10),cardRewards=getChestCards(type);P.gold+=goldReward;P.gems+=gemsReward;P.crystals += crystalsReward;if(Math.random()<0.001){openUpgradeModal();showNotify('📖 Bonus: Book of Cards!\nChoose a card to upgrade!','epic');}cardRewards.forEach(r=>{P.shards[r.card.id]=(P.shards[r.card.id]||0)+r.shardsGained;const needed=getUpgradeCost(1,r.card.rarity);if(P.shards[r.card.id]>=needed&&!P.unlocked.includes(r.card.id)){P.unlocked.push(r.card.id);r.unlocked=true;}});P.chests[idx]=null;save();const overlay=document.createElement('div');overlay.className='chest-open-overlay';let cardsHtml=cardRewards.map(r=>`<div class="reward-card${r.isNew||r.unlocked?' new':''}"><div class="rc-icon">${r.card.icon}</div><div class="rc-name">${r.card.name}</div><div class="rc-shards">+${r.shardsGained}</div>${r.unlocked?'<div class="rc-new">🎉 NEW!</div>':''}</div>`).join('');overlay.innerHTML=`<div class="chest-opening">${type.icon}</div><div class="chest-rewards"><div style="font-family:'Lilita One';font-size:20px;color:var(--gold);margin-bottom:10px">Rewards!</div><div class="reward-item">💰 <span>+${goldReward.toLocaleString()}</span></div><div class="reward-item">💎 <span>+${gemsReward}</span></div><div class="reward-item">💠 <span>+${crystalsReward}</span></div><div style="margin:8px 0;display:flex;flex-wrap:wrap;justify-content:center">${cardsHtml}</div><button style="margin-top:12px;padding:10px 30px;background:var(--gold);border:none;border-radius:10px;font-family:'Lilita One';font-size:14px;color:#fff;cursor:pointer" onclick="this.closest('.chest-open-overlay').remove();updateChests();updateCards();">Collect!</button></div>`;document.body.appendChild(overlay);}
function addChest(chestType){const emptySlot=P.chests.findIndex(c=>c===null);if(emptySlot===-1)return false;P.chests[emptySlot]={type:chestType.id,startTime:null,unlocking:false};save();return true;}
setInterval(()=>{updateChests();updateChestNotif();},1000);

function updateShop(){document.getElementById('dispGoldS').textContent=P.gold.toLocaleString();document.getElementById('dispGemsS').textContent=P.gems.toLocaleString();document.getElementById('dispCrystals').textContent=P.crystals.toLocaleString();const grid=document.getElementById('shopGrid');grid.innerHTML='';const sections=[{title:'⭐ SPECIAL OFFERS',items:SHOP_ITEMS.filter(i=>i.special)},{title:'💰 Resources',items:SHOP_ITEMS.filter(i=>(i.reward.gold||i.reward.gems)&&!i.reward.shards&&!i.special&&!i.reward.trophies)},{title:'📦 Chests',items:SHOP_ITEMS.filter(i=>i.reward.chest&&!i.special)},{title:'🎴 Card Shards',items:SHOP_ITEMS.filter(i=>i.reward.shards&&!i.special)}];sections.forEach(sec=>{if(sec.items.length===0)return;const section=document.createElement('div');section.className='shop-section';section.innerHTML=`<div class="shop-section-title">${sec.title}</div>`;const itemsDiv=document.createElement('div');itemsDiv.className='shop-items';sec.items.forEach(item=>{const div=document.createElement('div');div.className='shop-item'+(item.special?' special':'');div.innerHTML=`<div class="item-icon">${item.icon}</div><div class="item-name">${item.name}</div><div class="item-desc">${item.desc}</div><div class="item-price ${item.currency}">${item.currency==='gems'?'💎':'💰'} ${item.price}</div>`;div.onclick=()=>buyItem(item);itemsDiv.appendChild(div);});section.appendChild(itemsDiv);grid.appendChild(section);});}
function buyItem(item){const currency=item.currency==='gems'?P.gems:P.gold;if(currency<item.price){showNotify(`Not enough ${item.currency}!`,'error');return;}if(item.currency==='gems')P.gems-=item.price;else if(item.currency==='crystals'){if(P.crystals<item.price){showNotify('Not enough crystals!','error','💠');return;}P.crystals-=item.price;}else P.gold-=item.price;if(item.reward.gold)P.gold+=item.reward.gold;if(item.reward.gems)P.gems+=item.reward.gems;if(item.reward.trophies)P.tr=P.tr+item.reward.trophies;if(item.reward.chest){const chestType=CHEST_TYPES.find(t=>t.id===item.reward.chest);if(!addChest(chestType)){showNotify('No empty chest slots!','error','📦');if(item.currency==='gems')P.gems+=item.price;else P.gold+=item.price;return;}}if(item.reward.shards){let rarity=item.reward.shards.rarity;if(rarity==='random'){const rarities=['common','common','common','rare','rare','epic','legendary'];rarity=rarities[Math.floor(Math.random()*rarities.length)];}const cards=CARDS.filter(c=>c.rarity===rarity),card=cards[Math.floor(Math.random()*cards.length)];P.shards[card.id]=(P.shards[card.id]||0)+item.reward.shards.amount;const needed=getUpgradeCost(1,card.rarity);if(P.shards[card.id]>=needed&&!P.unlocked.includes(card.id)){P.unlocked.push(card.id);showNotify(`🎉 Card Unlocked!\n${card.icon} ${card.name}`,'success');}else showNotify(`+${item.reward.shards.amount} ${card.name} shards!`,'success','🎴');}if(item.reward.wild){openUpgradeModal();}if(item.reward.book){openUpgradeModal();}if(item.reward.crystals)P.crystals+=item.reward.crystals;if(item.reward.emotes)P.emotes=[...new Set([...P.emotes,...item.reward.emotes])];if(item.reward.megaupgrade){CARDS.forEach(c=>{if(P.unlocked.includes(c.id)&&(P.lvls[c.id]||1)<15)P.lvls[c.id]=(P.lvls[c.id]||1)+1;});save();updateCards();showNotify('⬆️ MEGA UPGRADE!\nAll cards upgraded!','epic');}save();updateShop();updateChests();updateCards();updatePlay();}

function renderStarShop(){
  const grid=document.getElementById('starShopGrid');
  const balanceEl=document.getElementById('starShopBalance');
  if(!grid)return;
  balanceEl.textContent=(P.starPoints||0).toLocaleString();
  grid.innerHTML='';
  STAR_SHOP_ITEMS.forEach(item=>{
    const canAfford=(P.starPoints||0)>=item.price;
    const tierClass=item.tier||'';
    const div=document.createElement('div');
    div.className='starshop-item '+tierClass+(canAfford?'':' disabled');
    div.innerHTML=`<div class="starshop-icon">${item.icon}</div><div class="starshop-name">${item.name}</div><div class="starshop-desc">${item.desc}</div><div class="starshop-price${canAfford?'':' cant-afford'}">⭐ ${item.price}</div>`;
    div.onclick=()=>buyStarItem(item);
    grid.appendChild(div);
  });
}

function buyStarItem(item){
  if((P.starPoints||0)<item.price){showNotify('Not enough Star Points!','error','⭐');return;}
  P.starPoints-=item.price;
  let msg='';
  switch(item.type){
    case 'gold':P.gold+=item.amount;msg=`+${item.amount.toLocaleString()} Gold`;break;
    case 'gems':P.gems+=item.amount;msg=`+${item.amount} Gems`;break;
    case 'wild':P.royalWildCards=(P.royalWildCards||0)+item.amount;msg=`+${item.amount} Wild Card${item.amount>1?'s':''}`;break;
    case 'chest':
      const chestType=CHEST_TYPES.find(t=>t.id===item.chest);
      if(chestType){if(!addChest(chestType)){showNotify('No empty chest slots!','error','📦');P.starPoints+=item.price;return;}msg=`${chestType.name} Chest added!`;}
      break;
    case 'shards':
      const cards=CARDS.filter(c=>c.rarity===item.rarity);
      const card=cards[Math.floor(Math.random()*cards.length)];
      P.shards[card.id]=(P.shards[card.id]||0)+item.amount;
      const needed=getUpgradeCost(1,card.rarity);
      if(P.shards[card.id]>=needed&&!P.unlocked.includes(card.id)){P.unlocked.push(card.id);showNotify(`🎉 Card Unlocked!\n${card.icon} ${card.name}`,'success');}
      msg=`+${item.amount} ${card.name} shards`;
      break;
    case 'boost':
      if(!P.activeBoosts)P.activeBoosts={};
      P.activeBoosts[item.boostType]={charges:3,type:item.boostType};
      msg='XP Boost activated (3 battles)!';
      break;
  }
  save();renderStarShop();updateShop();updateChests();updateCards();updateStats();updateWorkshop();
  showNotify(`Purchase Complete!\n${msg}`,'success','⭐');
}

function updateRoad(){const container=document.getElementById('roadContainer');container.innerHTML='<div class="road-line"></div>';TROPHY_ROAD.forEach((milestone,idx)=>{const claimed=P.roadClaimed.includes(milestone.tr),canClaim=P.tr>=milestone.tr&&!claimed,locked=P.tr<milestone.tr;const div=document.createElement('div');div.className='road-milestone'+(claimed?' claimed':'')+(canClaim?' current':'')+(locked?' locked':'');div.innerHTML=`<div class="road-icon">${milestone.icon}</div><div class="road-info"><div class="road-trophies">🏆 ${milestone.tr.toLocaleString()}</div><div class="road-reward">${milestone.desc}</div></div>${claimed?'<div class="road-claimed">✅ CLAIMED</div>':canClaim?`<button class="road-claim-btn" onclick="claimRoadReward(${idx})">CLAIM</button>`:''}`;container.appendChild(div);});}
function claimRoadReward(idx){const milestone=TROPHY_ROAD[idx];if(P.tr<milestone.tr||P.roadClaimed.includes(milestone.tr))return;P.roadClaimed.push(milestone.tr);const r=milestone.reward;if(r.gold)P.gold+=r.gold;if(r.gems)P.gems+=r.gems;if(r.chest){const chestType=CHEST_TYPES.find(t=>t.id===r.chest);addChest(chestType);}if(r.shards){const cards=CARDS.filter(c=>c.rarity===r.shards.rarity),card=cards[Math.floor(Math.random()*cards.length)];P.shards[card.id]=(P.shards[card.id]||0)+r.shards.amount;const needed=getUpgradeCost(1,card.rarity);if(P.shards[card.id]>=needed&&!P.unlocked.includes(card.id))P.unlocked.push(card.id);}save();updateRoad();updateChests();updateCards();updateShop();}

async function updateLeaderboard(){
const input=document.getElementById('playerNameInput');if(input)input.value=P.name;
const el=document.getElementById('lbList');
const playerTitle=getCurrentTitle();

// Try to fetch real leaderboard if online
if(NET.isOnline){
  try{
    const data=await NET.api('/api/leaderboard/trophies?limit=130');
    el.innerHTML='';
    const botTitles=['🐣','⚔️','🥊','🎖️','💎','🏅','🥉','🥈','🥇','🏆','👑','🌟'];
    data.players.forEach((p,i)=>{
      const rank=i+1,div=document.createElement('div');
      const isMe=p.id===NET.playerId;
      div.className='lb-row'+(isMe?' you':'')+(rank<=3?' top3':'');
      const titleIcon=botTitles[Math.floor(p.trophies/5000)%botTitles.length];
      div.innerHTML=`<div class="lb-rank">${rank<=3?['🥇','🥈','🥉'][rank-1]:rank}</div><div class="lb-name"><span style="opacity:0.7;margin-right:4px">${titleIcon}</span>${p.name}${isMe?' (YOU)':''}</div><div class="lb-trophies">🏆 ${p.trophies.toLocaleString()}</div>`;
      el.appendChild(div);
    });
    // Show player rank if not in top 130
    if(data.player_rank>130){
      const div=document.createElement('div');div.className='lb-row you';div.style.marginTop='12px';
      div.innerHTML=`<div class="lb-rank">#${data.player_rank}</div><div class="lb-name"><span style="opacity:0.7;margin-right:4px">${playerTitle.icon}</span>${P.name} (YOU)</div><div class="lb-trophies">🏆 ${P.tr.toLocaleString()}</div>`;
      el.appendChild(div);
    }
    return;
  }catch(e){console.warn('Failed to fetch leaderboard:',e);}
}
// Fallback to local bots if offline
const lb=[...P.lbBots,{name:P.name,trophies:P.tr,isBot:false,title:playerTitle}];lb.sort((a,b)=>b.trophies-a.trophies);const top130=lb.slice(0,130);el.innerHTML='';const botTitles=['🐣','⚔️','🥊','🎖️','💎','🏅','🥉','🥈','🥇','🏆','👑','🌟'];top130.forEach((p,i)=>{const rank=i+1,div=document.createElement('div');div.className='lb-row'+(!p.isBot?' you':'')+(rank<=3?' top3':'');const titleIcon=p.isBot?botTitles[Math.floor(p.trophies/5000)%botTitles.length]:p.title.icon;div.innerHTML=`<div class="lb-rank">${rank<=3?['🥇','🥈','🥉'][rank-1]:rank}</div><div class="lb-name"><span style="opacity:0.7;margin-right:4px">${titleIcon}</span>${p.name}${!p.isBot?' (YOU)':''}</div><div class="lb-trophies">🏆 ${p.trophies.toLocaleString()}${p.change>0?'<span class="arrow up">⬆️</span>':p.change<0?'<span class="arrow down">⬇️</span>':''}</div>`;el.appendChild(div);if(p.isBot) p.change=0;});const playerInTop=top130.some(p=>!p.isBot);if(!playerInTop){const allSorted=[...P.lbBots,{name:P.name,trophies:P.tr,isBot:false}].sort((a,b)=>b.trophies-a.trophies);const playerRank=allSorted.findIndex(p=>!p.isBot)+1;const div=document.createElement('div');div.className='lb-row you';div.style.marginTop='12px';div.innerHTML=`<div class="lb-rank">#${playerRank}</div><div class="lb-name"><span style="opacity:0.7;margin-right:4px">${playerTitle.icon}</span>${P.name} (YOU)</div><div class="lb-trophies">🏆 ${P.tr.toLocaleString()}</div>`;el.appendChild(div);}}

// Medals Leaderboard
function initMedalsBots(){
  // Reset bots if they have old high values OR if not initialized
  const needsReset=!P.medalsBots||P.medalsBots.length===0||(P.medalsBots[0]&&P.medalsBots[0].medals>500);
  if(needsReset){
    P.medalsBots=[];
    for(let i=0;i<99;i++){
      const name=BOT_NAMES[i%BOT_NAMES.length]+(i>=BOT_NAMES.length?Math.floor(i/BOT_NAMES.length):'');
      const medals=100; // Everyone starts at 100
      P.medalsBots.push({name,medals,isBot:true});
    }
    save();
  }
}

function updateMedalsLB(){
  initMedalsBots();
  // Update player stats display
  const yourMedals=document.getElementById('medalsLbYourMedals');
  const winsEl=document.getElementById('medalsLbWins');
  const lossesEl=document.getElementById('medalsLbLosses');
  const bestEl=document.getElementById('medalsLbBest');
  if(yourMedals)yourMedals.textContent='🏅 '+(P.medals||0).toLocaleString();
  if(winsEl)winsEl.textContent=P.medalsWins||0;
  if(lossesEl)lossesEl.textContent=P.medalsLosses||0;
  if(bestEl)bestEl.textContent=P.medalsHighest||0;

  // Bots slowly gain medals (only gain, never lose much)
  P.medalsBots.forEach(bot=>{
    // 80% chance to gain 1-15 medals, 20% chance to lose 0-5
    if(Math.random()<0.8){
      bot.medals+=Math.floor(Math.random()*15)+1;
    }else{
      bot.medals=Math.max(0,bot.medals-Math.floor(Math.random()*5));
    }
  });

  const playerTitle=getCurrentTitle();
  const lb=[...P.medalsBots,{name:P.name,medals:P.medals||0,isBot:false,title:playerTitle}];
  lb.sort((a,b)=>b.medals-a.medals);
  const top100=lb.slice(0,100);

  const el=document.getElementById('medalsLbList');
  if(!el)return;
  el.innerHTML='';
  const botTitles=['🐣','⚔️','🥊','🎖️','💎','🏅','🥉','🥈','🥇','🏆','👑','🌟'];

  top100.forEach((p,i)=>{
    const rank=i+1;
    const div=document.createElement('div');
    div.className='lb-row'+(!p.isBot?' you':'')+(rank<=3?' top3':'');
    div.style.background=rank<=3?'linear-gradient(145deg,#ffd700,#ff8c00)':'';
    const titleIcon=p.isBot?botTitles[Math.floor(p.medals/500)%botTitles.length]:p.title.icon;
    div.innerHTML=`<div class="lb-rank">${rank<=3?['🥇','🥈','🥉'][rank-1]:rank}</div><div class="lb-name"><span style="opacity:0.7;margin-right:4px">${titleIcon}</span>${p.name}${!p.isBot?' (YOU)':''}</div><div class="lb-trophies" style="color:#ffd700">🏅 ${p.medals.toLocaleString()}</div>`;
    el.appendChild(div);
  });

  const playerInTop=top100.some(p=>!p.isBot);
  if(!playerInTop){
    const allSorted=[...P.medalsBots,{name:P.name,medals:P.medals||0,isBot:false}].sort((a,b)=>b.medals-a.medals);
    const playerRank=allSorted.findIndex(p=>!p.isBot)+1;
    const div=document.createElement('div');
    div.className='lb-row you';
    div.style.marginTop='12px';
    div.innerHTML=`<div class="lb-rank">#${playerRank}</div><div class="lb-name"><span style="opacity:0.7;margin-right:4px">${playerTitle.icon}</span>${P.name} (YOU)</div><div class="lb-trophies" style="color:#ffd700">🏅 ${(P.medals||0).toLocaleString()}</div>`;
    el.appendChild(div);
  }
}

function updateStats(){const a=getArena(P.tr);const totalBattles=P.wins+P.losses;const winRate=totalBattles>0?Math.round((P.wins/totalBattles)*100):0;const avgCrowns=totalBattles>0?Math.round(P.crowns/totalBattles*10)/10:0;const stats=[{i:'🏆',v:P.tr.toLocaleString(),l:'Trophies'},{i:'🏟️',v:a.name,l:'Arena'},{i:'✅',v:P.wins,l:'Wins'},{i:'❌',v:P.losses,l:'Losses'},{i:'👑',v:P.crowns,l:'Crowns'},{i:'🔥',v:P.maxStr,l:'Best Streak'},{i:'⚔️',v:totalBattles.toString(),l:'Total Battles'},{i:'📈',v:winRate+'%',l:'Win Rate'},{i:'🏅',v:avgCrowns,l:'Avg Crowns'},{i:'💰',v:P.gold.toLocaleString(),l:'Gold'},{i:'💎',v:P.gems.toLocaleString(),l:'Gems'},{i:'⭐',v:(P.starPoints||0).toLocaleString(),l:'Star Points'},{i:'🎴',v:P.unlocked.length+'/'+CARDS.length,l:'Cards'}];document.getElementById('statsGrid').innerHTML=stats.map(s=>`<div class="stat-card"><div class="stat-icon">${s.i}</div><div class="stat-value">${s.v}</div><div class="stat-label">${s.l}</div></div>`).join('');const starEl=document.getElementById('dispStarPoints');if(starEl)starEl.textContent=(P.starPoints||0).toLocaleString();}

function updateArena(){const currentArena=getArena(P.tr);const currentIndex=ARENAS.indexOf(currentArena);let html='';ARENAS.forEach((a,i)=>{const isCurrent=i===currentIndex;const isAhead=i>currentIndex;html+=`<div class="arena-item${isCurrent?' current':''}${isAhead?' ahead':''}"><div class="arena-icon">${a.icon}</div><div class="arena-name">${a.name}</div><div class="arena-range">${a.min}-${a.max} trophies</div>${isAhead?`<div class="arena-req">Need ${a.min-P.tr} more trophies</div>`:''}</div>`;});document.getElementById('arenaList').innerHTML=html;}

// Admin functions
function openAdmin(){
  document.getElementById('adminModal').classList.add('on');
  // Check if player has admin access
  if(P.admin === true){
    // Admin has access - skip lock screen
    document.getElementById('lockScreen').style.display='none';
    document.getElementById('adminContent').classList.add('on');
    populateAdminSelects();
    refreshAdminPlayerList();
  }else{
    // Not an admin - show access denied
    document.getElementById('lockScreen').innerHTML=`
      <div style="text-align:center;padding:40px;">
        <div style="font-size:60px;margin-bottom:20px;">🚫</div>
        <div style="font-size:24px;font-weight:bold;color:#e74c3c;margin-bottom:10px;">ACCESS DENIED</div>
        <div style="color:#888;margin-bottom:20px;">You are not authorized to access the admin panel.</div>
        <div style="color:#666;font-size:12px;">Only developers can access this area.</div>
      </div>`;
    document.getElementById('lockScreen').style.display='block';
    document.getElementById('adminContent').classList.remove('on');
  }
}
function closeAdmin(){document.getElementById('adminModal').classList.remove('on');adminTargetPlayerId=null;adminTargetPlayerData=null;document.getElementById('adminTargetPlayer').value='';document.getElementById('targetPlayerInfo').style.display='none';}
function codeInputHash(num){const input=document.getElementById('code'+num);if(input.value){input.dataset.real=input.value;input.value='#';if(num<4)document.getElementById('code'+(num+1)).focus();}}
function tryUnlock(){const code=[1,2,3,4].map(n=>document.getElementById('code'+n).dataset.real.toLowerCase()).join('');if(code===ADMIN_CODE){[1,2,3,4].forEach(n=>document.getElementById('code'+n).classList.add('correct'));setTimeout(()=>{document.getElementById('lockScreen').style.display='none';document.getElementById('adminContent').classList.add('on');},300);}else{[1,2,3,4].forEach(n=>document.getElementById('code'+n).classList.add('wrong'));setTimeout(()=>{[1,2,3,4].forEach(n=>{const el=document.getElementById('code'+n);el.classList.remove('wrong');el.value='';el.dataset.real='';});document.getElementById('code1').focus();},500);}}
function populateAdminSelects(){['unlockCardSelect','levelCardSelect','shardCardSelect'].forEach(id=>{const sel=document.getElementById(id);sel.innerHTML=CARDS.map(c=>`<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');});if(typeof updateMetaDeckSelect==='function')updateMetaDeckSelect();}
async function setTrophies(){
  const val=Math.max(0,parseInt(document.getElementById('admTr').value)||0);
  if(adminTargetPlayerId){
    if(await adminUpdatePlayer({trophies:val}))showNotify(`🏆 Set ${adminTargetPlayerData?.username}'s trophies to ${val}`,'success');
  }else{P.tr=val;save();updatePlay();updateStats();updateLeaderboard();updateRoad();showNotify(`🏆 Trophies set to ${val}`,'success');}
}
async function setGold(){
  const val=Math.max(0,parseInt(document.getElementById('admGold').value)||0);
  if(adminTargetPlayerId){
    if(await adminUpdatePlayer({gold:val}))showNotify(`💰 Set ${adminTargetPlayerData?.username}'s gold to ${val}`,'success');
  }else{P.gold=val;save();updateShop();updateChests();updateStats();showNotify(`💰 Gold set to ${val}`,'success');}
}
async function setGems(){
  const val=Math.max(0,parseInt(document.getElementById('admGems').value)||0);
  if(adminTargetPlayerId){
    if(await adminUpdatePlayer({gems:val}))showNotify(`💎 Set ${adminTargetPlayerData?.username}'s gems to ${val}`,'success');
  }else{P.gems=val;save();updateShop();updateChests();updateStats();showNotify(`💎 Gems set to ${val}`,'success');}
}
async function setCrystals(){
  const val=Math.max(0,parseInt(document.getElementById('admCrystals').value)||0);
  if(adminTargetPlayerId){
    if(await adminUpdatePlayer({crystals:val}))showNotify(`💜 Set ${adminTargetPlayerData?.username}'s crystals to ${val}`,'success');
  }else{P.crystals=val;save();updateShop();showNotify(`💜 Crystals set to ${val}`,'success');}
}
async function sendResourcesToPlayer(){
  const resourceType=document.getElementById('sendResourceType').value;
  const amount=parseInt(document.getElementById('sendAmount').value)||0;
  if(amount<=0){showNotify('Enter a valid amount','error');return;}
  const resourceNames={gold:'💰 Gold',gems:'💎 Gems',crystals:'🔮 Crystals',star_points:'⭐ Star Points'};

  // If admin targeting a player, add resources directly to them
  if(adminTargetPlayerId){
    const currentAmount=adminTargetPlayerData?.resources?.[resourceType]||0;
    const newAmount=currentAmount+amount;
    const updateData={};
    updateData[resourceType]=newAmount;
    if(await adminUpdatePlayer(updateData)){
      showNotify(`💸 Added ${amount} ${resourceNames[resourceType]} to ${adminTargetPlayerData?.username} (now ${newAmount})`,'success');
      document.getElementById('sendAmount').value='';
    }
    return;
  }

  // Otherwise transfer from self to recipient
  const recipient=document.getElementById('sendRecipient').value.trim();
  if(!recipient){showNotify('Enter recipient username','error');return;}
  const myAmount=resourceType==='star_points'?P.starPoints:(P[resourceType]||0);
  if(myAmount<amount){showNotify(`Not enough ${resourceNames[resourceType]}! You have ${myAmount}`,'error');return;}
  try{
    const res=await fetch(`${SERVER_URL}/api/send-resources`,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+P.token},
      body:JSON.stringify({recipient,resource:resourceType,amount})
    });
    const data=await res.json();
    if(data.success){
      if(resourceType==='star_points')P.starPoints-=amount;else P[resourceType]-=amount;
      save();updateStats();updateShop();
      showNotify(data.message,'success');
      document.getElementById('sendRecipient').value='';
      document.getElementById('sendAmount').value='';
    }else{showNotify(data.error||'Transfer failed','error');}
  }catch(e){showNotify('Network error','error');}
}
function setTrophyGain(){P.trophyGainPerWin=Math.max(0,parseInt(document.getElementById('admTrophyGain').value)||150);save();}
async function setMedals(){
  const val=Math.max(0,parseInt(document.getElementById('admMedals').value)||0);
  if(adminTargetPlayerId){
    if(await adminUpdatePlayer({medals:val}))showNotify(`🏅 Set ${adminTargetPlayerData?.username}'s medals to ${val}`,'success');
  }else{P.medals=val;P.medalsHighest=Math.max(P.medalsHighest||0,val);save();updateMedalsStats();updatePlay();showNotify(`🏅 Medals set to ${val}`,'success');}
}
function setBotLevel(){const lvl=Math.max(1,Math.min(13,parseInt(document.getElementById('admBotLevel').value)||1));P.forceBotLevel=lvl;save();showNotify(`🤖 Bot level set to ${lvl}`,'success');updateBotLvlDisplay();}
function updateBotLvlDisplay(){const el=document.getElementById('currentBotLvl');if(el)el.textContent=P.forceBotLevel?'Level '+P.forceBotLevel:'Auto';}
async function setWildCards(){
  const val=Math.max(0,parseInt(document.getElementById('admWildCards').value)||0);
  if(adminTargetPlayerId){
    if(await adminUpdatePlayer({royal_wild_cards:val}))showNotify(`🃏 Set ${adminTargetPlayerData?.username}'s wild cards to ${val}`,'success');
  }else{P.royalWildCards=val;save();updateStats();showNotify(`🃏 Wild cards set to ${val}`,'success');}
}
async function setStarPoints(){
  const val=Math.max(0,parseInt(document.getElementById('admStarPoints').value)||0);
  if(adminTargetPlayerId){
    if(await adminUpdatePlayer({star_points:val}))showNotify(`⭐ Set ${adminTargetPlayerData?.username}'s star points to ${val}`,'success');
  }else{P.starPoints=val;save();updateStats();renderStarShop();showNotify(`⭐ Star points set to ${val}`,'success');}
}
async function unlockAll(){
  if(adminTargetPlayerId){
    const allCardIds=CARDS.map(c=>c.id);
    if(await adminUpdatePlayer({unlocked:allCardIds}))showNotify(`🔓 Unlocked all cards for ${adminTargetPlayerData?.username}`,'success');
  }else{CARDS.forEach(c=>{if(!P.unlocked.includes(c.id))P.unlocked.push(c.id);});save();updateCards();showNotify('🔓 All cards unlocked','success');}
}
function skipAllChests(){const toOpen=P.chests.map((c,i)=>c&&c.startTime?i:null).filter(i=>i!==null).reverse();toOpen.forEach(idx=>openChest(idx));updateChests();}
async function unlockSingle(){
  const id=document.getElementById('unlockCardSelect').value;
  if(adminTargetPlayerId){
    const current=adminTargetPlayerData?.cards?.unlocked||[];
    if(!current.includes(id)){
      const updated=[...current,id];
      if(await adminUpdatePlayer({unlocked:updated}))showNotify(`🔓 Unlocked ${id} for ${adminTargetPlayerData?.username}`,'success');
    }else{showNotify('Card already unlocked','info');}
  }else{if(!P.unlocked.includes(id))P.unlocked.push(id);save();updateCards();showNotify(`🔓 ${id} unlocked`,'success');}
}
async function maxAllCards(){
  const maxLvl=parseInt(document.getElementById('maxLevelInput').value)||25;
  if(adminTargetPlayerId){
    const levels={};CARDS.forEach(c=>levels[c.id]=maxLvl);
    if(await adminUpdatePlayer({levels}))showNotify(`⬆️ Maxed all cards to Lv${maxLvl} for ${adminTargetPlayerData?.username}`,'success');
  }else{
    const cost=5000;
    if(P.gold<cost){showNotify(`Not enough gold! Need ${cost}, you have ${P.gold}`,'error');return;}
    if(!confirm(`Max all cards to Lv${maxLvl} for ${cost} gold?`))return;
    P.gold-=cost;
    CARDS.forEach(c=>{P.lvls[c.id]=maxLvl;});save();updateCards();updateShop();updateStats();showNotify(`⬆️ All cards set to Lv${maxLvl}`,'success');
  }
}
async function setCardLevel(){
  const id=document.getElementById('levelCardSelect').value,lvl=Math.max(1,parseInt(document.getElementById('levelInput').value)||1);
  if(adminTargetPlayerId){
    const levels={...(adminTargetPlayerData?.cards?.levels||{}),[id]:lvl};
    if(await adminUpdatePlayer({levels}))showNotify(`⬆️ Set ${id} to Lv${lvl} for ${adminTargetPlayerData?.username}`,'success');
  }else{P.lvls[id]=lvl;save();updateCards();showNotify(`⬆️ ${id} set to Lv${lvl}`,'success');}
}
async function addShardsAll(amt){
  if(adminTargetPlayerId){
    const shards={...(adminTargetPlayerData?.cards?.shards||{})};
    CARDS.forEach(c=>shards[c.id]=(shards[c.id]||0)+amt);
    if(await adminUpdatePlayer({shards}))showNotify(`✨ Added ${amt} shards to all cards for ${adminTargetPlayerData?.username}`,'success');
  }else{CARDS.forEach(c=>{P.shards[c.id]=(P.shards[c.id]||0)+amt;});save();updateCards();showNotify(`✨ Added ${amt} shards to all cards`,'success');}
}
async function addShardsSingle(){
  const id=document.getElementById('shardCardSelect').value,amt=parseInt(document.getElementById('shardInput').value)||0;
  if(adminTargetPlayerId){
    const shards={...(adminTargetPlayerData?.cards?.shards||{}),[id]:(adminTargetPlayerData?.cards?.shards?.[id]||0)+amt};
    if(await adminUpdatePlayer({shards}))showNotify(`✨ Added ${amt} shards to ${id} for ${adminTargetPlayerData?.username}`,'success');
  }else{P.shards[id]=(P.shards[id]||0)+amt;save();updateCards();showNotify(`✨ Added ${amt} shards to ${id}`,'success');}
}
function claimAllRoad(){TROPHY_ROAD.forEach(m=>{if(!P.roadClaimed.includes(m.tr)){P.roadClaimed.push(m.tr);const r=m.reward;if(r.gold)P.gold+=r.gold;if(r.gems)P.gems+=r.gems;if(r.chest){const ct=CHEST_TYPES.find(t=>t.id===r.chest);addChest(ct);}if(r.shards){const cards=CARDS.filter(c=>c.rarity===r.shards.rarity),card=cards[Math.floor(Math.random()*cards.length)];P.shards[card.id]=(P.shards[card.id]||0)+r.shards.amount;}}});save();updateRoad();updateChests();updateCards();updateShop();updateStats();}
function resetRoad(){P.roadClaimed=[];save();updateRoad();}
function addAdminChest(type){const ct=CHEST_TYPES.find(t=>t.id===type);if(ct)addChest(ct);updateChests();}
function fillAllChests(){const types=['silver','gold','magic','giant','legendary','super'];P.chests=P.chests.map((c,i)=>c||{type:types[i%types.length],startTime:null,unlocking:false});save();updateChests();}
function clearAllChests(){P.chests=Array(MAX_CHESTS).fill(null);save();updateChests();}
function skipAllChests(){P.chests.forEach(c=>{if(c&&c.unlocking){const type=CHEST_TYPES.find(t=>t.id===c.type);c.startTime=Date.now()-type.time*1000;}});save();updateChests();}

// Player Management (Ban/Unban)
async function banPlayer() {
  const username = document.getElementById('banUsername').value.trim();
  if (!username) { showNotify('Enter a username', 'error'); return; }
  try {
    const res = await fetch(`${SERVER_URL}/api/admin/ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, banned: true })
    });
    const data = await res.json();
    if (res.ok) {
      showNotify(`🚫 ${username} has been BANNED`, 'error');
      document.getElementById('banUsername').value = '';
      loadPlayerList();
    } else {
      showNotify(data.error || 'Failed to ban player', 'error');
    }
  } catch (e) {
    showNotify('Network error', 'error');
  }
}

async function unbanPlayer() {
  const username = document.getElementById('unbanUsername').value.trim();
  if (!username) { showNotify('Enter a username', 'error'); return; }
  try {
    const res = await fetch(`${SERVER_URL}/api/admin/ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, banned: false })
    });
    const data = await res.json();
    if (res.ok) {
      showNotify(`✅ ${username} has been UNBANNED`, 'success');
      document.getElementById('unbanUsername').value = '';
      loadPlayerList();
    } else {
      showNotify(data.error || 'Failed to unban player', 'error');
    }
  } catch (e) {
    showNotify('Network error', 'error');
  }
}

async function loadPlayerList() {
  const container = document.getElementById('playerListContainer');
  container.style.display = 'block';
  container.innerHTML = '<div style="color:#888;font-size:10px;text-align:center">Loading...</div>';
  try {
    const res = await fetch(`${SERVER_URL}/api/admin/players`);
    const data = await res.json();
    if (res.ok && data.players) {
      container.innerHTML = data.players.map(p => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;margin:2px 0;background:${p.banned ? 'rgba(231,76,60,0.3)' : 'rgba(255,255,255,0.1)'};border-radius:4px;font-size:10px">
          <span style="color:${p.banned ? '#e74c3c' : '#fff'}">${p.username} ${p.banned ? '🚫' : ''}</span>
          <span style="color:#888">🏆${p.trophies}</span>
          <button onclick="${p.banned ? 'unbanPlayer' : 'banPlayer'}Quick('${p.username}')" style="padding:2px 6px;font-size:8px;border:none;border-radius:3px;cursor:pointer;background:${p.banned ? '#27ae60' : '#e74c3c'};color:#fff">${p.banned ? 'Unban' : 'Ban'}</button>
        </div>
      `).join('');
    } else {
      container.innerHTML = '<div style="color:#e74c3c;font-size:10px;text-align:center">Failed to load</div>';
    }
  } catch (e) {
    container.innerHTML = '<div style="color:#e74c3c;font-size:10px;text-align:center">Network error</div>';
  }
}

async function banPlayerQuick(username) {
  document.getElementById('banUsername').value = username;
  await banPlayer();
}

async function unbanPlayerQuick(username) {
  document.getElementById('unbanUsername').value = username;
  await unbanPlayer();
}

async function resetPlayerPassword() {
  const username = document.getElementById('resetPwUsername').value.trim();
  const newPassword = document.getElementById('resetPwNew').value;
  if (!username) { showNotify('Enter a username', 'error'); return; }
  if (!newPassword) { showNotify('Enter a new password', 'error'); return; }
  if (newPassword.length < 4) { showNotify('Password must be at least 4 characters', 'error'); return; }
  try {
    const res = await fetch(`${SERVER_URL}/api/admin/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, new_password: newPassword })
    });
    const data = await res.json();
    if (res.ok) {
      showNotify(`🔑 Password reset for ${username}`, 'success');
      document.getElementById('resetPwUsername').value = '';
      document.getElementById('resetPwNew').value = '';
    } else {
      showNotify(data.error || 'Failed to reset password', 'error');
    }
  } catch (e) {
    showNotify('Network error', 'error');
  }
}

// ==================== ADMIN TARGET PLAYER SYSTEM ====================
let adminTargetPlayerId = null;  // null means "myself"
let adminTargetPlayerData = null;

async function refreshAdminPlayerList() {
  const select = document.getElementById('adminTargetPlayer');
  select.innerHTML = '<option value="">👤 Myself</option>';

  try {
    const res = await fetch(`${SERVER_URL}/api/admin/players`);
    const data = await res.json();
    if (res.ok && data.players) {
      data.players.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.username} 🏆${p.trophies}${p.banned ? ' 🚫' : ''}`;
        select.appendChild(opt);
      });
    }
  } catch (e) {
    console.error('Failed to load player list:', e);
  }
}

async function onTargetPlayerChange() {
  const select = document.getElementById('adminTargetPlayer');
  const info = document.getElementById('targetPlayerInfo');
  adminTargetPlayerId = select.value || null;

  if (!adminTargetPlayerId) {
    adminTargetPlayerData = null;
    info.style.display = 'none';
    return;
  }

  // Fetch target player data
  try {
    const res = await fetch(`${SERVER_URL}/api/admin/player/${adminTargetPlayerId}`);
    const data = await res.json();
    if (res.ok && data.player) {
      adminTargetPlayerData = data.player;
      info.style.display = 'block';
      info.innerHTML = `Editing: <strong>${data.player.username}</strong> | 🏆${data.player.stats?.trophies || 0} | 💰${data.player.resources?.gold || 0} | 💎${data.player.resources?.gems || 0}`;
    } else {
      showNotify('Failed to load player data', 'error');
      select.value = '';
      adminTargetPlayerId = null;
      adminTargetPlayerData = null;
      info.style.display = 'none';
    }
  } catch (e) {
    showNotify('Network error loading player', 'error');
    console.error(e);
  }
}

async function adminUpdatePlayer(updates) {
  if (!adminTargetPlayerId) {
    // Updating myself - use local P object
    return false;
  }

  // Updating another player via API
  try {
    const res = await fetch(`${SERVER_URL}/api/admin/player/${adminTargetPlayerId}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates })
    });
    const data = await res.json();
    if (res.ok && data.player) {
      adminTargetPlayerData = data.player;
      // Update info display
      const info = document.getElementById('targetPlayerInfo');
      info.innerHTML = `Editing: <strong>${data.player.username}</strong> | 🏆${data.player.stats?.trophies || 0} | 💰${data.player.resources?.gold || 0} | 💎${data.player.resources?.gems || 0}`;
      return true;
    } else {
      showNotify(data.error || 'Failed to update player', 'error');
      return false;
    }
  } catch (e) {
    showNotify('Network error', 'error');
    console.error(e);
    return false;
  }
}

function resetGame(){
    localStorage.removeItem('arena_royale_v3');
    P = {
      name: 'Player',
      deck: [],
      tr: 0,
      gold: 5000,
      gems: 500,
      crystals: 0,
      emotes: [...EMOTES],
      wins: 0,
      losses: 0,
      streak: 0,
      maxStr: 0,
      crowns: 0,
      lvls: {},
      shards: {},
      unlocked: [...STARTER_CARDS],
      chests: Array(MAX_CHESTS).fill(null),
      lbBots: [],
      lastLbUpdate: 0,
      roadClaimed: [],
      trophyGainPerWin: 150,
      kingTowerLevel: 1,
      princessLevel: 1,
      compWins: 0,
      compLosses: 0,
      compTrophies: 0,
      compBots: [],
      compLastUpdate: 0,
      medals: 0,
      medalsWins: 0,
      medalsLosses: 0,
      medalsHighest: 0
    };
    initLeaderboard();
    updatePlay();
    updateChests();
    updateCards();
    updateShop();
    updateRoad();
    updateLeaderboard();
    updateStats();
}

function startBattle(){
// Check if we should use real multiplayer matchmaking
if(NET.isOnline && currentGameMode !== 'test' && currentGameMode !== 'custom'){
  if(P.deck.length<8)randomDeck();
  showMatchmakingOverlay();
  NET.send('queue_join', {
    mode: currentGameMode || 'normal',
    trophies: currentGameMode==='comp' ? P.compTrophies : P.tr,
    deck: P.deck
  });
  return; // Wait for match_found event
}
// Offline/test mode - use existing bot logic
if(P.deck.length<8)randomDeck();const arena=getArena(currentGameMode==='comp'?P.compTrophies:P.tr),botLvl=getBotLvl(currentGameMode==='comp'?P.compTrophies:P.tr),botMult=1+(Math.min(botLvl,15)-1)*0.10,botCards=CARDS.filter(c=>c.type==='troop').sort(()=>0.5-Math.random()).slice(0,8);
// Pick opponent from leaderboard based on trophy range
const playerTr=currentGameMode==='comp'?P.compTrophies:P.tr;
const trophyRange=500;
const nearbyBots=P.lbBots.filter(b=>Math.abs(b.trophies-playerTr)<=trophyRange);
const opponent=nearbyBots.length>0?nearbyBots[Math.floor(Math.random()*nearbyBots.length)]:P.lbBots[Math.floor(Math.random()*P.lbBots.length)];
const opponentName=opponent?opponent.name:BOT_NAMES[Math.floor(Math.random()*BOT_NAMES.length)];
const opponentTrophies=opponent?opponent.trophies:playerTr;
B={on:true,elixir:5,botElixir:5,hand:[],queue:[...P.deck].sort(()=>0.5-Math.random()),next:null,sel:-1,troops:[],towers:{pL:{hp:getPrincessHP(),max:getPrincessHP(),dead:0},pR:{hp:getPrincessHP(),max:getPrincessHP(),dead:0},pK:{hp:getKingTowerHP(),max:getKingTowerHP(),dead:0},aL:{hp:Math.floor(getPrincessHP()*botMult),max:Math.floor(getPrincessHP()*botMult),dead:0},aR:{hp:Math.floor(getPrincessHP()*botMult),max:Math.floor(getPrincessHP()*botMult),dead:0},aK:{hp:Math.floor(getKingTowerHP()*botMult),max:Math.floor(getKingTowerHP()*botMult),dead:0}},tCD:{pL:0,pR:0,pK:0,aL:0,aR:0,aK:0},kingOn:{p:0,a:0},crowns:{me:0,ai:0},time:0,arena,botLvl,botMult,botCards,botHand:[],botQueue:[...botCards],loop:null,gameMode:currentGameMode,spellEffects:[],troopPoisons:[],cardCycle:[],opponentName,opponentTrophies};for(let i=0;i<4;i++)B.hand.push(B.queue.shift());B.next=B.queue.shift();for(let i=0;i<4;i++)B.botHand.push(B.botQueue.shift());B.botNext=B.botQueue.shift();document.getElementById('battle').classList.add('on');try{if(document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(()=>{});}catch(e){}renderArena();startLoop();}
function quitBattle(){if(B&&B.on){B.on=false;if(B.loop)cancelAnimationFrame(B.loop);}document.getElementById('battle').classList.remove('on');try{if(document.exitFullscreen)document.exitFullscreen().catch(()=>{});}catch(e){}}
function renderArena(){const a=document.getElementById('arena'),h=a.offsetHeight,w=a.offsetWidth;B.towers.pL.x=w*0.12;B.towers.pL.y=h*0.82;B.towers.pR.x=w*0.88;B.towers.pR.y=h*0.82;B.towers.pK.x=w/2;B.towers.pK.y=h*0.92;B.towers.aL.x=w*0.12;B.towers.aL.y=h*0.12;B.towers.aR.x=w*0.88;B.towers.aR.y=h*0.12;B.towers.aK.x=w/2;B.towers.aK.y=h*0.04;a.innerHTML=`<div class="river"></div><div class="bridge" style="left:12%"></div><div class="bridge" style="right:12%"></div><div class="tower small red" id="t-aL" style="top:8%;left:8%">🏯<span class="hp-text">${B.towers.aL.hp}</span></div><div class="tower small red" id="t-aR" style="top:8%;right:8%">🏯<span class="hp-text">${B.towers.aR.hp}</span></div><div class="tower king red" id="t-aK" style="top:1%;left:50%;transform:translateX(-50%)">🏰<span class="hp-text">${B.towers.aK.hp}</span></div><div class="tower small blue" id="t-pL" style="bottom:15%;left:8%">🏯<span class="hp-text">${B.towers.pL.hp}</span></div><div class="tower small blue" id="t-pR" style="bottom:15%;right:8%">🏯<span class="hp-text">${B.towers.pR.hp}</span></div><div class="tower king blue" id="t-pK" style="bottom:5%;left:50%;transform:translateX(-50%)">🏰<span class="hp-text">${B.towers.pK.hp}</span></div><div id="spawnZone"></div><div id="pocketLeft" class="pocket-zone"></div><div id="pocketRight" class="pocket-zone"></div><div id="elixirBar"><div id="elixirFill" style="width:50%"></div><div id="elixirText">5/10</div><div class="double-elixir" id="doubleElixir">2X</div></div><div id="hand"></div><div id="nextCard"><div class="lbl">NEXT</div><div class="icon">${getCard(B.next)?.icon||'?'}</div></div><div id="emoteBtn" onclick="toggleEmotes()">😀</div><div id="emotePanel">${P.equippedEmotes.filter(id=>id).map(id=>{const em=ALL_EMOTES.find(x=>x.id===id);return em?`<div class="emote-btn" onclick="sendEmote('${em.icon}')">${em.icon}</div>`:''}).join('')}</div>`;document.getElementById('botLbl').textContent=B.opponentName+' 🏆'+B.opponentTrophies;document.getElementById('myCrowns').textContent='0';document.getElementById('aiCrowns').textContent='0';const spawnZone=document.getElementById('spawnZone');spawnZone.addEventListener('pointerdown',function(e){e.preventDefault();e.stopPropagation();if(!B||!B.on||B.sel===-1)return;const cardId=B.hand[B.sel],card=getLvlCard(cardId);if(!card||B.elixir<card.cost)return;const rect=a.getBoundingClientRect(),zoom=1,x=(e.clientX-rect.left)/zoom,y=(e.clientY-rect.top)/zoom,lane=x<w/2?'left':'right';if(card.type==='spell')castSpell(card,x,y,'player');else spawnTroop(card,x,y,'player',lane);B.elixir-=card.cost;cycleCard();});a.addEventListener('pointerdown',function(e){if(!B||!B.on||B.sel===-1)return;const cardId=B.hand[B.sel],card=getLvlCard(cardId);if(!card||card.type!=='spell'||B.elixir<card.cost)return;if(e.target.closest('#hand')||e.target.closest('#elixirBar')||e.target.closest('#nextCard')||e.target.closest('#emoteBtn')||e.target.closest('#emotePanel'))return;e.preventDefault();const rect=a.getBoundingClientRect(),zoom=1;castSpell(card,(e.clientX-rect.left)/zoom,(e.clientY-rect.top)/zoom,'player');B.elixir-=card.cost;cycleCard();},true);updateHand();}
function toggleEmotes(){document.getElementById('emotePanel').classList.toggle('on');}
function sendEmote(e){document.getElementById('emotePanel').classList.remove('on');const a=document.getElementById('arena'),el=document.createElement('div');el.className='emote-display';el.textContent=e;el.style.left=(a.offsetWidth/2-18)+'px';el.style.bottom='100px';a.appendChild(el);setTimeout(()=>el.remove(),2000);}
function cycleCard(){const playedCardId=B.hand[B.sel];B.hand[B.sel]=B.next;B.next=B.queue.shift();if(!B.queue.length)B.queue=[...P.deck].sort(()=>0.5-Math.random());B.sel=-1;document.getElementById('spawnZone').classList.remove('ready');const pl=document.getElementById('pocketLeft'),pr=document.getElementById('pocketRight');if(pl)pl.classList.remove('ready');if(pr)pr.classList.remove('ready');document.getElementById('nextCard').querySelector('.icon').textContent=getCard(B.next)?.icon||'?';if(playedCardId){if(!B.cardCycle)B.cardCycle=[];B.cardCycle.push(playedCardId);if(B.cardCycle.length>4)B.cardCycle.shift();updateCardCycle();}updateHand();}
function updateCardCycle(){const el=document.getElementById('cardCycle');if(!el||!B||!B.cardCycle)return;el.innerHTML='<div class="cycle-lbl">CYCLE</div>'+B.cardCycle.map(id=>{const c=getCard(id);return c?`<div class="cycle-card">${c.icon}</div>`:'';}).join('');}
function updateHand(){const el=document.getElementById('hand');if(!el||!B)return;el.innerHTML='';B.hand.forEach((id,i)=>{const c=getLvlCard(id);if(!c)return;const d=document.createElement('div');d.className=`hand-card ${c.rarity}`+(B.sel===i?' selected':'')+(c.cost>B.elixir?' disabled':'');d.innerHTML=`<div class="cost">${c.cost}</div><div class="icon">${c.icon}</div><div class="name">${c.name}</div>`;d.addEventListener('pointerdown',function(e){e.preventDefault();e.stopPropagation();if(c.cost>B.elixir)return;B.sel=B.sel===i?-1:i;updateHand();document.getElementById('spawnZone').classList.toggle('ready',B.sel!==-1);const pl=document.getElementById('pocketLeft'),pr=document.getElementById('pocketRight');if(pl&&pl.classList.contains('unlocked'))pl.classList.toggle('ready',B.sel!==-1);if(pr&&pr.classList.contains('unlocked'))pr.classList.toggle('ready',B.sel!==-1);});el.appendChild(d);});}
function spawnTroop(card,x,y,side,lane){const a=document.getElementById('arena'),cnt=card.cnt||1;const fx=document.createElement('div');fx.className=`spawn-effect ${side}`;fx.style.left=(x-20)+'px';fx.style.top=(y-20)+'px';a.appendChild(fx);setTimeout(()=>fx.remove(),400);for(let i=0;i<cnt;i++){const ox=cnt>1?(i-(cnt-1)/2)*12:0,tx=Math.max(10,Math.min(a.offsetWidth-10,x+ox)),ty=y+(Math.random()-0.5)*6;const el=document.createElement('div');el.className=`troop ${side}`+(card.fly?' fly':'');el.style.left=tx+'px';el.style.top=ty+'px';el.innerHTML=`<div class="sprite">${card.icon}</div><div class="hp-bar"><div class="hp-fill" style="width:100%"></div></div>${card.ability?'<div class="hit-counter">0</div>':''}`;a.appendChild(el);const mult=side==='ai'?B.botMult:1;B.troops.push({el,x:tx,y:ty,lane,hp:Math.floor(card.hp*mult),maxHp:Math.floor(card.hp*mult),dmg:Math.floor(card.dmg*mult),spd:card.spd,rng:(card.rng||1)*16,as:card.as||1,side,card,cd:0,charge:card.charge?1:0,chargeBuildup:0,stun:0,hitCount:0,abilityUsed:false});}if(side==='player')sendTroopSpawn(card,x,y,lane);}
// Spawn a building card (including Elixir Pump)
function spawnBuilding(card,x,y,side,lane){
const a=document.getElementById('arena');
const fx=document.createElement('div');fx.className=`spawn-effect ${side}`;fx.style.left=(x-20)+'px';fx.style.top=(y-20)+'px';a.appendChild(fx);setTimeout(()=>fx.remove(),400);
const el=document.createElement('div');el.className=`building ${side}`;el.style.left=x+'px';el.style.top=y+'px';
el.innerHTML=`<div class="sprite" style="font-size:28px">${card.icon}</div><div class="hp-bar"><div class="hp-fill" style="width:100%"></div></div>`;
a.appendChild(el);
const mult=side==='ai'?B.botMult:1;
const bldgData={el,x,y,lane,hp:Math.floor(card.hp*mult),maxHp:Math.floor(card.hp*mult),dmg:Math.floor((card.dmg||0)*mult),rng:card.rng||5,as:card.as||1,air:card.air||0,side,card,cd:0,icon:card.icon,lifetime:card.lifetime||0,remaining:card.lifetime||0};
// Check if this is an elixir-generating building
if(card.elixirGen&&card.elixirGen>0){
bldgData.elixirGen=card.elixirGen;
bldgData.interval=card.elixirInterval||8;
bldgData.timer=0;
B.elixirPumps.push(bldgData);
showDmg(x,y-20,'🧪 PUMP!','#9b59b6');
}else{
B.buildings.push(bldgData);
}
if(side==='player')sendBuildingSpawn(card,x,y,lane);
}
function castSpell(card,x,y,side){const a=document.getElementById('arena'),r=card.radius*16;const targetSide=side==='player'?'ai':'player';
// Send to server for multiplayer sync
if(side==='player')sendSpellCast(card,x,y);
// Goblin Barrel - spawns goblins at target location (tower-locked: goblins only attack towers)
if(card.id==='goblinbarrel'){
const goblinCard=getCard('goblin');
if(goblinCard){
const lane=x<a.offsetWidth/2?'left':'right';
const mult=side==='ai'?B.botMult:1;
// towerLock: true means these goblins will ONLY attack towers, ignoring other troops
const goblinData={...goblinCard,hp:Math.floor(goblinCard.hp*mult),dmg:Math.floor(goblinCard.dmg*mult),cnt:1,towerLock:true};
// Spawn 3 goblins in a triangle pattern around the target
const offsets=[{ox:0,oy:-10},{ox:-12,oy:8},{ox:12,oy:8}];
offsets.forEach(off=>{
const gx=Math.max(10,Math.min(a.offsetWidth-10,x+off.ox));
const gy=y+off.oy;
spawnTroop(goblinData,gx,gy,side,lane);
});
// Visual barrel throw effect
const barrel=document.createElement('div');barrel.style.cssText=`position:absolute;left:${x-15}px;top:${y-15}px;font-size:30px;pointer-events:none;z-index:100;animation:barrelLand 0.3s forwards`;barrel.textContent='🛢️';a.appendChild(barrel);setTimeout(()=>barrel.remove(),300);
// Add barrel landing animation style if not exists
if(!document.getElementById('barrelStyle')){const style=document.createElement('style');style.id='barrelStyle';style.textContent='@keyframes barrelLand{0%{transform:scale(2) translateY(-50px);opacity:0.5}100%{transform:scale(1) translateY(0);opacity:0}}';document.head.appendChild(style);}
return;
}}
// Graveyard - spawns skeletons over time at target location
if(card.id==='graveyard'){
const skelCard=getCard('skel');
if(skelCard){
const lane=x<a.offsetWidth/2?'left':'right';
const mult=side==='ai'?B.botMult:1;
// Create graveyard visual effect
const fx=document.createElement('div');fx.className='graveyard-zone';fx.style.cssText=`position:absolute;left:${x-r}px;top:${y-r}px;width:${r*2}px;height:${r*2}px;border-radius:50%;background:radial-gradient(rgba(80,80,100,0.6),rgba(40,40,60,0.3));pointer-events:none;z-index:50;animation:pulse 1s infinite;border:2px dashed rgba(150,150,180,0.5);`;a.appendChild(fx);
// Add graveyard style if not exists
if(!document.getElementById('graveyardStyle')){const style=document.createElement('style');style.id='graveyardStyle';style.textContent='@keyframes skeletonRise{0%{transform:translateY(10px) scale(0);opacity:0}50%{transform:translateY(-5px) scale(1.2);opacity:1}100%{transform:translateY(0) scale(1);opacity:1}}';document.head.appendChild(style);}
// Initialize graveyard spawner effects array if needed
if(!B.graveyardEffects)B.graveyardEffects=[];
B.graveyardEffects.push({x,y,radius:r,remaining:card.duration,side,lane,el:fx,spawnTimer:0,skelCard,mult,spawned:0,maxSpawns:15});
return;
}}
// Check if spell has duration (persistent effect like Poison)
if(card.duration){
const fx=document.createElement('div');fx.className='poison-zone';fx.style.cssText=`position:absolute;left:${x-r}px;top:${y-r}px;width:${r*2}px;height:${r*2}px;border-radius:50%;background:radial-gradient(rgba(150,50,200,0.5),rgba(100,0,150,0.2));pointer-events:none;z-index:50;animation:pulse 1s infinite;`;a.appendChild(fx);
B.spellEffects.push({x,y,radius:r,dps:card.dmg,remaining:card.duration,side,el:fx,tickTimer:0});
}else{
const fx=document.createElement('div');fx.style.cssText=`position:absolute;left:${x-r}px;top:${y-r}px;width:${r*2}px;height:${r*2}px;border-radius:50%;background:radial-gradient(rgba(255,200,50,0.7),transparent);pointer-events:none;z-index:100;`;a.appendChild(fx);setTimeout(()=>fx.remove(),350);
B.troops.forEach(t=>{if(t.side===targetSide&&t.hp>0){const d=Math.sqrt((t.x-x)**2+(t.y-y)**2);if(d<r){t.hp-=card.dmg;showDmg(t.x,t.y,'-'+card.dmg);if(card.stun)t.stun=card.stun;}}});const towerKeys=side==='player'?['aL','aR','aK']:['pL','pR','pK'];towerKeys.forEach(k=>{const tw=B.towers[k];if(!tw.dead){const d=Math.sqrt((tw.x-x)**2+(tw.y-y)**2);if(d<r+20){const dmg=Math.floor(card.dmg*0.35);tw.hp-=dmg;showDmg(tw.x,tw.y,'-'+dmg);updateTower(k);}}});}}
function updateSpellEffects(dt){
if(!B.spellEffects)return;
const targetSides={player:'ai',ai:'player'};
B.spellEffects.forEach(eff=>{
eff.remaining-=dt;eff.tickTimer+=dt;
if(eff.tickTimer>=0.5){eff.tickTimer=0;const dmg=Math.floor(eff.dps*0.5);const targetSide=targetSides[eff.side];
B.troops.forEach(t=>{if(t.side===targetSide&&t.hp>0){const d=Math.sqrt((t.x-eff.x)**2+(t.y-eff.y)**2);if(d<eff.radius){t.hp-=dmg;showDmg(t.x,t.y,'-'+dmg,'#9b59b6');}}});
const towerKeys=eff.side==='player'?['aL','aR','aK']:['pL','pR','pK'];
towerKeys.forEach(k=>{const tw=B.towers[k];if(!tw.dead){const d=Math.sqrt((tw.x-eff.x)**2+(tw.y-eff.y)**2);if(d<eff.radius+20){const tdmg=Math.floor(dmg*0.35);tw.hp-=tdmg;showDmg(tw.x,tw.y,'-'+tdmg,'#9b59b6');updateTower(k);}}});}
});
B.spellEffects=B.spellEffects.filter(eff=>{if(eff.remaining<=0){eff.el.remove();return false;}return true;});
}
function updateTroopPoisons(dt){
if(!B.troopPoisons)return;
B.troopPoisons.forEach(p=>{
p.remaining-=dt;p.tickTimer+=dt;
if(p.tickTimer>=0.5){p.tickTimer=0;const dmg=Math.floor(p.dps*0.5);
if(p.tower){const tw=B.towers[p.tower];if(tw&&!tw.dead){tw.hp-=dmg;showDmg(tw.x,tw.y,'-'+dmg,'#00ff00');updateTower(p.tower);}}
else if(p.target&&p.target.hp>0){p.target.hp-=dmg;showDmg(p.target.x,p.target.y,'-'+dmg,'#00ff00');if(!p.target.el.classList.contains('poisoned'))p.target.el.classList.add('poisoned');}
}});
B.troopPoisons=B.troopPoisons.filter(p=>{if(p.remaining<=0){if(p.tower){B.towers[p.tower].poisoned=false;}else if(p.target){p.target.poisoned=false;if(p.target.el)p.target.el.classList.remove('poisoned');}return false;}if(p.tower){return !B.towers[p.tower].dead;}return p.target&&p.target.hp>0;});
}
function updateGraveyardEffects(dt){
if(!B.graveyardEffects)return;
const a=document.getElementById('arena');
B.graveyardEffects.forEach(eff=>{
eff.remaining-=dt;eff.spawnTimer+=dt;
// Spawn a skeleton every 0.6 seconds
if(eff.spawnTimer>=0.6&&eff.spawned<eff.maxSpawns){
eff.spawnTimer=0;eff.spawned++;
// Random position within graveyard radius
const angle=Math.random()*Math.PI*2;
const dist=Math.random()*(eff.radius-10);
const sx=eff.x+Math.cos(angle)*dist;
const sy=eff.y+Math.sin(angle)*dist;
// Create skeleton with proper stats
const skelData={...eff.skelCard,hp:Math.floor(eff.skelCard.hp*eff.mult),dmg:Math.floor(eff.skelCard.dmg*eff.mult),cnt:1};
spawnTroop(skelData,sx,sy,eff.side,eff.lane);
// Visual spawn effect
const rise=document.createElement('div');rise.style.cssText=`position:absolute;left:${sx-8}px;top:${sy-8}px;font-size:16px;pointer-events:none;z-index:60;animation:skeletonRise 0.3s forwards`;rise.textContent='💀';a.appendChild(rise);setTimeout(()=>rise.remove(),300);
}
});
B.graveyardEffects=B.graveyardEffects.filter(eff=>{if(eff.remaining<=0){eff.el.remove();return false;}return true;});
}
// Witch skeleton spawning system
function updateWitchSpawns(dt){
if(!B||!B.troops)return;
const a=document.getElementById('arena');
const skelCard=getCard('skel');
if(!skelCard)return;
B.troops.forEach(t=>{
if(t.hp<=0)return;
// Check if this troop is a witch that should spawn skeletons
const isWitch=t.card.id==='witch'||t.card.id==='evo_witch';
if(!isWitch)return;
// Initialize spawn timer if not set
if(t.witchSpawnTimer===undefined)t.witchSpawnTimer=0;
t.witchSpawnTimer+=dt;
// Spawn skeletons every 4 seconds for witch, every 3 seconds for evo_witch
const spawnInterval=t.card.id==='evo_witch'?3:4;
const spawnCount=t.card.id==='evo_witch'?5:4;
if(t.witchSpawnTimer>=spawnInterval){
t.witchSpawnTimer=0;
// Spawn skeletons near the witch
const mult=t.side==='ai'?B.botMult:1;
for(let i=0;i<spawnCount;i++){
const angle=(i/spawnCount)*Math.PI*2;
const dist=20+Math.random()*10;
const sx=t.x+Math.cos(angle)*dist;
const sy=t.y+Math.sin(angle)*dist;
const skelData={...skelCard,hp:Math.floor(skelCard.hp*mult),dmg:Math.floor(skelCard.dmg*mult),cnt:1};
spawnTroop(skelData,sx,sy,t.side,t.lane);
}
// Visual spawn effect
const rise=document.createElement('div');rise.style.cssText=`position:absolute;left:${t.x-12}px;top:${t.y-12}px;font-size:20px;pointer-events:none;z-index:60;animation:skeletonRise 0.4s forwards`;rise.textContent='💀✨';a.appendChild(rise);setTimeout(()=>rise.remove(),400);
}
});
}
// Elixir Pump Update - generates elixir over time for elixir-generating buildings
function updateElixirPumps(dt){
if(!B||!B.elixirPumps)return;
const a=document.getElementById('arena');
B.elixirPumps.forEach(pump=>{
if(pump.hp<=0)return;
pump.timer+=dt;
if(pump.timer>=pump.interval){
pump.timer=0;
const elixirGain=pump.elixirGen;
if(pump.side==='player'){
B.elixir=Math.min(10,B.elixir+elixirGain);
showDmg(pump.x,pump.y-10,'+'+elixirGain+'⚗️','#9b59b6');
}else{
B.botElixir=Math.min(10,B.botElixir+elixirGain);
}
// Visual effect
const fx=document.createElement('div');fx.style.cssText=`position:absolute;left:${pump.x-15}px;top:${pump.y-15}px;font-size:20px;pointer-events:none;z-index:60;animation:elixirPulse 0.5s forwards`;fx.textContent='🧪';a.appendChild(fx);setTimeout(()=>fx.remove(),500);
}
// Lifetime decay
if(pump.lifetime>0){
pump.remaining-=dt;
if(pump.remaining<=0)pump.hp=0;
}
// Update HP bar
const bar=pump.el.querySelector('.hp-fill');if(bar)bar.style.width=Math.max(0,(pump.hp/pump.maxHp)*100)+'%';
});
// Remove destroyed pumps
B.elixirPumps=B.elixirPumps.filter(pump=>{
if(pump.hp<=0){
const fx=document.createElement('div');fx.className='death-effect';fx.textContent=pump.icon;fx.style.left=pump.x+'px';fx.style.top=pump.y+'px';a.appendChild(fx);setTimeout(()=>fx.remove(),500);
pump.el.remove();return false;
}return true;
});
}
// Building Update - handles building lifetime and attacks
function updateBuildings(dt){
if(!B||!B.buildings)return;
const a=document.getElementById('arena');
B.buildings.forEach(bldg=>{
if(bldg.hp<=0)return;
// Lifetime decay
if(bldg.lifetime>0){
bldg.remaining-=dt;
if(bldg.remaining<=0)bldg.hp=0;
}
// Building attacks (if it has damage)
if(bldg.dmg>0&&bldg.as>0){
bldg.cd-=dt;
if(bldg.cd<=0){
const enemy=bldg.side==='player'?'ai':'player';
let target=null,bestD=bldg.rng*16||80;
B.troops.forEach(t=>{
if(t.side===enemy&&t.hp>0){
if(t.card?.fly&&!bldg.air)return;
const d=Math.sqrt((t.x-bldg.x)**2+(t.y-bldg.y)**2);
if(d<bestD){bestD=d;target=t;}
}
});
if(target){
target.hp-=bldg.dmg;
showDmg(target.x,target.y,'-'+bldg.dmg);
bldg.cd=bldg.as;
}
}
}
// Update HP bar
const bar=bldg.el.querySelector('.hp-fill');if(bar)bar.style.width=Math.max(0,(bldg.hp/bldg.maxHp)*100)+'%';
});
// Remove destroyed buildings
B.buildings=B.buildings.filter(bldg=>{
if(bldg.hp<=0){
const fx=document.createElement('div');fx.className='death-effect';fx.textContent=bldg.icon;fx.style.left=bldg.x+'px';fx.style.top=bldg.y+'px';a.appendChild(fx);setTimeout(()=>fx.remove(),500);
bldg.el.remove();return false;
}return true;
});
}
// Add elixir pulse animation style
if(!document.getElementById('elixirPumpStyle')){const style=document.createElement('style');style.id='elixirPumpStyle';style.textContent='@keyframes elixirPulse{0%{transform:scale(1);opacity:1}100%{transform:scale(1.5) translateY(-20px);opacity:0}}';document.head.appendChild(style);}
function updateTower(k){const tw=B.towers[k],el=document.getElementById('t-'+k);if(!el)return;el.querySelector('.hp-text').textContent=Math.max(0,tw.hp);if(tw.hp<=0&&!tw.dead){tw.dead=1;el.classList.add('dead');const side=k[0]==='p'?'ai':'me';B.crowns[side]++;if(k.includes('K'))B.crowns[side]=3;else B.kingOn[k[0]]=1;document.getElementById('myCrowns').textContent=B.crowns.me;document.getElementById('aiCrowns').textContent=B.crowns.ai;
// Sync tower destruction to server in multiplayer
if(B.isMultiplayer&&B.battleId){
  const myRole=B.myRole||'player1';
  const towerType=k.includes('K')?'king':(k.includes('L')?'left':'right');
  const targetPlayer=k[0]==='p'?myRole:(myRole==='player1'?'player2':'player1');
  NET.send('tower_damage',{battle_id:B.battleId,target:towerType,damage:9999,target_player:targetPlayer});
}
// Unlock pocket zones when enemy princess towers are destroyed
if(k==='aL'){const pl=document.getElementById('pocketLeft');if(pl)pl.classList.add('unlocked');}
if(k==='aR'){const pr=document.getElementById('pocketRight');if(pr)pr.classList.add('unlocked');}}}
function showDmg(x,y,txt,col='#fff'){const a=document.getElementById('arena');if(!a)return;const el=document.createElement('div');el.className='dmg-text';el.textContent=txt;el.style.left=x+'px';el.style.top=y+'px';el.style.color=col;a.appendChild(el);setTimeout(()=>el.remove(),550);}
function triggerAbility(t){
const enemy=t.side==='player'?'ai':'player';
switch(t.card.ability){
case 'dash':showDmg(t.x,t.y-12,'⚡DASH!','#00bcd4');B.troops.forEach(e=>{if(e.side===enemy&&e.hp>0){e.hp-=500;showDmg(e.x,e.y,'-500','#00bcd4');}});break;
case 'shadow':showDmg(t.x,t.y-12,'👻SHADOW!','#9b59b6');t.el.style.opacity='0.3';t.dmg*=2;setTimeout(()=>{if(t.el)t.el.style.opacity='1';t.dmg/=2;},3000);break;
case 'storm':showDmg(t.x,t.y-12,'⛈️STORM!','#3498db');B.troops.filter(e=>e.side===enemy&&e.hp>0).slice(0,3).forEach(e=>{e.hp-=300;showDmg(e.x,e.y,'-300','#3498db');});break;
case 'phoenix':showDmg(t.x,t.y-12,'🔥PHOENIX!','#e74c3c');t.phoenixRevive=true;break;
case 'cloak':showDmg(t.x,t.y-12,'👑CLOAK!','#f1c40f');t.el.style.opacity='0.2';t.as*=0.5;setTimeout(()=>{if(t.el)t.el.style.opacity='1';t.as*=2;},4000);break;
case 'summon':showDmg(t.x,t.y-12,'☠️SUMMON!','#95a5a6');const skelCard=getCard('skel');if(skelCard){const summonedUnits=[];const halfDmgSkel={...skelCard,dmg:Math.floor(skelCard.dmg/2),cnt:1};for(let i=0;i<85;i++){const angle=(i/85)*Math.PI*2;const radius=50+Math.floor(i/28)*25;const sx=t.x+Math.cos(angle)*radius;const sy=t.y+Math.sin(angle)*radius;const skel=spawnTroop({...halfDmgSkel},sx,sy,t.side,t.lane);if(skel)summonedUnits.push(skel);}const queenHp=Math.floor(t.maxHp/2);const queen=spawnTroop({id:'skelqueen',name:'Skeleton Queen',hp:queenHp,dmg:150,spd:1.2,rng:1,as:1.3,type:'troop',icon:'👸💀',cnt:1},t.x,t.y+40,t.side,t.lane);if(queen){queen.hitCount=0;queen.isSkeletonQueen=true;summonedUnits.push(queen);}setTimeout(()=>{summonedUnits.forEach(s=>{if(s&&s.hp>0){s.hp=0;if(s.el)s.el.remove();}});},10000);}break;
case 'multistrike':showDmg(t.x,t.y-12,'⚔️MULTI!','#e67e22');t.as*=0.3;setTimeout(()=>t.as/=0.3,2000);break;
case 'earthquake':showDmg(t.x,t.y-12,'🗿QUAKE!','#8b4513');B.troops.forEach(e=>{if(e.side===enemy&&e.hp>0){const d=Math.sqrt((e.x-t.x)**2+(e.y-t.y)**2);if(d<80){e.hp-=400;showDmg(e.x,e.y,'-400','#8b4513');}}});break;
case 'blizzard':showDmg(t.x,t.y-12,'❄️FREEZE!','#00ffff');B.troops.forEach(e=>{if(e.side===enemy&&e.hp>0)e.stun=3;});break;
case 'chainlightning':showDmg(t.x,t.y-12,'⚡CHAIN!','#f1c40f');B.troops.filter(e=>e.side===enemy&&e.hp>0).slice(0,5).forEach(e=>{e.hp-=250;showDmg(e.x,e.y,'-250','#f1c40f');});break;
case 'teleport':showDmg(t.x,t.y-12,'🌀WARP!','#9b59b6');const farthest=B.troops.filter(e=>e.side===enemy&&e.hp>0).sort((a,b)=>Math.sqrt((b.x-t.x)**2+(b.y-t.y)**2)-Math.sqrt((a.x-t.x)**2+(a.y-t.y)**2))[0];if(farthest){t.x=farthest.x+20;t.y=farthest.y;t.el.style.left=t.x+'px';t.el.style.top=t.y+'px';}break;
case 'radiance':showDmg(t.x,t.y-12,'☀️RADIANCE!','#f39c12');B.troops.forEach(e=>{if(e.side===enemy&&e.hp>0){const d=Math.sqrt((e.x-t.x)**2+(e.y-t.y)**2);if(d<60){e.hp-=200;showDmg(e.x,e.y,'-200','#f39c12');}}});break;
case 'moonbeam':showDmg(t.x,t.y-12,'🌙HEAL!','#a29bfe');B.troops.forEach(e=>{if(e.side===t.side&&e.hp>0){const d=Math.sqrt((e.x-t.x)**2+(e.y-t.y)**2);if(d<60){e.hp=Math.min(e.maxHp,e.hp+300);showDmg(e.x,e.y,'+300','#a29bfe');}}});break;
case 'rally':showDmg(t.x,t.y-12,'🪖RALLY!','#27ae60');B.troops.forEach(e=>{if(e.side===t.side&&e.hp>0)e.as*=0.7;});setTimeout(()=>B.troops.forEach(e=>{if(e.side===t.side)e.as/=0.7;}),5000);break;
case 'dragonfire':showDmg(t.x,t.y-12,'🐉FIRE!','#e74c3c');B.troops.forEach(e=>{if(e.side===enemy&&e.hp>0&&e.y>t.y-20&&e.y<t.y+60&&Math.abs(e.x-t.x)<50){e.hp-=500;showDmg(e.x,e.y,'-500','#e74c3c');}});break;
case 'soulharvest':showDmg(t.x,t.y-12,'💀HARVEST!','#8e44ad');t.hp=Math.min(t.maxHp,t.hp+300);t.dmg+=50;break;
case 'timewarp':showDmg(t.x,t.y-12,'⏰SLOW!','#3498db');B.troops.forEach(e=>{if(e.side===enemy)e.spd*=0.3;});setTimeout(()=>B.troops.forEach(e=>{if(e.side===enemy)e.spd/=0.3;}),3000);break;
case 'runeexplosion':showDmg(t.x,t.y-12,'🔷RUNES!','#2980b9');B.troops.forEach(e=>{if(e.side===enemy&&e.hp>0){const d=Math.sqrt((e.x-t.x)**2+(e.y-t.y)**2);if(d<70){e.hp-=600;showDmg(e.x,e.y,'-600','#2980b9');}}});break;
case 'lifesteal':showDmg(t.x,t.y-12,'🦇DRAIN!','#c0392b');let stolen=0;B.troops.forEach(e=>{if(e.side===enemy&&e.hp>0){const d=Math.sqrt((e.x-t.x)**2+(e.y-t.y)**2);if(d<50){e.hp-=150;stolen+=150;showDmg(e.x,e.y,'-150','#c0392b');}}});t.hp=Math.min(t.maxHp,t.hp+stolen);break;
case 'spiritbomb':showDmg(t.x,t.y-12,'👁️SPIRIT!','#9b59b6');const tgt=B.troops.filter(e=>e.side===enemy&&e.hp>0)[0];if(tgt){B.troops.forEach(e=>{if(e.side===enemy&&e.hp>0){const d=Math.sqrt((e.x-tgt.x)**2+(e.y-tgt.y)**2);if(d<50){e.hp-=400;showDmg(e.x,e.y,'-400','#9b59b6');}}});}break;
case 'crystalshield':showDmg(t.x,t.y-12,'💎SHIELD!','#1abc9c');B.troops.forEach(e=>{if(e.side===t.side&&e.hp>0){e.hp+=500;e.maxHp+=500;showDmg(e.x,e.y,'+🛡️','#1abc9c');}});break;
case 'backstab':showDmg(t.x,t.y-12,'🗡️BACKSTAB!','#e74c3c');const victim=B.troops.filter(e=>e.side===enemy&&e.hp>0)[0];if(victim){t.x=victim.x+15;t.y=victim.y;t.el.style.left=t.x+'px';t.el.style.top=t.y+'px';victim.hp-=t.dmg*3;showDmg(victim.x,victim.y,'-'+(t.dmg*3),'#e74c3c');}break;
case 'hellfire':showDmg(t.x,t.y-12,'🔥HELLFIRE!','#c0392b');B.troops.forEach(e=>{if(e.side===enemy&&e.hp>0){const d=Math.sqrt((e.x-t.x)**2+(e.y-t.y)**2);if(d<60){e.hp-=350;showDmg(e.x,e.y,'-350','#c0392b');}}});break;
case 'tornado':showDmg(t.x,t.y-12,'💨TORNADO!','#74b9ff');B.troops.forEach(e=>{if(e.side===enemy&&e.hp>0){const d=Math.sqrt((e.x-t.x)**2+(e.y-t.y)**2);if(d<80&&d>10){const angle=Math.atan2(t.y-e.y,t.x-e.x);e.x+=Math.cos(angle)*20;e.y+=Math.sin(angle)*20;e.el.style.left=e.x+'px';e.el.style.top=e.y+'px';}}});break;
case 'counter':showDmg(t.x,t.y-12,'🛡️COUNTER!','#f39c12');t.dmg*=2;setTimeout(()=>t.dmg/=2,3000);break;
case 'masssummon':showDmg(t.x,t.y-12,'💀HORDE!','#8e44ad');const sk=getCard('skel');if(sk){for(let i=0;i<8;i++){const angle=(i/8)*Math.PI*2;const sx=t.x+Math.cos(angle)*35;const sy=t.y+Math.sin(angle)*35;spawnTroop({...sk,cnt:1},sx,sy,t.side,t.lane);}}break;
}}
// Champion ability button system
function updateChampionAbilityButton(){
if(!B||!B.on)return;
const btn=document.getElementById('championAbilityBtn');
if(!btn)return;
const champion=B.troops.find(t=>t.side==='player'&&t.hp>0&&t.card.rarity==='champion'&&!t.abilityUsed);
if(champion){btn.classList.add('ready');btn.classList.remove('cooldown');btn.querySelector('.ability-icon').textContent=champion.card.icon;B.activeChampion=champion;}
else{const usedChamp=B.troops.find(t=>t.side==='player'&&t.hp>0&&t.card.rarity==='champion'&&t.abilityUsed);
if(usedChamp){btn.classList.add('ready');btn.classList.add('cooldown');btn.querySelector('.ability-icon').textContent=usedChamp.card.icon;}
else{btn.classList.remove('ready');btn.classList.remove('cooldown');}B.activeChampion=null;}}
function activateChampionAbility(){
if(!B||!B.on||!B.activeChampion)return;
const t=B.activeChampion;if(t.abilityUsed)return;
t.abilityUsed=true;t.hitCount=10;triggerAbility(t);updateChampionAbilityButton();}
function startLoop(){let last=performance.now();function loop(now){if(!B||!B.on)return;const dt=(now-last)/1000;last=now;B.time+=dt;const rem=Math.max(0,(B.duration||180)-B.time);document.getElementById('timer').textContent=fmt(rem);if(rem<=0){if(B.isMultiplayer){sendBattleEnd(B.crowns.me>B.crowns.ai);return;}else{endBattle(B.crowns.me>B.crowns.ai);return;}}const rate=B.time>=120?1.6:0.8;B.elixir=Math.min(10,B.elixir+dt*rate);if(!B.isMultiplayer)B.botElixir=Math.min(10,B.botElixir+dt*rate*0.85);document.getElementById('elixirFill').style.width=(B.elixir*10)+'%';document.getElementById('elixirText').textContent=Math.floor(B.elixir)+'/10';document.getElementById('doubleElixir').classList.toggle('on',B.time>=120);updateHand();updateTroops(dt);updateSpellEffects(dt);updateTroopPoisons(dt);updateGraveyardEffects(dt);towerAttacks(dt);if(!B.isMultiplayer)aiTurn();if(B.crowns.me>=3){if(B.isMultiplayer){sendBattleEnd(true);return;}else{endBattle(true);return;}}if(B.crowns.ai>=3){if(B.isMultiplayer){sendBattleEnd(false);return;}else{endBattle(false);return;}}B.loop=requestAnimationFrame(loop);}B.loop=requestAnimationFrame(loop);}
function updateTroops(dt){const a=document.getElementById('arena');B.troops.forEach(t=>{if(t.hp<=0)return;if(t.stun>0){t.stun-=dt;return;}const target=findTarget(t);if(!target)return;const dx=target.x-t.x,dy=target.y-t.y,dist=Math.sqrt(dx*dx+dy*dy);if(t.card.charge&&!t.charge){t.chargeBuildup+=dt;if(t.chargeBuildup>=2)t.charge=1;}if(dist<=t.rng){t.cd-=dt;if(t.cd<=0){let dmg=t.dmg;if(t.charge){dmg*=2;t.charge=0;showDmg(t.x,t.y-12,'⚡CHARGE!','#f1c40f');}if(target.type==='tower'){t.lockedTower=target.key;B.towers[target.key].hp-=dmg;showDmg(target.x,target.y,'-'+dmg);updateTower(target.key);if(t.card.poison&&!B.towers[target.key].poisoned){B.towers[target.key].poisoned=true;B.troopPoisons.push({tower:target.key,dps:t.card.poison,remaining:t.card.poisonDur||4,tickTimer:0});}}else{if(t.card.spl){const sr=t.card.spl*16;B.troops.forEach(e=>{if(e.side!==t.side&&e.hp>0){const ed=Math.sqrt((e.x-target.x)**2+(e.y-target.y)**2);if(ed<sr){e.hp-=dmg;showDmg(e.x,e.y,'-'+dmg);if(t.card.poison&&!e.poisoned){e.poisoned=true;B.troopPoisons.push({target:e,dps:t.card.poison,remaining:t.card.poisonDur||4,tickTimer:0});}}}});}else{target.hp-=dmg;showDmg(target.x,target.y,'-'+dmg);if(t.card.poison&&!target.poisoned){target.poisoned=true;B.troopPoisons.push({target,dps:t.card.poison,remaining:t.card.poisonDur||4,tickTimer:0});}}}t.hitCount++;if(t.isSkeletonQueen&&t.hitCount%3===0){const skelC=getCard('skel');if(skelC){for(let qi=0;qi<3;qi++){const qang=(qi/3)*Math.PI*2;const qsx=t.x+Math.cos(qang)*25;const qsy=t.y+Math.sin(qang)*25;spawnTroop({...skelC,cnt:1},qsx,qsy,t.side,t.lane);}showDmg(t.x,t.y-12,'👸💀x3!','#9b59b6');}}if(t.card.ability&&t.hitCount>=10&&!t.abilityUsed){t.abilityUsed=true;triggerAbility(t);}const counter=t.el.querySelector('.hit-counter');if(counter)counter.textContent=t.hitCount;t.cd=t.as;}}else{let spd=t.charge?t.spd*2:t.spd;const pushDist=30;B.troops.forEach(p=>{if(p!==t&&p.side===t.side&&p.hp>0&&p.spd>t.spd){const px=p.x-t.x,py=p.y-t.y,pd=Math.sqrt(px*px+py*py);const behind=(t.side==='player'?py>0:py<0);const sameArea=Math.abs(px)<25;if(pd<pushDist&&behind&&sameArea){spd=Math.max(spd,p.spd*0.85);}}});t.x+=(dx/dist)*spd*38*dt;t.y+=(dy/dist)*spd*38*dt;t.el.style.left=t.x+'px';t.el.style.top=t.y+'px';}const bar=t.el.querySelector('.hp-fill');if(bar)bar.style.width=Math.max(0,(t.hp/t.maxHp)*100)+'%';});B.troops=B.troops.filter(t=>{if(t.hp<=0){const fx=document.createElement('div');fx.className='death-effect';fx.textContent=t.card.icon;fx.style.left=t.x+'px';fx.style.top=t.y+'px';a.appendChild(fx);setTimeout(()=>fx.remove(),500);t.el.remove();return false;}return true;});}
function findTarget(t){const enemy=t.side==='player'?'ai':'player',tKeys=enemy==='ai'?['aL','aR','aK']:['pL','pR','pK'];let best=null,bestD=120;
// If troop has locked onto a tower (already hit it once), keep targeting it
if(t.lockedTower&&!B.towers[t.lockedTower].dead)return{type:'tower',key:t.lockedTower,x:B.towers[t.lockedTower].x,y:B.towers[t.lockedTower].y};
// Buildings-only targeting (bldg property) OR tower-locked troops (towerLock property like Goblin Barrel goblins)
if(t.card.bldg||t.card.towerLock){const sameLane=t.lane==='left'?tKeys[0]:tKeys[1];if(!B.towers[sameLane].dead)return{type:'tower',key:sameLane,x:B.towers[sameLane].x,y:B.towers[sameLane].y};if(!B.towers[tKeys[2]].dead)return{type:'tower',key:tKeys[2],x:B.towers[tKeys[2]].x,y:B.towers[tKeys[2]].y};const other=t.lane==='left'?tKeys[1]:tKeys[0];if(!B.towers[other].dead)return{type:'tower',key:other,x:B.towers[other].x,y:B.towers[other].y};return null;}B.troops.forEach(e=>{if(e.side!==t.side&&e.hp>0){if(e.card?.fly&&!t.card.air)return;const d=Math.sqrt((e.x-t.x)**2+(e.y-t.y)**2);if(d<bestD){bestD=d;best=e;}}});if(!best){const sameLane=t.lane==='left'?tKeys[0]:tKeys[1];if(!B.towers[sameLane].dead)return{type:'tower',key:sameLane,x:B.towers[sameLane].x,y:B.towers[sameLane].y};if(!B.towers[tKeys[2]].dead)return{type:'tower',key:tKeys[2],x:B.towers[tKeys[2]].x,y:B.towers[tKeys[2]].y};const other=t.lane==='left'?tKeys[1]:tKeys[0];if(!B.towers[other].dead)return{type:'tower',key:other,x:B.towers[other].x,y:B.towers[other].y};}return best;}
function towerAttacks(dt){const attack=(k,enemy)=>{const tw=B.towers[k];if(tw.dead)return;if(k.includes('K')&&!B.kingOn[k[0]])return;B.tCD[k]-=dt;if(B.tCD[k]>0)return;let closest=null,closestD=100;B.troops.forEach(t=>{if(t.side===enemy&&t.hp>0){const d=Math.sqrt((t.x-tw.x)**2+(t.y-tw.y)**2);if(d<closestD){closestD=d;closest=t;}}});if(closest){const dmg=k.includes('K')?getKingTowerDamage():getPrincessDamage();closest.hp-=dmg;showDmg(closest.x,closest.y,'-'+dmg);B.tCD[k]=1;}};attack('pL','ai');attack('pR','ai');attack('pK','ai');attack('aL','player');attack('aR','player');attack('aK','player');}
// Smart defensive AI that responds to player pushes - scales with bot level
function aiTurn(){
// Higher level bots react faster and more often
const reactionChance=0.03+B.botLvl*0.005; // 3% base + 0.5% per level (up to ~8% at lvl 100)
const minElixir=Math.max(2,4-Math.floor(B.botLvl/25)); // Higher lvl bots play at lower elixir
if(B.botElixir<minElixir||Math.random()>reactionChance)return;
const a=document.getElementById('arena');
if(!a)return;

// Analyze player threats on the field
const playerTroops=B.troops.filter(t=>t.side==='player'&&t.hp>0);
const leftLaneThreat=playerTroops.filter(t=>t.x<a.offsetWidth/2);
const rightLaneThreat=playerTroops.filter(t=>t.x>=a.offsetWidth/2);
const riverY=a.offsetHeight*0.42;

// Identify special threats - Hog Rider, building-targeting troops
const hogThreats=playerTroops.filter(t=>t.card.bldg||t.card.id==='hog'||t.card.spd>=1.5);
const hasHogThreat=hogThreats.length>0;

// Calculate threat levels per lane - prioritize building-targeting and fast troops
const calcThreat=(troops)=>troops.reduce((sum,t)=>{
  const hpWeight=t.hp/500;
  const dmgWeight=t.dmg/100;
  const tankBonus=(t.card.hp>=3000)?3:1;
  const hogBonus=(t.card.bldg||t.card.id==='hog'||t.card.spd>=1.5)?4:1; // HUGE priority for Hog/building-targeting
  const speedBonus=t.card.spd>=1.3?2:1; // Fast troops are more dangerous
  const distanceToTower=Math.max(0,(riverY-t.y)/50); // How close to AI towers
  return sum+(hpWeight+dmgWeight)*tankBonus*hogBonus*speedBonus*(1+distanceToTower);
},0);

const leftThreat=calcThreat(leftLaneThreat);
const rightThreat=calcThreat(rightLaneThreat);
const totalThreat=leftThreat+rightThreat;

// Higher level bots defend earlier (lower threshold)
const defenseThreshold=Math.max(0.5,2-B.botLvl*0.015); // 2 at lvl 1, ~0.5 at lvl 100
const needsDefense=totalThreat>defenseThreshold||hasHogThreat;
const defendLane=leftThreat>rightThreat?'left':'right';
const threateningTroops=defendLane==='left'?leftLaneThreat:rightLaneThreat;

// Find best counter card - include spells for higher level bots
const affordable=B.botHand.filter(c=>c.cost<=B.botElixir&&(c.type==='troop'||(B.botLvl>=30&&c.type==='spell')));
if(!affordable.length)return;

let bestCard=null;
if(needsDefense&&(threateningTroops.length>0||hasHogThreat)){
  // Priority: Counter Hog Rider / fast building-targeting troops
  const hogInLane=threateningTroops.filter(t=>t.card.bldg||t.card.id==='hog'||t.card.spd>=1.5);

  if(hogInLane.length>0){
    // COUNTER HOG: High DPS single-target (Mini PEKKA, Lumberjack) or swarm (Skel Army, Goblins)
    bestCard=affordable.find(c=>c.dmg>=250&&c.cost<=4)||  // Mini PEKKA-like
             affordable.find(c=>c.cnt>=3)||               // Swarm to surround
             affordable.find(c=>c.dmg>=150)||             // Any high damage
             affordable.sort((a,b)=>b.dmg-a.dmg)[0];      // Highest DPS available
  }else{
    // Find the biggest threat
    const biggestThreat=threateningTroops.reduce((a,b)=>b.hp>a.hp?b:a,threateningTroops[0]);
    const isTank=biggestThreat.card.hp>=2500;
    const isSwarm=threateningTroops.length>=3;
    const isAir=biggestThreat.card.fly;

    if(isTank){
      bestCard=affordable.find(c=>c.dmg>=300)||affordable.find(c=>c.dmg>=200)||affordable[0];
    }else if(isSwarm){
      bestCard=affordable.find(c=>c.spl)||affordable.find(c=>c.cnt&&c.cnt>1)||affordable[0];
    }else if(isAir){
      bestCard=affordable.find(c=>c.air)||affordable[0];
    }else{
      bestCard=affordable.sort((a,b)=>a.cost-b.cost)[0];
    }
  }
}else{
  // No immediate threat - play offensively or save elixir
  // Higher level bots are more aggressive
  const attackThreshold=Math.max(5,8-Math.floor(B.botLvl/20));
  if(B.botElixir>=attackThreshold){
    bestCard=affordable.sort((a,b)=>b.cost-a.cost)[0];
  }else if(B.botElixir>=5&&Math.random()<(0.2+B.botLvl*0.003)){
    bestCard=affordable.filter(c=>c.cost>=3&&c.cost<=5)[0]||affordable[0];
  }else{
    return;
  }
}

if(!bestCard)bestCard=affordable[0];

// Position troop based on situation - AI MUST stay on their side (top half, y < river)
let x,y;
if(needsDefense){
  // Find the closest threatening troop to intercept
  const targetTroop=hogThreats.length>0?hogThreats[0]:threateningTroops[0];
  if(targetTroop){
    // Place defender directly in the path, closer to towers for better interception
    x=targetTroop.x+((Math.random()-0.5)*20);
    x=Math.max(30,Math.min(a.offsetWidth-30,x));
    // Higher level bots place defenders further forward (more aggressive)
    const defenseDepth=riverY*(0.5+B.botLvl*0.002); // 50% to ~70% up their side
    y=Math.min(defenseDepth,Math.max(20,targetTroop.y-30));
  }else{
    x=defendLane==='left'?60+Math.random()*40:a.offsetWidth-60-Math.random()*40;
    y=riverY*0.6+Math.random()*20;
  }
}else{
  const attackLane=Math.random()<0.5?'left':'right';
  x=attackLane==='left'?50+Math.random()*30:a.offsetWidth-50-Math.random()*30;
  y=riverY-20+Math.random()*15;
}

const lane=x<a.offsetWidth/2?'left':'right';
const aiCard={...bestCard,hp:Math.floor(bestCard.hp*B.botMult),dmg:Math.floor(bestCard.dmg*B.botMult)};
spawnTroop(aiCard,x,y,'ai',lane);
B.botElixir-=bestCard.cost;
B.botHand[B.botHand.indexOf(bestCard)]=B.botNext;
B.botNext=B.botQueue.shift()||B.botCards[Math.floor(Math.random()*B.botCards.length)];
}
function closeResult(){document.querySelectorAll('.result-overlay').forEach(el=>el.remove());document.getElementById('battle').classList.remove('on');try{if(document.exitFullscreen)document.exitFullscreen().catch(()=>{});}catch(e){}goTab('Play');}
function rematch(){document.querySelectorAll('.result-overlay').forEach(el=>el.remove());document.getElementById('battle').classList.remove('on');startBattle();}
// Battle mode selector overlay
function showBattleModeSelector(){
const ov=document.createElement('div');ov.id='battleModeSelectorOverlay';
ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:250;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px';
ov.innerHTML=`<div style="font-size:24px;font-weight:900;color:var(--gold);margin-bottom:20px">🎮 SWITCH MODE</div>
<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;max-width:300px">
<div class="mode-btn" onclick="switchBattleMode('normal')" style="background:linear-gradient(145deg,#27ae60,#1e8449);padding:15px;border-radius:10px;text-align:center;cursor:pointer;border:2px solid #fff"><div style="font-size:24px">🎮</div><div style="font-weight:800;font-size:12px">1v1</div></div>
<div class="mode-btn" onclick="switchBattleMode('2v2')" style="background:linear-gradient(145deg,#3498db,#2980b9);padding:15px;border-radius:10px;text-align:center;cursor:pointer;border:2px solid #fff"><div style="font-size:24px">👥</div><div style="font-weight:800;font-size:12px">2v2</div></div>
<div class="mode-btn" onclick="switchBattleMode('chaos')" style="background:linear-gradient(145deg,#9b59b6,#8e44ad);padding:15px;border-radius:10px;text-align:center;cursor:pointer;border:2px solid #fff"><div style="font-size:24px">💥</div><div style="font-weight:800;font-size:12px">CHAOS</div></div>
<div class="mode-btn" onclick="switchBattleMode('draft')" style="background:linear-gradient(145deg,#e67e22,#d35400);padding:15px;border-radius:10px;text-align:center;cursor:pointer;border:2px solid #fff"><div style="font-size:24px">🎲</div><div style="font-weight:800;font-size:12px">DRAFT</div></div>
<div class="mode-btn" onclick="switchBattleMode('medals')" style="background:linear-gradient(145deg,#ffd700,#ff8c00);padding:15px;border-radius:10px;text-align:center;cursor:pointer;border:2px solid #fff"><div style="font-size:24px">🏅</div><div style="font-weight:800;font-size:12px;color:#000">MEDALS</div></div>
<div class="mode-btn" onclick="switchBattleMode('test')" style="background:linear-gradient(145deg,#1abc9c,#16a085);padding:15px;border-radius:10px;text-align:center;cursor:pointer;border:2px solid #fff"><div style="font-size:24px">🧪</div><div style="font-weight:800;font-size:12px">TEST</div></div>
</div>
<button onclick="closeBattleModeSelector()" style="margin-top:20px;padding:10px 30px;background:#e74c3c;border:none;border-radius:8px;color:#fff;font-weight:800;cursor:pointer">❌ CANCEL</button>`;
document.body.appendChild(ov);
}
function closeBattleModeSelector(){const ov=document.getElementById('battleModeSelectorOverlay');if(ov)ov.remove();}
function switchBattleMode(mode){
closeBattleModeSelector();
quitBattle();
setGameModeBtn(mode);
setTimeout(()=>startBattle(),100);
}
function setGameMode(mode){currentGameMode=mode;document.getElementById('normalModeBtn').style.opacity=mode==='normal'?'1':'0.6';document.getElementById('compModeBtn').style.opacity=mode==='comp'?'1':'0.6';document.getElementById('compStats').style.display=mode==='comp'?'block':'none';updatePlay();}
function initCompLeaderboard(){if(!P.compBots||P.compBots.length===0){P.compBots=[];for(let i=0;i<99;i++){const name=BOT_NAMES[i%BOT_NAMES.length]+(i>=BOT_NAMES.length?Math.floor(i/BOT_NAMES.length):'');const wins=Math.max(0,Math.floor(100-i*1+Math.random()*2));P.compBots.push({name,wins,isBot:true});}P.compLastUpdate=Date.now();save();}}
initCompLeaderboard();
function updateCompBots(){P.compBots.forEach(bot=>{if(Math.random()<0.4){bot.wins+=Math.floor(Math.random()*3)+1;}});P.compLastUpdate=Date.now();save();}
setInterval(()=>{updateCompBots();updateCompetitive();},2000);
function updateCompetitive(){const lb=[...P.compBots,{name:P.name,wins:P.compWins,isBot:false}];lb.sort((a,b)=>b.wins-a.wins);const top100=lb.slice(0,100);const el=document.getElementById('compLbList');if(!el)return;el.innerHTML='';top100.forEach((p,i)=>{const rank=i+1,div=document.createElement('div');div.className='lb-row'+(!p.isBot?' you':'')+(rank<=3?' top3':'');div.innerHTML=`<div class="lb-rank">${rank<=3?['🥇','🥈','🥉'][rank-1]:rank}</div><div class="lb-name">${p.name}${!p.isBot?' (YOU)':''}</div><div class="lb-trophies" style="color:#ff0080">🔥 ${p.wins} WINS</div>`;el.appendChild(div);});const playerInTop=top100.some(p=>!p.isBot);if(!playerInTop){const allSorted=lb.sort((a,b)=>b.wins-a.wins);const playerRank=allSorted.findIndex(p=>!p.isBot)+1;const div=document.createElement('div');div.className='lb-row you';div.style.marginTop='12px';div.innerHTML=`<div class="lb-rank">#${playerRank}</div><div class="lb-name">${P.name} (YOU)</div><div class="lb-trophies" style="color:#ff0080">🔥 ${P.compWins} WINS</div>`;el.appendChild(div);}}
function goTab(t){document.querySelectorAll('.tab').forEach(el=>el.classList.remove('on'));document.querySelectorAll('.nav-btn').forEach(el=>el.classList.remove('on'));document.getElementById('tab'+t).classList.add('on');const idx=['Play','Cards','Chests','Shop','Road','Leaderboard','Stats','Arena'].indexOf(t);if(idx>=0)document.querySelectorAll('.nav-btn')[idx].classList.add('on');if(t==='Play')updatePlay();if(t==='Cards')updateCards(),updateKingTowerUI(),updatePrincessUI();if(t==='Chests')updateChests();if(t==='Shop')updateShop();if(t==='Road')updateRoad();if(t==='Leaderboard'){updateLeaderboard();updateCompetitive();}if(t==='Stats')updateStats();if(t==='Arena')updateArena();}
function updatePlay(){const a=getArena(P.tr);document.getElementById('dispTr').textContent=P.tr.toLocaleString();document.getElementById('dispArena').textContent=a.icon+' '+a.name;document.getElementById('dispW').textContent=P.wins;document.getElementById('dispL').textContent=P.losses;document.getElementById('dispC').textContent=P.crowns;document.getElementById('dispStreak').textContent=P.streak||0;document.getElementById('dispCompTr').textContent=P.compTrophies||0;document.getElementById('dispCompW').textContent=P.compWins||0;document.getElementById('dispCompL').textContent=P.compLosses||0;const btn=document.getElementById('battleBtn'),badge=document.getElementById('rankedBadge');if(isRanked()){btn.className='battle-btn ranked';btn.innerHTML='🔥 RANKED BATTLE!';badge.style.display='inline-block';}else{btn.className='battle-btn';btn.innerHTML='⚔️ BATTLE!';badge.style.display='none';}}

// Toggle comp mode from corner box
function toggleCompMode(){currentGameMode=currentGameMode==='normal'?'comp':'normal';setGameMode(currentGameMode);}
function setGameMode(mode){currentGameMode=mode;const box=document.getElementById('compToggleBox'),icon=document.getElementById('compToggleIcon'),label=document.getElementById('compToggleLabel');if(box){box.style.borderColor=mode==='comp'?'#ff0080':'#34495e';box.style.background=mode==='comp'?'linear-gradient(145deg,#ff0080,#cc0066)':'linear-gradient(145deg,#1b2838,#243447)';}if(icon)icon.textContent=mode==='comp'?'🔥':'🎮';if(label)label.textContent=mode==='comp'?'COMP':'NORMAL';document.getElementById('compStats').style.display=mode==='comp'?'block':'none';updatePlay();}
// Leaderboard mode toggle
let lbMode='normal';
function setLbMode(mode){lbMode=mode;document.getElementById('lbNormalBtn').style.background=mode==='normal'?'linear-gradient(180deg,var(--gold),var(--gold-dark))':'linear-gradient(180deg,#444,#333)';document.getElementById('lbNormalBtn').style.opacity=mode==='normal'?'1':'0.7';document.getElementById('lbCompBtn').style.background=mode==='comp'?'linear-gradient(180deg,#ff0080,#cc0066)':'linear-gradient(180deg,#444,#333)';document.getElementById('lbCompBtn').style.opacity=mode==='comp'?'1':'0.7';document.getElementById('normalLbSection').style.display=mode==='normal'?'block':'none';document.getElementById('compLbSection').style.display=mode==='comp'?'block':'none';if(mode==='normal')updateLeaderboard();else updateCompetitive();}
// Custom card creator
let customCards=[];
try{const cc=localStorage.getItem('custom_cards');if(cc)customCards=JSON.parse(cc);}catch(e){}
function saveCustomCards(){localStorage.setItem('custom_cards',JSON.stringify(customCards));}
function createCustomCard(){const name=document.getElementById('ccName').value.trim(),icon=document.getElementById('ccIcon').value.trim()||'⭐',type=document.getElementById('ccType').value,rarity=document.getElementById('ccRarity').value,cost=parseInt(document.getElementById('ccCost').value)||3,hp=parseInt(document.getElementById('ccHP').value)||1000,dmg=parseInt(document.getElementById('ccDMG').value)||100,spd=parseFloat(document.getElementById('ccSpd').value)||1.0,rng=parseFloat(document.getElementById('ccRng').value)||1,as=parseFloat(document.getElementById('ccAS').value)||1.0,air=document.getElementById('ccAir').checked?1:0,fly=document.getElementById('ccFly').checked?1:0,bldg=document.getElementById('ccBldg').checked?1:0,charge=document.getElementById('ccCharge').checked?1:0,cnt=parseInt(document.getElementById('ccCnt').value)||1,spl=parseFloat(document.getElementById('ccSpl').value)||0,radius=parseFloat(document.getElementById('ccRadius').value)||0,poison=parseInt(document.getElementById('ccPoison').value)||0,poisonDur=parseFloat(document.getElementById('ccPoisonDur').value)||4,heal=parseInt(document.getElementById('ccHeal').value)||0,stun=parseFloat(document.getElementById('ccStun').value)||0,freeze=parseFloat(document.getElementById('ccFreeze').value)||0,slow=parseInt(document.getElementById('ccSlow').value)||0,slowDur=parseFloat(document.getElementById('ccSlowDur').value)||0,deathDmg=parseInt(document.getElementById('ccDeathDmg').value)||0,deathRadius=parseFloat(document.getElementById('ccDeathRadius').value)||0,shield=parseInt(document.getElementById('ccShield').value)||0,lifesteal=parseInt(document.getElementById('ccLifesteal').value)||0,ability=document.getElementById('ccAbility').value||'',abilityDesc=document.getElementById('ccAbilityDesc').value||'',elixirGen=parseFloat(document.getElementById('ccElixirGen').value)||0,elixirInterval=parseFloat(document.getElementById('ccElixirInterval').value)||8,lifetime=parseFloat(document.getElementById('ccLifetime').value)||0;if(!name){showNotify('Please enter a card name!','error','⚠️');return;}const isEditing=!!editingCardId;const id=isEditing?editingCardId:'custom_'+Date.now();const card={id,name,cost,type,rarity,icon};if(type==='troop'){card.hp=hp;card.dmg=dmg;card.spd=spd;card.rng=rng;card.as=as;card.air=air;if(fly)card.fly=1;if(bldg)card.bldg=1;if(charge)card.charge=1;if(cnt>1)card.cnt=cnt;if(spl>0)card.spl=spl;if(poison>0){card.poison=poison;card.poisonDur=poisonDur;}if(heal>0)card.heal=heal;if(stun>0)card.stun=stun;if(freeze>0)card.freeze=freeze;if(slow>0){card.slow=slow;card.slowDur=slowDur;}if(deathDmg>0){card.deathDmg=deathDmg;card.deathRadius=deathRadius||2;}if(shield>0)card.shield=shield;if(lifesteal>0)card.lifesteal=lifesteal;if(ability){card.ability=ability;card.abilityDesc=abilityDesc||'Special ability!'}}else if(type==='building'){card.hp=hp;card.dmg=dmg;card.rng=rng;card.as=as;card.air=air;if(lifetime>0)card.lifetime=lifetime;if(elixirGen>0){card.elixirGen=elixirGen;card.elixirInterval=elixirInterval;}}else{card.dmg=dmg;card.radius=radius||2;if(poison>0){card.poison=poison;card.poisonDur=poisonDur;card.duration=poisonDur;}}if(isEditing){const cidx=CARDS.findIndex(c=>c.id===id);if(cidx>=0)CARDS[cidx]=card;const ccidx=customCards.findIndex(c=>c.id===id);if(ccidx>=0)customCards[ccidx]=card;editingCardId=null;showNotify('✏️ Card Updated!\n"'+name+'"','success');}else{CARDS.push(card);customCards.push(card);P.unlocked.push(id);P.lvls[id]=1;P.shards[id]=0;showNotify('🎉 Card Created!\n"'+name+'"','success');}saveCustomCards();save();updateCards();populateAdminSelects();}
function deleteCustomCard(){const id=document.getElementById('deleteCardSelect').value;if(!id||!id.startsWith('custom_')){showNotify('Select a custom card to delete!','error','⚠️');return;}const idx=CARDS.findIndex(c=>c.id===id);if(idx>=0)CARDS.splice(idx,1);const cidx=customCards.findIndex(c=>c.id===id);if(cidx>=0)customCards.splice(cidx,1);const uidx=P.unlocked.indexOf(id);if(uidx>=0)P.unlocked.splice(uidx,1);const didx=P.deck.indexOf(id);if(didx>=0)P.deck.splice(didx,1);saveCustomCards();save();updateCards();populateAdminSelects();showNotify('🗑️ Card Deleted!','success');}
let editingCardId=null;
function editCustomCard(){const id=document.getElementById('deleteCardSelect').value;if(!id||!id.startsWith('custom_')){showNotify('Select a custom card to edit!','error','⚠️');return;}const card=customCards.find(c=>c.id===id);if(!card){showNotify('Card not found!','error','⚠️');return;}editingCardId=id;document.getElementById('ccName').value=card.name||'';document.getElementById('ccIcon').value=card.icon||'';document.getElementById('ccType').value=card.type||'troop';document.getElementById('ccRarity').value=card.rarity||'common';document.getElementById('ccCost').value=card.cost||3;document.getElementById('ccHP').value=card.hp||'';document.getElementById('ccDMG').value=card.dmg||'';document.getElementById('ccSpd').value=card.spd||'';document.getElementById('ccRng').value=card.rng||'';document.getElementById('ccAS').value=card.as||'';document.getElementById('ccAir').checked=!!card.air;document.getElementById('ccFly').checked=!!card.fly;document.getElementById('ccBldg').checked=!!card.bldg;document.getElementById('ccCharge').checked=!!card.charge;document.getElementById('ccCnt').value=card.cnt||'';document.getElementById('ccSpl').value=card.spl||'';document.getElementById('ccRadius').value=card.radius||'';document.getElementById('ccPoison').value=card.poison||'';document.getElementById('ccPoisonDur').value=card.poisonDur||'';document.getElementById('ccHeal').value=card.heal||'';document.getElementById('ccStun').value=card.stun||'';document.getElementById('ccFreeze').value=card.freeze||'';document.getElementById('ccSlow').value=card.slow||'';document.getElementById('ccSlowDur').value=card.slowDur||'';document.getElementById('ccDeathDmg').value=card.deathDmg||'';document.getElementById('ccDeathRadius').value=card.deathRadius||'';document.getElementById('ccShield').value=card.shield||'';document.getElementById('ccLifesteal').value=card.lifesteal||'';document.getElementById('ccAbility').value=card.ability||'';document.getElementById('ccAbilityDesc').value=card.abilityDesc||'';document.getElementById('ccElixirGen').value=card.elixirGen||'';document.getElementById('ccElixirInterval').value=card.elixirInterval||'';document.getElementById('ccLifetime').value=card.lifetime||'';showNotify('✏️ Editing Card\n"'+card.name+'" - modify & click CREATE','info');}
function previewCustomCard(){const name=document.getElementById('ccName').value.trim()||'Preview Card',icon=document.getElementById('ccIcon').value.trim()||'⭐',type=document.getElementById('ccType').value,rarity=document.getElementById('ccRarity').value,cost=parseInt(document.getElementById('ccCost').value)||3,hp=parseInt(document.getElementById('ccHP').value)||1000,dmg=parseInt(document.getElementById('ccDMG').value)||100;showNotify(`📋 CARD PREVIEW\n${icon} ${name}\n${type} | ${rarity} | Cost: ${cost}`,'info');}
function loadCardTemplate(){const templates=[{name:'Tank',icon:'🛡️',type:'troop',rarity:'epic',cost:6,hp:4000,dmg:150,spd:0.7,rng:1,as:1.8},{name:'Assassin',icon:'🗡️',type:'troop',rarity:'legendary',cost:4,hp:800,dmg:500,spd:2.0,rng:1,as:0.8},{name:'Healer',icon:'💚',type:'troop',rarity:'epic',cost:4,hp:600,dmg:50,spd:1.0,rng:4,as:1.5,heal:100},{name:'Swarm',icon:'🐝',type:'troop',rarity:'common',cost:3,hp:100,dmg:50,spd:1.5,rng:1,as:0.8,cnt:6},{name:'Sniper',icon:'🎯',type:'troop',rarity:'rare',cost:5,hp:400,dmg:400,spd:0.8,rng:8,as:2.0,air:1},{name:'Bomber',icon:'💥',type:'troop',rarity:'rare',cost:4,hp:500,dmg:300,spd:1.0,rng:4,as:1.5,spl:2},{name:'Freeze Spell',icon:'❄️',type:'spell',rarity:'epic',cost:4,dmg:100,radius:3,freeze:4},{name:'Rage Spell',icon:'😤',type:'spell',rarity:'epic',cost:3,dmg:0,radius:5},{name:'Elixir Pump',icon:'🧪',type:'building',rarity:'rare',cost:6,hp:800,dmg:0,rng:0,as:0,lifetime:60,elixirGen:1,elixirInterval:8},{name:'Cannon',icon:'💣',type:'building',rarity:'common',cost:3,hp:600,dmg:120,rng:5.5,as:0.8,lifetime:30,air:0}];const t=templates[Math.floor(Math.random()*templates.length)];document.getElementById('ccName').value=t.name;document.getElementById('ccIcon').value=t.icon;document.getElementById('ccType').value=t.type;document.getElementById('ccRarity').value=t.rarity;document.getElementById('ccCost').value=t.cost;document.getElementById('ccHP').value=t.hp||'';document.getElementById('ccDMG').value=t.dmg;if(t.spd)document.getElementById('ccSpd').value=t.spd;if(t.rng)document.getElementById('ccRng').value=t.rng;if(t.as)document.getElementById('ccAS').value=t.as;if(t.cnt)document.getElementById('ccCnt').value=t.cnt;if(t.spl)document.getElementById('ccSpl').value=t.spl;if(t.radius)document.getElementById('ccRadius').value=t.radius;if(t.freeze)document.getElementById('ccFreeze').value=t.freeze;if(t.heal)document.getElementById('ccHeal').value=t.heal;if(t.air)document.getElementById('ccAir').checked=true;if(t.lifetime)document.getElementById('ccLifetime').value=t.lifetime;if(t.elixirGen)document.getElementById('ccElixirGen').value=t.elixirGen;if(t.elixirInterval)document.getElementById('ccElixirInterval').value=t.elixirInterval;showNotify('📜 Template Loaded!\n'+t.name,'success');}
function populateAdminSelects(){['unlockCardSelect','levelCardSelect','shardCardSelect'].forEach(id=>{const sel=document.getElementById(id);if(sel)sel.innerHTML=CARDS.map(c=>`<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');});const delSel=document.getElementById('deleteCardSelect');if(delSel)delSel.innerHTML='<option value="">-- Select Custom Card --</option>'+customCards.map(c=>`<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');updateMetaDeckSelect();updateGameModeSelect();}
// Load custom cards on startup
customCards.forEach(c=>{if(!CARDS.find(x=>x.id===c.id)){CARDS.push(c);if(!P.unlocked.includes(c.id))P.unlocked.push(c.id);if(!P.lvls[c.id])P.lvls[c.id]=1;if(!P.shards[c.id])P.shards[c.id]=0;}});

// ===== CUSTOM GAME MODE SYSTEM =====
let customGameModes=[];
let editingGameModeId=null;
let activeCustomMode=null;
try{const cgm=localStorage.getItem('custom_game_modes');if(cgm)customGameModes=JSON.parse(cgm);}catch(e){}
function saveCustomGameModes(){localStorage.setItem('custom_game_modes',JSON.stringify(customGameModes));}

function createCustomGameMode(){
  const name=document.getElementById('gmName').value.trim();
  const icon=document.getElementById('gmIcon').value.trim()||'🎮';
  const desc=document.getElementById('gmDesc').value.trim()||'Custom game mode';

  if(!name){showNotify('Please enter a mode name!','error','⚠️');return;}

  const mode={
    id:editingGameModeId||'gm_'+Date.now(),
    name,icon,desc,
    // Time settings
    duration:parseInt(document.getElementById('gmDuration').value)||180,
    overtime:parseInt(document.getElementById('gmOvertime').value)||60,
    infiniteTime:document.getElementById('gmInfiniteTime').checked,
    suddenDeath:document.getElementById('gmSuddenDeath').checked,
    // Elixir settings
    startElixir:parseInt(document.getElementById('gmStartElixir').value)||5,
    maxElixir:parseInt(document.getElementById('gmMaxElixir').value)||10,
    elixirRate:parseFloat(document.getElementById('gmElixirRate').value)||1,
    doubleElixirTime:parseInt(document.getElementById('gmDoubleElixirTime').value)||60,
    tripleElixirTime:parseInt(document.getElementById('gmTripleElixirTime').value)||120,
    infiniteElixir:document.getElementById('gmInfiniteElixir').checked,
    startFull:document.getElementById('gmStartFull').checked,
    // Tower settings
    towerHP:parseInt(document.getElementById('gmTowerHP').value)||100,
    towerDMG:parseInt(document.getElementById('gmTowerDMG').value)||100,
    kingHP:parseInt(document.getElementById('gmKingHP').value)||100,
    noTowers:document.getElementById('gmNoTowers').checked,
    kingOnly:document.getElementById('gmKingOnly').checked,
    // Troop settings
    troopHP:parseInt(document.getElementById('gmTroopHP').value)||100,
    troopDMG:parseInt(document.getElementById('gmTroopDMG').value)||100,
    troopSpd:parseInt(document.getElementById('gmTroopSpd').value)||100,
    spawnMult:parseInt(document.getElementById('gmSpawnMult').value)||1,
    costMult:parseInt(document.getElementById('gmCostMult').value)||100,
    // Bot settings
    botLevel:parseInt(document.getElementById('gmBotLevel').value)||0,
    botMult:parseInt(document.getElementById('gmBotMult').value)||100,
    botSpeed:parseInt(document.getElementById('gmBotSpeed').value)||100,
    botDisabled:document.getElementById('gmBotDisabled').checked,
    botAggressive:document.getElementById('gmBotAggressive').checked,
    // Card settings
    allCards:document.getElementById('gmAllCards').checked,
    randomDeck:document.getElementById('gmRandomDeck').checked,
    draftMode:document.getElementById('gmDraftMode').checked,
    mirrorMode:document.getElementById('gmMirrorMode').checked,
    cardFilter:document.getElementById('gmCardFilter').value,
    // Special modifiers
    rageMode:document.getElementById('gmRageMode').checked,
    chaosEvents:document.getElementById('gmChaosEvents').checked,
    doubleTroops:document.getElementById('gmDoubleTroops').checked,
    giantMode:document.getElementById('gmGiantMode').checked,
    miniMode:document.getElementById('gmMiniMode').checked,
    fragileMode:document.getElementById('gmFragileMode').checked,
    tankMode:document.getElementById('gmTankMode').checked,
    speedMode:document.getElementById('gmSpeedMode').checked,
    // Rewards
    trophyMult:parseInt(document.getElementById('gmTrophyMult').value)||100,
    goldMult:parseInt(document.getElementById('gmGoldMult').value)||100,
    xpMult:parseInt(document.getElementById('gmXpMult').value)||100
  };

  if(editingGameModeId){
    const idx=customGameModes.findIndex(m=>m.id===editingGameModeId);
    if(idx>=0)customGameModes[idx]=mode;
    editingGameModeId=null;
    showNotify('✏️ Mode Updated!\n"'+name+'"','success');
  }else{
    customGameModes.push(mode);
    showNotify('🎮 Mode Created!\n"'+name+'"','success');
  }
  saveCustomGameModes();
  updateGameModeSelect();
  clearGameModeForm();
}

function deleteCustomGameMode(){
  const id=document.getElementById('deleteGameModeSelect').value;
  if(!id){showNotify('Select a mode to delete!','error','⚠️');return;}
  const idx=customGameModes.findIndex(m=>m.id===id);
  if(idx>=0)customGameModes.splice(idx,1);
  saveCustomGameModes();
  updateGameModeSelect();
  showNotify('🗑️ Mode Deleted!','success');
}

function editGameMode(){
  const id=document.getElementById('deleteGameModeSelect').value;
  if(!id){showNotify('Select a mode to edit!','error','⚠️');return;}
  const mode=customGameModes.find(m=>m.id===id);
  if(!mode){showNotify('Mode not found!','error','⚠️');return;}

  editingGameModeId=id;
  document.getElementById('gmName').value=mode.name||'';
  document.getElementById('gmIcon').value=mode.icon||'';
  document.getElementById('gmDesc').value=mode.desc||'';
  document.getElementById('gmDuration').value=mode.duration||180;
  document.getElementById('gmOvertime').value=mode.overtime||60;
  document.getElementById('gmInfiniteTime').checked=!!mode.infiniteTime;
  document.getElementById('gmSuddenDeath').checked=!!mode.suddenDeath;
  document.getElementById('gmStartElixir').value=mode.startElixir||5;
  document.getElementById('gmMaxElixir').value=mode.maxElixir||10;
  document.getElementById('gmElixirRate').value=mode.elixirRate||1;
  document.getElementById('gmDoubleElixirTime').value=mode.doubleElixirTime||60;
  document.getElementById('gmTripleElixirTime').value=mode.tripleElixirTime||120;
  document.getElementById('gmInfiniteElixir').checked=!!mode.infiniteElixir;
  document.getElementById('gmStartFull').checked=!!mode.startFull;
  document.getElementById('gmTowerHP').value=mode.towerHP||100;
  document.getElementById('gmTowerDMG').value=mode.towerDMG||100;
  document.getElementById('gmKingHP').value=mode.kingHP||100;
  document.getElementById('gmNoTowers').checked=!!mode.noTowers;
  document.getElementById('gmKingOnly').checked=!!mode.kingOnly;
  document.getElementById('gmTroopHP').value=mode.troopHP||100;
  document.getElementById('gmTroopDMG').value=mode.troopDMG||100;
  document.getElementById('gmTroopSpd').value=mode.troopSpd||100;
  document.getElementById('gmSpawnMult').value=mode.spawnMult||1;
  document.getElementById('gmCostMult').value=mode.costMult||100;
  document.getElementById('gmBotLevel').value=mode.botLevel||0;
  document.getElementById('gmBotMult').value=mode.botMult||100;
  document.getElementById('gmBotSpeed').value=mode.botSpeed||100;
  document.getElementById('gmBotDisabled').checked=!!mode.botDisabled;
  document.getElementById('gmBotAggressive').checked=!!mode.botAggressive;
  document.getElementById('gmAllCards').checked=!!mode.allCards;
  document.getElementById('gmRandomDeck').checked=!!mode.randomDeck;
  document.getElementById('gmDraftMode').checked=!!mode.draftMode;
  document.getElementById('gmMirrorMode').checked=!!mode.mirrorMode;
  document.getElementById('gmCardFilter').value=mode.cardFilter||'all';
  document.getElementById('gmRageMode').checked=!!mode.rageMode;
  document.getElementById('gmChaosEvents').checked=!!mode.chaosEvents;
  document.getElementById('gmDoubleTroops').checked=!!mode.doubleTroops;
  document.getElementById('gmGiantMode').checked=!!mode.giantMode;
  document.getElementById('gmMiniMode').checked=!!mode.miniMode;
  document.getElementById('gmFragileMode').checked=!!mode.fragileMode;
  document.getElementById('gmTankMode').checked=!!mode.tankMode;
  document.getElementById('gmSpeedMode').checked=!!mode.speedMode;
  document.getElementById('gmTrophyMult').value=mode.trophyMult||100;
  document.getElementById('gmGoldMult').value=mode.goldMult||100;
  document.getElementById('gmXpMult').value=mode.xpMult||100;
  showNotify('✏️ Editing Mode\n"'+mode.name+'"','info');
}

function previewGameMode(){
  const name=document.getElementById('gmName').value.trim()||'Preview Mode';
  const icon=document.getElementById('gmIcon').value.trim()||'🎮';
  const dur=document.getElementById('gmDuration').value||180;
  const elixir=document.getElementById('gmElixirRate').value||1;
  const hp=document.getElementById('gmTroopHP').value||100;
  showNotify(`📋 MODE PREVIEW\n${icon} ${name}\nTime: ${dur}s | Elixir: ${elixir}x | HP: ${hp}%`,'info');
}

function loadGameModeTemplate(){
  const templates=[
    {name:'Infinite Elixir',icon:'🧪',desc:'Unlimited elixir madness!',infiniteElixir:true,duration:120},
    {name:'Sudden Death',icon:'💀',desc:'First crown wins!',suddenDeath:true,towerHP:10,kingHP:10,duration:180},
    {name:'Triple Elixir',icon:'⚡',desc:'3x elixir from the start!',elixirRate:3,startFull:true},
    {name:'Giant Mode',icon:'🦣',desc:'All troops are huge!',giantMode:true,troopHP:300,troopDMG:200,troopSpd:50},
    {name:'Mini Mode',icon:'🐜',desc:'Tiny troops, big fun!',miniMode:true,troopHP:30,spawnMult:3,troopSpd:150},
    {name:'Speed Battle',icon:'💨',desc:'Everything is fast!',speedMode:true,troopSpd:200,elixirRate:2,duration:90},
    {name:'Tank Wars',icon:'🛡️',desc:'High HP, low damage',tankMode:true,troopHP:500,troopDMG:50,towerHP:300},
    {name:'Glass Cannon',icon:'💥',desc:'Fragile but deadly',fragileMode:true,troopHP:20,troopDMG:300},
    {name:'Rage Mode',icon:'😤',desc:'Permanent rage effect!',rageMode:true,troopSpd:140,troopDMG:130},
    {name:'No Bot',icon:'🎯',desc:'Practice without opponent',botDisabled:true,infiniteTime:true,infiniteElixir:true},
    {name:'Chaos Battle',icon:'🌀',desc:'Random events every 10s!',chaosEvents:true,elixirRate:1.5},
    {name:'Draft Mode',icon:'🎴',desc:'Pick your cards!',draftMode:true,allCards:true}
  ];
  const t=templates[Math.floor(Math.random()*templates.length)];
  clearGameModeForm();
  document.getElementById('gmName').value=t.name;
  document.getElementById('gmIcon').value=t.icon;
  document.getElementById('gmDesc').value=t.desc;
  if(t.duration)document.getElementById('gmDuration').value=t.duration;
  if(t.elixirRate)document.getElementById('gmElixirRate').value=t.elixirRate;
  if(t.infiniteElixir)document.getElementById('gmInfiniteElixir').checked=true;
  if(t.startFull)document.getElementById('gmStartFull').checked=true;
  if(t.suddenDeath)document.getElementById('gmSuddenDeath').checked=true;
  if(t.infiniteTime)document.getElementById('gmInfiniteTime').checked=true;
  if(t.towerHP)document.getElementById('gmTowerHP').value=t.towerHP;
  if(t.kingHP)document.getElementById('gmKingHP').value=t.kingHP;
  if(t.troopHP)document.getElementById('gmTroopHP').value=t.troopHP;
  if(t.troopDMG)document.getElementById('gmTroopDMG').value=t.troopDMG;
  if(t.troopSpd)document.getElementById('gmTroopSpd').value=t.troopSpd;
  if(t.spawnMult)document.getElementById('gmSpawnMult').value=t.spawnMult;
  if(t.giantMode)document.getElementById('gmGiantMode').checked=true;
  if(t.miniMode)document.getElementById('gmMiniMode').checked=true;
  if(t.speedMode)document.getElementById('gmSpeedMode').checked=true;
  if(t.tankMode)document.getElementById('gmTankMode').checked=true;
  if(t.fragileMode)document.getElementById('gmFragileMode').checked=true;
  if(t.rageMode)document.getElementById('gmRageMode').checked=true;
  if(t.chaosEvents)document.getElementById('gmChaosEvents').checked=true;
  if(t.botDisabled)document.getElementById('gmBotDisabled').checked=true;
  if(t.draftMode)document.getElementById('gmDraftMode').checked=true;
  if(t.allCards)document.getElementById('gmAllCards').checked=true;
  showNotify('📜 Template Loaded!\n'+t.name,'success');
}

function clearGameModeForm(){
  document.getElementById('gmName').value='';
  document.getElementById('gmIcon').value='';
  document.getElementById('gmDesc').value='';
  document.getElementById('gmDuration').value='180';
  document.getElementById('gmOvertime').value='60';
  document.getElementById('gmInfiniteTime').checked=false;
  document.getElementById('gmSuddenDeath').checked=false;
  document.getElementById('gmStartElixir').value='5';
  document.getElementById('gmMaxElixir').value='10';
  document.getElementById('gmElixirRate').value='1';
  document.getElementById('gmDoubleElixirTime').value='60';
  document.getElementById('gmTripleElixirTime').value='120';
  document.getElementById('gmInfiniteElixir').checked=false;
  document.getElementById('gmStartFull').checked=false;
  document.getElementById('gmTowerHP').value='100';
  document.getElementById('gmTowerDMG').value='100';
  document.getElementById('gmKingHP').value='100';
  document.getElementById('gmNoTowers').checked=false;
  document.getElementById('gmKingOnly').checked=false;
  document.getElementById('gmTroopHP').value='100';
  document.getElementById('gmTroopDMG').value='100';
  document.getElementById('gmTroopSpd').value='100';
  document.getElementById('gmSpawnMult').value='1';
  document.getElementById('gmCostMult').value='100';
  document.getElementById('gmBotLevel').value='0';
  document.getElementById('gmBotMult').value='100';
  document.getElementById('gmBotSpeed').value='100';
  document.getElementById('gmBotDisabled').checked=false;
  document.getElementById('gmBotAggressive').checked=false;
  document.getElementById('gmAllCards').checked=false;
  document.getElementById('gmRandomDeck').checked=false;
  document.getElementById('gmDraftMode').checked=false;
  document.getElementById('gmMirrorMode').checked=false;
  document.getElementById('gmCardFilter').value='all';
  document.getElementById('gmRageMode').checked=false;
  document.getElementById('gmChaosEvents').checked=false;
  document.getElementById('gmDoubleTroops').checked=false;
  document.getElementById('gmGiantMode').checked=false;
  document.getElementById('gmMiniMode').checked=false;
  document.getElementById('gmFragileMode').checked=false;
  document.getElementById('gmTankMode').checked=false;
  document.getElementById('gmSpeedMode').checked=false;
  document.getElementById('gmTrophyMult').value='100';
  document.getElementById('gmGoldMult').value='100';
  document.getElementById('gmXpMult').value='100';
  editingGameModeId=null;
}

function updateGameModeSelect(){
  const sel=document.getElementById('deleteGameModeSelect');
  if(sel)sel.innerHTML='<option value="">-- Select Mode --</option>'+customGameModes.map(m=>`<option value="${m.id}">${m.icon} ${m.name}</option>`).join('');
  updateCustomModeChips();
}

function updateCustomModeChips(){
  const container=document.getElementById('customModeChips');
  if(!container)return;
  container.innerHTML=customGameModes.map(m=>`<div class="mode-chip" onclick="playCustomMode('${m.id}')" style="padding:6px 12px;background:linear-gradient(145deg,#ff0080,#cc0066);border-radius:20px;font-size:10px;font-weight:800;cursor:pointer;display:flex;align-items:center;gap:4px;border:2px solid transparent"><span>${m.icon}</span>${m.name}</div>`).join('');
}

function playCustomMode(modeId){
  const mode=customGameModes.find(m=>m.id===modeId);
  if(!mode){showNotify('Mode not found!','error');return;}
  activeCustomMode=mode;
  currentGameMode='custom';
  showNotify(`🎮 ${mode.icon} ${mode.name}\n${mode.desc}`,'success');
  setTimeout(()=>startBattle(),500);
}

// WILD ITEMS SYSTEM
const WILD_ITEMS=[
{id:'w_shield',name:'Battle Shield',icon:'🛡️',desc:'Reduces tower damage by 10%',effect:'+10% Tower Defense',rarity:'common',chance:0.15},
{id:'w_sword',name:'Power Sword',icon:'⚔️',desc:'Increases troop damage by 5%',effect:'+5% Troop Damage',rarity:'common',chance:0.15},
{id:'w_boots',name:'Speed Boots',icon:'👟',desc:'Troops move 8% faster',effect:'+8% Speed',rarity:'common',chance:0.12},
{id:'w_heart',name:'Life Crystal',icon:'💖',desc:'Troops gain 10% more HP',effect:'+10% Troop HP',rarity:'rare',chance:0.08},
{id:'w_elixir',name:'Elixir Potion',icon:'🧪',desc:'Start with +1 elixir',effect:'+1 Starting Elixir',rarity:'rare',chance:0.08},
{id:'w_clock',name:'Time Warp',icon:'⏰',desc:'Elixir regenerates 5% faster',effect:'+5% Elixir Regen',rarity:'rare',chance:0.06},
{id:'w_crown',name:'Royal Crown',icon:'👑',desc:'+15% gold from battles',effect:'+15% Battle Gold',rarity:'epic',chance:0.04},
{id:'w_gem',name:'Lucky Gem',icon:'💎',desc:'+5% chance for better chests',effect:'+5% Chest Luck',rarity:'epic',chance:0.04},
{id:'w_star',name:'Victory Star',icon:'⭐',desc:'+10% trophy gains',effect:'+10% Trophies',rarity:'epic',chance:0.03},
{id:'w_dragon',name:'Dragon Egg',icon:'🥚',desc:'Summon a mini dragon every 30s',effect:'Mini Dragon Spawn',rarity:'legendary',chance:0.02},
{id:'w_phoenix',name:'Phoenix Feather',icon:'🪶',desc:'One tower revives with 20% HP',effect:'Tower Revival',rarity:'legendary',chance:0.015},
{id:'w_infinity',name:'Infinity Stone',icon:'♾️',desc:'All wild effects doubled',effect:'2x Wild Effects',rarity:'legendary',chance:0.01}
];

// DAILY REWARDS
const DAILY_REWARDS=[
{day:1,icon:'💰',amount:'500',type:'gold',reward:{gold:500}},
{day:2,icon:'💎',amount:'25',type:'gems',reward:{gems:25}},
{day:3,icon:'📦',amount:'1',type:'chest',reward:{chest:'silver'}},
{day:4,icon:'💰',amount:'1000',type:'gold',reward:{gold:1000}},
{day:5,icon:'💠',amount:'50',type:'crystals',reward:{crystals:50}},
{day:6,icon:'🎁',amount:'1',type:'chest',reward:{chest:'gold'}},
{day:7,icon:'👑',amount:'MEGA',type:'mega',reward:{gold:5000,gems:100,crystals:100,chest:'magic'}}
];

// DAILY CHALLENGES
const CHALLENGES=[
{id:'ch_wins',name:'Win 3 Battles',icon:'⚔️',target:3,reward:{gold:500}},
{id:'ch_crowns',name:'Earn 5 Crowns',icon:'👑',target:5,reward:{gems:20}},
{id:'ch_troops',name:'Deploy 20 Troops',icon:'🎴',target:20,reward:{gold:300}},
{id:'ch_damage',name:'Deal 5000 Damage',icon:'💥',target:5000,reward:{crystals:30}}
];

// ACHIEVEMENTS
const ACHIEVEMENTS=[
{id:'ach_first',name:'First Victory',desc:'Win your first battle',icon:'🏆',check:()=>P.wins>=1,reward:{gems:50}},
{id:'ach_10wins',name:'Warrior',desc:'Win 10 battles',icon:'⚔️',check:()=>P.wins>=10,reward:{gems:100}},
{id:'ach_100wins',name:'Champion',desc:'Win 100 battles',icon:'🏅',check:()=>P.wins>=100,reward:{gems:500}},
{id:'ach_1000tr',name:'Rising Star',desc:'Reach 1000 trophies',icon:'⭐',check:()=>P.tr>=1000,reward:{gems:100}},
{id:'ach_5000tr',name:'Arena Master',desc:'Reach 5000 trophies',icon:'🌟',check:()=>P.tr>=5000,reward:{gems:250}},
{id:'ach_streak5',name:'Hot Streak',desc:'Win 5 battles in a row',icon:'🔥',check:()=>P.maxStr>=5,reward:{gems:75}},
{id:'ach_allcards',name:'Collector',desc:'Unlock all cards',icon:'🎴',check:()=>P.unlocked.length>=CARDS.length,reward:{gems:1000}},
{id:'ach_wild5',name:'Wild Hunter',desc:'Collect 5 wild items',icon:'🌀',check:()=>(P.wildItems||[]).length>=5,reward:{gems:150}},
{id:'ach_rich',name:'Gold Hoarder',desc:'Have 100,000 gold',icon:'💰',check:()=>P.gold>=100000,reward:{gems:200}}
];

// Initialize player wild/daily data
if(!P.wildItems)P.wildItems=[];
if(!P.wildTokens)P.wildTokens=0;
if(!P.selectedSkin)P.selectedSkin=0;
if(!P.dailyStreak)P.dailyStreak=0;
if(!P.lastDaily)P.lastDaily=0;
if(!P.challengeProgress)P.challengeProgress={};
if(!P.achievementsUnlocked)P.achievementsUnlocked=[];
if(!P.totalDamage)P.totalDamage=0;
if(!P.troopsDeployed)P.troopsDeployed=0;

// Get unlocked arena skins
function getUnlockedSkins(){return ARENAS.filter((a,i)=>P.tr>=a.min||P.tr>=a.min).map((a,i)=>ARENAS.indexOf(a));}

// Select arena skin
function selectSkin(idx){if(P.tr>=ARENAS[idx].min){P.selectedSkin=idx;save();updateWild();showNotify('🎨 Skin Equipped!\n'+ARENAS[idx].name,'success');}}

// Update Wild tab
function updateWild(){
const grid=document.getElementById('wildGrid');if(!grid)return;
document.getElementById('dispGoldW').textContent=P.gold.toLocaleString();
document.getElementById('dispGemsW').textContent=P.gems.toLocaleString();
document.getElementById('dispWildTokens').textContent=P.wildTokens||0;
grid.innerHTML='<div style="grid-column:span 2;margin-bottom:10px"><div class="section-title">🎨 ARENA SKINS</div></div>';
const skinDiv=document.createElement('div');skinDiv.style='grid-column:span 2;display:flex;flex-wrap:wrap;gap:6px;margin-bottom:15px';
ARENAS.slice(0,20).forEach((a,i)=>{const unlocked=P.tr>=a.min,selected=P.selectedSkin===i;
const btn=document.createElement('div');btn.className='wild-item'+(unlocked?' owned':'')+(selected?' legendary':'');btn.style='padding:8px;min-width:70px';
btn.innerHTML=`<div style="font-size:20px">${a.icon}</div><div style="font-size:8px;font-weight:800">${a.name.split(' ')[0]}</div>${unlocked?'<div style="font-size:7px;color:#2ecc71">✓</div>':'<div style="font-size:7px;color:#ff6b6b">🔒 ${a.min}</div>'}`;
if(unlocked)btn.onclick=()=>selectSkin(i);
skinDiv.appendChild(btn);});
grid.appendChild(skinDiv);
grid.innerHTML+='<div style="grid-column:span 2"><div class="section-title">🌀 WILD ITEMS</div></div>';
WILD_ITEMS.forEach(item=>{const owned=(P.wildItems||[]).includes(item.id);
const div=document.createElement('div');div.className='wild-item'+(owned?' owned':'')+(item.rarity==='legendary'?' legendary':'');
div.innerHTML=`<div class="wild-icon">${item.icon}</div><div class="wild-name">${item.name}</div><div class="wild-desc">${item.desc}</div><div class="wild-effect">${item.effect}</div>${owned?'<div class="wild-owned">✓</div>':''}`;
grid.appendChild(div);});
}

// Award wild item from chest
function awardWildItem(){
const roll=Math.random();let cumulative=0;
for(const item of WILD_ITEMS){cumulative+=item.chance;if(roll<cumulative&&!P.wildItems.includes(item.id)){P.wildItems.push(item.id);P.wildTokens=(P.wildTokens||0)+1;save();return item;}}
P.wildTokens=(P.wildTokens||0)+1;save();return null;
}

// ==================== WILD CARD WORKSHOP SYSTEM ====================
// Initialize workshop data
if(!P.royalWildCards)P.royalWildCards=0;
if(!P.workshopStats)P.workshopStats={forges:0,summons:0,boosts:0,transmutes:0};
if(!P.activeBoosts)P.activeBoosts=[];

// Workshop boost definitions
const WORKSHOP_BOOSTS=[
{id:'boost_dmg',name:'Damage Surge',icon:'⚔️',desc:'+15% troop damage for 3 battles',effect:{type:'troopDmg',value:0.15},battles:3,cost:5},
{id:'boost_hp',name:'Iron Will',icon:'🛡️',desc:'+20% troop HP for 3 battles',effect:{type:'troopHp',value:0.20},battles:3,cost:5},
{id:'boost_elixir',name:'Elixir Rush',icon:'🧪',desc:'+1 starting elixir for 3 battles',effect:{type:'startElixir',value:1},battles:3,cost:8},
{id:'boost_speed',name:'Swift Feet',icon:'👟',desc:'+15% troop speed for 3 battles',effect:{type:'troopSpeed',value:0.15},battles:3,cost:5},
{id:'boost_tower',name:'Tower Fortress',icon:'🏰',desc:'+25% tower HP for 3 battles',effect:{type:'towerHp',value:0.25},battles:3,cost:10},
{id:'boost_mega',name:'MEGA POWER',icon:'💥',desc:'ALL boosts combined for 1 battle!',effect:{type:'mega',value:1},battles:1,cost:15}
];

// Update Workshop tab
function updateWorkshop(){
const wcCount=document.getElementById('workshopWildCount');
if(wcCount)wcCount.textContent=(P.royalWildCards||0).toLocaleString();
// Update stats
const statsDiv=document.getElementById('workshopStats');
if(statsDiv){
const s=P.workshopStats||{forges:0,summons:0,boosts:0,transmutes:0};
statsDiv.innerHTML=`
<div style="background:linear-gradient(145deg,#3a2a1a,#4a3a2a);padding:8px;border-radius:8px;border:2px solid #f39c12">
  <div style="color:#f39c12;font-weight:900">⚒️ Forges</div><div style="font-size:16px;font-weight:900">${s.forges}</div>
</div>
<div style="background:linear-gradient(145deg,#2a1a3a,#3a2a4a);padding:8px;border-radius:8px;border:2px solid #9b59b6">
  <div style="color:#9b59b6;font-weight:900">✨ Summons</div><div style="font-size:16px;font-weight:900">${s.summons}</div>
</div>
<div style="background:linear-gradient(145deg,#1a3a2a,#2a4a3a);padding:8px;border-radius:8px;border:2px solid #2ecc71">
  <div style="color:#2ecc71;font-weight:900">⚡ Boosts</div><div style="font-size:16px;font-weight:900">${s.boosts}</div>
</div>
<div style="background:linear-gradient(145deg,#1a2a3a,#2a3a4a);padding:8px;border-radius:8px;border:2px solid #3498db">
  <div style="color:#3498db;font-weight:900">🔄 Transmutes</div><div style="font-size:16px;font-weight:900">${s.transmutes}</div>
</div>`;
}
// Update active boosts
const boostsDiv=document.getElementById('activeBoosts');
if(boostsDiv){
P.activeBoosts=P.activeBoosts.filter(b=>b.battlesLeft>0);
if(P.activeBoosts.length===0){
boostsDiv.innerHTML='<div style="color:#888">No active boosts - visit Power Boost!</div>';
}else{
boostsDiv.innerHTML=P.activeBoosts.map(b=>{
const boost=WORKSHOP_BOOSTS.find(wb=>wb.id===b.id);
return `<div style="display:flex;align-items:center;gap:8px;background:linear-gradient(145deg,#1a3a2a,#2a4a3a);padding:8px;border-radius:8px;margin:4px 0;border:2px solid #2ecc71">
<span style="font-size:20px">${boost?.icon||'⚡'}</span>
<div style="flex:1"><div style="font-weight:800;color:#2ecc71">${boost?.name||'Boost'}</div><div style="font-size:9px;color:#888">${b.battlesLeft} battles remaining</div></div>
</div>`;
}).join('');
}
save();
}
}

// Open workshop modal
let selectedForgeCard=null;
let selectedTransmuteFrom=null;
let selectedTransmuteTo=null;
let forgeRarityFilter='all';

function openWorkshopModal(type){
const modal=document.getElementById('workshopModal');
const body=document.getElementById('workshopModalBody');
modal.classList.add('show');

if(type==='forge'){
body.innerHTML=`
<div class="workshop-modal-title">⚒️ CARD FORGE</div>
<div style="text-align:center;margin-bottom:10px;color:#888;font-size:11px">Select a card to forge shards (Cost: 10 Wild Cards)</div>
<div style="text-align:center;margin-bottom:8px;font-size:13px;font-weight:800;color:#ff6b6b">🃏 ${P.royalWildCards||0} Wild Cards</div>
<div class="rarity-filter">
<button class="rarity-btn common ${forgeRarityFilter==='common'||forgeRarityFilter==='all'?'active':''}" onclick="setForgeFilter('common')">Common</button>
<button class="rarity-btn rare ${forgeRarityFilter==='rare'?'active':''}" onclick="setForgeFilter('rare')">Rare</button>
<button class="rarity-btn epic ${forgeRarityFilter==='epic'?'active':''}" onclick="setForgeFilter('epic')">Epic</button>
<button class="rarity-btn legendary ${forgeRarityFilter==='legendary'?'active':''}" onclick="setForgeFilter('legendary')">Legend</button>
<button class="rarity-btn champion ${forgeRarityFilter==='champion'?'active':''}" onclick="setForgeFilter('champion')">Champ</button>
</div>
<div class="forge-card-grid" id="forgeCardGrid"></div>
<div id="forgeSelection" style="text-align:center;margin-top:10px"></div>
<button class="workshop-btn primary" id="forgeBtn" onclick="executeForge()" disabled>SELECT A CARD</button>`;
renderForgeCards();
}
else if(type==='summon'){
body.innerHTML=`
<div class="workshop-modal-title">✨ WILD SUMMON</div>
<div class="summon-machine">
<div style="margin-bottom:10px;color:#888;font-size:11px">Tap the orb to summon a random card!</div>
<div style="font-size:13px;font-weight:800;color:#ff6b6b;margin-bottom:15px">🃏 ${P.royalWildCards||0} Wild Cards</div>
<div class="summon-orb" onclick="executeSummon()">🌀</div>
<div style="font-size:12px;color:#9b59b6;font-weight:800">Cost: 5 Wild Cards</div>
<div class="summon-result" id="summonResult"></div>
</div>
<div style="margin-top:15px;padding:10px;background:rgba(0,0,0,0.3);border-radius:10px">
<div style="font-size:10px;color:#888;text-align:center">
<div style="font-weight:800;color:#9b59b6;margin-bottom:5px">✨ SUMMON RATES</div>
<div>Common: 40% • Rare: 30% • Epic: 20%</div>
<div>Legendary: 8% • Champion: 2%</div>
</div>
</div>`;
}
else if(type==='boost'){
body.innerHTML=`
<div class="workshop-modal-title">⚡ POWER BOOST</div>
<div style="text-align:center;margin-bottom:10px;color:#888;font-size:11px">Purchase temporary battle power-ups!</div>
<div style="text-align:center;font-size:13px;font-weight:800;color:#ff6b6b;margin-bottom:15px">🃏 ${P.royalWildCards||0} Wild Cards</div>
<div class="boost-list">
${WORKSHOP_BOOSTS.map(b=>{
const active=P.activeBoosts.find(ab=>ab.id===b.id);
return `<div class="boost-item ${active?'active':''}" onclick="${active?'':'purchaseBoost(\''+b.id+'\')'}">
<div class="bi-icon">${b.icon}</div>
<div class="bi-info">
<div class="bi-name">${b.name}</div>
<div class="bi-desc">${b.desc}</div>
</div>
<div class="bi-cost">${active?'✓ ACTIVE':'🃏 '+b.cost}</div>
</div>`;
}).join('')}
</div>`;
}
else if(type==='transmute'){
body.innerHTML=`
<div class="workshop-modal-title">🔄 CARD TRANSMUTER</div>
<div style="text-align:center;margin-bottom:10px;color:#888;font-size:11px">Convert 20 shards of one card into 10 shards of another!</div>
<div style="text-align:center;font-size:13px;font-weight:800;color:#ff6b6b;margin-bottom:15px">🃏 ${P.royalWildCards||0} Wild Cards (Cost: 8)</div>
<div class="transmute-section">
<div style="font-size:11px;font-weight:800;color:#3498db;margin-bottom:5px">FROM (need 20+ shards)</div>
<div class="forge-card-grid" id="transmuteFromGrid" style="max-height:120px"></div>
<div class="transmute-arrow">⬇️</div>
<div style="font-size:11px;font-weight:800;color:#2ecc71;margin-bottom:5px">TO (receive 10 shards)</div>
<div class="forge-card-grid" id="transmuteToGrid" style="max-height:120px"></div>
</div>
<button class="workshop-btn primary" id="transmuteBtn" onclick="executeTransmute()" disabled>SELECT CARDS</button>`;
renderTransmuteCards();
}
}

function closeWorkshopModal(){
document.getElementById('workshopModal').classList.remove('show');
selectedForgeCard=null;
selectedTransmuteFrom=null;
selectedTransmuteTo=null;
}

function setForgeFilter(rarity){
forgeRarityFilter=rarity;
openWorkshopModal('forge');
}

function renderForgeCards(){
const grid=document.getElementById('forgeCardGrid');if(!grid)return;
grid.innerHTML='';
const filteredCards=CARDS.filter(c=>{
if(forgeRarityFilter==='all')return true;
return c.rarity===forgeRarityFilter;
});
filteredCards.forEach(card=>{
const div=document.createElement('div');
div.className=`forge-card game-card ${card.rarity} ${selectedForgeCard===card.id?'selected':''}`;
div.innerHTML=`<div class="fc-icon">${card.icon}</div><div class="fc-name">${card.name}</div>`;
div.onclick=()=>selectForgeCard(card.id);
grid.appendChild(div);
});
}

function selectForgeCard(cardId){
selectedForgeCard=cardId;
const card=CARDS.find(c=>c.id===cardId);
const shardAmounts={common:10,rare:8,epic:6,legendary:4,champion:3,evolution:5};
const shards=shardAmounts[card.rarity]||5;
document.getElementById('forgeSelection').innerHTML=`<div style="font-weight:800;color:var(--gold)">${card.icon} ${card.name}</div><div style="font-size:11px;color:#2ecc71">You will receive: ${shards} shards</div>`;
const btn=document.getElementById('forgeBtn');
btn.disabled=(P.royalWildCards||0)<10;
btn.textContent=(P.royalWildCards||0)<10?'NOT ENOUGH WILD CARDS':'⚒️ FORGE FOR 10 WILD CARDS';
renderForgeCards();
}

function executeForge(){
if(!selectedForgeCard||(P.royalWildCards||0)<10)return;
const card=CARDS.find(c=>c.id===selectedForgeCard);
const shardAmounts={common:10,rare:8,epic:6,legendary:4,champion:3,evolution:5};
const shards=shardAmounts[card.rarity]||5;
P.royalWildCards-=10;
P.shards[card.id]=(P.shards[card.id]||0)+shards;
P.workshopStats.forges++;
// Check if card should be unlocked
const reqShards={common:10,rare:20,epic:30,legendary:40,champion:50,evolution:50};
if(!P.unlocked.includes(card.id)&&P.shards[card.id]>=(reqShards[card.rarity]||10)){
P.unlocked.push(card.id);
P.cardLvl[card.id]=1;
}
save();
showNotify(`⚒️ FORGED!\n${card.icon} ${card.name} +${shards} shards!\nWild Cards: ${P.royalWildCards}`,'success');
closeWorkshopModal();
updateWorkshop();updateCards();
}

function executeSummon(){
if((P.royalWildCards||0)<5){showNotify('Not enough Wild Cards! Need 5.','error','🃏');return;}
P.royalWildCards-=5;
P.workshopStats.summons++;
// Determine rarity based on rates
const roll=Math.random()*100;
let rarity;
if(roll<40)rarity='common';
else if(roll<70)rarity='rare';
else if(roll<90)rarity='epic';
else if(roll<98)rarity='legendary';
else rarity='champion';
// Get random card of that rarity
const pool=CARDS.filter(c=>c.rarity===rarity);
const card=pool[Math.floor(Math.random()*pool.length)];
const shardAmounts={common:15,rare:12,epic:8,legendary:5,champion:3};
const shards=shardAmounts[rarity]||10;
P.shards[card.id]=(P.shards[card.id]||0)+shards;
// Check if card should be unlocked
const reqShards={common:10,rare:20,epic:30,legendary:40,champion:50};
if(!P.unlocked.includes(card.id)&&P.shards[card.id]>=(reqShards[card.rarity]||10)){
P.unlocked.push(card.id);
P.cardLvl[card.id]=1;
}
save();
// Show result with animation
const resultDiv=document.getElementById('summonResult');
resultDiv.classList.add('show');
resultDiv.innerHTML=`
<div style="font-size:40px;animation:bounce 0.5s">${card.icon}</div>
<div style="font-weight:900;font-size:16px;color:var(--gold);margin:8px 0">${card.name}</div>
<div class="card-rarity ${card.rarity}" style="display:inline-block;padding:3px 12px;border-radius:8px;font-size:10px;text-transform:uppercase">${card.rarity}</div>
<div style="font-size:14px;color:#2ecc71;margin-top:8px;font-weight:800">+${shards} Shards!</div>
<div style="font-size:11px;color:#888;margin-top:5px">Wild Cards: ${P.royalWildCards}</div>`;
// Update the Wild Cards display
document.querySelector('.summon-machine > div:nth-child(2)').innerHTML=`🃏 ${P.royalWildCards} Wild Cards`;
updateWorkshop();updateCards();
}

function purchaseBoost(boostId){
const boost=WORKSHOP_BOOSTS.find(b=>b.id===boostId);
if(!boost)return;
if((P.royalWildCards||0)<boost.cost){showNotify(`Not enough Wild Cards! Need ${boost.cost}.`,'error','🃏');return;}
if(P.activeBoosts.find(b=>b.id===boostId)){showNotify('This boost is already active!','info','⚡');return;}
P.royalWildCards-=boost.cost;
P.workshopStats.boosts++;
P.activeBoosts.push({id:boostId,battlesLeft:boost.battles});
save();
showNotify(`⚡ BOOST ACTIVATED!\n${boost.icon} ${boost.name}\n${boost.desc}\nActive for ${boost.battles} battle(s)!`,'epic');
closeWorkshopModal();
updateWorkshop();
}

function renderTransmuteCards(){
const fromGrid=document.getElementById('transmuteFromGrid');
const toGrid=document.getElementById('transmuteToGrid');
if(!fromGrid||!toGrid)return;
fromGrid.innerHTML='';
toGrid.innerHTML='';
// From: Cards with 20+ shards
const fromCards=CARDS.filter(c=>(P.shards[c.id]||0)>=20);
fromCards.forEach(card=>{
const div=document.createElement('div');
div.className=`forge-card game-card ${card.rarity} ${selectedTransmuteFrom===card.id?'selected':''}`;
div.innerHTML=`<div class="fc-icon">${card.icon}</div><div class="fc-name">${card.name}</div><div style="position:absolute;top:2px;right:2px;font-size:7px;background:rgba(0,0,0,0.7);padding:1px 3px;border-radius:3px">${P.shards[card.id]}</div>`;
div.onclick=()=>{selectedTransmuteFrom=card.id;renderTransmuteCards();updateTransmuteBtn();};
fromGrid.appendChild(div);
});
if(fromCards.length===0){
fromGrid.innerHTML='<div style="grid-column:span 4;text-align:center;color:#888;font-size:10px;padding:10px">No cards with 20+ shards</div>';
}
// To: All cards (same or lower rarity as from card)
const fromCard=CARDS.find(c=>c.id===selectedTransmuteFrom);
const rarityOrder=['common','rare','epic','legendary','champion','evolution'];
const fromRarityIdx=fromCard?rarityOrder.indexOf(fromCard.rarity):5;
const toCards=CARDS.filter(c=>rarityOrder.indexOf(c.rarity)<=fromRarityIdx&&c.id!==selectedTransmuteFrom);
toCards.slice(0,20).forEach(card=>{
const div=document.createElement('div');
div.className=`forge-card game-card ${card.rarity} ${selectedTransmuteTo===card.id?'selected':''}`;
div.innerHTML=`<div class="fc-icon">${card.icon}</div><div class="fc-name">${card.name}</div>`;
div.onclick=()=>{selectedTransmuteTo=card.id;renderTransmuteCards();updateTransmuteBtn();};
toGrid.appendChild(div);
});
}

function updateTransmuteBtn(){
const btn=document.getElementById('transmuteBtn');
if(!btn)return;
const canTransmute=selectedTransmuteFrom&&selectedTransmuteTo&&(P.royalWildCards||0)>=8;
btn.disabled=!canTransmute;
btn.textContent=canTransmute?'🔄 TRANSMUTE FOR 8 WILD CARDS':'SELECT CARDS';
}

function executeTransmute(){
if(!selectedTransmuteFrom||!selectedTransmuteTo)return;
if((P.royalWildCards||0)<8){showNotify('Not enough Wild Cards! Need 8.','error','🃏');return;}
if((P.shards[selectedTransmuteFrom]||0)<20){showNotify('Not enough shards to transmute!','error','🔄');return;}
const fromCard=CARDS.find(c=>c.id===selectedTransmuteFrom);
const toCard=CARDS.find(c=>c.id===selectedTransmuteTo);
P.royalWildCards-=8;
P.shards[selectedTransmuteFrom]-=20;
P.shards[toCard.id]=(P.shards[toCard.id]||0)+10;
P.workshopStats.transmutes++;
// Check if card should be unlocked
const reqShards={common:10,rare:20,epic:30,legendary:40,champion:50,evolution:50};
if(!P.unlocked.includes(toCard.id)&&P.shards[toCard.id]>=(reqShards[toCard.rarity]||10)){
P.unlocked.push(toCard.id);
P.cardLvl[toCard.id]=1;
}
save();
showNotify(`🔄 TRANSMUTED!\n${fromCard.icon} ${fromCard.name} → ${toCard.icon} ${toCard.name}\nWild Cards: ${P.royalWildCards}`,'success');
closeWorkshopModal();
updateWorkshop();updateCards();
}

// Apply workshop boosts to battle
function getWorkshopBoostMultiplier(type){
let mult=1;
for(const activeBoost of (P.activeBoosts||[])){
const boost=WORKSHOP_BOOSTS.find(b=>b.id===activeBoost.id);
if(!boost)continue;
if(boost.effect.type===type)mult+=boost.effect.value;
if(boost.effect.type==='mega'){
if(type==='troopDmg')mult+=0.15;
if(type==='troopHp')mult+=0.20;
if(type==='troopSpeed')mult+=0.15;
if(type==='towerHp')mult+=0.25;
}
}
return mult;
}

function getWorkshopStartingElixir(){
let extra=0;
for(const activeBoost of (P.activeBoosts||[])){
const boost=WORKSHOP_BOOSTS.find(b=>b.id===activeBoost.id);
if(!boost)continue;
if(boost.effect.type==='startElixir')extra+=boost.effect.value;
if(boost.effect.type==='mega')extra+=1;
}
return extra;
}

function consumeWorkshopBoosts(){
// Called after each battle - reduce battle counts
P.activeBoosts=(P.activeBoosts||[]).map(b=>({...b,battlesLeft:b.battlesLeft-1})).filter(b=>b.battlesLeft>0);
save();
}

// ==================== END WILD CARD WORKSHOP ====================

// Update Daily tab
function updateDaily(){
const dailyGrid=document.getElementById('dailyGrid');if(!dailyGrid)return;
const today=new Date().toDateString();
const canClaim=P.lastDaily!==today;
const currentDay=((P.dailyStreak||0)%7)+1;
dailyGrid.innerHTML='';
DAILY_REWARDS.forEach((d,i)=>{
const dayNum=i+1;const isCurrent=dayNum===currentDay&&canClaim;const claimed=dayNum<currentDay||(dayNum===currentDay&&!canClaim);
const div=document.createElement('div');div.className='daily-day'+(claimed?' claimed':'')+(isCurrent?' today':'');
div.innerHTML=`<div class="day-num">DAY ${dayNum}</div><div class="day-icon">${d.icon}</div><div class="day-amt">${d.amount}</div>`;
dailyGrid.appendChild(div);});
const claimBtn=document.getElementById('dailyClaimBtn');
claimBtn.innerHTML=canClaim?`<button onclick="claimDaily()" style="padding:12px 24px;background:linear-gradient(180deg,var(--gold),var(--gold-dark));border:none;border-radius:10px;color:#fff;font-weight:900;font-size:14px;cursor:pointer">🎁 CLAIM DAY ${currentDay} REWARD!</button>`:`<div style="color:#6b7c8a;font-size:12px">Come back tomorrow for Day ${currentDay<7?currentDay+1:1}!</div>`;
updateChallenges();updateAchievements();updateDailyNotif();
}

// Claim daily reward
function claimDaily(){
const today=new Date().toDateString();if(P.lastDaily===today)return;
const dayIdx=(P.dailyStreak||0)%7;const reward=DAILY_REWARDS[dayIdx].reward;
if(reward.gold)P.gold+=reward.gold;if(reward.gems)P.gems+=reward.gems;if(reward.crystals)P.crystals+=reward.crystals;
if(reward.chest){const ct=CHEST_TYPES.find(t=>t.id===reward.chest);addChest(ct);}
P.dailyStreak=(P.dailyStreak||0)+1;P.lastDaily=today;save();
showNotify(`Day ${dayIdx+1} Claimed!\n${reward.gold?'+'+reward.gold+' Gold ':''}${reward.gems?'+'+reward.gems+' Gems ':''}${reward.crystals?'+'+reward.crystals+' Crystals ':''}`,'success','📅');
updateDaily();updateShop();updateChests();
}

// Update challenges
function updateChallenges(){
const list=document.getElementById('challengeList');if(!list)return;list.innerHTML='';
CHALLENGES.forEach(ch=>{
const progress=P.challengeProgress[ch.id]||0;const completed=progress>=ch.target;const pct=Math.min(100,Math.floor((progress/ch.target)*100));
const div=document.createElement('div');div.className='challenge-item'+(completed?' completed':'');
div.innerHTML=`<div class="challenge-icon">${ch.icon}</div><div class="challenge-info"><div class="challenge-name">${ch.name}</div><div class="challenge-progress">${progress}/${ch.target}</div><div class="challenge-bar"><div class="challenge-fill" style="width:${pct}%"></div></div></div><div class="challenge-reward">${completed?'✅':ch.reward.gold?'+'+ch.reward.gold+'💰':ch.reward.gems?'+'+ch.reward.gems+'💎':'+'+ch.reward.crystals+'💠'}</div>`;
if(completed&&!P.challengeProgress[ch.id+'_claimed']){div.onclick=()=>claimChallenge(ch);}
list.appendChild(div);});
}

// Claim challenge reward
function claimChallenge(ch){
if(P.challengeProgress[ch.id+'_claimed'])return;
if(ch.reward.gold)P.gold+=ch.reward.gold;if(ch.reward.gems)P.gems+=ch.reward.gems;if(ch.reward.crystals)P.crystals+=ch.reward.crystals;
P.challengeProgress[ch.id+'_claimed']=true;save();updateChallenges();updateShop();
}

// Update achievements
function updateAchievements(){
const list=document.getElementById('achievementList');if(!list)return;list.innerHTML='';
ACHIEVEMENTS.forEach(ach=>{
const unlocked=P.achievementsUnlocked.includes(ach.id);const canUnlock=!unlocked&&ach.check();
const div=document.createElement('div');div.className='achievement-item'+(unlocked?' unlocked':'');
div.innerHTML=`<div class="achievement-icon">${ach.icon}</div><div class="achievement-info"><div class="achievement-name">${ach.name}</div><div class="achievement-desc">${ach.desc}</div></div><div style="font-size:12px;font-weight:900;color:${unlocked?'#2ecc71':canUnlock?'var(--gold)':'#6b7c8a'}">${unlocked?'✓ DONE':canUnlock?'CLAIM':ach.reward.gems+'💎'}</div>`;
if(canUnlock)div.onclick=()=>claimAchievement(ach);
list.appendChild(div);});
}

// Claim achievement
function claimAchievement(ach){
if(P.achievementsUnlocked.includes(ach.id)||!ach.check())return;
P.achievementsUnlocked.push(ach.id);if(ach.reward.gems)P.gems+=ach.reward.gems;save();
showNotify('🏆 Achievement Unlocked!\n'+ach.name+' +'+ach.reward.gems+' Gems!','epic');updateAchievements();updateShop();
}

// Update daily notification
function updateDailyNotif(){
const today=new Date().toDateString();const canClaim=P.lastDaily!==today;
const notif=document.getElementById('dailyNotif');if(notif)notif.style.display=canClaim?'flex':'none';
}

// Game mode button handler
function setGameModeBtn(mode){
currentGameMode=mode;
document.querySelectorAll('.mode-card').forEach(b=>b.classList.remove('active'));
const modeBtn=document.getElementById('mode'+mode.charAt(0).toUpperCase()+mode.slice(1));
if(modeBtn)modeBtn.classList.add('active');
const btn=document.getElementById('battleBtn');
if(mode==='chaos'){btn.className='battle-btn ranked';btn.innerHTML='💥 CHAOS BATTLE!';}
else if(mode==='2v2'){btn.className='battle-btn';btn.innerHTML='👥 2v2 BATTLE!';}
else if(mode==='draft'){btn.className='battle-btn';btn.innerHTML='🎲 DRAFT BATTLE!';}
else if(mode==='test'){btn.className='battle-btn';btn.innerHTML='🧪 TESTING ZONE!';}
else{btn.className='battle-btn';btn.innerHTML='⚔️ BATTLE!';}
document.getElementById('partnerDisplay').style.display=mode==='2v2'?'block':'none';
setGameMode(mode);
}

// Update goTab to include new tabs
function goTab(t){document.querySelectorAll('.tab').forEach(el=>el.classList.remove('on'));document.querySelectorAll('.nav-btn').forEach(el=>el.classList.remove('on'));document.getElementById('tab'+t).classList.add('on');const idx=['Play','Cards','Chests','Shop','Wild','Daily','Leaderboard','Stats'].indexOf(t);if(idx>=0)document.querySelectorAll('.nav-btn')[idx].classList.add('on');if(t==='Play')updatePlay();if(t==='Cards')updateCards(),updateKingTowerUI(),updatePrincessUI();if(t==='Chests')updateChests();if(t==='Shop')updateShop();if(t==='Wild')updateWild();if(t==='Daily')updateDaily();if(t==='Leaderboard'){updateLeaderboard();updateCompetitive();}if(t==='Stats')updateStats();}

// Enhanced chest opening with wild items
const originalOpenChest=openChest;
function openChest(idx){
const chest=P.chests[idx],type=CHEST_TYPES.find(t=>t.id===chest.type);
const goldReward=type.gold[0]+Math.floor(Math.random()*(type.gold[1]-type.gold[0]));
const gemsReward=Math.floor(Math.random()*20)+10;
const crystalsReward=Math.floor(Math.random()*10);
const cardRewards=getChestCards(type);
const wildItem=Math.random()<0.1?awardWildItem():null;
P.gold+=goldReward;P.gems+=gemsReward;P.crystals+=crystalsReward;
cardRewards.forEach(r=>{P.shards[r.card.id]=(P.shards[r.card.id]||0)+r.shardsGained;const needed=getUpgradeCost(1,r.card.rarity);if(P.shards[r.card.id]>=needed&&!P.unlocked.includes(r.card.id)){P.unlocked.push(r.card.id);r.unlocked=true;}});
P.chests[idx]=null;save();
const overlay=document.createElement('div');overlay.className='chest-open-overlay';
let cardsHtml=cardRewards.map(r=>`<div class="reward-card${r.isNew||r.unlocked?' new':''}"><div class="rc-icon">${r.card.icon}</div><div class="rc-name">${r.card.name}</div><div class="rc-shards">+${r.shardsGained}</div>${r.unlocked?'<div class="rc-new">NEW!</div>':''}</div>`).join('');
overlay.innerHTML=`<div class="chest-opening">${type.icon}</div><div class="chest-rewards"><div style="font-family:'Lilita One';font-size:20px;color:var(--gold);margin-bottom:10px">Rewards!</div><div class="reward-item">💰 <span>+${goldReward.toLocaleString()}</span></div><div class="reward-item">💎 <span>+${gemsReward}</span></div><div class="reward-item">💠 <span>+${crystalsReward}</span></div>${wildItem?`<div class="reward-item" style="color:#ff6b6b">🌀 <span>+${wildItem.name}!</span></div>`:''}<div style="margin:8px 0;display:flex;flex-wrap:wrap;justify-content:center">${cardsHtml}</div><button style="margin-top:12px;padding:10px 30px;background:var(--gold);border:none;border-radius:10px;font-family:'Lilita One';font-size:14px;color:#fff;cursor:pointer" onclick="this.closest('.chest-open-overlay').remove();updateChests();updateCards();updateWild();">Collect!</button></div>`;
document.body.appendChild(overlay);
}

// Apply arena skin in battle
function getArenaSkin(){const skinIdx=P.selectedSkin||0;return ARENAS[skinIdx]?.skin||ARENAS[0].skin;}

// Modified renderArena to use skins
const originalRenderArena=renderArena;
function renderArena(){
const a=document.getElementById('arena'),h=a.offsetHeight,w=a.offsetWidth;
const skin=getArenaSkin();
B.towers.pL.x=40;B.towers.pL.y=h-80;B.towers.pR.x=w-40;B.towers.pR.y=h-80;B.towers.pK.x=w/2;B.towers.pK.y=h-38;
B.towers.aL.x=40;B.towers.aL.y=60;B.towers.aR.x=w-40;B.towers.aR.y=60;B.towers.aK.x=w/2;B.towers.aK.y=25;
const grassTop=skin.grass,grassBot=skin.grass,riverCol=skin.river,bridgeCol=skin.bridge;
a.style.background=`linear-gradient(180deg,${grassTop} 0%,${grassTop} 20%,${grassTop} 45%,${riverCol} 50%,${grassBot} 55%,${grassBot} 80%,${grassBot} 100%)`;
a.innerHTML=`<div class="river" style="background:linear-gradient(90deg,${riverCol},${riverCol})"></div><div class="bridge" style="left:35px;background:${bridgeCol}"></div><div class="bridge" style="right:35px;background:${bridgeCol}"></div><div class="tower small red" id="t-aL" style="top:42px;left:22px">${skin.tower}<span class="hp-text">${B.towers.aL.hp}</span></div><div class="tower small red" id="t-aR" style="top:42px;right:22px">${skin.tower}<span class="hp-text">${B.towers.aR.hp}</span></div><div class="tower king red" id="t-aK" style="top:3px;left:50%;transform:translateX(-50%)">🏰<span class="hp-text">${B.towers.aK.hp}</span></div><div class="tower small blue" id="t-pL" style="bottom:68px;left:22px">${skin.tower}<span class="hp-text">${B.towers.pL.hp}</span></div><div class="tower small blue" id="t-pR" style="bottom:68px;right:22px">${skin.tower}<span class="hp-text">${B.towers.pR.hp}</span></div><div class="tower king blue" id="t-pK" style="bottom:22px;left:50%;transform:translateX(-50%)">🏰<span class="hp-text">${B.towers.pK.hp}</span></div><div id="spawnZone"></div><div id="pocketLeft" class="pocket-zone"></div><div id="pocketRight" class="pocket-zone"></div><div id="elixirBar"><div id="elixirFill" style="width:50%"></div><div id="elixirText">5/10</div><div class="double-elixir" id="doubleElixir">2X</div></div><div id="hand"></div><div id="nextCard"><div class="lbl">NEXT</div><div class="icon">${getCard(B.next)?.icon||'?'}</div></div><div id="emoteBtn" onclick="toggleEmotes()">😀</div><div id="emotePanel">${P.emotes.map(e=>`<div class="emote-btn" onclick="sendEmote('${e}')">${e}</div>`).join('')}</div><div id="championAbilityBtn" onclick="activateChampionAbility()"><div class="ability-icon">⚡</div><div class="ability-key">ABILITY</div></div>`;
document.getElementById('botLbl').textContent=B.gameMode==='chaos'?'CHAOS Bot':B.gameMode==='tourney'?'🏆 Tournament':B.gameMode==='medals'?'⚔️ Ranked':(B.opponentName||'Opponent');
document.getElementById('myCrowns').textContent='0';document.getElementById('aiCrowns').textContent='0';
const spawnZone=document.getElementById('spawnZone');
spawnZone.addEventListener('pointerdown',function(e){e.preventDefault();e.stopPropagation();if(!B||!B.on||B.sel===-1)return;const cardId=B.hand[B.sel],card=getLvlCard(cardId);if(!card||B.elixir<card.cost)return;const rect=a.getBoundingClientRect(),zoom=1,x=(e.clientX-rect.left)/zoom,y=(e.clientY-rect.top)/zoom,lane=x<w/2?'left':'right';if(card.type==='spell')castSpell(card,x,y,'player');else if(card.type==='building')spawnBuilding(card,x,y,'player',lane);else{spawnTroop(card,x,y,'player',lane);P.troopsDeployed=(P.troopsDeployed||0)+(card.cnt||1);}B.elixir-=card.cost;cycleCard();});
// Pocket zone event listeners - allow spawning in enemy territory when their tower is destroyed
const pocketLeft=document.getElementById('pocketLeft');
const pocketRight=document.getElementById('pocketRight');
function handlePocketSpawn(e,pocket){e.preventDefault();e.stopPropagation();if(!B||!B.on||B.sel===-1)return;const cardId=B.hand[B.sel],card=getLvlCard(cardId);if(!card||B.elixir<card.cost)return;const rect=a.getBoundingClientRect(),zoom=1,x=(e.clientX-rect.left)/zoom,y=(e.clientY-rect.top)/zoom,lane=pocket==='left'?'left':'right';if(card.type==='spell')castSpell(card,x,y,'player');else if(card.type==='building')spawnBuilding(card,x,y,'player',lane);else{spawnTroop(card,x,y,'player',lane);P.troopsDeployed=(P.troopsDeployed||0)+(card.cnt||1);}B.elixir-=card.cost;cycleCard();}
pocketLeft.addEventListener('pointerdown',function(e){handlePocketSpawn(e,'left');});
pocketRight.addEventListener('pointerdown',function(e){handlePocketSpawn(e,'right');});
a.addEventListener('pointerdown',function(e){if(!B||!B.on||B.sel===-1)return;const cardId=B.hand[B.sel],card=getLvlCard(cardId);if(!card||card.type!=='spell'||B.elixir<card.cost)return;if(e.target.closest('#hand')||e.target.closest('#elixirBar')||e.target.closest('#nextCard')||e.target.closest('#emoteBtn')||e.target.closest('#emotePanel'))return;e.preventDefault();const rect=a.getBoundingClientRect(),zoom=1;castSpell(card,(e.clientX-rect.left)/zoom,(e.clientY-rect.top)/zoom,'player');B.elixir-=card.cost;cycleCard();},true);
updateHand();
startSnowEffect();
}

// Holiday snow effect
function startSnowEffect(){
const arena=document.getElementById('arena');
if(!arena)return;
// Remove existing snowflakes
arena.querySelectorAll('.snowflake').forEach(s=>s.remove());
const snowChars=['❄','❅','❆','✻','✼','⁂'];
const snowCount=15;
for(let i=0;i<snowCount;i++){
const flake=document.createElement('div');
flake.className='snowflake';
flake.textContent=snowChars[Math.floor(Math.random()*snowChars.length)];
flake.style.left=Math.random()*100+'%';
flake.style.fontSize=(8+Math.random()*10)+'px';
flake.style.opacity=0.4+Math.random()*0.5;
flake.style.animationDuration=(4+Math.random()*6)+'s';
flake.style.animationDelay=(-Math.random()*10)+'s';
arena.appendChild(flake);
}
}

// Chaos mode modifiers
function applyChaosModifiers(){
if(B.gameMode!=='chaos')return;
// Random events every 10 seconds
if(B.chaosTimer===undefined)B.chaosTimer=0;
B.chaosTimer++;
if(B.chaosTimer%600===0){
const events=['elixir','speed','damage','spawn'];
const event=events[Math.floor(Math.random()*events.length)];
if(event==='elixir'){B.elixir=10;showDmg(160,300,'⚡MAX ELIXIR!','#9b59b6');}
if(event==='speed'){B.troops.forEach(t=>{if(t.side==='player')t.spd*=1.5;});showDmg(160,300,'🏃SPEED BOOST!','#3498db');}
if(event==='damage'){B.troops.forEach(t=>{if(t.side==='player')t.dmg*=1.3;});showDmg(160,300,'💪DAMAGE UP!','#e74c3c');}
if(event==='spawn'){const card=getLvlCard(P.deck[Math.floor(Math.random()*P.deck.length)]);if(card&&card.type==='troop'){spawnTroop(card,160,350,'player','left');showDmg(160,300,'🎁FREE TROOP!','#2ecc71');}}
}}

// Override startLoop to include chaos and custom modes
const originalStartLoop=startLoop;
function startLoop(){let last=performance.now();function loop(now){if(!B||!B.on)return;const dt=(now-last)/1000;last=now;B.time+=dt;
// Custom mode time handling
const cm=B.customMode||{};
const duration=B.isCustom?(cm.infiniteTime?99999:(cm.duration||180)):180;
const rem=B.isTest?999:Math.max(0,duration-B.time);
document.getElementById('timer').textContent=(B.isTest||(B.isCustom&&cm.infiniteTime))?'∞':fmt(rem);
if(rem<=0&&!B.isTest&&!(B.isCustom&&cm.infiniteTime)){
  if(B.isMultiplayer){sendBattleEnd(B.crowns.me>B.crowns.ai);return;}
  else{endBattle(B.crowns.me>B.crowns.ai);return;}
}
// Calculate elixir rate based on mode
let rate=B.time>=60?1.6:0.8;
if(B.isCustom){
  const baseRate=(cm.elixirRate||1);
  const doubleTime=cm.doubleElixirTime||60;
  const tripleTime=cm.tripleElixirTime||120;
  if(B.time>=tripleTime)rate=0.8*3*baseRate;
  else if(B.time>=doubleTime)rate=0.8*2*baseRate;
  else rate=0.8*baseRate;
  if(cm.rageMode)rate*=1.4;
  if(cm.speedMode)rate*=1.5;
}
// Elixir regeneration
const maxElixir=B.isCustom?(cm.maxElixir||10):10;
if(B.isTest||(B.isCustom&&cm.infiniteElixir)){B.elixir=maxElixir;}
else{B.elixir=Math.min(maxElixir,B.elixir+dt*rate*(B.gameMode==='chaos'?1.5:1));}
// Bot elixir (disabled if botDisabled)
if(!(B.isCustom&&cm.botDisabled))B.botElixir=Math.min(10,B.botElixir+dt*rate*0.85);
document.getElementById('elixirFill').style.width=(B.elixir/maxElixir*100)+'%';
document.getElementById('elixirText').textContent=Math.floor(B.elixir)+'/'+maxElixir;
const doubleActive=B.time>=60||B.isTest||(B.isCustom&&(cm.elixirRate>=2||B.time>=(cm.doubleElixirTime||60)));
document.getElementById('doubleElixir').classList.toggle('on',doubleActive);
updateHand();updateTroops(dt);updateSpellEffects(dt);updateTroopPoisons(dt);updateGraveyardEffects(dt);updateWitchSpawns(dt);updateElixirPumps(dt);updateBuildings(dt);updateChampionAbilityButton();towerAttacks(dt);
// AI turn (skip if bot disabled or multiplayer)
if(!B.isTest&&!B.isMultiplayer&&!(B.isCustom&&cm.botDisabled))aiTurn();
// Apply chaos modifiers (either chaos mode or custom mode with chaos events)
if(B.gameMode==='chaos'||(B.isCustom&&cm.chaosEvents))applyChaosModifiers();
// Apply custom mode special effects
if(B.isCustom)applyCustomModeModifiers(dt);
// Check for 3-crown victory immediately after tower updates
if(B.crowns.me>=3){
  if(B.isMultiplayer){sendBattleEnd(true);return;}
  else{endBattle(true);return;}
}
if(B.crowns.ai>=3){
  if(B.isMultiplayer){sendBattleEnd(false);return;}
  else{endBattle(false);return;}
}
B.loop=requestAnimationFrame(loop);}B.loop=requestAnimationFrame(loop);}

// Apply custom mode modifiers during battle
function applyCustomModeModifiers(dt){
if(!B||!B.isCustom||!B.customMode)return;
const cm=B.customMode;
// Apply rage mode effects to newly spawned troops
B.troops.forEach(t=>{
  if(t.side==='player'&&!t.customModApplied){
    t.customModApplied=true;
    // Apply troop HP/DMG/Speed modifiers
    const hpMult=(cm.troopHP||100)/100;
    const dmgMult=(cm.troopDMG||100)/100;
    const spdMult=(cm.troopSpd||100)/100;
    t.hp=Math.floor(t.hp*hpMult);
    t.maxHp=Math.floor(t.maxHp*hpMult);
    t.dmg=Math.floor(t.dmg*dmgMult);
    t.spd=t.spd*spdMult;
    // Giant mode - increase size
    if(cm.giantMode&&t.el){
      t.el.style.transform='scale(1.8)';
      t.el.style.zIndex='50';
    }
    // Mini mode - decrease size
    if(cm.miniMode&&t.el){
      t.el.style.transform='scale(0.5)';
    }
    // Rage mode visual
    if(cm.rageMode&&t.el){
      t.el.style.filter='hue-rotate(330deg) brightness(1.2)';
    }
    // Fragile mode
    if(cm.fragileMode){
      t.hp=1;t.maxHp=1;
    }
    // Tank mode
    if(cm.tankMode){
      t.hp*=3;t.maxHp*=3;t.dmg=Math.floor(t.dmg*0.3);
    }
  }
});
}


// Add wild items to shop
SHOP_ITEMS.push({id:'wildtoken',name:'Wild Token',desc:'Chance for wild item!',icon:'🌀',price:500,currency:'gems',reward:{wildToken:1},special:true});

// Handle wild token purchase - wrap the original buyItem
(function(){
const originalBuyItem=buyItem;
window.buyItem=function(item){
if(item.reward&&item.reward.wildToken){
if(P.gems<item.price){showNotify('Not enough gems!','error','💎');return;}
P.gems-=item.price;
const wildItem=awardWildItem();
if(wildItem)showNotify('🎁 You Found!\n'+wildItem.name,'success');
else showNotify('No new item, but +1 Wild Token!','info','🎫');
save();updateShop();updateWild();return;
}
originalBuyItem(item);
};
})();

// ========== NEW FEATURES V2.0 ==========

// Initialize new player data
if(!P.decks)P.decks=[[...P.deck],[],[],[],[]];
if(!P.currentDeck)P.currentDeck=0;
if(!P.clan)P.clan=null;
if(!P.battleLog)P.battleLog=[];
if(!P.bpLevel)P.bpLevel=1;
if(!P.bpXp)P.bpXp=0;
if(!P.bpPremium)P.bpPremium=false;
if(!P.bpClaimed)P.bpClaimed=[];
if(!P.starPoints)P.starPoints=0;
if(!P.cardMastery)P.cardMastery={};
if(!P.evolved)P.evolved=[];
if(!P.towerSkins)P.towerSkins={king:'🏰',princess:'🏯'};
if(!P.ownedTowerSkins)P.ownedTowerSkins=['🏰','🏯'];
if(!P.weeklyProgress)P.weeklyProgress={};
if(!P.favorites)P.favorites=[];
if(!P.soundOn)P.soundOn=true;
P.deck=P.decks[P.currentDeck]||[];

// ===== MULTIPLE DECK SLOTS =====
function switchDeck(idx){
P.decks[P.currentDeck]=[...P.deck];
P.currentDeck=idx;
P.deck=P.decks[idx]||[];
document.querySelectorAll('.deck-tab').forEach((t,i)=>t.classList.toggle('active',i===idx));
save();updateCards();
}

// ===== META DECKS (Old - see full tier list in Feature 4) =====
function copyRandomMetaDeck(){
const simpleDecks=[
{name:'Hog Cycle',cards:['hog','musk','knight','archer','zap','fb','skel','goblin']},
{name:'Giant Beatdown',cards:['giant','wiz','valk','musk','arrows','fb','skel','minion']},
{name:'PEKKA Control',cards:['pekka','mpek','wiz','musk','zap','fb','goblin','archer']},
{name:'Golem Push',cards:['golem','drag','wiz','mpek','arrows','rocket','skel','minion']},
{name:'Mega Knight',cards:['mk','inferno','musk','goblin','zap','fb','skel','minion']}
];
const deck=simpleDecks[Math.floor(Math.random()*simpleDecks.length)];
P.deck=deck.cards.filter(c=>P.unlocked.includes(c));
while(P.deck.length<8){
const avail=P.unlocked.filter(c=>!P.deck.includes(c)&&CARDS.find(x=>x.id===c)?.type==='troop');
if(avail.length)P.deck.push(avail[Math.floor(Math.random()*avail.length)]);else break;
}
save();updateCards();showNotify('📋 Deck Loaded!\n'+deck.name,'success');
}

// ===== CLAN SYSTEM =====
const CLAN_NAMES=['Royal Warriors','Shadow Knights','Dragon Slayers','Elite Force','Storm Riders','Iron Legion','Phoenix Rising','Thunder Gods','Dark Empire','Golden Crown'];
const CLAN_BADGES=['⚔️','🛡️','🐉','⚡','🌑','🔥','🐺','👑','🌊','🔮','🗡️','💀','⭐','🏰','🦁'];

async function createClan(){
  if(!NET.isOnline){showNotify('Must be online to create a clan!','error');return;}
  if(P.clan){showNotify('You are already in a clan!','error');return;}

  const name=prompt('Enter clan name (3-20 characters):',CLAN_NAMES[Math.floor(Math.random()*CLAN_NAMES.length)]);
  if(!name)return;
  if(name.length<3||name.length>20){showNotify('Clan name must be 3-20 characters!','error');return;}

  try{
    showNotify('Creating clan...','info');
    const badge=CLAN_BADGES[Math.floor(Math.random()*CLAN_BADGES.length)];
    const result=await NET.api('/api/clan','POST',{name,badge,type:'open',required_trophies:0});
    if(result.clan){
      P.clan=result.clan;
      P.clanId=result.clan.id;
      subscribeToClanChannel(); // Subscribe to clan chat
      save();updateClan();
      showNotify(`🏰 Clan "${name}" Created!\nYou are the leader!`,'success');
    }
  }catch(e){
    console.error('Failed to create clan:',e);
    showNotify('Failed to create clan: '+(e.message||'Unknown error'),'error');
  }
}
function joinRandomClan(){showClanBrowser();}

// Clan Browser System - Now fetches from API
let cachedClans=[];

async function showClanBrowser(){
  if(P.clan){showNotify('You are already in a clan! Leave first.','error');return;}

  const modal=document.createElement('div');
  modal.className='confirm-modal';
  modal.id='clanBrowserModal';
  modal.style.overflowY='auto';

  // Show loading state first
  modal.innerHTML=`<div style="background:linear-gradient(145deg,#0d1b2a,#1b2838);border:3px solid #3498db;border-radius:16px;padding:20px;max-width:380px;width:100%;max-height:80vh;overflow-y:auto">
    <div style="text-align:center;margin-bottom:15px">
      <div style="font-family:'Lilita One',cursive;font-size:22px;color:#3498db">🔍 FIND A CLAN</div>
      <div style="font-size:10px;color:#888">Your Trophies: 🏆 ${P.tr.toLocaleString()}</div>
    </div>
    <div style="text-align:center;padding:40px;color:#888">Loading clans...</div>
    <button onclick="closeClanBrowser()" style="width:100%;padding:12px;background:linear-gradient(180deg,#555,#333);border:none;border-radius:10px;color:#fff;font-weight:800;font-size:14px;cursor:pointer;margin-top:10px">Close</button>
  </div>`;
  document.body.appendChild(modal);

  // Fetch clans from API
  try{
    if(NET.isOnline){
      const result=await NET.api('/api/clans?trophies='+P.tr);
      cachedClans=result.clans||[];
    }
  }catch(e){
    console.error('Failed to fetch clans:',e);
  }

  // If no clans from API, show message to create
  if(cachedClans.length===0){
    document.getElementById('clanListContainer')?.remove();
    const container=modal.querySelector('div>div:last-of-type');
    if(container){
      container.outerHTML=`<div id="clanListContainer" style="text-align:center;padding:20px;color:#888">
        <div style="font-size:40px;margin-bottom:10px">🏰</div>
        <div>No clans found!</div>
        <div style="font-size:11px;margin-top:5px">Be the first to create a clan!</div>
        <button onclick="closeClanBrowser();createClan()" style="margin-top:15px;padding:10px 20px;background:linear-gradient(180deg,#27ae60,#1e8449);border:none;border-radius:8px;color:#fff;font-weight:800;cursor:pointer">Create Clan</button>
      </div>`;
    }
    return;
  }

  renderClanBrowser();
}

function renderClanBrowser(searchQuery=''){
  const modal=document.getElementById('clanBrowserModal');
  if(!modal)return;

  let clansToShow=cachedClans||[];
  if(searchQuery){
    const q=searchQuery.toLowerCase();
    clansToShow=clansToShow.filter(c=>c.name.toLowerCase().includes(q));
  }

  // Sort by members (most active first)
  clansToShow.sort((a,b)=>(b.members||0)-(a.members||0));

  let clansHtml='';
  if(clansToShow.length===0){
    clansHtml=`<div style="text-align:center;padding:20px;color:#888">No clans match your search</div>`;
  }else{
    clansHtml=clansToShow.map(clan=>{
      const typeLabel=clan.type==='open'?'Open':clan.type==='invite_only'?'Invite Only':'Closed';
      const canJoin=P.tr>=(clan.required_trophies||0)&&clan.type==='open'&&(clan.members||0)<50;
      const needsInvite=clan.type==='invite_only'&&(clan.members||0)<50;
      const isFull=(clan.members||0)>=50;
      const isClosed=clan.type==='closed';

      return `<div style="background:linear-gradient(145deg,#1b2838,#243447);border:2px solid ${canJoin?'#27ae60':needsInvite?'#f39c12':'#e74c3c'};border-radius:10px;padding:12px;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="font-size:28px">${clan.badge||'🏰'}</div>
          <div style="flex:1">
            <div style="font-weight:900;font-size:13px;color:#fff">${clan.name}</div>
            <div style="font-size:10px;color:#888">🏆 ${(clan.war_trophies||0).toLocaleString()} | 👥 ${clan.members||0}/${clan.max_members||50}</div>
            <div style="font-size:9px;color:${canJoin?'#27ae60':needsInvite?'#f39c12':'#e74c3c'}">${typeLabel} ${(clan.required_trophies||0)>0?`• Required: ${clan.required_trophies} 🏆`:''}</div>
          </div>
          <button onclick="joinClanById('${clan.id}')"
            style="padding:8px 12px;background:linear-gradient(180deg,${canJoin?'#27ae60,#1e8449':needsInvite?'#f39c12,#d68910':'#95a5a6,#7f8c8d'});border:none;border-radius:8px;color:#fff;font-weight:800;font-size:10px;cursor:${canJoin||needsInvite?'pointer':'not-allowed'}"
            ${isFull||isClosed?'disabled':''}>${isFull?'FULL':isClosed?'🔒':canJoin?'JOIN':'REQUEST'}</button>
        </div>
      </div>`;
    }).join('');
  }

  modal.querySelector('div').innerHTML=`
    <div style="text-align:center;margin-bottom:15px">
      <div style="font-family:'Lilita One',cursive;font-size:22px;color:#3498db">🔍 FIND A CLAN</div>
      <div style="font-size:10px;color:#888">Your Trophies: 🏆 ${P.tr.toLocaleString()}</div>
    </div>
    <div style="margin-bottom:10px;padding:8px;background:#1a2535;border-radius:8px">
      <input type="text" id="clanSearchInput" placeholder="Search clans..." oninput="filterClans()" value="${searchQuery}" style="width:100%;padding:8px;border:none;background:transparent;color:#fff;font-size:12px">
    </div>
    <div id="clanListContainer" style="max-height:300px;overflow-y:auto">${clansHtml}</div>
    <button onclick="closeClanBrowser()" style="width:100%;padding:12px;background:linear-gradient(180deg,#555,#333);border:none;border-radius:10px;color:#fff;font-weight:800;font-size:14px;cursor:pointer;margin-top:10px">Close</button>`;
}

function filterClans(){
  const input=document.getElementById('clanSearchInput');
  if(input)renderClanBrowser(input.value);
}

function closeClanBrowser(){document.getElementById('clanBrowserModal')?.remove();}

// Join clan by ID using API
async function joinClanById(clanId){
  if(!NET.isOnline){showNotify('Must be online to join a clan!','error');return;}
  if(P.clan){showNotify('You are already in a clan!','error');return;}

  const clan=cachedClans.find(c=>c.id===clanId);
  if(!clan){showNotify('Clan not found!','error');return;}

  // Check if invite-only
  if(clan.type==='invite'){
    showNotify('📨 Join Request Sent!\nWaiting for clan leader approval...','info');
    // For now, simulate invite system (future: implement proper invite API)
    setTimeout(async()=>{
      try{
        const result=await NET.api(`/api/clan/${clanId}/join`,'POST');
        if(result.clan){
          P.clan=result.clan;
          P.clanId=clanId;
          subscribeToClanChannel(); // Subscribe to clan chat
          save();updateClan();
          closeClanBrowser();
          showNotify('✅ Request Accepted!\nWelcome to '+clan.name+'!','success');
        }
      }catch(e){
        showNotify('❌ Request Declined: '+(e.message||'Try another clan!'),'error');
      }
    },1500);
    return;
  }

  // Direct join for open clans
  try{
    showNotify('Joining clan...','info');
    const result=await NET.api(`/api/clan/${clanId}/join`,'POST');
    if(result.clan){
      P.clan=result.clan;
      P.clanId=clanId;
      subscribeToClanChannel(); // Subscribe to clan chat
      save();updateClan();
      closeClanBrowser();
      showNotify(`🏰 Joined ${clan.name}!\nWelcome to the clan!`,'success');
    }
  }catch(e){
    console.error('Failed to join clan:',e);
    showNotify('Failed to join clan: '+(e.message||'Unknown error'),'error');
  }
}

// Legacy function for backwards compatibility
function joinSpecificClan(name,badge,trophies,memberCount){
  const clan=cachedClans.find(c=>c.name===name);
  if(clan){
    joinClanById(clan.id);
  }else{
    showNotify('Clan not found!','error');
  }
}

// Leave clan using API
async function leaveClan(){
  if(!P.clan){showNotify('You are not in a clan!','error');return;}
  if(!NET.isOnline){showNotify('Must be online to leave a clan!','error');return;}

  const clanId=P.clan.id||P.clanId;
  if(!clanId){
    // Fallback for local-only clan
    P.clan=null;
    P.clanId=null;
    save();updateClan();
    showNotify('Left the clan!','info');
    return;
  }

  // Check if player is leader
  const myMember=P.clan.members?.find(m=>m.player_id===NET.playerId||m.name===P.name);
  if(myMember?.role==='leader'&&P.clan.members?.length>1){
    showNotify('You must transfer leadership before leaving!','error');
    return;
  }

  try{
    showNotify('Leaving clan...','info');
    unsubscribeFromClanChannel(clanId); // Unsubscribe from clan chat
    const result=await NET.api(`/api/clan/${clanId}/leave`,'POST');
    if(result.success){
      P.clan=null;
      P.clanId=null;
      save();updateClan();
      showNotify('Left the clan!','info');
    }
  }catch(e){
    console.error('Failed to leave clan:',e);
    showNotify('Failed to leave clan: '+(e.message||'Unknown error'),'error');
  }
}

// Delete clan (leader only)
async function deleteClan(){
  if(!P.clan){showNotify('You are not in a clan!','error');return;}
  if(!NET.isOnline){showNotify('Must be online to delete a clan!','error');return;}

  const clanId=P.clan.id||P.clanId;
  if(!clanId){showNotify('Cannot delete local clan','error');return;}

  // Check if player is leader
  const myMember=P.clan.members?.find(m=>m.player_id===NET.playerId||m.name===P.name);
  if(myMember?.role!=='leader'){
    showNotify('Only the clan leader can delete the clan!','error');
    return;
  }

  if(!confirm('Are you sure you want to DELETE this clan? This cannot be undone!')){
    return;
  }

  try{
    showNotify('Deleting clan...','info');
    unsubscribeFromClanChannel(clanId);
    // For now, leader leaving with only 1 member deletes the clan
    const result=await NET.api(`/api/clan/${clanId}/leave`,'POST');
    if(result.success||result.deleted){
      P.clan=null;
      P.clanId=null;
      save();updateClan();
      showNotify('Clan deleted!','success');
    }
  }catch(e){
    console.error('Failed to delete clan:',e);
    showNotify('Failed to delete clan: '+(e.message||'Unknown error'),'error');
  }
}

// ===== REAL-TIME CLAN UPDATES =====
let clanPollingInterval=null;

function startClanPolling(){
  if(clanPollingInterval)return;
  clanPollingInterval=setInterval(async()=>{
    if(!NET.isOnline||!P.clan?.id)return;
    try{
      const result=await NET.api(`/api/clan/${P.clan.id}`);
      if(result.clan){
        // Preserve local chat history
        const localChat=P.clan.chatHistory||[];
        P.clan=result.clan;
        // Merge chat histories
        if(!P.clan.chatHistory)P.clan.chatHistory=[];
        P.clan.chatHistory=[...P.clan.chat_history||[],...localChat.filter(m=>!P.clan.chat_history?.some(s=>s.message===m.msg&&s.sender_name===m.sender))];
        updateClan();
      }
    }catch(e){}
  },10000); // Poll every 10 seconds
}

function stopClanPolling(){
  if(clanPollingInterval){
    clearInterval(clanPollingInterval);
    clanPollingInterval=null;
  }
}

// ===== AI JOIN REQUESTS SYSTEM =====
function generateJoinRequests(){
  if(!P.clan)return;
  if(!P.clan.joinRequests)P.clan.joinRequests=[];
  if(Math.random()<0.4&&P.clan.joinRequests.length<10&&P.clan.members.length<50){
    const usedNames=[...P.clan.members.map(m=>m.name),...P.clan.joinRequests.map(r=>r.name)];
    const availableNames=BOT_NAMES.filter(n=>!usedNames.includes(n));
    if(availableNames.length>0){
      const name=availableNames[Math.floor(Math.random()*availableNames.length)];
      const trophies=Math.floor(Math.random()*20000)+500;
      const wins=Math.floor(Math.random()*500)+10;
      const donations=Math.floor(Math.random()*1000);
      P.clan.joinRequests.push({name,trophies,wins,donations,time:Date.now()});
      save();
    }
  }
}

function updateJoinRequests(){
  if(!P.clan)return;
  generateJoinRequests();
  const section=document.getElementById('joinRequestsSection');
  const list=document.getElementById('joinRequestsList');
  const count=document.getElementById('joinRequestCount');
  if(!section||!list)return;
  const requests=P.clan.joinRequests||[];
  if(requests.length===0){section.style.display='none';return;}
  section.style.display='block';
  count.textContent=requests.length;
  list.innerHTML=requests.map((r,i)=>`<div style="display:flex;align-items:center;gap:8px;padding:8px;background:linear-gradient(145deg,#1b2838,#243447);border-radius:8px;margin-bottom:6px;border:1px solid #3498db"><div style="font-size:24px">👤</div><div style="flex:1"><div style="font-weight:800;font-size:12px;color:#fff">${r.name}</div><div style="font-size:9px;color:#888">🏆 ${r.trophies.toLocaleString()} | ✅ ${r.wins} wins</div></div><div style="display:flex;gap:4px"><button onclick="acceptJoinRequest(${i})" style="padding:6px 10px;background:linear-gradient(180deg,#27ae60,#1e8449);border:none;border-radius:6px;color:#fff;font-weight:800;font-size:10px;cursor:pointer">✓</button><button onclick="declineJoinRequest(${i})" style="padding:6px 10px;background:linear-gradient(180deg,#e74c3c,#c0392b);border:none;border-radius:6px;color:#fff;font-weight:800;font-size:10px;cursor:pointer">✗</button></div></div>`).join('');
}

function acceptJoinRequest(idx){
  if(!P.clan||!P.clan.joinRequests||!P.clan.joinRequests[idx])return;
  if(P.clan.members.length>=50){showNotify('Clan is full! (50/50)','error');return;}
  const request=P.clan.joinRequests[idx];
  P.clan.members.push({name:request.name,trophies:request.trophies,role:'Member',donations:0,isBot:true,wins:request.wins});
  P.clan.joinRequests.splice(idx,1);
  if(!P.clan.chatHistory)P.clan.chatHistory=[];
  P.clan.chatHistory.push({sender:request.name,msg:['Hey everyone! Happy to be here!','Thanks for accepting me!','Excited to join! Let\'s win some wars!','Hey! Ready to battle!','What\'s up clan! 💪'][Math.floor(Math.random()*5)],time:Date.now()});
  save();updateClan();
  showNotify(`✅ ${request.name} joined the clan!`,'success');
}

function declineJoinRequest(idx){
  if(!P.clan||!P.clan.joinRequests)return;
  const name=P.clan.joinRequests[idx]?.name;
  P.clan.joinRequests.splice(idx,1);
  save();updateJoinRequests();
  showNotify(`❌ Declined ${name}'s request`,'info');
}

// ===== CLAN MEMBER POPUP (Click to show, centered) =====
let memberPopupData=[];
let activePopupIdx=-1;
function formatLastActive(timestamp){
  const diff=Date.now()-timestamp;
  const mins=Math.floor(diff/60000);
  const hours=Math.floor(diff/3600000);
  const days=Math.floor(diff/86400000);
  if(mins<60)return `${mins}m ago`;
  if(hours<24)return `${hours}h ago`;
  return `${days}d ago`;
}
function showMemberPopup(idx,event){
  event.stopPropagation();
  // Toggle if same popup clicked
  if(activePopupIdx===idx){hideMemberPopup();return;}
  document.querySelectorAll('.member-popup').forEach(p=>p.remove());
  activePopupIdx=idx;
  const member=memberPopupData[idx];
  if(!member)return;
  const popup=document.createElement('div');
  popup.className='member-popup';
  // Center popup in upper portion of screen
  popup.style.cssText='position:fixed;z-index:9999;background:linear-gradient(145deg,#1b2838,#0d1b2a);border:2px solid #ffd700;border-radius:12px;padding:15px;min-width:220px;max-width:280px;box-shadow:0 10px 30px rgba(0,0,0,0.8);left:50%;top:120px;transform:translateX(-50%);animation:popupSlideIn 0.2s ease';
  const roleColors={Leader:'#ffd700','Co-Leader':'#e74c3c',Elder:'#3498db',Member:'#95a5a6'};
  const roleIcons={Leader:'👑','Co-Leader':'⭐',Elder:'🛡️',Member:'👤'};
  const winRate=member.wins&&member.losses?Math.round(member.wins/(member.wins+member.losses)*100):50;
  const lastActiveText=member.lastActive?formatLastActive(member.lastActive):'Online';
  const isOnline=!member.lastActive||Date.now()-member.lastActive<3600000;
  popup.innerHTML=`<div style="position:absolute;top:8px;right:10px;cursor:pointer;font-size:16px;color:#666" onclick="hideMemberPopup()">✕</div><div style="text-align:center;margin-bottom:10px"><div style="font-size:40px;margin-bottom:5px">${roleIcons[member.role]||'👤'}</div><div style="font-weight:900;font-size:16px;color:#fff">${member.name}</div><div style="font-size:11px;color:${roleColors[member.role]||'#888'};font-weight:800">${member.role}</div></div><div style="background:#0a1520;border-radius:8px;padding:10px"><div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:#888;font-size:11px">Trophies</span><span style="color:#ffd700;font-weight:800;font-size:11px">🏆 ${member.trophies.toLocaleString()}</span></div><div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:#888;font-size:11px">Best</span><span style="color:#ff8c00;font-weight:800;font-size:11px">⭐ ${(member.maxTrophies||member.trophies).toLocaleString()}</span></div><div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:#888;font-size:11px">Win Rate</span><span style="color:#3498db;font-weight:800;font-size:11px">${winRate}% (${member.wins||0}W/${member.losses||0}L)</span></div><div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:#888;font-size:11px">Crowns</span><span style="color:#e74c3c;font-weight:800;font-size:11px">👑 ${(member.crowns||0).toLocaleString()}</span></div><div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:#888;font-size:11px">Donations</span><span style="color:#27ae60;font-weight:800;font-size:11px">🎁 ${member.donations||0}</span></div><div style="display:flex;justify-content:space-between"><span style="color:#888;font-size:11px">Last Active</span><span style="color:${isOnline?'#27ae60':'#888'};font-weight:800;font-size:11px">${isOnline?'🟢 Online':lastActiveText}</span></div></div>${member.name!==P.name?`<div style="margin-top:10px;display:flex;gap:6px"><button onclick="challengeMember('${member.name}')" style="flex:1;padding:8px;background:linear-gradient(180deg,#9b59b6,#8e44ad);border:none;border-radius:6px;color:#fff;font-weight:800;font-size:10px;cursor:pointer">⚔️ Battle</button><button onclick="visitMember('${member.name}')" style="flex:1;padding:8px;background:linear-gradient(180deg,#3498db,#2980b9);border:none;border-radius:6px;color:#fff;font-weight:800;font-size:10px;cursor:pointer">👁️ Profile</button></div>`:'<div style="margin-top:8px;text-align:center;color:#ffd700;font-size:10px;font-weight:800">⭐ This is you!</div>'}`;
  document.body.appendChild(popup);
}
function hideMemberPopup(){document.querySelectorAll('.member-popup').forEach(p=>p.remove());activePopupIdx=-1;}
function challengeMember(name){hideMemberPopup();showNotify(`⚔️ Challenged ${name}!\nStarting friendly battle...`,'info');setTimeout(()=>startBattle(),1000);}
function visitMember(name){hideMemberPopup();const member=P.clan?.members.find(m=>m.name===name);if(!member)return;const winRate=member.wins&&member.losses?Math.round(member.wins/(member.wins+member.losses)*100):50;showNotify(`👁️ ${name}'s Profile\n🏆 ${member.trophies.toLocaleString()} (Best: ${(member.maxTrophies||member.trophies).toLocaleString()})\n📊 ${winRate}% Win Rate (${member.wins||0}W/${member.losses||0}L)\n👑 ${(member.crowns||0).toLocaleString()} Crowns | 🎁 ${member.donations||0} Donated`,'info');}
setInterval(()=>{if(P.clan)updateJoinRequests();},20000);

// Helper to normalize role display (API uses lowercase, display uses Title Case)
function normalizeRole(role){
  if(!role)return 'Member';
  const r=role.toLowerCase();
  if(r==='leader')return 'Leader';
  if(r==='co-leader')return 'Co-Leader';
  if(r==='elder')return 'Elder';
  return 'Member';
}
function getRoleIcon(role){
  const r=(role||'').toLowerCase();
  if(r==='leader')return '👑';
  if(r==='co-leader')return '⭐';
  if(r==='elder')return '🛡️';
  return '👤';
}
function isLeaderRole(role){
  return (role||'').toLowerCase()==='leader';
}

function updateClan(){
  const noClan=document.getElementById('noClan'),inClan=document.getElementById('inClan');
  if(!P.clan){
    noClan.style.display='block';
    inClan.style.display='none';
    stopClanPolling();
    return;
  }
  noClan.style.display='none';
  inClan.style.display='block';
  // Start real-time updates
  if(P.clan.id)startClanPolling();

  // Support both API format (stats.war_trophies) and local format (warTrophies)
  const warTrophies=P.clan.stats?.war_trophies||P.clan.warTrophies||0;
  const warWins=P.clan.stats?.war_wins||P.clan.warWins||0;
  const members=P.clan.members||[];

  document.getElementById('clanInfo').innerHTML=`<div class="clan-header"><div class="clan-badge">${P.clan.badge||'🏰'}</div><div><div class="clan-name">${P.clan.name}</div><div class="clan-stats"><span>👥 ${members.length}/50</span><span>🏆 ${warTrophies}</span><span>⚔️ ${warWins} Wars</span></div></div></div>`;

  // Sort by trophies (handle both trophies field and stats.trophies from player data)
  const sortedMembers=[...members].sort((a,b)=>(b.trophies||0)-(a.trophies||0));
  memberPopupData=sortedMembers.slice(0,10);

  document.getElementById('clanMembers').innerHTML=memberPopupData.map((m,i)=>{
    const displayName=m.name||'Unknown';
    const isMe=m.player_id===NET.playerId||m.name===P.name;
    const role=normalizeRole(m.role);
    const trophies=m.trophies||0;
    const donations=m.donations||0;
    return `<div class="clan-member${isLeaderRole(m.role)?' leader':''}" onclick="showMemberPopup(${i},event)" style="cursor:pointer"><div style="font-size:20px">${getRoleIcon(m.role)}</div><div style="flex:1"><div style="font-weight:800;font-size:11px">${displayName}${isMe?' (You)':''}</div><div class="role">${role}</div></div><div style="text-align:right"><div style="font-size:11px;color:var(--gold)">🏆 ${trophies}</div><div style="font-size:9px;color:#6b7c8a">🎁 ${donations}</div></div></div>`;
  }).join('');

  document.getElementById('clanWar').innerHTML=`<div style="text-align:center;padding:15px"><div style="font-size:30px">⚔️</div><div style="font-weight:800;margin:5px 0">Clan War Available!</div><button onclick="startClanWar()" style="padding:8px 16px;background:linear-gradient(180deg,var(--gold),var(--gold-dark));border:none;border-radius:8px;color:#fff;font-weight:800;cursor:pointer">Start War</button></div>`;
  updateJoinRequests();updateClanChat();updateDonations();updateClanLevel();updateClanGames();updateClanChest();updateClanPerks();updateClanLeague();updateClanMail();updateClanSettings();
}
function startClanWar(){showNotify('⚔️ Clan War Started!\nWin battles to earn war trophies!','epic');P.clan.warWins++;P.clan.warTrophies+=Math.floor(Math.random()*100)+50;save();updateClan();}

// ===== CLAN CHAT & FEATURES =====
// Subscribe to clan channel when joining/loading clan
function subscribeToClanChannel(){
  if(P.clan&&P.clan.id&&NET.isOnline){
    NET.send('subscribe',{channel:`clan:${P.clan.id}`});
  }
}
function unsubscribeFromClanChannel(clanId){
  if(clanId&&NET.isOnline){
    NET.send('unsubscribe',{channel:`clan:${clanId}`});
  }
}

function sendClanChat(){
  const input=document.getElementById('chatInput');
  const msg=input.value.trim();
  if(!msg||!P.clan)return;
  if(msg.length>200){showNotify('Message too long! (max 200 characters)','error');return;}

  input.value='';

  // Always show message immediately (optimistic update)
  if(!P.clan.chatHistory)P.clan.chatHistory=[];
  P.clan.chatHistory.push({sender:P.name,msg,time:Date.now()});
  if(P.clan.chatHistory.length>100)P.clan.chatHistory.shift();
  updateClanChat();

  // Also send via WebSocket if online
  if(NET.isOnline&&P.clan.id){
    NET.send('chat_send',{
      channel:'clan',
      message:msg,
      clan_id:P.clan.id
    });
  }
  save();
}

function updateClanChat(){
  const chat=document.getElementById('clanChat');
  if(!chat||!P.clan)return;

  // Support both API format (chat_history) and local format (chatHistory)
  const history=P.clan.chat_history||P.clan.chatHistory||[];

  if(history.length===0){
    chat.innerHTML='<div style="color:#6b7c8a;font-size:10px;text-align:center">No messages yet. Start the conversation!</div>';
    return;
  }

  chat.innerHTML=history.slice(-20).map(m=>{
    // Support both formats: API uses sender_name/message, local uses sender/msg
    const sender=m.sender_name||m.sender||'Unknown';
    const message=m.message||m.msg||'';
    const isMe=sender===P.name;
    return `<div style="margin-bottom:6px;padding:4px 8px;background:${isMe?'#2d4a3e':'#243447'};border-radius:6px"><div style="font-size:9px;color:${isMe?'#4ade80':'#6b9dc8'};font-weight:700">${sender}</div><div style="font-size:11px;color:#fff">${message}</div></div>`;
  }).join('');
  chat.scrollTop=chat.scrollHeight;
}
async function requestDonation(){
  if(!P.clan)return;
  const cards=CARDS.filter(c=>c.rarity==='Common'||c.rarity==='Rare');
  const card=cards[Math.floor(Math.random()*cards.length)];

  if(NET.isOnline&&P.clan.id){
    try{
      const result=await NET.api(`/api/clan/${P.clan.id}/request`,'POST',{card_id:card.id});
      if(result.request){
        if(!P.clan.donation_requests)P.clan.donation_requests=[];
        P.clan.donation_requests.unshift(result.request);
        updateDonations();
        showNotify(`📨 Card Requested!\n${card.n}`,'success');
      }else if(result.error){
        showNotify(`Error: ${result.error}`,'error');
      }
    }catch(e){
      showNotify('Failed to request cards','error');
    }
  }else{
    // Offline fallback
    if(!P.clan.donationRequests)P.clan.donationRequests=[];
    P.clan.donationRequests.unshift({requester:P.name,cardId:card.id,cardName:card.n,amount:0,max:card.rarity==='Common'?40:10,time:Date.now()});
    if(P.clan.donationRequests.length>10)P.clan.donationRequests.pop();
    save();updateDonations();
    showNotify(`📨 Card Requested!\n${card.n}`,'success');
  }
}
function updateDonations(){
  const el=document.getElementById('donationRequests');
  if(!el||!P.clan)return;
  // Support both API format (donation_requests) and local format (donationRequests)
  const reqs=P.clan.donation_requests||P.clan.donationRequests||[];
  if(reqs.length===0){
    el.innerHTML='<div style="color:#6b7c8a;font-size:10px;text-align:center">No donation requests</div>';
    return;
  }
  el.innerHTML=reqs.slice(0,5).map(r=>{
    // Support both formats: API uses requester_name/card_id, local uses requester/cardId
    const requester=r.requester_name||r.requester||'Unknown';
    const cardId=r.card_id||r.cardId;
    const cardName=r.cardName||getCard(cardId)?.n||'Card';
    const amount=r.amount||0;
    const max=r.max||10;
    const isMe=requester===P.name;
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px;background:#1a2535;border-radius:6px;margin-bottom:4px"><div style="font-size:20px">${getCard(cardId)?.icon||'🃏'}</div><div style="flex:1"><div style="font-size:10px;font-weight:700">${requester} wants ${cardName}</div><div style="font-size:9px;color:#6b7c8a">${amount}/${max} donated</div></div>${!isMe?`<button onclick="donateCard('${cardId}','${requester}')" style="padding:4px 8px;background:#27ae60;border:none;border-radius:4px;color:#fff;font-size:9px;cursor:pointer">Give</button>`:''}</div>`;
  }).join('');
}
async function donateCard(cardId,requester){
  if(!P.clan){showNotify('Not in a clan!','error');return;}
  const reqs=P.clan.donation_requests||P.clan.donationRequests||[];
  const req=reqs.find(r=>(r.card_id||r.cardId)===cardId&&(r.requester_name||r.requester)===requester);
  if(!req){showNotify('Request not found!','error');return;}
  if(req.amount>=(req.max||10)){showNotify('Request already filled!','info');return;}

  // Check if we have the card to donate
  const cardData=P.cards?.find(c=>c.id===cardId);
  const cardShards=P.shards?.[cardId]||cardData?.shards||0;
  if(cardShards<1){
    showNotify('You don\'t have this card to donate!','error');
    return;
  }

  if(NET.isOnline&&P.clan.id&&req.id){
    try{
      const result=await NET.api(`/api/clan/${P.clan.id}/donate`,'POST',{request_id:req.id,amount:1});
      if(result.error){
        showNotify(`Error: ${result.error}`,'error');
        return;
      }
      // Update local state
      req.amount=(req.amount||0)+1;
      P.gold+=(req.max===40)?5:50;
      P.xp+=(req.max===40)?1:10;
      const me=P.clan.members?.find(m=>m.name===P.name||m.player_id===NET.playerId);
      if(me)me.donations=(me.donations||0)+1;
      save();updateDonations();updateCurrency();
      showNotify('🎁 Card Donated! +' + ((req.max===40)?5:50) + ' gold','success');
    }catch(e){
      console.error('Donate error:',e);
      showNotify('Failed to donate: '+(e.message||'Network error'),'error');
    }
  }else{
    // Offline/local fallback - just update locally
    req.amount=(req.amount||0)+1;
    P.gold+=(req.max===40)?5:50;
    P.xp+=(req.max===40)?1:10;
    // Deduct from our cards
    if(P.shards&&P.shards[cardId])P.shards[cardId]=Math.max(0,P.shards[cardId]-1);
    else if(cardData)cardData.shards=Math.max(0,(cardData.shards||0)-1);
    const me=P.clan.members?.find(m=>m.name===P.name||m.player_id===NET.playerId);
    if(me)me.donations=(me.donations||0)+1;
    save();updateDonations();updateCurrency();
    showNotify('🎁 Card Donated!','success');
  }
}
function showMemberManagement(){
  if(!P.clan)return;
  const members=P.clan.members||[];
  const myMember=members.find(m=>m.name===P.name||m.player_id===NET.playerId);
  const myRole=normalizeRole(myMember?.role);
  const isLeader=myRole==='Leader';
  const isCoLeader=myRole==='Co-Leader';
  let html='<div style="max-height:300px;overflow-y:auto">';
  members.forEach(m=>{
    const role=normalizeRole(m.role);
    const roleIcon=getRoleIcon(m.role);
    const isMe=m.name===P.name||m.player_id===NET.playerId;
    const trophies=m.trophies||0;
    const memberId=m.player_id||m.name;
    const targetIsLeader=role==='Leader';
    const targetIsCoLeader=role==='Co-Leader';
    html+=`<div style="display:flex;align-items:center;gap:8px;padding:8px;background:#1a2535;border-radius:6px;margin-bottom:4px"><div style="font-size:18px">${roleIcon}</div><div style="flex:1"><div style="font-weight:700;font-size:11px">${m.name}${isMe?' (You)':''}</div><div style="font-size:9px;color:#6b7c8a">${role} • 🏆${trophies}</div></div>`;
    // Only leaders can promote/demote/kick, and only for non-leaders
    if(isLeader&&!isMe&&!targetIsLeader){
      html+=`<button onclick="promoteMember('${memberId}')" style="padding:3px 6px;background:#27ae60;border:none;border-radius:4px;color:#fff;font-size:8px;cursor:pointer">⬆️</button><button onclick="demoteMember('${memberId}')" style="padding:3px 6px;background:#e67e22;border:none;border-radius:4px;color:#fff;font-size:8px;cursor:pointer">⬇️</button><button onclick="kickMember('${memberId}')" style="padding:3px 6px;background:#e74c3c;border:none;border-radius:4px;color:#fff;font-size:8px;cursor:pointer">❌</button>`;
    }
    // Co-leaders can only kick regular members
    else if(isCoLeader&&!isMe&&!targetIsLeader&&!targetIsCoLeader){
      html+=`<button onclick="kickMember('${memberId}')" style="padding:3px 6px;background:#e74c3c;border:none;border-radius:4px;color:#fff;font-size:8px;cursor:pointer">❌</button>`;
    }
    html+=`</div>`;
  });
  html+='</div>';
  const modal=document.createElement('div');
  modal.id='memberManagementModal';
  modal.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:9999';
  modal.innerHTML=`<div style="background:#243447;border-radius:12px;padding:15px;width:90%;max-width:350px"><div style="font-weight:800;font-size:14px;margin-bottom:10px;text-align:center">👥 Clan Members</div>${html}<button onclick="this.parentElement.parentElement.remove()" style="width:100%;padding:8px;background:#e74c3c;border:none;border-radius:8px;color:#fff;font-weight:800;cursor:pointer;margin-top:10px">Close</button></div>`;
  // Remove existing modal if any
  document.getElementById('memberManagementModal')?.remove();
  document.body.appendChild(modal);
}

async function promoteMember(playerId){
  if(!P.clan)return;
  const members=P.clan.members||[];
  const m=members.find(x=>x.player_id===playerId||x.name===playerId);
  if(!m)return;

  if(NET.isOnline&&P.clan.id){
    try{
      const result=await NET.api(`/api/clan/${P.clan.id}/promote`,'POST',{player_id:playerId});
      if(result.clan){
        P.clan=result.clan;
        save();
        document.getElementById('memberManagementModal')?.remove();
        showMemberManagement();
        showNotify('⬆️ Member Promoted!','success');
      }else if(result.error){
        showNotify(`Error: ${result.error}`,'error');
      }
    }catch(e){
      showNotify('Failed to promote member','error');
    }
  }else{
    // Offline fallback
    const role=normalizeRole(m.role);
    if(role==='Member')m.role='elder';
    else if(role==='Elder')m.role='co-leader';
    save();
    document.getElementById('memberManagementModal')?.remove();
    showMemberManagement();
  }
}

async function demoteMember(playerId){
  if(!P.clan)return;
  const members=P.clan.members||[];
  const m=members.find(x=>x.player_id===playerId||x.name===playerId);
  if(!m)return;

  if(NET.isOnline&&P.clan.id){
    try{
      const result=await NET.api(`/api/clan/${P.clan.id}/demote`,'POST',{player_id:playerId});
      if(result.clan){
        P.clan=result.clan;
        save();
        document.getElementById('memberManagementModal')?.remove();
        showMemberManagement();
        showNotify('⬇️ Member Demoted!','success');
      }else if(result.error){
        showNotify(`Error: ${result.error}`,'error');
      }
    }catch(e){
      showNotify('Failed to demote member','error');
    }
  }else{
    // Offline fallback
    const role=normalizeRole(m.role);
    if(role==='Co-Leader')m.role='elder';
    else if(role==='Elder')m.role='member';
    save();
    document.getElementById('memberManagementModal')?.remove();
    showMemberManagement();
  }
}

async function kickMember(playerId){
  if(!P.clan)return;
  if(!confirm('Are you sure you want to kick this member?'))return;

  if(NET.isOnline&&P.clan.id){
    try{
      const result=await NET.api(`/api/clan/${P.clan.id}/kick`,'POST',{player_id:playerId});
      if(result.clan){
        P.clan=result.clan;
        save();
        document.getElementById('memberManagementModal')?.remove();
        showMemberManagement();
        updateClan();
        showNotify('❌ Member Kicked!','success');
      }else if(result.error){
        showNotify(`Error: ${result.error}`,'error');
      }
    }catch(e){
      showNotify('Failed to kick member','error');
    }
  }else{
    // Offline fallback
    P.clan.members=(P.clan.members||[]).filter(m=>m.player_id!==playerId&&m.name!==playerId);
    save();
    document.getElementById('memberManagementModal')?.remove();
    showMemberManagement();
    updateClan();
  }
}
function challengeClanmate(){
if(!P.clan)return;
const bots=P.clan.members.filter(m=>m.isBot);
if(bots.length===0){showNotify('No clanmates to challenge!','info','👥');return;}
const opponent=bots[Math.floor(Math.random()*bots.length)];
showNotify(`⚔️ Challenge Sent!\n${opponent.name}`,'success');
B={...B,isFriendly:true,opponentName:opponent.name};
startBattle(true);
}
function updateClanLevel(){
const el=document.getElementById('clanLevel');
if(!el||!P.clan)return;
const members=P.clan.members||[];
const totalTrophies=members.reduce((a,m)=>a+(m.trophies||0),0);
const level=Math.min(20,Math.floor(totalTrophies/10000)+1);
const xpInLevel=totalTrophies%10000;
el.innerHTML=`<div style="display:flex;align-items:center;gap:10px"><div style="font-size:28px;background:linear-gradient(180deg,#ffd700,#ff8c00);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:900">${level}</div><div style="flex:1"><div style="font-size:10px;color:#6b7c8a">Clan Level</div><div style="height:8px;background:#1a2535;border-radius:4px;overflow:hidden;margin-top:4px"><div style="height:100%;width:${(xpInLevel/10000)*100}%;background:linear-gradient(90deg,#4ade80,#22c55e)"></div></div><div style="font-size:9px;color:#6b7c8a;margin-top:2px">${xpInLevel.toLocaleString()}/10,000 XP</div></div></div>`;
}
function updateClanGames(){
const el=document.getElementById('clanGames');
if(!el||!P.clan)return;
if(!P.clan.games)P.clan.games={points:0,maxPoints:50000,rewards:[{pts:5000,reward:'500 Gold'},{pts:15000,reward:'Rare Card'},{pts:30000,reward:'1000 Gold'},{pts:50000,reward:'Epic Card'}]};
const g=P.clan.games;
el.innerHTML=`<div style="text-align:center;margin-bottom:8px"><div style="font-size:20px;font-weight:900;color:#4ade80">${g.points.toLocaleString()}</div><div style="font-size:9px;color:#6b7c8a">Clan Points</div></div><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px">${g.rewards.map(r=>`<div style="text-align:center;padding:6px;background:${g.points>=r.pts?'#27ae60':'#1a2535'};border-radius:6px"><div style="font-size:9px;font-weight:700">${r.pts/1000}K</div><div style="font-size:8px;color:#6b7c8a">${r.reward}</div></div>`).join('')}</div><button onclick="playClanGame()" style="width:100%;padding:8px;background:linear-gradient(180deg,#9b59b6,#8e44ad);border:none;border-radius:8px;color:#fff;font-weight:800;cursor:pointer;margin-top:8px;font-size:10px">🎮 Play Challenge (+500 pts)</button>`;
}
function playClanGame(){if(!P.clan||!P.clan.games)return;P.clan.games.points=Math.min(P.clan.games.maxPoints,P.clan.games.points+500);P.gold+=100;save();updateClanGames();updateCurrency();showNotify('🎮 Clan Game Complete!\n+500 clan points +100 gold','success');}
function updateClanChest(){
const el=document.getElementById('clanChest');
if(!el||!P.clan)return;
if(!P.clan.chest)P.clan.chest={crowns:0,maxCrowns:1600,tier:0};
const c=P.clan.chest;
el.innerHTML=`<div style="font-size:40px;margin-bottom:8px">📦</div><div style="font-size:12px;font-weight:800">Clan Chest</div><div style="height:12px;background:#1a2535;border-radius:6px;overflow:hidden;margin:8px 0"><div style="height:100%;width:${(c.crowns/c.maxCrowns)*100}%;background:linear-gradient(90deg,#3b82f6,#8b5cf6)"></div></div><div style="font-size:10px;color:#6b7c8a">👑 ${c.crowns}/${c.maxCrowns} Crowns</div>`;
}
function updateClanPerks(){
  const el=document.getElementById('clanPerks');
  if(!el||!P.clan)return;
  const members=P.clan.members||[];
  const totalTrophies=members.reduce((a,m)=>a+(m.trophies||0),0);
  const level=Math.min(20,Math.floor(totalTrophies/10000)+1);
  const perks=[{name:'Request Wait',icon:'⏱️',value:`${Math.max(1,8-Math.floor(level/3))}h`,desc:'Donation cooldown'},{name:'Request Cards',icon:'🃏',value:`+${level*2}`,desc:'Extra cards per request'},{name:'War Bonus',icon:'⚔️',value:`+${level*5}%`,desc:'War rewards boost'},{name:'Chest Speed',icon:'📦',value:`+${level*2}%`,desc:'Chest unlock speed'}];
  el.innerHTML=perks.map(p=>`<div style="background:#1a2535;border-radius:8px;padding:8px;text-align:center"><div style="font-size:18px">${p.icon}</div><div style="font-size:10px;font-weight:800;color:#4ade80">${p.value}</div><div style="font-size:8px;color:#6b7c8a">${p.name}</div></div>`).join('');
}
function updateClanLeague(){
  const el=document.getElementById('clanLeague');
  if(!el||!P.clan)return;
  // Support both API format (stats.war_trophies) and local format (warTrophies)
  const warTrophies=P.clan.stats?.war_trophies||P.clan.warTrophies||0;
  const leagues=[{name:'Bronze',icon:'🥉',min:0},{name:'Silver',icon:'🥈',min:1000},{name:'Gold',icon:'🥇',min:2500},{name:'Diamond',icon:'💎',min:5000},{name:'Legend',icon:'🏆',min:10000}];
  const current=leagues.filter(l=>warTrophies>=l.min).pop()||leagues[0];
  const next=leagues.find(l=>l.min>warTrophies);
  el.innerHTML=`<div style="font-size:36px">${current.icon}</div><div style="font-size:14px;font-weight:900;margin:4px 0">${current.name} League</div><div style="font-size:10px;color:#6b7c8a">⚔️ ${warTrophies} War Trophies</div>${next?`<div style="font-size:9px;color:#4ade80;margin-top:4px">${next.min-warTrophies} more for ${next.name}</div>`:'<div style="font-size:9px;color:#ffd700;margin-top:4px">MAX LEAGUE!</div>'}`;
}
function updateClanMail(){
  const el=document.getElementById('clanMail');
  if(!el||!P.clan)return;
  if(!P.clan.mail)P.clan.mail=[{from:'System',subject:'Welcome!',msg:'Welcome to the clan! Participate in wars and donate cards to earn rewards.',time:Date.now()}];
  const m=P.clan.mail[0];
  const members=P.clan.members||[];
  const myMember=members.find(mem=>mem.name===P.name||mem.player_id===NET.playerId);
  const myRole=normalizeRole(myMember?.role);
  const isLeader=myRole==='Leader'||myRole==='Co-Leader';
  el.innerHTML=`<div style="font-size:10px;font-weight:700;color:#ffd700">${m.subject}</div><div style="font-size:9px;color:#6b7c8a;margin:4px 0">From: ${m.from}</div><div style="font-size:10px">${m.msg}</div>${isLeader?`<button onclick="editClanMail()" style="margin-top:8px;padding:6px 10px;background:#3498db;border:none;border-radius:6px;color:#fff;font-size:9px;cursor:pointer">✏️ Edit Welcome</button>`:''}`;
}

async function editClanMail(){
  if(!P.clan)return;
  const subject=prompt('Enter welcome subject:',P.clan.mail?.[0]?.subject||'Welcome!');
  if(subject===null)return;
  const msg=prompt('Enter welcome message:',P.clan.mail?.[0]?.msg||'');
  if(msg===null)return;

  // Update local mail
  if(!P.clan.mail)P.clan.mail=[];
  P.clan.mail[0]={from:P.name,subject,msg,time:Date.now()};
  save();
  updateClanMail();
  showNotify('📢 Welcome Message Updated!','success');
}
function updateClanSettings(){
  const el=document.getElementById('clanSettings');
  if(!el||!P.clan)return;
  const members=P.clan.members||[];
  const myMember=members.find(m=>m.name===P.name||m.player_id===NET.playerId);
  const myRole=normalizeRole(myMember?.role);
  const isLeader=myRole==='Leader';
  const isCoLeader=myRole==='Co-Leader';
  const canEdit=isLeader||isCoLeader;

  // Only show settings to leaders and co-leaders
  if(!canEdit){
    el.innerHTML=`<div style="text-align:center;color:#6b7c8a;font-size:10px;padding:10px">Only clan leaders can edit settings</div>`;
    return;
  }

  // Co-leaders can edit settings but not delete clan
  el.innerHTML=`
    <button onclick="editClanDescription()" style="padding:8px;background:#3498db;border:none;border-radius:6px;color:#fff;font-size:10px;cursor:pointer">📝 Edit Description</button>
    <button onclick="changeClanBadge()" style="padding:8px;background:#9b59b6;border:none;border-radius:6px;color:#fff;font-size:10px;cursor:pointer">🛡️ Change Badge</button>
    <button onclick="toggleClanType()" style="padding:8px;background:#e67e22;border:none;border-radius:6px;color:#fff;font-size:10px;cursor:pointer">🔒 Toggle Open/Closed</button>
    <button onclick="setClanMinTrophies()" style="padding:8px;background:#27ae60;border:none;border-radius:6px;color:#fff;font-size:10px;cursor:pointer">🏆 Set Min Trophies</button>
    ${isLeader?`<button onclick="deleteClan()" style="padding:8px;background:#e74c3c;border:none;border-radius:6px;color:#fff;font-size:10px;cursor:pointer">🗑️ Delete Clan</button>`:''}`;
}
async function editClanDescription(){
  const desc=prompt('Enter clan description:',P.clan.description||'');
  if(desc===null)return;

  if(NET.isOnline&&P.clan.id){
    try{
      const result=await NET.api(`/api/clan/${P.clan.id}/settings`,'POST',{description:desc});
      if(result.clan){
        P.clan=result.clan;
        save();updateClan();
        showNotify('✏️ Description Updated!','success');
      }else if(result.error){
        showNotify(`Error: ${result.error}`,'error');
      }
    }catch(e){
      showNotify('Failed to update description','error');
    }
  }else{
    P.clan.description=desc;
    save();
    showNotify('✏️ Description Updated!','success');
  }
}

async function changeClanBadge(){
  const badges=['🛡️','⚔️','🏰','🐉','🦁','🦅','👑','💎','🔥','⭐'];
  const currentBadge=P.clan.badge||'🏰';
  const newBadge=badges[(badges.indexOf(currentBadge)+1)%badges.length];

  if(NET.isOnline&&P.clan.id){
    try{
      const result=await NET.api(`/api/clan/${P.clan.id}/settings`,'POST',{badge:newBadge});
      if(result.clan){
        P.clan=result.clan;
        save();updateClan();
        showNotify('🛡️ Badge Changed!\n'+newBadge,'success');
      }else if(result.error){
        showNotify(`Error: ${result.error}`,'error');
      }
    }catch(e){
      showNotify('Failed to change badge','error');
    }
  }else{
    P.clan.badge=newBadge;
    save();updateClan();
    showNotify('🛡️ Badge Changed!\n'+newBadge,'success');
  }
}

async function toggleClanType(){
  const currentType=P.clan.type||'open';
  const newType=currentType==='open'?'invite_only':'open';

  if(NET.isOnline&&P.clan.id){
    try{
      const result=await NET.api(`/api/clan/${P.clan.id}/settings`,'POST',{type:newType});
      if(result.clan){
        P.clan=result.clan;
        save();updateClan();
        showNotify('🔒 Clan Updated!\n'+(newType==='open'?'Open to All':'Invite Only'),'success');
      }else if(result.error){
        showNotify(`Error: ${result.error}`,'error');
      }
    }catch(e){
      showNotify('Failed to update clan type','error');
    }
  }else{
    P.clan.isOpen=!P.clan.isOpen;
    save();
    showNotify('🔒 Clan Updated!\n'+(P.clan.isOpen?'Open to All':'Invite Only'),'success');
  }
}

async function setClanMinTrophies(){
  const current=P.clan.required_trophies||P.clan.minTrophies||0;
  const min=prompt('Minimum trophies to join:',current);
  if(min===null||isNaN(min))return;
  const trophies=parseInt(min);

  if(NET.isOnline&&P.clan.id){
    try{
      const result=await NET.api(`/api/clan/${P.clan.id}/settings`,'POST',{required_trophies:trophies});
      if(result.clan){
        P.clan=result.clan;
        save();updateClan();
        showNotify('🏆 Min Trophies Set!\n'+trophies+' trophies','success');
      }else if(result.error){
        showNotify(`Error: ${result.error}`,'error');
      }
    }catch(e){
      showNotify('Failed to set min trophies','error');
    }
  }else{
    P.clan.minTrophies=trophies;
    save();
    showNotify('🏆 Min Trophies Set!\n'+trophies+' trophies','success');
  }
}

// ===== ENHANCED PASS ROYALE =====
const SEASON_THEMES=[
{name:'ROYAL DAWN',icon:'🌅',color:'#ff8c00'},
{name:'FROZEN CONQUEST',icon:'❄️',color:'#00bcd4'},
{name:'DRAGON FURY',icon:'🐉',color:'#e74c3c'},
{name:'SHADOW REALM',icon:'🌑',color:'#9b59b6'},
{name:'GOLDEN AGE',icon:'👑',color:'#ffd700'}
];
const CURRENT_SEASON=SEASON_THEMES[Math.floor(Date.now()/2592000000)%SEASON_THEMES.length];

// 90 Tier Battle Pass Rewards
const BP_TIERS=[
{tier:1,free:{gold:200},premium:{gems:25}},
{tier:2,free:{gold:300},premium:{chest:'silver'}},
{tier:3,free:{gems:15},premium:{gold:800}},
{tier:4,free:{chest:'silver'},premium:{gems:40}},
{tier:5,free:{gold:500},premium:{emoteId:'e31',towerSkinId:'tower_fire'}},
{tier:6,free:{gems:20},premium:{gold:1200}},
{tier:7,free:{gold:800},premium:{chest:'gold',towerSkinId:'tower_skeleton'}},
{tier:8,free:{chest:'silver'},premium:{gems:60,towerSkinId:'tower_nature'}},
{tier:9,free:{gems:30},premium:{wildCard:1}},
{tier:10,free:{chest:'gold'},premium:{towerSkinId:'tower_ice',emoteId:'e13'}},
{tier:11,free:{gold:1000},premium:{gems:80}},
{tier:12,free:{gems:40},premium:{chest:'magic',towerSkinId:'tower_star'}},
{tier:13,free:{gold:1200},premium:{emoteId:'e7'}},
{tier:14,free:{chest:'gold'},premium:{gold:2500}},
{tier:15,free:{gems:50,wildCard:1},premium:{legendaryShards:3,towerSkinId:'tower_dark'}},
{tier:16,free:{gold:1500},premium:{gems:100}},
{tier:17,free:{gems:60},premium:{chest:'giant'}},
{tier:18,free:{chest:'magic'},premium:{emoteId:'e8',towerSkinId:'tower_lava'}},
{tier:19,free:{gold:2000},premium:{wildCard:2}},
{tier:20,free:{gems:80},premium:{towerSkinId:'tower_gold',emoteId:'e23'}},
{tier:21,free:{gold:2500},premium:{gems:120}},
{tier:22,free:{chest:'gold'},premium:{chest:'legendary',towerSkinId:'tower_ocean'}},
{tier:23,free:{gems:100},premium:{emoteId:'e9'}},
{tier:24,free:{gold:3000},premium:{gold:5000}},
{tier:25,free:{chest:'giant',wildCard:2},premium:{championShards:5,towerSkinId:'tower_crystal'}},
{tier:26,free:{gems:120},premium:{gems:200}},
{tier:27,free:{gold:4000},premium:{chest:'super'}},
{tier:28,free:{chest:'magic'},premium:{emoteId:'e35',towerSkinId:'tower_void'}},
{tier:29,free:{gems:150},premium:{wildCard:3}},
{tier:30,free:{gold:5000},premium:{towerSkinId:'tower_dragon',emoteId:'e46'}},
{tier:31,free:{gems:100},premium:{gold:8000}},
{tier:32,free:{chest:'giant'},premium:{gems:300}},
{tier:33,free:{gold:6000},premium:{chest:'legendary',towerSkinId:'tower_rainbow'}},
{tier:34,free:{gems:200},premium:{emoteId:'e39'}},
{tier:35,free:{megaReward:true,chest:'legendary',wildCard:2},premium:{megaReward:true,towerSkinId:'tower_electric'}},
{tier:36,free:{gold:5500},premium:{gems:150}},
{tier:37,free:{gems:120},premium:{chest:'gold'}},
{tier:38,free:{chest:'silver'},premium:{gold:6000}},
{tier:39,free:{gold:6000},premium:{wildCard:2}},
{tier:40,free:{chest:'magic'},premium:{legendaryShards:5,emoteId:'e10'}},
{tier:41,free:{gems:130},premium:{gold:7000}},
{tier:42,free:{gold:6500},premium:{chest:'giant'}},
{tier:43,free:{chest:'gold'},premium:{gems:180}},
{tier:44,free:{gems:140},premium:{championShards:3}},
{tier:45,free:{gold:7000,wildCard:3},premium:{chest:'legendary',emoteId:'e11'}},
{tier:46,free:{chest:'silver'},premium:{gold:8000}},
{tier:47,free:{gems:150},premium:{wildCard:3}},
{tier:48,free:{gold:7500},premium:{chest:'super'}},
{tier:49,free:{chest:'magic'},premium:{gems:220}},
{tier:50,free:{gems:180},premium:{legendaryShards:8,emoteId:'e12'}},
{tier:51,free:{gold:8000},premium:{gold:10000}},
{tier:52,free:{chest:'gold'},premium:{gems:250}},
{tier:53,free:{gems:160},premium:{chest:'legendary'}},
{tier:54,free:{gold:8500},premium:{wildCard:4}},
{tier:55,free:{chest:'giant',wildCard:3},premium:{championShards:5,emoteId:'e14'}},
{tier:56,free:{gems:170},premium:{gold:12000}},
{tier:57,free:{gold:9000},premium:{chest:'super'}},
{tier:58,free:{chest:'magic'},premium:{gems:280}},
{tier:59,free:{gems:180},premium:{legendaryShards:10}},
{tier:60,free:{megaReward:true,chest:'legendary'},premium:{megaReward:true,emoteId:'e15'}},
{tier:61,free:{gold:9500},premium:{gems:200}},
{tier:62,free:{gems:190},premium:{chest:'giant'}},
{tier:63,free:{chest:'gold'},premium:{gold:14000}},
{tier:64,free:{gold:10000},premium:{wildCard:5}},
{tier:65,free:{gems:200,wildCard:4},premium:{chest:'legendary',emoteId:'e16'}},
{tier:66,free:{chest:'magic'},premium:{championShards:7}},
{tier:67,free:{gold:10500},premium:{gems:320}},
{tier:68,free:{gems:210},premium:{chest:'super'}},
{tier:69,free:{chest:'giant'},premium:{gold:16000}},
{tier:70,free:{gold:11000},premium:{legendaryShards:12,emoteId:'e17'}},
{tier:71,free:{gems:220},premium:{wildCard:6}},
{tier:72,free:{chest:'gold'},premium:{gems:350}},
{tier:73,free:{gold:11500},premium:{chest:'legendary'}},
{tier:74,free:{gems:230},premium:{championShards:10}},
{tier:75,free:{megaReward:true,chest:'super',wildCard:5},premium:{megaReward:true,emoteId:'e18'}},
{tier:76,free:{gold:12000},premium:{gold:20000}},
{tier:77,free:{gems:240},premium:{chest:'super'}},
{tier:78,free:{chest:'magic'},premium:{legendaryShards:15}},
{tier:79,free:{gold:12500},premium:{gems:400}},
{tier:80,free:{chest:'legendary'},premium:{wildCard:8,emoteId:'e19'}},
{tier:81,free:{gems:250},premium:{championShards:12}},
{tier:82,free:{gold:13000},premium:{chest:'legendary'}},
{tier:83,free:{chest:'giant'},premium:{gold:25000}},
{tier:84,free:{gems:260},premium:{legendaryShards:18}},
{tier:85,free:{gold:14000,wildCard:6},premium:{gems:500,emoteId:'e20'}},
{tier:86,free:{chest:'super'},premium:{wildCard:10}},
{tier:87,free:{gems:280},premium:{championShards:15}},
{tier:88,free:{gold:15000},premium:{chest:'super'}},
{tier:89,free:{chest:'legendary'},premium:{gold:30000}},
{tier:90,free:{megaReward:true,gems:500},premium:{megaReward:true,legendaryShards:25,championShards:20}}
];

// Exclusive Season Rewards
const EXCLUSIVE_REWARDS=[
{icon:'🏰',name:'Royal Tower',type:'towerSkin',tier:10},
{icon:'😎',name:'Cool Emote',type:'emote',tier:13},
{icon:'🔥',name:'Fire Emote',type:'emote',tier:18},
{icon:'🗼',name:'Tower Skin',type:'towerSkin',tier:20},
{icon:'💀',name:'Skull Emote',type:'emote',tier:23},
{icon:'👑',name:'Crown Emote',type:'emote',tier:28},
{icon:'⚔️',name:'Season Skin',type:'exclusiveSkin',tier:30},
{icon:'⚡',name:'Lightning',type:'emote',tier:34},
{icon:'🎖️',name:'MEGA REWARD',type:'mega',tier:35},
{icon:'🌟',name:'Star Emote',type:'emote',tier:40},
{icon:'🏯',name:'Fortress Tower',type:'towerSkin',tier:45},
{icon:'🦁',name:'Lion Emote',type:'emote',tier:50},
{icon:'🔱',name:'Trident Tower',type:'towerSkin',tier:55},
{icon:'🎖️',name:'MEGA REWARD II',type:'mega',tier:60},
{icon:'🐲',name:'Dragon Emote',type:'emote',tier:65},
{icon:'🏛️',name:'Mythic Tower',type:'towerSkin',tier:70},
{icon:'🎖️',name:'MEGA REWARD III',type:'mega',tier:75},
{icon:'⚜️',name:'Royal Crest',type:'emote',tier:80},
{icon:'🏰',name:'Ultimate Tower',type:'towerSkin',tier:85},
{icon:'🏆',name:'ULTIMATE REWARD',type:'mega',tier:90}
];

// Initialize new BP data
if(!P.crownChestProgress)P.crownChestProgress=0;
if(!P.crownChestsOpened)P.crownChestsOpened=0;
if(!P.bpStrike)P.bpStrike=0;
if(!P.lastBpPlay)P.lastBpPlay=0;
if(!P.bpEmotes)P.bpEmotes=[];
if(!P.bpTowerSkins)P.bpTowerSkins=[];
if(!P.royalWildCards)P.royalWildCards=0;

let currentBpTrack='free';

function updateBattlePass(){
// Update season info
const daysLeft=getSeasonTimeRemaining();
const passTimer=document.getElementById('passTimer');
const passSeasonName=document.getElementById('passSeasonName');
if(passTimer)passTimer.textContent=daysLeft+' days remaining';
if(passSeasonName)passSeasonName.textContent='SEASON '+((new Date().getMonth()%5)+1)+': '+CURRENT_SEASON.name;

// Update premium status
const premStatus=document.getElementById('premiumStatus');
const premBadge=document.getElementById('premiumBadge');
const perksPreview=document.getElementById('perksPreview');
if(premStatus)premStatus.className='premium-status'+(P.bpPremium?' active':'');
if(premBadge){
premBadge.textContent=P.bpPremium?'👑 PASS ROYALE':'🆓 FREE PASS';
premBadge.className='premium-badge'+(P.bpPremium?' gold':'');
}
if(perksPreview)perksPreview.textContent=P.bpPremium?'All premium perks active!':'Unlock Premium for exclusive rewards!';

// Update crown chest
const crownProgress=document.getElementById('crownProgress');
const crownChestFill=document.getElementById('crownChestFill');
const crownChestBtn=document.getElementById('crownChestBtn');
const progress=P.crownChestProgress||0;
if(crownProgress)crownProgress.textContent=progress+'/10';
if(crownChestFill)crownChestFill.style.width=(progress/10*100)+'%';
if(crownChestBtn){
crownChestBtn.disabled=progress<10;
crownChestBtn.textContent=progress>=10?'🎁 Open Crown Chest!':'🎁 '+progress+'/10 Crowns';
}

// Update level display
const bpLevelBig=document.getElementById('bpLevelBig');
const bpXpCurrent=document.getElementById('bpXpCurrent');
const bpXpMax=document.getElementById('bpXpMax');
const bpXpFillNew=document.getElementById('bpXpFillNew');
const bpCircleFill=document.getElementById('bpCircleFill');
const needed=getXpNeeded(P.bpLevel);
if(bpLevelBig)bpLevelBig.textContent=P.bpLevel;
if(bpXpCurrent)bpXpCurrent.textContent=P.bpXp;
if(bpXpMax)bpXpMax.textContent=needed;
const pct=Math.min(100,(P.bpXp/needed)*100);
if(bpXpFillNew)bpXpFillNew.style.width=pct+'%';
if(bpCircleFill)bpCircleFill.style.strokeDashoffset=283-(283*pct/100);

// Show bonus XP indicator if premium
const bpBonusXp=document.getElementById('bpBonusXp');
if(bpBonusXp)bpBonusXp.style.display=P.bpPremium?'block':'none';

// Update buy button
const buyPassBtn=document.getElementById('buyPassBtn');
if(buyPassBtn){
buyPassBtn.style.display=P.bpPremium?'none':'block';
}

// Update premium lock
const premLock=document.getElementById('premLock');
if(premLock)premLock.style.display=P.bpPremium?'none':'inline';

// Update strike bonus
updateStrikeBonus();

// Update rewards track
updateBpRewardsTrack();

// Update exclusive rewards preview
updateExclusiveRewards();
}

function getXpNeeded(level){
if(level>20)return 500;
return 100+((level-1)*25);
}

function updateBpRewardsTrack(){
const track=document.getElementById('bpRewardsTrack');
if(!track)return;
track.innerHTML='';

const isPremium=currentBpTrack==='premium';

BP_TIERS.forEach((t,i)=>{
const reward=isPremium?t.premium:t.free;
const claimKey=(isPremium?'prem_':'free_')+t.tier;
const claimed=P.bpClaimed.includes(claimKey);
const canClaim=P.bpLevel>=t.tier&&!claimed&&(isPremium?P.bpPremium:true);
const locked=P.bpLevel<t.tier||(isPremium&&!P.bpPremium);

const div=document.createElement('div');
div.className='bp-reward-tier'+(isPremium?' premium':'')+(canClaim?' current':'')+(claimed?' claimed':'')+(locked?' locked':'');

// Get reward icon and text
let icon='🎁';
let text='Reward';
if(reward.gold){icon='💰';text='+'+reward.gold;}
else if(reward.gems){icon='💎';text='+'+reward.gems;}
else if(reward.chest){icon=CHEST_TYPES.find(c=>c.id===reward.chest)?.icon||'📦';text=reward.chest;}
else if(reward.emote){icon=reward.emote;text='Emote';}
else if(reward.towerSkin){icon=reward.towerSkin;text='Tower';}
else if(reward.wildCard){icon='🃏';text='x'+reward.wildCard;}
else if(reward.legendaryShards){icon='❤️';text='+'+reward.legendaryShards;}
else if(reward.championShards){icon='💙';text='+'+reward.championShards;}
else if(reward.exclusiveSkin){icon=reward.exclusiveSkin;text='Exclusive';}
else if(reward.megaReward){icon='🎖️';text='MEGA!';}

div.innerHTML=`
${claimed?'<div class="tier-check">✓</div>':''}
${t.tier%5===0?'<div class="tier-crown">👑</div>':''}
<div class="tier-number">Tier ${t.tier}</div>
<div class="tier-icon">${icon}</div>
<div class="tier-reward-text">${text}</div>
`;

if(canClaim)div.onclick=()=>claimBpReward(t.tier,isPremium?'premium':'free');
track.appendChild(div);
});
}

function updateStrikeBonus(){
const strikeDays=document.getElementById('strikeDays');
const strikeReward=document.getElementById('strikeReward');
if(!strikeDays)return;

// Check if played today
const today=new Date().toDateString();
const lastPlay=P.lastBpPlay?new Date(P.lastBpPlay).toDateString():'';
const playedToday=today===lastPlay;

// Check streak
const yesterday=new Date(Date.now()-86400000).toDateString();
const playedYesterday=lastPlay===yesterday;
if(!playedToday&&!playedYesterday&&P.bpStrike>0){
// Reset streak if missed a day
P.bpStrike=0;save();
}

strikeDays.innerHTML='';
for(let i=1;i<=7;i++){
const div=document.createElement('div');
div.className='strike-day'+(i<=(P.bpStrike%7)||i===7&&P.bpStrike>=7?' completed':'')+(i===(P.bpStrike%7)+1&&playedToday?' active':'');
div.textContent=i===7?'🎁':i;
strikeDays.appendChild(div);
}

const bonuses=['+50 XP','+100 XP','+150 XP','+200 XP','+300 XP','+500 XP','🎁 Bonus Chest!'];
if(strikeReward)strikeReward.textContent='Day '+(Math.min(7,(P.bpStrike%7)+1))+': '+bonuses[Math.min(6,P.bpStrike%7)];
}

function updateExclusiveRewards(){
const grid=document.getElementById('exclusiveGrid');
if(!grid)return;
grid.innerHTML='';

EXCLUSIVE_REWARDS.forEach(r=>{
const unlocked=P.bpLevel>=r.tier&&P.bpPremium;
const div=document.createElement('div');
div.className='exclusive-item'+(unlocked?'':' locked');
div.innerHTML=`<div class="ex-icon">${r.icon}</div><div class="ex-name">${r.name}</div>`;
grid.appendChild(div);
});
}

function claimBpReward(tier,type){
const t=BP_TIERS.find(x=>x.tier===tier);
if(!t)return;
const reward=type==='premium'?t.premium:t.free;
const claimKey=type+'_'+tier;

if(type==='premium'&&!P.bpPremium){showNotify('Unlock Pass Royale first!','error','🔒');return;}
if(P.bpClaimed.includes(claimKey))return;
if(P.bpLevel<tier)return;

// Give rewards
let rewardText='';
if(reward.gold){P.gold+=reward.gold;rewardText='+'+reward.gold+' Gold';}
if(reward.gems){P.gems+=reward.gems;rewardText='+'+reward.gems+' Gems';}
if(reward.chest){
const ct=CHEST_TYPES.find(c=>c.id===reward.chest);
if(ct)addChest(ct);
rewardText=ct.name+' Chest';
}
if(reward.emote&&!P.emotes.includes(reward.emote)){
P.emotes.push(reward.emote);
P.bpEmotes.push(reward.emote);
rewardText='New Emote: '+reward.emote;
}
if(reward.emoteId&&!P.unlockedEmotes.includes(reward.emoteId)){
P.unlockedEmotes.push(reward.emoteId);
const emote=ALL_EMOTES.find(e=>e.id===reward.emoteId);
rewardText='New Emote: '+(emote?emote.icon+' '+emote.name:reward.emoteId);
}
if(reward.towerSkin&&!P.ownedTowerSkins.includes(reward.towerSkin)){
P.ownedTowerSkins.push(reward.towerSkin);
P.bpTowerSkins.push(reward.towerSkin);
rewardText='New Tower Skin: '+reward.towerSkin;
}
if(reward.towerSkinId&&!P.unlockedTowerSkins.includes(reward.towerSkinId)){
P.unlockedTowerSkins.push(reward.towerSkinId);
const skin=TOWER_SKINS.find(s=>s.id===reward.towerSkinId);
rewardText='New Tower Skin: '+(skin?skin.icon+' '+skin.name:reward.towerSkinId);
}
if(reward.wildCard){
P.royalWildCards=(P.royalWildCards||0)+reward.wildCard;
rewardText='+'+reward.wildCard+' Royal Wild Card(s)';
}
if(reward.legendaryShards){
const legendaries=CARDS.filter(c=>c.rarity==='legendary');
const card=legendaries[Math.floor(Math.random()*legendaries.length)];
P.shards[card.id]=(P.shards[card.id]||0)+reward.legendaryShards;
rewardText='+'+reward.legendaryShards+' '+card.name+' Shards';
}
if(reward.championShards){
const champions=CARDS.filter(c=>c.rarity==='champion');
const card=champions[Math.floor(Math.random()*champions.length)];
P.shards[card.id]=(P.shards[card.id]||0)+reward.championShards;
rewardText='+'+reward.championShards+' '+card.name+' Shards';
}
if(reward.exclusiveSkin){
P.ownedTowerSkins.push(reward.exclusiveSkin);
rewardText='Exclusive Season Skin: '+reward.exclusiveSkin;
}
if(reward.megaReward){
P.gold+=50000;P.gems+=2500;P.starPoints+=5000;
const superCt=CHEST_TYPES.find(c=>c.id==='super');
const legCt=CHEST_TYPES.find(c=>c.id==='legendary');
addChest(superCt);addChest(legCt);addChest(superCt);
// Add bonus shards for random legendary and champion
const legendaries=CARDS.filter(c=>c.rarity==='legendary');
const champions=CARDS.filter(c=>c.rarity==='champion');
const randLeg=legendaries[Math.floor(Math.random()*legendaries.length)];
const randChamp=champions[Math.floor(Math.random()*champions.length)];
P.shards[randLeg.id]=(P.shards[randLeg.id]||0)+15;
P.shards[randChamp.id]=(P.shards[randChamp.id]||0)+10;
rewardText='🎖️ MEGA REWARD! +50,000 Gold, +2,500 Gems, +5,000 Star Points, 2x Super Chests, Legendary Chest, +15 '+randLeg.name+' Shards, +10 '+randChamp.name+' Shards!';
}

P.bpClaimed.push(claimKey);
save();
updateBattlePass();updateShop();updateChests();updateCards();
playSound('victory');

// Show reward popup
showBpRewardPopup(rewardText,tier);
}

function showBpRewardPopup(text,tier){
const popup=document.createElement('div');
popup.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:500;display:flex;flex-direction:column;align-items:center;justify-content:center;animation:fadeIn 0.3s';
popup.innerHTML=`
<div style="font-size:60px;animation:bounce 0.5s">🎁</div>
<div style="font-family:'Lilita One',cursive;font-size:24px;color:#ffd700;margin:15px 0">TIER ${tier} REWARD!</div>
<div style="font-size:16px;color:#fff;text-align:center;padding:0 20px">${text}</div>
<button onclick="this.parentElement.remove()" style="margin-top:20px;padding:12px 30px;background:linear-gradient(180deg,#ffd700,#ff8c00);border:none;border-radius:10px;font-family:'Lilita One',cursive;font-size:14px;color:#000;cursor:pointer">Collect!</button>
`;
document.body.appendChild(popup);
}

function openCrownChest(){
if((P.crownChestProgress||0)<10)return;
P.crownChestProgress=0;
P.crownChestsOpened=(P.crownChestsOpened||0)+1;

// Better rewards for premium
const baseGold=P.bpPremium?2000:1000;
const baseGems=P.bpPremium?50:20;
const goldReward=baseGold+Math.floor(Math.random()*1000);
const gemsReward=baseGems+Math.floor(Math.random()*30);

P.gold+=goldReward;
P.gems+=gemsReward;

// Random shards
const rarities=['common','common','rare','rare','epic'];
if(P.bpPremium)rarities.push('legendary');
const rarity=rarities[Math.floor(Math.random()*rarities.length)];
const cards=CARDS.filter(c=>c.rarity===rarity);
const card=cards[Math.floor(Math.random()*cards.length)];
const shardAmount=P.bpPremium?15:8;
P.shards[card.id]=(P.shards[card.id]||0)+shardAmount;

// Add BP XP
addBpXp(P.bpPremium?100:50);

save();
updateBattlePass();
playSound('victory');

// Show crown chest popup
const popup=document.createElement('div');
popup.className='chest-open-overlay';
popup.innerHTML=`
<div style="font-size:80px;animation:chestShake 0.4s,chestOpen 0.4s 0.4s forwards">👑</div>
<div class="chest-rewards" style="animation:rewardsAppear 0.4s 0.8s both">
<div style="font-family:'Lilita One';font-size:24px;color:#ffd700;margin-bottom:15px">Crown Chest!</div>
<div class="reward-item">💰 <span>+${goldReward}</span></div>
<div class="reward-item">💎 <span>+${gemsReward}</span></div>
<div class="reward-item">${card.icon} <span>+${shardAmount} ${card.name} Shards</span></div>
<div class="reward-item">⭐ <span>+${P.bpPremium?100:50} BP XP</span></div>
<button style="margin-top:15px;padding:12px 30px;background:#ffd700;border:none;border-radius:10px;font-family:'Lilita One';font-size:14px;color:#000;cursor:pointer" onclick="this.closest('.chest-open-overlay').remove();updateBattlePass();">Collect!</button>
</div>`;
document.body.appendChild(popup);
}

function buyBattlePass(){
if(P.bpPremium){showNotify('You already have Pass Royale!','info','✅');return;}
if(P.gems<1000){showNotify('Need 1000 gems to unlock Pass Royale!','error','💎');return;}

const modal=document.createElement('div');
modal.className='confirm-modal';
modal.innerHTML=`
<div class="confirm-box" style="max-width:300px;border-color:#9b59b6">
<div style="font-family:'Lilita One',cursive;font-size:20px;color:#ffd700;margin-bottom:10px">👑 PASS ROYALE</div>
<div style="font-size:11px;color:#e0b0ff;margin-bottom:15px">Unlock 35 premium rewards + exclusive perks!</div>
<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:5px;margin-bottom:15px;font-size:9px;color:#fff">
<div>✅ +25% XP Boost</div>
<div>✅ +20% Gold Boost</div>
<div>✅ Instant Unlocks</div>
<div>✅ Exclusive Skins</div>
<div>✅ Royal Wild Cards</div>
<div>✅ Premium Emotes</div>
</div>
<div class="confirm-cost" style="color:#9b59b6">💎 1000</div>
<div class="confirm-btns">
<button class="confirm-btn no" onclick="this.closest('.confirm-modal').remove()">Cancel</button>
<button class="confirm-btn yes" style="background:linear-gradient(180deg,#9b59b6,#8e44ad)" onclick="confirmBuyPass();this.closest('.confirm-modal').remove()">Unlock!</button>
</div>
</div>`;
document.body.appendChild(modal);
}

function confirmBuyPass(){
if(P.gems<1000)return;
P.gems-=1000;
P.bpPremium=true;
save();
updateBattlePass();
updateShop();
playSound('victory');
showVictoryCelebration();
showNotify('🎉 Pass Royale Unlocked!\nEnjoy your premium rewards!','epic');
}

function setBpTrack(type){
currentBpTrack=type;
const freeBtn=document.getElementById('bpToggleFree');
const premBtn=document.getElementById('bpTogglePrem');
if(freeBtn)freeBtn.classList.toggle('active',type==='free');
if(premBtn)premBtn.classList.toggle('active',type==='premium');
updateBpRewardsTrack();
}

function addBpXp(amount){
// Premium bonus
if(P.bpPremium)amount=Math.floor(amount*1.25);
P.bpXp+=amount;
const needed=getXpNeeded(P.bpLevel);
while(P.bpXp>=needed&&P.bpLevel<90){
P.bpXp-=needed;
P.bpLevel++;
// Show level up notification
showBpLevelUp(P.bpLevel);
}
// Update strike
const today=new Date().toDateString();
const lastPlay=P.lastBpPlay?new Date(P.lastBpPlay).toDateString():'';
if(today!==lastPlay){
P.bpStrike=(P.bpStrike||0)+1;
P.lastBpPlay=Date.now();
// Give strike bonus
const bonusXp=[50,100,150,200,300,500,0][(P.bpStrike-1)%7];
if(bonusXp>0){P.bpXp+=bonusXp;}
if((P.bpStrike%7)===0){
// 7th day bonus chest
const ct=CHEST_TYPES.find(c=>c.id==='gold');
addChest(ct);
}
}
save();
}

function showBpLevelUp(level){
const notif=document.createElement('div');
notif.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:linear-gradient(145deg,#9b59b6,#8e44ad);border:3px solid #ffd700;border-radius:16px;padding:20px 40px;z-index:600;animation:scaleIn 0.3s;text-align:center';
notif.innerHTML=`<div style="font-size:14px;color:#e0b0ff">BATTLE PASS</div><div style="font-family:'Lilita One',cursive;font-size:36px;color:#ffd700">LEVEL ${level}!</div><div style="font-size:12px;color:#fff;margin-top:5px">New rewards available!</div>`;
document.body.appendChild(notif);
playSound('victory');
setTimeout(()=>notif.remove(),2000);
}

// Add crowns to crown chest progress
function addCrownChestProgress(crowns){
P.crownChestProgress=(P.crownChestProgress||0)+crowns;
if(P.crownChestProgress>10)P.crownChestProgress=10;
save();
}

// Premium perk: Instant chest unlock
function canInstantUnlock(){return P.bpPremium;}

// Premium perk: Gold boost
function getGoldMultiplier(){return P.bpPremium?1.2:1;}

// ===== BATTLE LOG =====
function addToBattleLog(won,opponent,crowns,trophyChange,mode){
P.battleLog.unshift({won,opponent,crowns,trophyChange,mode,time:Date.now()});
if(P.battleLog.length>20)P.battleLog.pop();
save();
}
function updateBattleLog(){
const list=document.getElementById('battleLogList');
if(!list)return;
if(!P.battleLog.length){list.innerHTML='<div style="text-align:center;color:#6b7c8a;padding:20px">No battles yet!</div>';return;}
list.innerHTML=P.battleLog.map(b=>`<div class="log-entry ${b.won?'win':'loss'}"><div class="log-result">${b.won?'🏆':'💀'}</div><div class="log-info"><div class="log-opponent">vs ${b.opponent}</div><div class="log-details">${b.mode} • ${b.crowns} crowns • ${new Date(b.time).toLocaleTimeString()}</div></div><div class="log-trophies" style="color:${b.trophyChange>=0?'var(--green)':'var(--red)'};">${b.trophyChange>=0?'+':''}${b.trophyChange}</div></div>`).join('');
}

// ===== CARD MASTERY =====
function addMastery(cardId,amount){
if(!P.cardMastery[cardId])P.cardMastery[cardId]={xp:0,level:0};
P.cardMastery[cardId].xp+=amount;
const needed=(P.cardMastery[cardId].level+1)*500;
if(P.cardMastery[cardId].xp>=needed&&P.cardMastery[cardId].level<7){
P.cardMastery[cardId].xp-=needed;
P.cardMastery[cardId].level++;
P.starPoints+=100*(P.cardMastery[cardId].level);
}
save();
}
function getMasteryStars(cardId){
const lvl=P.cardMastery[cardId]?.level||0;
return '⭐'.repeat(lvl)+'☆'.repeat(7-lvl);
}

// ===== CARD EVOLUTION =====
function canEvolve(cardId){
const card=getCard(cardId);
if(!card||card.rarity!=='legendary'&&card.rarity!=='champion')return false;
return(P.lvls[cardId]||1)>=15&&(P.cardMastery[cardId]?.level||0)>=5&&!P.evolved.includes(cardId);
}
function evolveCard(cardId){
if(!canEvolve(cardId))return;
P.evolved.push(cardId);
save();updateCards();
showNotify('✨ Card Evolved!\n'+getCard(cardId).name+' is now more powerful!','epic');
}


// ===== WEEKLY QUESTS =====
const WEEKLY_QUESTS=[
{id:'wq_wins10',name:'Win 10 Battles',target:10,reward:{gems:100,starPoints:200}},
{id:'wq_crowns30',name:'Earn 30 Crowns',target:30,reward:{gold:5000,gems:50}},
{id:'wq_donate5',name:'Donate 5 Cards',target:5,reward:{chest:'gold'}},
{id:'wq_2v2_5',name:'Win 5 2v2 Battles',target:5,reward:{gems:75,starPoints:150}}
];
function updateWeeklyQuests(){
const list=document.getElementById('weeklyQuestList');
if(!list)return;
list.innerHTML=WEEKLY_QUESTS.map(q=>{
const progress=P.weeklyProgress[q.id]||0;
const completed=progress>=q.target;
const pct=Math.min(100,(progress/q.target)*100);
return`<div class="weekly-quest"><div style="display:flex;align-items:center;gap:10px"><div style="font-size:20px">📜</div><div style="flex:1"><div style="font-weight:800;font-size:11px">${q.name}</div><div style="font-size:9px;color:#6b7c8a">${progress}/${q.target}</div><div class="challenge-bar"><div class="challenge-fill" style="width:${pct}%"></div></div></div><div class="weekly-timer">${completed?'✅':'7d'}</div></div></div>`;
}).join('');
}

// ===== SOUND EFFECTS =====
const SOUNDS={
click:()=>playTone(800,50),
spawn:()=>playTone(400,100),
hit:()=>playTone(200,50),
victory:()=>{playTone(523,150);setTimeout(()=>playTone(659,150),150);setTimeout(()=>playTone(784,300),300);},
defeat:()=>{playTone(400,200);setTimeout(()=>playTone(300,200),200);setTimeout(()=>playTone(200,400),400);}
};
let audioCtx=null;
function playTone(freq,dur){
if(!P.soundOn)return;
if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();
const osc=audioCtx.createOscillator();
const gain=audioCtx.createGain();
osc.connect(gain);gain.connect(audioCtx.destination);
osc.frequency.value=freq;
gain.gain.setValueAtTime(0.1,audioCtx.currentTime);
gain.gain.exponentialRampToValueAtTime(0.01,audioCtx.currentTime+dur/1000);
osc.start();osc.stop(audioCtx.currentTime+dur/1000);
}
function playSound(name){if(SOUNDS[name])SOUNDS[name]();}

// ===== VICTORY CELEBRATION =====
function showVictoryCelebration(){
const confetti=document.createElement('div');
confetti.className='victory-confetti';
const colors=['#ff0080','#ff8c00','#ffd700','#00ff00','#00bcd4','#9b59b6'];
for(let i=0;i<50;i++){
const piece=document.createElement('div');
piece.className='confetti';
piece.style.left=Math.random()*100+'%';
piece.style.background=colors[Math.floor(Math.random()*colors.length)];
piece.style.animationDelay=Math.random()*2+'s';
piece.style.transform=`rotate(${Math.random()*360}deg)`;
confetti.appendChild(piece);
}
document.body.appendChild(confetti);
playSound('victory');
setTimeout(()=>confetti.remove(),3000);
}

// ===== TROOP TRAILS =====
function addTroopTrail(x,y,side){
const a=document.getElementById('arena');
if(!a)return;
const trail=document.createElement('div');
trail.className='troop-trail';
trail.style.left=(x-4)+'px';
trail.style.top=(y-4)+'px';
trail.style.background=side==='player'?'rgba(52,152,219,0.6)':'rgba(231,76,60,0.6)';
a.appendChild(trail);
setTimeout(()=>trail.remove(),500);
}

// ===== 2v2 MODE =====
const PARTNER_NAMES=['RoyalBot','KnightAI','DragonHelper','ElitePartner','ChampBot'];
function start2v2Battle(){
B.is2v2=true;
B.partner={name:PARTNER_NAMES[Math.floor(Math.random()*PARTNER_NAMES.length)],deck:[...P.deck].sort(()=>0.5-Math.random()).slice(0,4)};
document.getElementById('partnerName').textContent=B.partner.name;
}

// ===== DRAFT MODE =====
let draftPool=[];
let draftPicks=[];
let draftInProgress=false;
function startDraftMode(){
// Shuffle using Fisher-Yates for reliable randomization
const troops=CARDS.filter(c=>c.type==='troop');
for(let i=troops.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[troops[i],troops[j]]=[troops[j],troops[i]];}
draftPool=troops.slice(0,16);
draftPicks=[];
draftInProgress=true;
showDraftModal();
}
function showDraftModal(){
if(draftPicks.length>=8){
// Draft complete - set up deck and start battle
P.deck=[...draftPicks];
save();
document.querySelectorAll('.draft-modal').forEach(m=>m.remove());
draftInProgress=false;
currentGameMode='normal';
// Small delay to ensure DOM is ready
setTimeout(()=>{startBattle();},100);
return;
}
// Get remaining cards not yet picked
const available=draftPool.filter(c=>!draftPicks.includes(c.id)).slice(0,4);
if(available.length===0){
// Fallback if somehow no cards available
showNotify('Draft error - not enough cards!','error');
draftInProgress=false;
return;
}
const modal=document.createElement('div');
modal.className='draft-modal';
modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:500;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px';
modal.innerHTML=`<div style="font-family:'Lilita One';font-size:24px;color:var(--gold);margin-bottom:20px">🎲 Pick a Card (${draftPicks.length+1}/8)</div><div class="draft-pool">${available.map(c=>`<div class="draft-card game-card ${c.rarity}" onclick="draftPick('${c.id}')" style="cursor:pointer"><div class="cost">${c.cost}</div><div class="icon">${c.icon}</div><div class="name">${c.name}</div></div>`).join('')}</div><div style="margin-top:20px;color:#888;font-size:12px">Tap a card to add it to your draft deck</div>`;
document.body.appendChild(modal);
}
function draftPick(cardId){
if(!draftInProgress)return;
if(draftPicks.includes(cardId))return; // Prevent duplicate picks
draftPicks.push(cardId);
document.querySelectorAll('.draft-modal').forEach(m=>m.remove());
playSound('click');
showDraftModal();
}

// ===== SEASON SYSTEM =====
function getSeasonTimeRemaining(){
const now=new Date();
const endOfMonth=new Date(now.getFullYear(),now.getMonth()+1,0);
const diff=endOfMonth-now;
return Math.ceil(diff/(1000*60*60*24));
}
function checkSeasonReset(){
const seasonKey='season_'+new Date().getMonth();
if(!P.lastSeason||P.lastSeason!==seasonKey){
if(P.lastSeason){
const resetTrophies=Math.max(4000,Math.floor(P.tr*0.5));
const bonus=Math.floor((P.tr-resetTrophies)*0.1);
P.gold+=bonus*10;
P.starPoints+=bonus;
P.tr=resetTrophies;
showNotify('🔄 Season Reset!\nTrophies: '+resetTrophies+' | +'+bonus*10+' gold +'+bonus+' star points!','info');
}
P.lastSeason=seasonKey;
P.weeklyProgress={};
save();
}}
checkSeasonReset();

// ===== CARD FAVORITES =====
function toggleFavorite(cardId){
const idx=P.favorites.indexOf(cardId);
if(idx>=0)P.favorites.splice(idx,1);
else P.favorites.push(cardId);
save();updateCards();
}

// ===== UPDATE GOTAB =====
const oldGoTab=goTab;
function goTab(t){
try{
document.querySelectorAll('.tab').forEach(el=>el.classList.remove('on'));
document.querySelectorAll('.nav-btn').forEach(el=>el.classList.remove('on'));
const tab=document.getElementById('tab'+t);
if(tab)tab.classList.add('on');
const tabs=['Play','Cards','Clan','Pass','Shop','Chests','Log','Stats'];
const idx=tabs.indexOf(t);
if(idx>=0)document.querySelectorAll('.nav-btn')[idx]?.classList.add('on');
try{
if(t==='Play'){updatePlay();updateMedalsStats();updateSpinWheel();}
if(t==='Cards'){updateCards();updateKingTowerUI();updatePrincessUI();}
if(t==='Chests')updateChests();
if(t==='Shop')updateShop();
if(t==='Wild')updateWild();
if(t==='Daily'){updateDaily();updateWeeklyQuests();}
if(t==='Leaderboard'){updateLeaderboard();updateCompetitive();}
if(t==='Stats')updateStats();
if(t==='Clan')updateClan();
if(t==='Pass')updateBattlePass();
if(t==='Log')updateBattleLog();
if(t==='Road')updateRoad();
if(t==='Arena')updateArena();
if(t==='Emotes')updateEmotesGrid();
if(t==='Towers')updateTowerSkinsGrid();
if(t==='StarShop')renderStarShop();
if(t==='Titles')updateTitlesTab();
if(t==='MedalsLB')updateMedalsLB();
if(t==='Meta')updateMetaDecks();
if(t==='Boss')updateBossMode();
if(t==='CashShop')updateCashShop();
}catch(e){console.error('Tab update error for '+t+':',e);}
}catch(e){console.error('goTab error:',e);}
}

// ===== EMOTES MANAGEMENT =====
function isEmoteUnlocked(emote){
  if(emote.unlocked)return true;
  if(P.unlockedEmotes.includes(emote.id))return true;
  if(emote.tier&&P.bpLevel>=emote.tier&&(!emote.premium||P.bpPremium))return true;
  return false;
}

function updateEmotesGrid(){
  const deck=document.getElementById('emoteDeck');
  const unlocked=document.getElementById('unlockedEmotesGrid');
  const locked=document.getElementById('lockedEmotesGrid');
  if(!deck||!unlocked||!locked)return;
  // Update emote deck display
  deck.innerHTML='';
  for(let i=0;i<4;i++){
    const emoteId=P.equippedEmotes[i];
    const emote=ALL_EMOTES.find(e=>e.id===emoteId);
    const slot=document.createElement('div');
    slot.style.cssText='width:50px;height:50px;background:linear-gradient(145deg,#243447,#1b2838);border:2px solid var(--gold);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:28px;cursor:pointer;position:relative';
    if(emote){
      slot.textContent=emote.icon;
      slot.onclick=()=>removeEmoteFromDeck(i);
      const removeBtn=document.createElement('div');
      removeBtn.style.cssText='position:absolute;top:-5px;right:-5px;width:16px;height:16px;background:var(--red);border:2px solid #fff;border-radius:50%;font-size:10px;display:flex;align-items:center;justify-content:center';
      removeBtn.textContent='×';
      slot.appendChild(removeBtn);
    }else{
      slot.textContent='+';
      slot.style.color='#666';
    }
    deck.appendChild(slot);
  }
  // Update unlocked/locked grids
  unlocked.innerHTML='';locked.innerHTML='';
  ALL_EMOTES.forEach(emote=>{
    const isUnlocked=isEmoteUnlocked(emote);
    const inDeck=P.equippedEmotes.includes(emote.id);
    const div=document.createElement('div');
    div.style.cssText='width:100%;aspect-ratio:1;background:linear-gradient(145deg,#243447,#1b2838);border:2px solid '+(inDeck?'var(--green)':'#4a6278')+';border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;position:relative';
    div.innerHTML=`<span style="font-size:24px">${emote.icon}</span><span style="font-size:7px;color:#888">${emote.name}</span>`;
    if(isUnlocked){
      div.onclick=()=>selectEmote(emote.id);
      if(inDeck)div.innerHTML+=`<div style="position:absolute;top:2px;right:2px;font-size:8px">✓</div>`;
      unlocked.appendChild(div);
    }else{
      div.style.opacity='0.5';
      div.innerHTML+=`<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:16px">🔒</div>`;
      const req=emote.tier?`Tier ${emote.tier}`:(emote.premium?'Premium':'');
      div.innerHTML+=`<span style="font-size:6px;color:#ff6b6b;position:absolute;bottom:2px">${req}</span>`;
      locked.appendChild(div);
    }
  });
}

function selectEmote(emoteId){
  if(P.equippedEmotes.includes(emoteId)){
    const idx=P.equippedEmotes.indexOf(emoteId);
    P.equippedEmotes[idx]=null;
  }else{
    const emptySlot=P.equippedEmotes.findIndex(e=>!e);
    if(emptySlot>=0)P.equippedEmotes[emptySlot]=emoteId;
    else P.equippedEmotes[0]=emoteId;
  }
  save();updateEmotesGrid();playSound('click');
}

function removeEmoteFromDeck(idx){
  P.equippedEmotes[idx]=null;
  save();updateEmotesGrid();playSound('click');
}

// ===== TOWER SKINS MANAGEMENT =====
function isTowerSkinUnlocked(skin){
  if(skin.unlocked)return true;
  if(P.unlockedTowerSkins.includes(skin.id))return true;
  if(skin.tier&&P.bpLevel>=skin.tier&&(!skin.premium||P.bpPremium))return true;
  // Non-premium skins can also unlock via trophies (tier * 100 trophies)
  if(skin.tier&&!skin.premium&&P.tr>=(skin.tier*100))return true;
  return false;
}

function updateTowerSkinsGrid(){
  const equipped=document.getElementById('equippedTowerDisplay');
  const unlocked=document.getElementById('unlockedTowerGrid');
  const locked=document.getElementById('lockedTowerGrid');
  if(!equipped||!unlocked||!locked)return;
  const currentSkin=TOWER_SKINS.find(s=>s.id===P.equippedTowerSkin)||TOWER_SKINS[0];
  equipped.innerHTML=`<div class="tower-skin-card equipped" style="background:linear-gradient(145deg,#243447,#1b2838);border:3px solid var(--gold);border-radius:12px;padding:15px;text-align:center;min-width:120px">
    <div style="font-size:40px">${currentSkin.icon}</div>
    <div style="font-weight:800;font-size:12px;color:var(--gold)">${currentSkin.name}</div>
    <div style="font-size:9px;color:#888">${currentSkin.desc}</div>
  </div>`;
  unlocked.innerHTML='';locked.innerHTML='';
  TOWER_SKINS.forEach(skin=>{
    const isUnlocked=isTowerSkinUnlocked(skin);
    const isEquipped=P.equippedTowerSkin===skin.id;
    const div=document.createElement('div');
    div.className='tower-skin-card';
    div.style.cssText='background:linear-gradient(145deg,#243447,#1b2838);border:2px solid '+(isEquipped?'var(--gold)':'#4a6278')+';border-radius:10px;padding:10px;text-align:center;cursor:pointer;position:relative';
    div.innerHTML=`<div style="font-size:28px">${skin.icon}</div><div style="font-weight:800;font-size:10px;margin-top:5px">${skin.name}</div><div style="font-size:8px;color:#888">${skin.desc}</div>`;
    if(isUnlocked){
      div.onclick=()=>selectTowerSkin(skin.id);
      if(isEquipped)div.innerHTML+=`<div style="position:absolute;top:5px;right:5px;background:var(--gold);border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:10px">✓</div>`;
      unlocked.appendChild(div);
    }else{
      div.style.opacity='0.5';
      div.innerHTML+=`<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:24px">🔒</div>`;
      const req=skin.tier?(skin.premium?`BP Tier ${skin.tier} (Premium)`:`${skin.tier*100}🏆 or BP Tier ${skin.tier}`):'';
      div.innerHTML+=`<div style="font-size:8px;color:#ff6b6b;margin-top:5px">${req}</div>`;
      locked.appendChild(div);
    }
  });
}

function selectTowerSkin(skinId){
  P.equippedTowerSkin=skinId;
  save();updateTowerSkinsGrid();playSound('upgrade');
}

// ===== UPDATE GAME MODE BTN =====
const oldSetGameModeBtn=setGameModeBtn;
function setGameModeBtn(mode){
currentGameMode=mode;
document.querySelectorAll('.mode-card,.mode-chip').forEach(b=>{b.classList.remove('active');b.style.border='2px solid transparent';});
const btn=document.getElementById('mode'+mode.charAt(0).toUpperCase()+mode.slice(1))||document.getElementById('modeNormal');
if(btn){btn.classList.add('active');btn.style.border='2px solid #fff';}
document.getElementById('partnerDisplay').style.display=mode==='2v2'?'block':'none';
document.getElementById('medalsStats').style.display=mode==='medals'?'block':'none';
document.getElementById('compStats').style.display=mode==='comp'?'block':'none';
const battleBtn=document.getElementById('battleBtn');
if(mode==='2v2'){battleBtn.innerHTML='👥 2v2 BATTLE!';}
else if(mode==='draft'){battleBtn.innerHTML='🎲 DRAFT BATTLE!';}
else if(mode==='chaos'){battleBtn.innerHTML='💥 CHAOS BATTLE!';}
else if(mode==='test'){battleBtn.innerHTML='🧪 TESTING ZONE!';}
else if(mode==='medals'){battleBtn.innerHTML='🏅 FIND MATCH!';}
else{battleBtn.innerHTML='⚔️ BATTLE!';}
updateMedalsStats();
}
// Medals queue system
let queueInterval=null;
let queueTime=0;
function startMedalsQueue(){
document.getElementById('queueOverlay').style.display='flex';
queueTime=0;
const targetTime=3+Math.random()*5;
queueInterval=setInterval(()=>{
queueTime+=0.5;
const mins=Math.floor(queueTime/60);
const secs=Math.floor(queueTime%60);
document.getElementById('queueTimer').textContent=mins+':'+(secs<10?'0':'')+secs;
document.getElementById('queueProgress').style.width=Math.min(100,(queueTime/targetTime)*100)+'%';
if(queueTime>=targetTime){
clearInterval(queueInterval);
document.getElementById('queueOverlay').style.display='none';
startMedalsBattle();
}
},500);
}
function cancelQueue(){
if(queueInterval)clearInterval(queueInterval);
document.getElementById('queueOverlay').style.display='none';
}
function startMedalsBattle(){
if(P.deck.length<8)randomDeck();
const arena=getArena(P.medals*50);
const botLvl=Math.min(13,Math.max(1,Math.floor(P.medals/100)+5));
const botMult=1+(Math.min(botLvl,15)-1)*0.12;
const botCards=CARDS.filter(c=>c.type==='troop').sort(()=>0.5-Math.random()).slice(0,8);
B={on:true,elixir:5,botElixir:5,hand:[],queue:[...P.deck].sort(()=>0.5-Math.random()),next:null,sel:-1,troops:[],towers:{pL:{hp:getPrincessHP(),max:getPrincessHP(),dead:0},pR:{hp:getPrincessHP(),max:getPrincessHP(),dead:0},pK:{hp:getKingTowerHP(),max:getKingTowerHP(),dead:0},aL:{hp:Math.floor(getPrincessHP()*botMult),max:Math.floor(getPrincessHP()*botMult),dead:0},aR:{hp:Math.floor(getPrincessHP()*botMult),max:Math.floor(getPrincessHP()*botMult),dead:0},aK:{hp:Math.floor(getKingTowerHP()*botMult),max:Math.floor(getKingTowerHP()*botMult),dead:0}},tCD:{pL:0,pR:0,pK:0,aL:0,aR:0,aK:0},kingOn:{p:0,a:0},crowns:{me:0,ai:0},time:0,arena,botLvl,botMult,botCards,botHand:[],botQueue:[...botCards],loop:null,gameMode:'medals',spellEffects:[],troopPoisons:[],cardCycle:[],buildings:[],elixirPumps:[]};
for(let i=0;i<4;i++)B.hand.push(B.queue.shift());
B.next=B.queue.shift();
for(let i=0;i<4;i++)B.botHand.push(B.botQueue.shift());
B.botNext=B.botQueue.shift();
document.getElementById('battle').classList.add('on');
try{if(document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(()=>{});}catch(e){}
renderArena();startLoop();
}
function updateMedalsStats(){
const ms=document.getElementById('dispMedals');
const mw=document.getElementById('dispMedalsW');
const ml=document.getElementById('dispMedalsL');
const mh=document.getElementById('dispMedalsHigh');
if(ms)ms.textContent=P.medals||0;
if(mw)mw.textContent=P.medalsWins||0;
if(ml)ml.textContent=P.medalsLosses||0;
if(mh)mh.textContent=P.medalsHighest||0;
}

// ===== LUCKY SPIN WHEEL SYSTEM =====
const SPIN_REWARDS=[
{id:0,icon:'💰',name:'500 Gold',gold:500,weight:20},
{id:1,icon:'💎',name:'10 Gems',gems:10,weight:15},
{id:2,icon:'💰',name:'1,000 Gold',gold:1000,weight:18},
{id:3,icon:'📦',name:'Silver Chest',chest:'silver',weight:12},
{id:4,icon:'💰',name:'2,000 Gold',gold:2000,weight:14},
{id:5,icon:'💎',name:'25 Gems',gems:25,weight:10},
{id:6,icon:'👑',name:'JACKPOT!',gold:10000,gems:100,chest:'gold',weight:3},
{id:7,icon:'💰',name:'800 Gold',gold:800,weight:18}
];

let isSpinning=false;
let spinRotation=0;

function canSpin(){
if(!P.lastSpinTime)return true;
const now=Date.now();
const cooldown=4*60*60*1000; // 4 hours
return (now-P.lastSpinTime)>=cooldown;
}

function getSpinTimeLeft(){
if(!P.lastSpinTime)return 0;
const now=Date.now();
const cooldown=4*60*60*1000;
const elapsed=now-P.lastSpinTime;
return Math.max(0,cooldown-elapsed);
}

function getRandomReward(){
const totalWeight=SPIN_REWARDS.reduce((sum,r)=>sum+r.weight,0);
let random=Math.random()*totalWeight;
for(const reward of SPIN_REWARDS){
random-=reward.weight;
if(random<=0)return reward;
}
return SPIN_REWARDS[0];
}

function spinWheel(){
if(isSpinning||!canSpin())return;
isSpinning=true;
const wheel=document.getElementById('spinWheel');
const btn=document.getElementById('spinBtn');
if(!wheel||!btn)return;
btn.disabled=true;
btn.classList.add('spinning');
btn.textContent='🎲 Spinning...';
playSound('click');
// Get reward and calculate rotation
const reward=getRandomReward();
const segmentAngle=360/8;
const targetSegment=reward.id;
const baseRotation=360*5; // 5 full rotations
const targetAngle=360-(targetSegment*segmentAngle)-(segmentAngle/2);
spinRotation+=baseRotation+targetAngle+(Math.random()*20-10);
wheel.style.transform=`rotate(${spinRotation}deg)`;
// After spin completes
setTimeout(()=>{
isSpinning=false;
btn.classList.remove('spinning');
P.lastSpinTime=Date.now();
P.totalSpins=(P.totalSpins||0)+1;
// Give rewards
if(reward.gold)P.gold+=reward.gold;
if(reward.gems)P.gems+=reward.gems;
if(reward.chest){const ct=CHEST_TYPES.find(t=>t.id===reward.chest);if(ct)addChest(ct);}
save();
// Show reward popup
showSpinReward(reward);
updateSpinWheel();
},4200);
}

function showSpinReward(reward){
playSound('select');
const popup=document.createElement('div');
popup.className='spin-result';
popup.innerHTML=`
<div style="font-size:80px;animation:bounce 0.6s">${reward.icon}</div>
<div style="font-family:'Lilita One';font-size:28px;color:#ffd700;margin:20px 0">${reward.name}</div>
<div style="background:linear-gradient(145deg,#1b2838,#243447);border:2px solid var(--gold);border-radius:12px;padding:20px 30px;text-align:center">
${reward.gold?`<div style="font-size:20px;margin:8px 0">💰 +${reward.gold.toLocaleString()} Gold</div>`:''}
${reward.gems?`<div style="font-size:20px;margin:8px 0">💎 +${reward.gems} Gems</div>`:''}
${reward.chest?`<div style="font-size:20px;margin:8px 0">📦 +${reward.chest.charAt(0).toUpperCase()+reward.chest.slice(1)} Chest!</div>`:''}
</div>
${reward.id===6?'<div style="font-size:14px;color:#ffd700;margin-top:15px;animation:pulse 1s infinite">🎉 JACKPOT WINNER! 🎉</div>':''}
<button onclick="this.parentElement.remove();updateShop();updateChests();" style="margin-top:25px;padding:14px 40px;background:linear-gradient(180deg,#ffd700,#ff8c00);border:none;border-radius:12px;font-family:'Lilita One';font-size:18px;color:#000;cursor:pointer;font-weight:900">Collect!</button>
`;
document.body.appendChild(popup);
}

function updateSpinWheel(){
const btn=document.getElementById('spinBtn');
const timerEl=document.getElementById('spinTimer');
const freeLabel=document.getElementById('spinFreeLabel');
if(!btn||!timerEl)return;
const canSpinNow=canSpin();
const timeLeft=getSpinTimeLeft();
btn.disabled=!canSpinNow;
btn.textContent=canSpinNow?'🎲 SPIN!':'⏳ Wait...';
if(freeLabel){
freeLabel.textContent=canSpinNow?'FREE!':'USED';
freeLabel.classList.toggle('used',!canSpinNow);
}
if(timeLeft>0){
const hours=Math.floor(timeLeft/(60*60*1000));
const mins=Math.floor((timeLeft%(60*60*1000))/(60*1000));
const secs=Math.floor((timeLeft%(60*1000))/1000);
timerEl.textContent=`Next free spin in: ${hours}h ${mins}m ${secs}s`;
timerEl.style.display='block';
}else{
timerEl.style.display='none';
}
}

// Update spin timer every second
setInterval(updateSpinWheel,1000);

// Initialize spin data
if(!P.totalSpins)P.totalSpins=0;

// ===== UPDATE START BATTLE =====
const oldStartBattle=startBattle;
function startBattle(){
if(currentGameMode==='medals'){startMedalsQueue();return;}
if(currentGameMode==='draft'){startDraftMode();return;}
// Handle custom game mode with draft
if(currentGameMode==='custom'&&activeCustomMode&&activeCustomMode.draftMode){startDraftMode();return;}
if(P.deck.length<8)randomDeck();
const isTestMode=currentGameMode==='test';
const isCustomMode=currentGameMode==='custom'&&activeCustomMode;
const cm=activeCustomMode||{};
const arena=getArena(currentGameMode==='comp'?P.compTrophies:P.tr);
let botLvl=getBotLvl(currentGameMode==='comp'?P.compTrophies:P.tr);
if(isCustomMode&&cm.botLevel>0)botLvl=cm.botLevel;
let botMult=1+(Math.min(botLvl,15)-1)*0.10;
if(isCustomMode)botMult=botMult*(cm.botMult||100)/100;
const botCards=CARDS.filter(c=>c.type==='troop').sort(()=>0.5-Math.random()).slice(0,8);
// Pick opponent from leaderboard based on trophy range
const playerTr=currentGameMode==='comp'?P.compTrophies:P.tr;
const trophyRange=500;
const nearbyBots=P.lbBots.filter(b=>Math.abs(b.trophies-playerTr)<=trophyRange);
const opponent=nearbyBots.length>0?nearbyBots[Math.floor(Math.random()*nearbyBots.length)]:P.lbBots[Math.floor(Math.random()*P.lbBots.length)];
const opponentName=isCustomMode?(cm.icon+' '+cm.name+' Bot'):(opponent?opponent.name:BOT_NAMES[Math.floor(Math.random()*BOT_NAMES.length)]);
const opponentTrophies=opponent?opponent.trophies:playerTr;

// Calculate tower HP with custom mode modifiers
let basePrincessHP=getPrincessHP();
let baseKingHP=getKingTowerHP();
if(isCustomMode){
  basePrincessHP=Math.floor(basePrincessHP*(cm.towerHP||100)/100);
  baseKingHP=Math.floor(baseKingHP*(cm.kingHP||100)/100);
  if(cm.suddenDeath){basePrincessHP=1;baseKingHP=1;}
}
// AI towers - in test mode give them lots of HP to be punching bags
const aiPrincessHP=isTestMode?99999:(isCustomMode&&cm.botDisabled)?99999:Math.floor(basePrincessHP*botMult);
const aiKingHP=isTestMode?99999:(isCustomMode&&cm.botDisabled)?99999:Math.floor(baseKingHP*botMult);
// Starting elixir
let startElixir=isTestMode?10:5;
if(isCustomMode){
  startElixir=cm.startFull?(cm.maxElixir||10):(cm.startElixir||5);
  if(cm.infiniteElixir)startElixir=cm.maxElixir||10;
}
B={on:true,elixir:startElixir,botElixir:5,hand:[],queue:[...P.deck].sort(()=>0.5-Math.random()),next:null,sel:-1,troops:[],towers:{pL:{hp:basePrincessHP,max:basePrincessHP,dead:0},pR:{hp:basePrincessHP,max:basePrincessHP,dead:0},pK:{hp:baseKingHP,max:baseKingHP,dead:0},aL:{hp:aiPrincessHP,max:aiPrincessHP,dead:0},aR:{hp:aiPrincessHP,max:aiPrincessHP,dead:0},aK:{hp:aiKingHP,max:aiKingHP,dead:0}},tCD:{pL:0,pR:0,pK:0,aL:0,aR:0,aK:0},kingOn:{p:0,a:0},crowns:{me:0,ai:0},time:0,arena,botLvl,botMult,botCards,botHand:[],botQueue:[...botCards],loop:null,gameMode:currentGameMode,is2v2:currentGameMode==='2v2',isTest:isTestMode,isCustom:isCustomMode,customMode:cm,spellEffects:[],troopPoisons:[],elixirPumps:[],buildings:[],opponentName,opponentTrophies};
for(let i=0;i<4;i++)B.hand.push(B.queue.shift());
B.next=B.queue.shift();
for(let i=0;i<4;i++)B.botHand.push(B.botQueue.shift());
B.botNext=B.botQueue.shift();
if(B.is2v2)start2v2Battle();
document.getElementById('battle').classList.add('on');
try{if(document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(()=>{});}catch(e){}
renderArena();startLoop();
playSound('click');
// Show custom mode notification
if(isCustomMode)showNotify(`${cm.icon} ${cm.name}\n${cm.desc}`,'info');
}

// ===== UPDATE END BATTLE =====
function endBattle(won){
B.on=false;if(B.loop)cancelAnimationFrame(B.loop);
// TOURNAMENT MODE - Handle tournament battles separately
if(B&&B.isTournament){
const crowns=B.crowns.me;
endTournamentBattle(won);
const ov=document.createElement('div');ov.className='result-overlay';
ov.innerHTML=`<div class="result-title ${won?'win':'lose'}">${won?'🏆 VICTORY!':'💀 DEFEAT!'}</div>
<div style="color:var(--gold);font-size:14px;font-weight:900;margin-bottom:10px">🏆 TOURNAMENT MATCH</div>
<div class="result-crowns"><span class="crown ${crowns>=1?'earned':''}">👑</span><span class="crown ${crowns>=2?'earned':''}">👑</span><span class="crown ${crowns>=3?'earned':''}">👑</span></div>
<div class="result-btns">
<button class="result-btn primary" onclick="closeResult();showTournaments()">📊 View Tournament</button>
<button class="result-btn secondary" onclick="closeResult()">🏠 Menu</button>
</div>`;
document.body.appendChild(ov);
playSound(won?'victory':'defeat');
return;
}
// TEST MODE - No rewards, just show complete screen
if(B.isTest){const ov=document.createElement('div');ov.className='result-overlay';ov.innerHTML=`<div class="result-title" style="color:#00ff88">🧪 TEST COMPLETE</div><div style="color:#aaa;margin:20px 0">Testing Zone - No rewards or trophies</div><div class="result-btns"><button class="result-btn primary" onclick="closeResult()">🏠 Menu</button><button class="result-btn secondary" onclick="rematch()">🔄 Test Again</button></div>`;document.body.appendChild(ov);return;}
const crowns=B.crowns.me,isComp=B.gameMode==='comp',isChaos=B.gameMode==='chaos',is2v2=B.is2v2,isMedals=B.gameMode==='medals';
let tr=0,gold=0,gems=0,chestAwarded=null,medalsGain=0;
const botName=BOT_NAMES[Math.floor(Math.random()*BOT_NAMES.length)];
if(isMedals){if(won){P.medalsWins++;medalsGain=30;P.medals+=30;gold=800;gems=15;}else{P.medalsLosses++;medalsGain=-15;P.medals=Math.max(0,P.medals-15);}P.medalsHighest=Math.max(P.medalsHighest,P.medals);}
else if(isComp){if(won){P.compWins++;P.compTrophies++;gold=500;gems=10;}else{P.compLosses++;}}
else if(isChaos){gold=won?2000:500;gems=won?20:5;tr=won?Math.floor(P.trophyGainPerWin*1.5):-Math.floor(P.trophyGainPerWin/4);}
else if(is2v2){gold=won?1500:300;gems=won?15:3;tr=won?Math.floor(P.trophyGainPerWin*0.8):-Math.floor(P.trophyGainPerWin/3);P.weeklyProgress.wq_2v2_5=(P.weeklyProgress.wq_2v2_5||0)+(won?1:0);}
else{tr=won?P.trophyGainPerWin:-Math.floor(P.trophyGainPerWin/2);gold=won?P.trophyGainPerWin*40+crowns*80:crowns*20;gems=won?Math.floor(Math.random()*5)+3:0;
if(won){const r=Math.random();const chestType=crowns>=3&&r<0.1?CHEST_TYPES[4]:crowns>=3&&r<0.2?CHEST_TYPES[3]:crowns>=2&&r<0.4?CHEST_TYPES[2]:r<0.6?CHEST_TYPES[1]:CHEST_TYPES[0];if(addChest(chestType))chestAwarded=chestType;}}
if(!isComp){P.tr=Math.max(0,P.tr+tr);const newArena=getArena(P.tr);const oldArena=getArena(P.tr-tr);if(newArena!==oldArena&&tr>0)showRankUp(newArena);}
if(won){P.wins++;P.streak++;P.maxStr=Math.max(P.maxStr,P.streak);P.challengeProgress.ch_wins=(P.challengeProgress.ch_wins||0)+1;P.weeklyProgress.wq_wins10=(P.weeklyProgress.wq_wins10||0)+1;addBpXp(150);showVictoryCelebration();const wcReward=Math.floor(Math.random()*3)+1;P.royalWildCards=(P.royalWildCards||0)+wcReward;}else{P.losses++;P.streak=0;addBpXp(10);playSound('defeat');}
consumeWorkshopBoosts();
P.challengeProgress.ch_crowns=(P.challengeProgress.ch_crowns||0)+crowns;
P.weeklyProgress.wq_crowns30=(P.weeklyProgress.wq_crowns30||0)+crowns;
// Apply gold multiplier from Pass Royale
gold=Math.floor(gold*getGoldMultiplier());
P.gold+=gold;P.gems+=gems;P.crowns+=crowns;
// Add crowns to crown chest progress
addCrownChestProgress(crowns);
// Add to battle log
addToBattleLog(won,botName+(is2v2?' & Partner':''),crowns,tr,B.gameMode);
// Add mastery
B.troops.filter(t=>t.side==='player').forEach(t=>{if(t.card)addMastery(t.card.id,10);});
// Add star points for wins
if(won)P.starPoints+=crowns*10;
save();
// Trigger cool features on victory
if(won&&crowns>=2){
  // 20% chance for loot drop animation on 2+ crown wins
  if(Math.random()<0.20){
    const bonusItems=[{icon:'⭐',amount:crowns*10,label:'Star Points',rarity:'rare'}];
    if(chestAwarded)bonusItems.push({icon:chestAwarded.icon,amount:1,label:chestAwarded.name,rarity:'epic'});
    showVictoryLootDrop(gold,gems,bonusItems);
  }
  // 10% chance for FREE treasure hunt bonus after win
  if(Math.random()<0.10){
    showNotify('🎁 BONUS!\nYou won a FREE Treasure Hunt!', 'epic');
    setTimeout(()=>showTreasureHunt(true),3000);
  }
}
const ov=document.createElement('div');ov.className='result-overlay';
const wcGained=won?Math.floor(Math.random()*3)+1:0;
ov.innerHTML=`<div class="result-title ${won?'win':'lose'}">${won?'🏆 VICTORY!':'💀 DEFEAT!'}</div>${is2v2?`<div style="color:var(--blue);font-size:14px;font-weight:900;margin-bottom:10px">👥 2v2 MODE</div>`:isChaos?`<div style="color:#ff0080;font-size:14px;font-weight:900;margin-bottom:10px">💥 CHAOS MODE</div>`:isComp?`<div style="color:#ff0080;font-size:14px;font-weight:900;margin-bottom:10px">🔥 COMPETITIVE</div>`:`<div class="result-crowns"><span class="crown ${crowns>=1?'earned':''}">👑</span><span class="crown ${crowns>=2?'earned':''}">👑</span><span class="crown ${crowns>=3?'earned':''}">👑</span></div>`}${chestAwarded?`<div style="font-size:36px;margin-bottom:8px">${chestAwarded.icon}</div><div style="color:var(--gold);font-weight:800;margin-bottom:12px">+${chestAwarded.name} Chest!</div>`:''}<div class="result-rewards">${tr?`<div class="result-row"><span class="label">Trophies</span><span class="value ${tr>=0?'positive':'negative'}">${tr>=0?'+':''}${tr}</span></div>`:''}<div class="result-row"><span class="label">Gold</span><span class="value positive">+${gold}</span></div>${gems>0?`<div class="result-row"><span class="label">Gems</span><span class="value positive">+${gems}</span></div>`:''}${won?`<div class="result-row"><span class="label">🃏 Wild Cards</span><span class="value positive" style="color:#ff6b6b">+${wcGained}</span></div>`:''}<div class="result-row"><span class="label">Battle Pass XP</span><span class="value positive">+${won?150:10}</span></div></div><div class="result-btns"><button class="result-btn primary" onclick="closeResult()">🏠 Menu</button><button class="result-btn secondary" onclick="rematch()">⚔️ Again</button></div>`;
document.body.appendChild(ov);
}

// ===== TOURNAMENT SYSTEM =====
const TOURNAMENTS=[
{id:'daily',name:'Daily Challenge',icon:'📅',type:'challenge',entry:'free',maxWins:12,maxLosses:3,rewards:{gold:5000,gems:100,chest:'legendary'},minTrophies:0},
{id:'classic',name:'Classic Challenge',icon:'🏆',type:'challenge',entry:{gems:10},maxWins:12,maxLosses:3,rewards:{gold:2000,gems:50,chest:'giant'},minTrophies:0},
{id:'grand',name:'Grand Challenge',icon:'👑',type:'challenge',entry:{gems:100},maxWins:12,maxLosses:3,rewards:{gold:22000,gems:250,chest:'legendary'},minTrophies:0},
{id:'bracket8',name:'8-Player Bracket',icon:'🎯',type:'bracket',entry:{gems:50},players:8,rewards:{gold:10000,gems:150,chest:'super'},minTrophies:1000},
{id:'bracket16',name:'16-Player Bracket',icon:'⚔️',type:'bracket',entry:{gems:100},players:16,rewards:{gold:25000,gems:300,chest:'legendary'},minTrophies:3000},
{id:'bracket32',name:'Royal Tournament',icon:'🔱',type:'bracket',entry:{gems:200},players:32,rewards:{gold:50000,gems:500,chest:'super'},minTrophies:5000}
];

// Initialize tournament data
if(!P.tournaments)P.tournaments={};
if(!P.activeTournament)P.activeTournament=null;
if(!P.tournamentHistory)P.tournamentHistory=[];

let currentTourneyTab='challenges';

function showTournaments(){
const modal=document.createElement('div');
modal.className='tournament-modal';
modal.id='tournamentModal';
modal.innerHTML=`
<button class="tourney-close" onclick="closeTournaments()">✕</button>
<div class="tournament-header">
<div class="tournament-title">🏆 TOURNAMENTS</div>
<div style="font-size:11px;color:#888">Compete for glory and rewards!</div>
</div>
<div class="tournament-tabs">
<div class="tournament-tab active" id="tabChallenges" onclick="setTourneyTab('challenges')">🎯 Challenges</div>
<div class="tournament-tab" id="tabBrackets" onclick="setTourneyTab('brackets')">⚔️ Brackets</div>
<div class="tournament-tab" id="tabHistory" onclick="setTourneyTab('history')">📜 History</div>
</div>
${P.activeTournament?renderActiveTournament():''}
<div class="tournament-list" id="tourneyList"></div>
`;
document.body.appendChild(modal);
updateTourneyList();
}

function closeTournaments(){
const modal=document.getElementById('tournamentModal');
if(modal)modal.remove();
}

function setTourneyTab(tab){
currentTourneyTab=tab;
document.querySelectorAll('.tournament-tab').forEach(t=>t.classList.remove('active'));
document.getElementById('tab'+tab.charAt(0).toUpperCase()+tab.slice(1)).classList.add('active');
updateTourneyList();
}

function updateTourneyList(){
const list=document.getElementById('tourneyList');
if(!list)return;

if(currentTourneyTab==='history'){
list.innerHTML=renderTourneyHistory();
return;
}

const type=currentTourneyTab==='challenges'?'challenge':'bracket';
const tourneys=TOURNAMENTS.filter(t=>t.type===type);

list.innerHTML=tourneys.map(t=>{
const canEnter=P.tr>=t.minTrophies;
const isActive=P.activeTournament&&P.activeTournament.id===t.id;
const entryText=t.entry==='free'?'FREE':t.entry.gems?`💎 ${t.entry.gems}`:'';

return`<div class="tourney-card${isActive?' active':''}${!canEnter?' locked':''}" onclick="${canEnter&&!isActive?`enterTournament('${t.id}')`:''}">
<div class="tourney-header">
<div class="tourney-name">${t.icon} ${t.name}</div>
<div class="tourney-status ${isActive?'ongoing':canEnter?'open':'finished'}">${isActive?'IN PROGRESS':canEnter?'OPEN':'🔒 '+t.minTrophies+'🏆'}</div>
</div>
<div class="tourney-info">
${t.type==='challenge'?`<span>🎯 ${t.maxWins} Wins to Complete</span><span>❌ ${t.maxLosses} Losses = Out</span>`:`<span>👥 ${t.players} Players</span><span>🏅 Bracket Tournament</span>`}
</div>
<div class="tourney-rewards">
<div class="tourney-reward">💰 ${t.rewards.gold.toLocaleString()}</div>
<div class="tourney-reward">💎 ${t.rewards.gems}</div>
<div class="tourney-reward">${CHEST_TYPES.find(c=>c.id===t.rewards.chest)?.icon||'📦'} Chest</div>
</div>
${!isActive&&canEnter?`<button class="tourney-enter-btn${t.entry!=='free'?' gems':''}" onclick="event.stopPropagation();enterTournament('${t.id}')">${entryText==='FREE'?'⚔️ ENTER FREE':entryText+' ENTER'}</button>`:''}
${isActive?`<button class="tourney-enter-btn" onclick="event.stopPropagation();playTournamentMatch()">⚔️ PLAY NEXT MATCH</button>`:''}
</div>`;
}).join('');
}

function renderActiveTournament(){
if(!P.activeTournament)return'';
const t=TOURNAMENTS.find(x=>x.id===P.activeTournament.id);
if(!t)return'';

if(t.type==='challenge'){
return`<div class="tourney-progress">
<div class="tourney-progress-title">${t.icon} ${t.name} - ${P.activeTournament.wins}W / ${P.activeTournament.losses}L</div>
<div class="tourney-wins">
${Array(t.maxWins).fill(0).map((_,i)=>`<div class="tourney-win-dot${i<P.activeTournament.wins?' won':''}">${i<P.activeTournament.wins?'✓':''}</div>`).join('')}
</div>
<div style="display:flex;justify-content:center;gap:5px;margin-top:8px">
${Array(t.maxLosses).fill(0).map((_,i)=>`<div class="tourney-win-dot${i<P.activeTournament.losses?' lost':''}">${i<P.activeTournament.losses?'✕':''}</div>`).join('')}
</div>
</div>`;
}else{
return`<div class="tourney-progress">
<div class="tourney-progress-title">${t.icon} ${t.name} - Round ${P.activeTournament.currentRound}</div>
<div class="bracket-container">${renderBracket(t,P.activeTournament)}</div>
</div>`;
}
}

function renderBracket(tourney,state){
const players=tourney.players;
const rounds=Math.log2(players);
const roundNames=['Finals','Semifinals','Quarterfinals','Round of 16','Round of 32'];

let html='<div class="bracket">';

for(let r=rounds-1;r>=0;r--){
const matchesInRound=Math.pow(2,r);
const roundName=roundNames[r]||`Round ${rounds-r}`;
const isCurrentRound=(rounds-r)===state.currentRound;

html+=`<div class="bracket-round"><div class="round-title">${roundName}</div>`;

for(let m=0;m<matchesInRound;m++){
const matchData=state.bracket?.[rounds-r-1]?.[m];
const isPlayerMatch=matchData?.hasPlayer;
const matchPlayed=matchData?.played;
const playerWon=matchData?.playerWon;

let matchClass='bracket-match';
if(isPlayerMatch&&isCurrentRound&&!matchPlayed)matchClass+=' current';
else if(isPlayerMatch&&matchPlayed)matchClass+=playerWon?' won':' lost';

html+=`<div class="${matchClass}">`;
if(matchData){
const p1Class=matchPlayed?(matchData.winner===0?'winner':'loser'):'';
const p2Class=matchPlayed?(matchData.winner===1?'winner':'loser'):'';
html+=`<div class="match-player ${p1Class}${matchData.p1===P.name?' you':''}"><span>${matchData.p1||'TBD'}</span><span class="score">${matchPlayed?matchData.score1:'-'}</span></div>`;
html+=`<div class="match-vs">VS</div>`;
html+=`<div class="match-player ${p2Class}${matchData.p2===P.name?' you':''}"><span>${matchData.p2||'TBD'}</span><span class="score">${matchPlayed?matchData.score2:'-'}</span></div>`;
}else{
html+=`<div class="match-player"><span>TBD</span><span class="score">-</span></div>`;
html+=`<div class="match-vs">VS</div>`;
html+=`<div class="match-player"><span>TBD</span><span class="score">-</span></div>`;
}
html+=`</div>`;
}
html+=`</div>`;
}

html+=`</div>`;
return html;
}

function renderTourneyHistory(){
if(!P.tournamentHistory||P.tournamentHistory.length===0){
return'<div style="text-align:center;color:#888;padding:30px">No tournament history yet!</div>';
}
return P.tournamentHistory.slice(0,10).map(h=>{
const t=TOURNAMENTS.find(x=>x.id===h.id);
return`<div class="tourney-card" style="cursor:default">
<div class="tourney-header">
<div class="tourney-name">${t?.icon||'🏆'} ${t?.name||h.id}</div>
<div class="tourney-status ${h.won?'open':'finished'}">${h.won?'🏆 WON':'❌ LOST'}</div>
</div>
<div class="tourney-info">
<span>${h.wins}W / ${h.losses}L</span>
<span>${new Date(h.date).toLocaleDateString()}</span>
</div>
${h.won?`<div class="tourney-rewards"><div class="tourney-reward">💰 ${h.goldEarned?.toLocaleString()||0}</div><div class="tourney-reward">💎 ${h.gemsEarned||0}</div></div>`:''}
</div>`;
}).join('');
}

function enterTournament(id){
const t=TOURNAMENTS.find(x=>x.id===id);
if(!t)return;

if(P.activeTournament){
showNotify('You are already in a tournament!\nFinish it first.','info','🏆');
return;
}

// Check entry fee
if(t.entry!=='free'){
if(t.entry.gems&&P.gems<t.entry.gems){
showNotify('Not enough gems!\nNeed '+t.entry.gems+' gems.','error','💎');
return;
}
P.gems-=t.entry.gems;
}

// Create tournament state
if(t.type==='challenge'){
P.activeTournament={id:t.id,type:'challenge',wins:0,losses:0,startTime:Date.now()};
}else{
// Generate bracket with player and bots
const bracket=generateBracket(t.players);
P.activeTournament={id:t.id,type:'bracket',currentRound:1,bracket,startTime:Date.now()};
}

save();
closeTournaments();
showTournaments();
playSound('click');
}

function generateBracket(playerCount){
const rounds=Math.log2(playerCount);
const bracket=[];
const allPlayers=[P.name];

// Add bot opponents
for(let i=1;i<playerCount;i++){
allPlayers.push(BOT_NAMES[i%BOT_NAMES.length]+(i>=BOT_NAMES.length?Math.floor(i/BOT_NAMES.length):''));
}

// Shuffle but keep player in first half for fairer bracket
const playerPos=Math.floor(Math.random()*(playerCount/2));
const shuffled=allPlayers.filter(p=>p!==P.name).sort(()=>0.5-Math.random());
shuffled.splice(playerPos,0,P.name);

// Create first round matches
const round1=[];
for(let i=0;i<playerCount/2;i++){
const p1=shuffled[i*2];
const p2=shuffled[i*2+1];
const hasPlayer=p1===P.name||p2===P.name;
round1.push({p1,p2,hasPlayer,played:false,winner:null,score1:0,score2:0,playerWon:null});
}
bracket.push(round1);

// Simulate bot matches for first round (except player's match)
round1.forEach(match=>{
if(!match.hasPlayer){
match.played=true;
match.winner=Math.random()<0.5?0:1;
match.score1=match.winner===0?3:Math.floor(Math.random()*3);
match.score2=match.winner===1?3:Math.floor(Math.random()*3);
}
});

// Create subsequent rounds (empty for now)
let matchesInRound=playerCount/4;
for(let r=1;r<rounds;r++){
const roundMatches=[];
for(let m=0;m<matchesInRound;m++){
roundMatches.push({p1:null,p2:null,hasPlayer:false,played:false,winner:null,score1:0,score2:0,playerWon:null});
}
bracket.push(roundMatches);
matchesInRound/=2;
}

// Advance winners from first round
advanceBracket(bracket,0);

return bracket;
}

function advanceBracket(bracket,roundIndex){
if(roundIndex>=bracket.length-1)return;

const currentRound=bracket[roundIndex];
const nextRound=bracket[roundIndex+1];

for(let m=0;m<currentRound.length;m+=2){
const match1=currentRound[m];
const match2=currentRound[m+1];
const nextMatchIndex=Math.floor(m/2);

if(match1.played){
const winner1=match1.winner===0?match1.p1:match1.p2;
nextRound[nextMatchIndex].p1=winner1;
if(winner1===P.name)nextRound[nextMatchIndex].hasPlayer=true;
}
if(match2&&match2.played){
const winner2=match2.winner===0?match2.p1:match2.p2;
nextRound[nextMatchIndex].p2=winner2;
if(winner2===P.name)nextRound[nextMatchIndex].hasPlayer=true;
}
}
}

function playTournamentMatch(){
if(!P.activeTournament){
showNotify('No active tournament!','info','🏆');
return;
}
closeTournaments();
currentGameMode='tourney';
startTournamentBattle();
}

function startTournamentBattle(){
if(P.deck.length<8)randomDeck();
const arena=getArena(P.tr);
const t=TOURNAMENTS.find(x=>x.id===P.activeTournament.id);
const botLvl=Math.min(15,Math.max(1,Math.floor(P.tr/500)));
const botMult=1+(botLvl-1)*0.08;
const botCards=CARDS.filter(c=>c.type==='troop').sort(()=>0.5-Math.random()).slice(0,8);

B={on:true,elixir:5,botElixir:5,hand:[],queue:[...P.deck].sort(()=>0.5-Math.random()),next:null,sel:-1,troops:[],towers:{pL:{hp:getPrincessHP(),max:getPrincessHP(),dead:0},pR:{hp:getPrincessHP(),max:getPrincessHP(),dead:0},pK:{hp:getKingTowerHP(),max:getKingTowerHP(),dead:0},aL:{hp:Math.floor(getPrincessHP()*botMult),max:Math.floor(getPrincessHP()*botMult),dead:0},aR:{hp:Math.floor(getPrincessHP()*botMult),max:Math.floor(getPrincessHP()*botMult),dead:0},aK:{hp:Math.floor(getKingTowerHP()*botMult),max:Math.floor(getKingTowerHP()*botMult),dead:0}},tCD:{pL:0,pR:0,pK:0,aL:0,aR:0,aK:0},kingOn:{p:0,a:0},crowns:{me:0,ai:0},time:0,arena,botLvl,botMult,botCards,botHand:[],botQueue:[...botCards],loop:null,gameMode:'tourney',isTournament:true,spellEffects:[],troopPoisons:[],cardCycle:[],buildings:[],elixirPumps:[]};

for(let i=0;i<4;i++)B.hand.push(B.queue.shift());
B.next=B.queue.shift();
for(let i=0;i<4;i++)B.botHand.push(B.botQueue.shift());
B.botNext=B.botQueue.shift();

document.getElementById('battle').classList.add('on');
try{if(document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(()=>{});}catch(e){}
document.getElementById('botLbl').textContent='🏆 Tournament';
renderArena();
startLoop();
playSound('click');
}

function endTournamentBattle(won){
const t=TOURNAMENTS.find(x=>x.id===P.activeTournament.id);
if(!t)return;

if(t.type==='challenge'){
if(won)P.activeTournament.wins++;
else P.activeTournament.losses++;

// Check if tournament is over
if(P.activeTournament.wins>=t.maxWins){
// Won the challenge!
finishTournament(true,t);
}else if(P.activeTournament.losses>=t.maxLosses){
// Lost the challenge
finishTournament(false,t);
}
}else{
// Bracket tournament
const bracket=P.activeTournament.bracket;
const round=P.activeTournament.currentRound-1;
const playerMatch=bracket[round].find(m=>m.hasPlayer&&!m.played);

if(playerMatch){
playerMatch.played=true;
playerMatch.playerWon=won;
const playerIsP1=playerMatch.p1===P.name;
playerMatch.winner=won?(playerIsP1?0:1):(playerIsP1?1:0);
playerMatch.score1=playerIsP1?(won?3:B.crowns.me):(won?B.crowns.ai:3);
playerMatch.score2=playerIsP1?(won?B.crowns.ai:3):(won?3:B.crowns.me);

if(won){
// Advance to next round
advanceBracket(bracket,round);

// Simulate other matches in next round
if(round+1<bracket.length){
bracket[round+1].forEach(match=>{
if(!match.hasPlayer&&match.p1&&match.p2&&!match.played){
match.played=true;
match.winner=Math.random()<0.5?0:1;
match.score1=match.winner===0?3:Math.floor(Math.random()*3);
match.score2=match.winner===1?3:Math.floor(Math.random()*3);
}
});
advanceBracket(bracket,round+1);
}

P.activeTournament.currentRound++;

// Check if won finals
if(P.activeTournament.currentRound>Math.log2(t.players)){
finishTournament(true,t);
}
}else{
// Lost bracket
finishTournament(false,t);
}
}
}
save();
}

function finishTournament(won,tourney){
const history={
id:tourney.id,
won,
wins:P.activeTournament.wins||P.activeTournament.currentRound-1,
losses:P.activeTournament.losses||1,
date:Date.now(),
goldEarned:0,
gemsEarned:0
};

if(won){
// Give rewards based on wins
const multiplier=tourney.type==='challenge'?P.activeTournament.wins/tourney.maxWins:1;
const goldReward=Math.floor(tourney.rewards.gold*multiplier);
const gemsReward=Math.floor(tourney.rewards.gems*multiplier);

P.gold+=goldReward;
P.gems+=gemsReward;
history.goldEarned=goldReward;
history.gemsEarned=gemsReward;

// Add chest
const ct=CHEST_TYPES.find(c=>c.id===tourney.rewards.chest);
if(ct)addChest(ct);

// Show victory
setTimeout(()=>{
showNotify(`🏆 TOURNAMENT WON!\n+${goldReward.toLocaleString()} Gold +${gemsReward} Gems\n+${ct?.name||''} Chest!`,'epic');
},500);
}else{
// Partial rewards for challenges
if(tourney.type==='challenge'&&P.activeTournament.wins>0){
const partialGold=Math.floor(tourney.rewards.gold*0.1*P.activeTournament.wins);
const partialGems=Math.floor(tourney.rewards.gems*0.05*P.activeTournament.wins);
P.gold+=partialGold;
P.gems+=partialGems;
history.goldEarned=partialGold;
history.gemsEarned=partialGems;
}
}

P.tournamentHistory.unshift(history);
if(P.tournamentHistory.length>20)P.tournamentHistory.pop();
P.activeTournament=null;
save();
}


// ===== FEATURE 1: VICTORY LOOT DROP SYSTEM =====
const LOOT_ICONS=['💰','💎','⭐','🎴','📦','👑','🏆','✨','🔥','💜'];
function showVictoryLootDrop(gold,gems,bonusItems=[]){
  // Create falling loot animation
  const overlay=document.createElement('div');
  overlay.className='loot-drop-overlay';
  document.body.appendChild(overlay);

  // Spawn falling items
  for(let i=0;i<20;i++){
    setTimeout(()=>{
      const item=document.createElement('div');
      item.className='loot-item';
      item.textContent=LOOT_ICONS[Math.floor(Math.random()*LOOT_ICONS.length)];
      item.style.left=Math.random()*100+'%';
      item.style.animationDelay=Math.random()*0.5+'s';
      item.style.animationDuration=(1.5+Math.random())+'s';
      overlay.appendChild(item);
    },i*100);
  }

  // Show loot popup after animation
  setTimeout(()=>{
    overlay.remove();
    const popup=document.createElement('div');
    popup.className='loot-popup';
    let itemsHtml=`<div class="loot-reward"><div class="loot-reward-icon">💰</div><div class="loot-reward-amount">+${gold}</div><div class="loot-reward-label">Gold</div></div>`;
    if(gems>0)itemsHtml+=`<div class="loot-reward rare"><div class="loot-reward-icon">💎</div><div class="loot-reward-amount">+${gems}</div><div class="loot-reward-label">Gems</div></div>`;
    bonusItems.forEach(b=>{itemsHtml+=`<div class="loot-reward ${b.rarity||''}"><div class="loot-reward-icon">${b.icon}</div><div class="loot-reward-amount">+${b.amount}</div><div class="loot-reward-label">${b.label}</div></div>`;});
    popup.innerHTML=`<div class="loot-title">🎉 VICTORY LOOT!</div><div class="loot-items-grid">${itemsHtml}</div><button class="loot-close" onclick="this.parentElement.remove()">COLLECT</button>`;
    document.body.appendChild(popup);
    playSound('victory');
  },2000);
}

// ===== FEATURE 2: PLAYER TITLES SYSTEM =====
const PLAYER_TITLES=[
  // Starter & Basic Titles
  {id:'newbie',name:'Newbie',icon:'🐣',class:'title-newbie',requirement:'Start playing',unlocked:true},
  {id:'rookie',name:'Rookie',icon:'🎮',class:'title-newbie',requirement:'Win 5 battles',check:()=>P.wins>=5},
  {id:'warrior',name:'Warrior',icon:'⚔️',class:'title-warrior',requirement:'Win 10 battles',check:()=>P.wins>=10},
  {id:'fighter',name:'Fighter',icon:'🥊',class:'title-warrior',requirement:'Win 25 battles',check:()=>P.wins>=25},
  {id:'veteran',name:'Veteran',icon:'🎖️',class:'title-warrior',requirement:'Win 50 battles',check:()=>P.wins>=50},
  {id:'elite',name:'Elite',icon:'💎',class:'title-champion',requirement:'Win 100 battles',check:()=>P.wins>=100},
  {id:'master',name:'Master',icon:'🏅',class:'title-champion',requirement:'Win 250 battles',check:()=>P.wins>=250},
  {id:'grandmaster',name:'Grand Master',icon:'🎯',class:'title-legend',requirement:'Win 500 battles',check:()=>P.wins>=500},
  {id:'supreme',name:'Supreme',icon:'⚡',class:'title-mythic',requirement:'Win 1000 battles',check:()=>P.wins>=1000},

  // Trophy Milestones
  {id:'bronze',name:'Bronze League',icon:'🥉',class:'title-newbie',requirement:'Reach 1000 trophies',check:()=>P.tr>=1000},
  {id:'silver',name:'Silver League',icon:'🥈',class:'title-warrior',requirement:'Reach 2500 trophies',check:()=>P.tr>=2500},
  {id:'gold',name:'Gold League',icon:'🥇',class:'title-warrior',requirement:'Reach 5000 trophies',check:()=>P.tr>=5000},
  {id:'platinum',name:'Platinum',icon:'💠',class:'title-champion',requirement:'Reach 7500 trophies',check:()=>P.tr>=7500},
  {id:'diamond',name:'Diamond',icon:'💎',class:'title-champion',requirement:'Reach 10000 trophies',check:()=>P.tr>=10000},
  {id:'champion',name:'Champion',icon:'🏆',class:'title-legend',requirement:'Reach 15000 trophies',check:()=>P.tr>=15000},
  {id:'legend',name:'Legend',icon:'👑',class:'title-legend',requirement:'Reach 20000 trophies',check:()=>P.tr>=20000},
  {id:'mythic',name:'Mythic',icon:'🌟',class:'title-mythic',requirement:'Reach 50000 trophies',check:()=>P.tr>=50000},
  {id:'divine',name:'Divine',icon:'✨',class:'title-divine',requirement:'Reach 100000 trophies',check:()=>P.tr>=100000},
  {id:'immortal',name:'Immortal',icon:'🔱',class:'title-divine',requirement:'Reach 500000 trophies',check:()=>P.tr>=500000},
  {id:'godlike',name:'Godlike',icon:'👁️',class:'title-divine',requirement:'Reach 1000000 trophies',check:()=>P.tr>=1000000},

  // Win Rate Titles (calculated based on wins/total games)
  {id:'consistent',name:'Consistent',icon:'📊',class:'title-warrior',requirement:'60%+ win rate (50+ games)',check:()=>(P.wins+P.losses)>=50&&(P.wins/(P.wins+P.losses))>=0.60},
  {id:'skilled',name:'Skilled',icon:'🎯',class:'title-champion',requirement:'70%+ win rate (100+ games)',check:()=>(P.wins+P.losses)>=100&&(P.wins/(P.wins+P.losses))>=0.70},
  {id:'pro',name:'Pro Player',icon:'🌟',class:'title-legend',requirement:'80%+ win rate (200+ games)',check:()=>(P.wins+P.losses)>=200&&(P.wins/(P.wins+P.losses))>=0.80},
  {id:'unstoppable',name:'Unstoppable',icon:'🔥',class:'title-mythic',requirement:'90%+ win rate (500+ games)',check:()=>(P.wins+P.losses)>=500&&(P.wins/(P.wins+P.losses))>=0.90},
  {id:'perfect',name:'Perfectionist',icon:'💯',class:'title-divine',requirement:'95%+ win rate (1000+ games)',check:()=>(P.wins+P.losses)>=1000&&(P.wins/(P.wins+P.losses))>=0.95},

  // Streak Titles
  {id:'hot_streak',name:'Hot Streak',icon:'🔥',class:'title-warrior',requirement:'5 win streak',check:()=>P.maxStr>=5},
  {id:'streak_king',name:'Streak King',icon:'👑',class:'title-champion',requirement:'10 win streak',check:()=>P.maxStr>=10},
  {id:'streak_master',name:'Streak Master',icon:'⚡',class:'title-legend',requirement:'20 win streak',check:()=>P.maxStr>=20},
  {id:'untouchable',name:'Untouchable',icon:'🛡️',class:'title-mythic',requirement:'50 win streak',check:()=>P.maxStr>=50},
  {id:'invincible',name:'Invincible',icon:'💫',class:'title-divine',requirement:'100 win streak',check:()=>P.maxStr>=100},

  // Crown Titles
  {id:'crown_seeker',name:'Crown Seeker',icon:'👑',class:'title-newbie',requirement:'Earn 100 crowns',check:()=>P.crowns>=100},
  {id:'crown_hunter',name:'Crown Hunter',icon:'👑',class:'title-warrior',requirement:'Earn 500 crowns',check:()=>P.crowns>=500},
  {id:'crown_master',name:'Crown Master',icon:'👑',class:'title-champion',requirement:'Earn 1000 crowns',check:()=>P.crowns>=1000},
  {id:'crown_emperor',name:'Crown Emperor',icon:'👑',class:'title-legend',requirement:'Earn 5000 crowns',check:()=>P.crowns>=5000},
  {id:'crown_god',name:'Crown God',icon:'👑',class:'title-divine',requirement:'Earn 10000 crowns',check:()=>P.crowns>=10000},

  // Collection Titles
  {id:'collector',name:'Collector',icon:'🎴',class:'title-warrior',requirement:'Unlock 25 cards',check:()=>P.unlocked.length>=25},
  {id:'hoarder',name:'Hoarder',icon:'📦',class:'title-champion',requirement:'Unlock 50 cards',check:()=>P.unlocked.length>=50},
  {id:'archivist',name:'Archivist',icon:'📚',class:'title-legend',requirement:'Unlock 75 cards',check:()=>P.unlocked.length>=75},
  {id:'completionist',name:'Completionist',icon:'✅',class:'title-mythic',requirement:'Unlock ALL cards',check:()=>P.unlocked.length>=(typeof CARDS!=='undefined'?CARDS.length:100)},

  // Wealth Titles
  {id:'wealthy',name:'Wealthy',icon:'💰',class:'title-warrior',requirement:'Have 50,000 gold',check:()=>P.gold>=50000},
  {id:'rich',name:'Rich',icon:'💎',class:'title-champion',requirement:'Have 250,000 gold',check:()=>P.gold>=250000},
  {id:'millionaire',name:'Millionaire',icon:'🤑',class:'title-legend',requirement:'Have 1,000,000 gold',check:()=>P.gold>=1000000},
  {id:'billionaire',name:'Billionaire',icon:'💵',class:'title-divine',requirement:'Have 10,000,000 gold',check:()=>P.gold>=10000000}
];

function getUnlockedTitles(){return PLAYER_TITLES.filter(t=>t.unlocked||t.check&&t.check());}
function getCurrentTitle(){
  const equipped=P.equippedTitle||'newbie';
  const title=PLAYER_TITLES.find(t=>t.id===equipped);
  if(title&&(title.unlocked||title.check&&title.check()))return title;
  return PLAYER_TITLES[0];
}
function setPlayerTitle(titleId){
  const title=PLAYER_TITLES.find(t=>t.id===titleId);
  if(title&&(title.unlocked||title.check&&title.check())){P.equippedTitle=titleId;save();updateTitleDisplay();showNotify('Title changed to '+title.icon+' '+title.name,'success');}
}
function updateTitleDisplay(){
  const title=getCurrentTitle();
  const el=document.getElementById('playerTitleBadge');
  if(el)el.innerHTML=`<span class="player-title-badge ${title.class}">${title.icon} ${title.name}</span>`;
}
function showTitleSelector(){
  const unlocked=getUnlockedTitles();
  const current=getCurrentTitle();
  let html='<div class="title-selector"><div style="font-weight:900;margin-bottom:10px;color:#ffd700">🏷️ SELECT YOUR TITLE</div>';
  PLAYER_TITLES.forEach(t=>{
    const isUnlocked=t.unlocked||t.check&&t.check();
    const isSelected=t.id===current.id;
    html+=`<div class="title-option ${t.class} ${isSelected?'selected':''} ${!isUnlocked?'locked':''}" onclick="${isUnlocked?`setPlayerTitle('${t.id}')`:''}">
      ${t.icon} ${t.name} ${!isUnlocked?'🔒':''}
    </div>`;
  });
  html+='<div style="font-size:9px;color:#666;margin-top:10px">Unlock more titles by completing achievements!</div></div>';
  return html;
}

// Update Titles Tab (full display in More section)
function updateTitlesTab(){
  const current=getCurrentTitle();
  const unlocked=getUnlockedTitles();
  const total=PLAYER_TITLES.length;

  // Update count
  const countEl=document.getElementById('titlesUnlockedCount');
  if(countEl)countEl.textContent=`${unlocked.length}/${total}`;

  // Update equipped display
  const equippedEl=document.getElementById('equippedTitleDisplay');
  if(equippedEl){
    equippedEl.innerHTML=`<div style="padding:12px 24px;background:linear-gradient(145deg,#1b2838,#243447);border:2px solid #ffd700;border-radius:12px;text-align:center">
      <div style="font-size:32px;margin-bottom:5px">${current.icon}</div>
      <div style="font-size:14px;font-weight:900;color:#ffd700">${current.name}</div>
      <div class="player-title-badge ${current.class}" style="margin-top:5px">${current.icon} ${current.name}</div>
    </div>`;
  }

  // Update unlocked grid
  const unlockedGrid=document.getElementById('unlockedTitlesGrid');
  if(unlockedGrid){
    unlockedGrid.innerHTML='';
    unlocked.forEach(t=>{
      const isSelected=t.id===current.id;
      const div=document.createElement('div');
      div.style.cssText=`padding:10px;background:linear-gradient(145deg,${isSelected?'#2a4a3a':'#1b2838'},${isSelected?'#1a3a2a':'#243447'});border:2px solid ${isSelected?'#ffd700':'#34495e'};border-radius:10px;cursor:pointer;text-align:center;transition:all 0.2s`;
      div.innerHTML=`<div style="font-size:24px;margin-bottom:4px">${t.icon}</div><div style="font-size:11px;font-weight:800;color:${isSelected?'#ffd700':'#fff'}">${t.name}</div><div style="font-size:8px;color:#888;margin-top:2px">${t.requirement}</div>${isSelected?'<div style="font-size:8px;color:#27ae60;margin-top:4px">EQUIPPED</div>':''}`;
      div.onclick=()=>{setPlayerTitle(t.id);updateTitlesTab();};
      unlockedGrid.appendChild(div);
    });
  }

  // Update locked grid
  const lockedGrid=document.getElementById('lockedTitlesGrid');
  if(lockedGrid){
    lockedGrid.innerHTML='';
    PLAYER_TITLES.filter(t=>!t.unlocked&&(!t.check||!t.check())).forEach(t=>{
      const div=document.createElement('div');
      div.style.cssText='padding:10px;background:linear-gradient(145deg,#1a1a2a,#0d0d1a);border:2px solid #2a2a3a;border-radius:10px;text-align:center;opacity:0.6';
      div.innerHTML=`<div style="font-size:24px;margin-bottom:4px;filter:grayscale(100%)">${t.icon}</div><div style="font-size:11px;font-weight:800;color:#666">${t.name}</div><div style="font-size:8px;color:#555;margin-top:2px">🔒 ${t.requirement}</div>`;
      lockedGrid.appendChild(div);
    });
  }
}

// ===== FEATURE 3: TREASURE HUNT GAME =====
const TREASURE_ITEMS=[
  {icon:'💰',name:'Gold Pile',gold:500,gems:0,rarity:'common'},
  {icon:'💎',name:'Gem Crystal',gold:0,gems:25,rarity:'rare'},
  {icon:'⭐',name:'Star Token',gold:1000,gems:10,rarity:'rare'},
  {icon:'👑',name:'Royal Crown',gold:2500,gems:50,rarity:'epic'},
  {icon:'🏆',name:'Trophy',gold:1500,gems:25,rarity:'epic'},
  {icon:'📦',name:'Mystery Box',gold:3000,gems:75,rarity:'epic'},
  {icon:'🌟',name:'Mega Star',gold:5000,gems:100,rarity:'legendary'},
  {icon:'💜',name:'Amethyst',gold:0,gems:150,rarity:'legendary'},
  {icon:'🪙',name:'Coin',gold:200,gems:0,rarity:'common'},
  {icon:'✨',name:'Sparkle Dust',gold:300,gems:5,rarity:'common'},
  {icon:'🎁',name:'Gift Box',gold:1000,gems:20,rarity:'rare'},
  {icon:'💫',name:'Shooting Star',gold:2000,gems:40,rarity:'epic'}
];
let treasureGameActive=false;
let treasurePicks=0;
let treasureTotal={gold:0,gems:0};
let treasureRevealed=[];
const TREASURE_HUNT_COST = 300; // Gems required to play

function showTreasureHunt(freePlay = false){
  if(document.querySelector('.treasure-overlay'))return;

  // Check if player has enough gems (unless free play from win bonus)
  if (!freePlay && P.gems < TREASURE_HUNT_COST) {
    showNotify(`💎 Not Enough Gems!\nYou need ${TREASURE_HUNT_COST} gems to play Treasure Hunt.\nYou have: ${P.gems} gems`, 'error');
    return;
  }

  // Show confirmation if not free play
  if (!freePlay) {
    const confirmModal = document.createElement('div');
    confirmModal.className = 'confirm-modal';
    confirmModal.innerHTML = `
      <div class="confirm-box" style="border-color:#ffd700">
        <div style="font-size:40px;margin-bottom:10px">📦</div>
        <div style="font-size:16px;font-weight:900;margin-bottom:5px">TREASURE HUNT</div>
        <div style="font-size:12px;color:#888;margin-bottom:15px">Pick 3 chests to find hidden treasures!</div>
        <div style="font-size:14px;margin-bottom:15px">
          <span style="color:#e74c3c;font-weight:900">Cost: ${TREASURE_HUNT_COST} 💎</span>
          <div style="font-size:11px;color:#888;margin-top:5px">Your gems: ${P.gems} 💎</div>
        </div>
        <div style="display:flex;gap:10px;justify-content:center">
          <button onclick="this.closest('.confirm-modal').remove()" style="padding:10px 20px;background:linear-gradient(180deg,#555,#333);border:none;border-radius:8px;color:#fff;font-weight:800;cursor:pointer">Cancel</button>
          <button onclick="this.closest('.confirm-modal').remove();startTreasureHunt()" style="padding:10px 20px;background:linear-gradient(180deg,#27ae60,#1e8449);border:none;border-radius:8px;color:#fff;font-weight:800;cursor:pointer">Play (${TREASURE_HUNT_COST}💎)</button>
        </div>
      </div>
    `;
    document.body.appendChild(confirmModal);
    return;
  }

  startTreasureHunt();
}

function startTreasureHunt(){
  // Deduct gems
  P.gems -= TREASURE_HUNT_COST;
  save();
  updatePlay();

  treasureGameActive=true;
  treasurePicks=3;
  treasureTotal={gold:0,gems:0};
  treasureRevealed=[];

  // Generate hidden treasures (9 chests)
  const chests=[];
  for(let i=0;i<9;i++){
    const roll=Math.random();
    let item;
    if(roll<0.05)item=TREASURE_ITEMS.find(t=>t.rarity==='legendary');
    else if(roll<0.20)item=TREASURE_ITEMS.find(t=>t.rarity==='epic');
    else if(roll<0.50)item=TREASURE_ITEMS.find(t=>t.rarity==='rare');
    else item=TREASURE_ITEMS.find(t=>t.rarity==='common');
    if(!item)item=TREASURE_ITEMS[Math.floor(Math.random()*TREASURE_ITEMS.length)];
    chests.push({...item,index:i});
  }

  const overlay=document.createElement('div');
  overlay.className='treasure-overlay';
  overlay.id='treasureOverlay';
  overlay.innerHTML=`
    <div class="treasure-game">
      <div class="treasure-title">📦 TREASURE HUNT! 📦</div>
      <div class="treasure-subtitle">Pick 3 chests to discover hidden treasures!</div>
      <div class="treasure-picks">Picks remaining: <span id="treasurePicksLeft">3</span></div>
      <div class="treasure-grid" id="treasureGrid">
        ${chests.map((c,i)=>`<div class="treasure-chest" data-index="${i}" data-item='${JSON.stringify(c)}' onclick="openTreasureChest(this)">📦</div>`).join('')}
      </div>
      <div class="treasure-result" id="treasureResult"></div>
      <button class="treasure-btn" id="treasureBtn" style="display:none" onclick="collectTreasure()">COLLECT ALL!</button>
      <div style="margin-top:12px"><button style="background:none;border:none;color:#888;cursor:pointer;font-size:12px" onclick="closeTreasureHunt()">Close</button></div>
    </div>`;
  document.body.appendChild(overlay);
}

function openTreasureChest(el){
  if(!treasureGameActive||treasurePicks<=0||el.classList.contains('opened'))return;

  const item=JSON.parse(el.dataset.item);
  el.classList.add('opened');
  treasurePicks--;
  treasureRevealed.push(item);

  // Reveal treasure
  setTimeout(()=>{
    el.textContent=item.icon;
    if(item.rarity==='legendary'||item.rarity==='epic'){
      el.classList.add('golden');
      playSound('victory');
    }else{
      playSound('click');
    }

    treasureTotal.gold+=item.gold;
    treasureTotal.gems+=item.gems;

    document.getElementById('treasurePicksLeft').textContent=treasurePicks;

    // Show what was found
    const colors={common:'#aaa',rare:'#3498db',epic:'#9b59b6',legendary:'#f1c40f'};
    document.getElementById('treasureResult').innerHTML=`<span style="color:${colors[item.rarity]}">${item.icon} ${item.name}!</span>`;

    if(treasurePicks===0){
      // Game over - show total
      setTimeout(()=>{
        document.getElementById('treasureResult').innerHTML=`
          <div style="font-size:16px;margin-bottom:5px">TOTAL LOOT:</div>
          <span style="color:#ffd700">+${treasureTotal.gold}💰</span>
          ${treasureTotal.gems>0?`<span style="color:#3498db;margin-left:10px">+${treasureTotal.gems}💎</span>`:''}
        `;
        document.getElementById('treasureBtn').style.display='inline-block';
        treasureGameActive=false;
      },500);
    }
  },300);
}

function collectTreasure(){
  P.gold+=treasureTotal.gold;
  P.gems+=treasureTotal.gems;
  save();

  // Celebration effect
  for(let i=0;i<20;i++){
    setTimeout(()=>{
      const conf=document.createElement('div');
      conf.style.cssText=`position:fixed;top:-20px;left:${Math.random()*100}%;font-size:24px;z-index:10001;animation:lootFall 2s ease-in forwards`;
      conf.textContent=['🎉','✨','⭐','💰','💎'][Math.floor(Math.random()*5)];
      document.body.appendChild(conf);
      setTimeout(()=>conf.remove(),2000);
    },i*50);
  }

  playSound('victory');
  showNotify(`Collected +${treasureTotal.gold}💰 ${treasureTotal.gems>0?'+'+treasureTotal.gems+'💎':''}`,'success');
  closeTreasureHunt();
}

function closeTreasureHunt(){
  document.getElementById('treasureOverlay')?.remove();
  treasureGameActive=false;
}

// Trigger FREE treasure hunt randomly after wins (10% chance)
function tryTriggerTreasure(){
  if(Math.random()<0.10){
    showNotify('🎁 BONUS!\nYou won a FREE Treasure Hunt!', 'epic');
    setTimeout(()=>showTreasureHunt(true),500); // Free play from win bonus
    return true;
  }
  return false;
}

// Show titles modal
function showTitlesModal(){
  const modal=document.createElement('div');
  modal.className='loot-popup';
  modal.style.maxWidth='350px';
  modal.innerHTML=`<div class="loot-title">🏷️ PLAYER TITLES</div>${showTitleSelector()}<button class="loot-close" onclick="this.parentElement.remove()" style="margin-top:15px">DONE</button>`;
  document.body.appendChild(modal);
}

// Initialize title display on load
setTimeout(()=>updateTitleDisplay(),100);

// ===== FEATURE 4: META DECKS TIER LIST =====
const META_DECKS=[
  // S Tier - Best of the best
  {tier:'S',name:'Hog Cycle 2.6',winRate:68,useRate:12,cards:['🐷','🧊','🔫','🪵','⚡','🔥','🗡️','💨'],desc:'Classic fast cycle deck'},
  {tier:'S',name:'Golem Beatdown',winRate:65,useRate:9,cards:['🪨','👶','⚡','🌙','🔮','💀','🏰','🌲'],desc:'Heavy push dominance'},
  {tier:'S',name:'Log Bait',winRate:64,useRate:11,cards:['👸','🗡️','🪵','🚀','💣','⚔️','🔥','👹'],desc:'Spell bait master'},
  {tier:'S',name:'X-Bow Cycle',winRate:63,useRate:7,cards:['🎯','❄️','🔫','🪵','⚡','🔥','🛡️','💨'],desc:'Defensive siege'},

  // A Tier - Very strong
  {tier:'A',name:'Pekka Bridge Spam',winRate:61,useRate:8,cards:['🤖','👻','🦇','⚡','💣','🔮','🪵','🌉'],desc:'Counter push specialist'},
  {tier:'A',name:'Lava Hound',winRate:60,useRate:6,cards:['🐕‍🦺','🎈','👶','💀','⚡','🪵','🔥','🏰'],desc:'Air dominance'},
  {tier:'A',name:'Royal Giant',winRate:59,useRate:10,cards:['👑','⚡','🔥','🪵','💣','🔮','🏰','🌲'],desc:'Siege royalty'},
  {tier:'A',name:'Miner Control',winRate:58,useRate:7,cards:['⛏️','💀','🔫','🪵','⚡','🔥','🚀','💨'],desc:'Chip damage king'},
  {tier:'A',name:'Giant Double Prince',winRate:57,useRate:5,cards:['🧔','🤴','🤴','🔮','⚡','🪵','💣','🏰'],desc:'Classic beatdown'},

  // B Tier - Solid choices
  {tier:'B',name:'Mortar Cycle',winRate:55,useRate:4,cards:['🧱','🔫','⚡','🪵','🚀','💣','🛡️','💨'],desc:'F2P friendly siege'},
  {tier:'B',name:'Goblin Drill',winRate:54,useRate:5,cards:['🕳️','💣','🗡️','⚡','🔥','🪵','👹','🛡️'],desc:'Surprise attacks'},
  {tier:'B',name:'Balloon Freeze',winRate:53,useRate:6,cards:['🎈','❄️','👶','⚡','🔥','🪵','💣','🏰'],desc:'All or nothing'},
  {tier:'B',name:'Sparky Beatdown',winRate:52,useRate:3,cards:['⚡','🧔','🔮','💀','🪵','🔥','💣','🏰'],desc:'High risk high reward'},

  // C Tier - Playable but outclassed
  {tier:'C',name:'Elite Barbs Rage',winRate:48,useRate:8,cards:['⚔️','😡','🔥','⚡','🪵','💣','💀','🏰'],desc:'Bridge spam'},
  {tier:'C',name:'Mega Knight Spam',winRate:47,useRate:9,cards:['🦸','👹','🗡️','💣','⚡','🪵','🔥','💨'],desc:'Defensive counter'},
  {tier:'C',name:'Three Musketeers',winRate:46,useRate:2,cards:['👩‍🦰','👩‍🦰','👩‍🦰','⛏️','💣','🪵','🔥','🛡️'],desc:'Split lane master'},

  // D Tier - Struggling
  {tier:'D',name:'Giant Skeleton',winRate:43,useRate:2,cards:['💀','💣','⚡','🪵','🔥','🏰','🛡️','👶'],desc:'Bomb delivery'},
  {tier:'D',name:'Witch Spam',winRate:42,useRate:3,cards:['🧙‍♀️','🧔','💀','⚡','🪵','🔥','💣','🏰'],desc:'Swarm spawner'},

  // F Tier - Not recommended
  {tier:'F',name:'Heal Spirit Cycle',winRate:38,useRate:1,cards:['💚','🔫','⚡','🪵','🚀','💣','🛡️','💨'],desc:'Meme deck'},
  {tier:'F',name:'All Spells',winRate:35,useRate:1,cards:['🔥','⚡','❄️','🚀','💣','🪵','😡','🌪️'],desc:'For fun only'}
];

function updateMetaDecks(){
  const container=document.getElementById('metaTierList');
  if(!container)return;

  const tiers=['S','A','B','C','D','F'];
  const tierNames={S:'S TIER - Overpowered',A:'A TIER - Very Strong',B:'B TIER - Solid',C:'C TIER - Average',D:'D TIER - Weak',F:'F TIER - Meme'};
  const tierColors={S:'#ffd700',A:'#2ecc71',B:'#3498db',C:'#9b59b6',D:'#95a5a6',F:'#e74c3c'};

  let html='';
  tiers.forEach(tier=>{
    const decks=META_DECKS.filter(d=>d.tier===tier);
    if(decks.length===0)return;

    html+=`<div class="meta-tier ${tier}">
      <div style="font-weight:900;font-size:14px;margin-bottom:8px;color:#fff;text-shadow:1px 1px 2px rgba(0,0,0,0.5)">${tierNames[tier]}</div>`;

    decks.forEach((deck,idx)=>{
      const deckIdx=META_DECKS.indexOf(deck);
      html+=`<div class="meta-deck" onclick="copyMetaDeckByIdx(${deckIdx})">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-weight:800;font-size:12px">${deck.name}</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.8)">${deck.winRate}% WR</div>
        </div>
        <div style="font-size:9px;color:rgba(255,255,255,0.6);margin-top:2px">${deck.desc}</div>
        <div class="meta-deck-cards">${deck.cards.map(c=>`<span class="meta-deck-card">${c}</span>`).join('')}</div>
        <div style="font-size:8px;color:rgba(255,255,255,0.5);margin-top:4px">Use Rate: ${deck.useRate}% | Tap to view</div>
      </div>`;
    });

    html+=`</div>`;
  });

  container.innerHTML=html;
}

function copyMetaDeckByIdx(idx){
  const deck=META_DECKS[idx];
  if(!deck)return;
  playSound('click');
  // Show deck detail modal
  const tierColors={S:'#ffd700',A:'#2ecc71',B:'#3498db',C:'#9b59b6',D:'#95a5a6',F:'#e74c3c'};
  const modal=document.createElement('div');
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.onclick=(e)=>{if(e.target===modal)modal.remove();};
  modal.innerHTML=`
    <div style="background:linear-gradient(145deg,#1b2838,#0d1b2a);border:3px solid ${tierColors[deck.tier]};border-radius:16px;padding:20px;max-width:320px;width:100%;text-align:center">
      <div style="font-size:12px;font-weight:900;padding:4px 12px;background:${tierColors[deck.tier]};border-radius:8px;display:inline-block;margin-bottom:10px;color:#000">${deck.tier} TIER</div>
      <div style="font-size:20px;font-weight:900;color:#ffd700;margin-bottom:5px">${deck.name}</div>
      <div style="font-size:12px;color:#888;margin-bottom:15px">${deck.desc}</div>
      <div style="display:flex;justify-content:center;gap:15px;margin-bottom:15px">
        <div style="text-align:center"><div style="font-size:20px;font-weight:900;color:#2ecc71">${deck.winRate}%</div><div style="font-size:9px;color:#888">WIN RATE</div></div>
        <div style="text-align:center"><div style="font-size:20px;font-weight:900;color:#3498db">${deck.useRate}%</div><div style="font-size:9px;color:#888">USE RATE</div></div>
      </div>
      <div style="font-size:11px;color:#fff;margin-bottom:8px;font-weight:800">DECK CARDS</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:15px">${deck.cards.map(c=>`<span style="font-size:28px;background:rgba(255,255,255,0.1);padding:8px;border-radius:8px">${c}</span>`).join('')}</div>
      <button onclick="this.parentElement.parentElement.remove()" style="padding:10px 30px;background:linear-gradient(180deg,#e74c3c,#c0392b);border:none;border-radius:8px;color:#fff;font-weight:800;cursor:pointer">CLOSE</button>
    </div>`;
  document.body.appendChild(modal);
}

// Show meta decks popup from Cards tab
function showMetaDecksPopup(){
  playSound('click');
  const modal=document.createElement('div');
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:9999;display:flex;flex-direction:column;align-items:center;padding:15px;overflow-y:auto';
  modal.onclick=(e)=>{if(e.target===modal)modal.remove();};

  const tiers=['S','A','B','C','D','F'];
  const tierNames={S:'S TIER - Overpowered',A:'A TIER - Very Strong',B:'B TIER - Solid',C:'C TIER - Average',D:'D TIER - Weak',F:'F TIER - Meme'};
  const tierColors={S:'#ffd700',A:'#2ecc71',B:'#3498db',C:'#9b59b6',D:'#95a5a6',F:'#e74c3c'};
  const tierBgs={S:'linear-gradient(145deg,#ff6b35,#ee5a24)',A:'linear-gradient(145deg,#2ecc71,#27ae60)',B:'linear-gradient(145deg,#3498db,#2980b9)',C:'linear-gradient(145deg,#9b59b6,#8e44ad)',D:'linear-gradient(145deg,#7f8c8d,#6c7a89)',F:'linear-gradient(145deg,#e74c3c,#c0392b)'};

  let html=`<div style="font-family:'Lilita One',cursive;font-size:24px;color:#ffd700;margin-bottom:15px">📋 META DECKS</div>`;
  html+=`<div style="width:100%;max-width:360px">`;

  tiers.forEach(tier=>{
    const decks=META_DECKS.filter(d=>d.tier===tier);
    if(decks.length===0)return;
    html+=`<div style="background:${tierBgs[tier]};border:2px solid ${tierColors[tier]};border-radius:10px;padding:10px;margin-bottom:10px">
      <div style="font-weight:900;font-size:14px;margin-bottom:8px;color:#fff;text-shadow:1px 1px 2px rgba(0,0,0,0.5)">${tierNames[tier]}</div>`;
    decks.forEach(deck=>{
      const deckIdx=META_DECKS.indexOf(deck);
      html+=`<div onclick="copyMetaDeckByIdx(${deckIdx})" style="background:rgba(0,0,0,0.3);border-radius:8px;padding:8px;margin:5px 0;cursor:pointer">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-weight:800;font-size:12px;color:#fff">${deck.name}</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.8)">${deck.winRate}% WR</div>
        </div>
        <div style="font-size:9px;color:rgba(255,255,255,0.6);margin-top:2px">${deck.desc}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:5px">${deck.cards.map(c=>`<span style="font-size:16px;background:rgba(255,255,255,0.1);padding:4px;border-radius:4px">${c}</span>`).join('')}</div>
      </div>`;
    });
    html+=`</div>`;
  });

  html+=`</div>`;
  html+=`<button onclick="this.parentElement.remove()" style="margin-top:10px;padding:12px 40px;background:linear-gradient(180deg,#e74c3c,#c0392b);border:none;border-radius:10px;color:#fff;font-weight:800;font-size:14px;cursor:pointer">CLOSE</button>`;

  modal.innerHTML=html;
  document.body.appendChild(modal);
}

// Create custom meta deck from admin panel
function createMetaDeck(){
  const name=document.getElementById('metaDeckName').value.trim();
  const tier=document.getElementById('metaDeckTier').value;
  const winRate=parseInt(document.getElementById('metaDeckWinRate').value)||50;
  const useRate=parseInt(document.getElementById('metaDeckUseRate').value)||5;
  const desc=document.getElementById('metaDeckDesc').value.trim()||'Custom deck';

  if(!name){showNotify('Enter a deck name!','error');return;}
  if(P.deck.length!==8){showNotify('You need 8 cards in your deck!','error');return;}

  const cards=P.deck.map(id=>{const c=getCard(id);return c?c.icon:'?';});

  META_DECKS.push({tier,name,winRate,useRate,cards,desc,custom:true});

  document.getElementById('metaDeckName').value='';
  document.getElementById('metaDeckDesc').value='';
  document.getElementById('metaDeckWinRate').value='';
  document.getElementById('metaDeckUseRate').value='';

  updateMetaDeckSelect();
  updateMetaDecks();
  showNotify(`Created "${name}" meta deck!`,'success','📋');
}

// Delete custom meta deck
function deleteMetaDeck(){
  const select=document.getElementById('deleteMetaDeckSelect');
  const idx=parseInt(select.value);
  if(isNaN(idx)||idx<0||idx>=META_DECKS.length)return;

  const deck=META_DECKS[idx];
  if(!deck.custom){showNotify('Cannot delete built-in decks!','error');return;}

  META_DECKS.splice(idx,1);
  updateMetaDeckSelect();
  updateMetaDecks();
  showNotify('Meta deck deleted!','success');
}

// Update meta deck delete dropdown
function updateMetaDeckSelect(){
  const select=document.getElementById('deleteMetaDeckSelect');
  if(!select)return;
  select.innerHTML=META_DECKS.map((d,i)=>`<option value="${i}">${d.custom?'★ ':''}${d.name} (${d.tier})</option>`).join('');
}

// ===== FEATURE 5: BOSS BATTLE MODE =====
const BOSSES=[
  {id:'goblin_king',name:'Goblin King',icon:'👺',hp:50000,damage:500,reward:{gold:5000,gems:100,tokens:50},desc:'The ruler of all goblins',difficulty:'Easy'},
  {id:'mega_knight',name:'Mega Knight',icon:'🦸',hp:80000,damage:800,reward:{gold:8000,gems:150,tokens:75},desc:'The armored destroyer',difficulty:'Medium'},
  {id:'dragon_lord',name:'Dragon Lord',icon:'🐉',hp:120000,damage:1200,reward:{gold:15000,gems:250,tokens:100},desc:'Ancient fire breather',difficulty:'Hard'},
  {id:'skeleton_emperor',name:'Skeleton Emperor',icon:'💀',hp:100000,damage:1000,reward:{gold:12000,gems:200,tokens:85},desc:'Lord of the undead',difficulty:'Hard'},
  {id:'pekka_prime',name:'P.E.K.K.A Prime',icon:'🤖',hp:150000,damage:1500,reward:{gold:20000,gems:350,tokens:150},desc:'Ultimate war machine',difficulty:'Extreme'},
  {id:'royal_giant_king',name:'Royal Giant King',icon:'👑',hp:200000,damage:2000,reward:{gold:30000,gems:500,tokens:200},desc:'The siege master',difficulty:'Extreme'},
  {id:'inferno_dragon',name:'Inferno Dragon',icon:'🔥',hp:90000,damage:2500,reward:{gold:10000,gems:180,tokens:90},desc:'Melts everything',difficulty:'Medium'},
  {id:'electro_wizard_boss',name:'Electro Overlord',icon:'⚡',hp:175000,damage:1800,reward:{gold:25000,gems:400,tokens:175},desc:'Master of lightning',difficulty:'Extreme'}
];

let currentBoss=null;
let B_bossData=null;
let bossHP=0;
let bossMaxHP=0;

function updateBossMode(){
  // Initialize boss tokens if not exists
  if(typeof P.bossTokens==='undefined')P.bossTokens=0;
  if(typeof P.bossesDefeated==='undefined')P.bossesDefeated=[];
  if(typeof P.bossKills==='undefined')P.bossKills={};

  document.getElementById('bossTokensDisplay').textContent=P.bossTokens;

  // Current boss section
  const currentSection=document.getElementById('currentBossSection');
  if(!currentBoss){
    // Select random available boss
    const availableBosses=BOSSES.filter(b=>!P.bossesDefeated.includes(b.id)||Math.random()<0.3);
    currentBoss=availableBosses[Math.floor(Math.random()*availableBosses.length)]||BOSSES[0];
    bossMaxHP=currentBoss.hp;
    bossHP=bossMaxHP;
  }

  const hpPercent=(bossHP/bossMaxHP)*100;
  const diffColors={Easy:'#2ecc71',Medium:'#f39c12',Hard:'#e74c3c',Extreme:'#8e44ad'};

  currentSection.innerHTML=`
    <div class="boss-card">
      <div style="font-size:48px;margin-bottom:10px">${currentBoss.icon}</div>
      <div style="font-size:18px;font-weight:900;color:#ffd700">${currentBoss.name}</div>
      <div style="font-size:11px;color:#888;margin-bottom:5px">${currentBoss.desc}</div>
      <div style="display:inline-block;padding:3px 10px;background:${diffColors[currentBoss.difficulty]};border-radius:10px;font-size:10px;font-weight:800;margin-bottom:10px">${currentBoss.difficulty}</div>
      <div class="boss-hp-bar">
        <div class="boss-hp-fill" style="width:${hpPercent}%"></div>
      </div>
      <div style="font-size:12px;font-weight:900;color:#ff4757">HP: ${currentBoss.hp.toLocaleString()} | DMG: ${currentBoss.damage.toLocaleString()}</div>
      <div style="margin-top:15px;display:flex;gap:10px;justify-content:center">
        <button onclick="startBossBattle()" style="padding:12px 25px;background:linear-gradient(180deg,#ff4757,#c0392b);border:none;border-radius:10px;color:#fff;font-weight:900;cursor:pointer;font-size:14px">⚔️ FIGHT BOSS!</button>
      </div>
      <div style="font-size:10px;color:#666;margin-top:10px">Rewards: 💰${currentBoss.reward.gold.toLocaleString()} | 💎${currentBoss.reward.gems} | 👹${currentBoss.reward.tokens} tokens</div>
      <div style="font-size:9px;color:#ff4757;margin-top:5px">⚠️ Boss will spawn as a massive troop!</div>
    </div>`;

  // Rewards section
  const rewardsSection=document.getElementById('bossRewardsSection');
  rewardsSection.innerHTML=`
    <div style="background:linear-gradient(145deg,#1b2838,#0d1b2a);border:2px solid #ffd700;border-radius:10px;padding:10px;text-align:center">
      <div style="font-size:20px">💰</div>
      <div style="font-size:12px;font-weight:800;color:#ffd700">Gold Earned</div>
      <div style="font-size:14px">${(P.bossGoldEarned||0).toLocaleString()}</div>
    </div>
    <div style="background:linear-gradient(145deg,#1b2838,#0d1b2a);border:2px solid #a855f7;border-radius:10px;padding:10px;text-align:center">
      <div style="font-size:20px">💎</div>
      <div style="font-size:12px;font-weight:800;color:#a855f7">Gems Earned</div>
      <div style="font-size:14px">${P.bossGemsEarned||0}</div>
    </div>
    <div style="background:linear-gradient(145deg,#1b2838,#0d1b2a);border:2px solid #ff4757;border-radius:10px;padding:10px;text-align:center">
      <div style="font-size:20px">👹</div>
      <div style="font-size:12px;font-weight:800;color:#ff4757">Bosses Killed</div>
      <div style="font-size:14px">${P.bossesDefeated.length}</div>
    </div>
    <div style="background:linear-gradient(145deg,#1b2838,#0d1b2a);border:2px solid #2ecc71;border-radius:10px;padding:10px;text-align:center">
      <div style="font-size:20px">⚔️</div>
      <div style="font-size:12px;font-weight:800;color:#2ecc71">Total Attacks</div>
      <div style="font-size:14px">${P.bossAttacks||0}</div>
    </div>`;

  // Defeated bosses section
  const defeatedSection=document.getElementById('defeatedBossesSection');
  if(P.bossesDefeated.length===0){
    defeatedSection.innerHTML='<div style="text-align:center;color:#666;padding:20px">No bosses defeated yet. Start attacking!</div>';
  }else{
    defeatedSection.innerHTML=P.bossesDefeated.map(id=>{
      const boss=BOSSES.find(b=>b.id===id);
      return boss?`<div style="display:flex;align-items:center;gap:10px;padding:8px;background:linear-gradient(145deg,#1b2838,#0d1b2a);border-radius:8px;margin-bottom:5px">
        <span style="font-size:24px">${boss.icon}</span>
        <div style="flex:1">
          <div style="font-weight:800;font-size:11px">${boss.name}</div>
          <div style="font-size:9px;color:#888">Killed ${P.bossKills[id]||1}x</div>
        </div>
        <div style="color:#2ecc71;font-size:10px">✓ DEFEATED</div>
      </div>`:'';
    }).join('');
  }
}

function attackBoss(){
  if(!currentBoss)return;

  // Calculate damage based on player's deck level
  const avgLevel=P.deck.length>0?P.deck.reduce((sum,id)=>(P.lvls[id]||1)+sum,0)/P.deck.length:1;
  const baseDamage=1000;
  const damage=Math.floor(baseDamage*avgLevel*(0.8+Math.random()*0.4));

  bossHP=Math.max(0,bossHP-damage);
  P.bossAttacks=(P.bossAttacks||0)+1;

  // Earn tokens for attacking
  P.bossTokens=(P.bossTokens||0)+1;

  showNotify(`⚔️ Dealt ${damage.toLocaleString()} damage!`,'info');
  playSound('attack');

  if(bossHP<=0){
    defeatBoss();
  }else{
    save();
    updateBossMode();
  }
}

function superAttackBoss(){
  if(!currentBoss||P.bossTokens<10)return;

  P.bossTokens-=10;

  // Super attack does 5x damage
  const avgLevel=P.deck.length>0?P.deck.reduce((sum,id)=>(P.lvls[id]||1)+sum,0)/P.deck.length:1;
  const baseDamage=5000;
  const damage=Math.floor(baseDamage*avgLevel*(0.8+Math.random()*0.4));

  bossHP=Math.max(0,bossHP-damage);
  P.bossAttacks=(P.bossAttacks||0)+1;

  showNotify(`💥 SUPER ATTACK! ${damage.toLocaleString()} damage!`,'epic');
  playSound('upgrade');

  if(bossHP<=0){
    defeatBoss();
  }else{
    save();
    updateBossMode();
  }
}

function startBossBattle(){
  if(!currentBoss){showNotify('No boss available!','error');return;}
  // Start a special boss battle
  currentGameMode='boss';
  activeCustomMode={
    name:currentBoss.name+' Battle',
    icon:currentBoss.icon,
    desc:'Defeat the '+currentBoss.name+'!',
    duration:300,
    infiniteTime:false,
    startElixir:10,
    maxElixir:10,
    elixirRate:2,
    infiniteElixir:false,
    towerHP:150,
    kingHP:200,
    troopHP:100,
    troopDMG:100,
    botDisabled:true,
    botMult:0,
    chaosEvents:false
  };
  // Store boss data for battle
  B_bossData={boss:currentBoss,hp:bossHP,maxHP:bossMaxHP};
  showNotify(`${currentBoss.icon} ${currentBoss.name}\nFight the boss!`,'epic');
  setTimeout(()=>{
    currentGameMode='custom';
    startBattle();
    // Spawn boss after arena loads
    setTimeout(()=>{
      if(B&&B.on)spawnBossTroop();
    },500);
  },500);
}

function spawnBossTroop(){
  if(!B||!B.on||!B_bossData)return;
  const boss=B_bossData.boss;
  const a=document.getElementById('arena');
  const bossCard={
    id:'boss_'+boss.id,
    name:boss.name,
    icon:boss.icon,
    type:'troop',
    hp:boss.hp*10,
    dmg:boss.damage,
    spd:0.3,
    rng:2,
    as:2,
    air:0
  };
  const x=a.offsetWidth/2;
  const y=80;
  const el=document.createElement('div');
  el.className='troop ai boss-troop';
  el.style.cssText='left:'+x+'px;top:'+y+'px;transform:scale(2.5);z-index:100;filter:drop-shadow(0 0 20px #ff4757)';
  el.innerHTML=`<div class="sprite" style="font-size:40px">${boss.icon}</div><div class="hp-bar" style="width:80px"><div class="hp-fill" style="width:100%;background:linear-gradient(90deg,#ff4757,#c0392b)"></div></div>`;
  a.appendChild(el);
  B.troops.push({
    el,x,y,lane:'left',
    hp:boss.hp*10,maxHp:boss.hp*10,
    dmg:boss.damage,spd:0.3,rng:32,as:2,
    side:'ai',card:bossCard,cd:0,isBoss:true
  });
  showDmg(x,y-30,'👹 BOSS SPAWNED!','#ff4757');
}

function defeatBoss(){
  if(!currentBoss)return;

  // Add rewards
  P.gold+=currentBoss.reward.gold;
  P.gems+=currentBoss.reward.gems;
  P.bossTokens+=currentBoss.reward.tokens;
  P.bossGoldEarned=(P.bossGoldEarned||0)+currentBoss.reward.gold;
  P.bossGemsEarned=(P.bossGemsEarned||0)+currentBoss.reward.gems;

  // Track kill
  if(!P.bossesDefeated.includes(currentBoss.id)){
    P.bossesDefeated.push(currentBoss.id);
  }
  P.bossKills[currentBoss.id]=(P.bossKills[currentBoss.id]||0)+1;

  showNotify(`🎉 BOSS DEFEATED! +${currentBoss.reward.gold.toLocaleString()}💰 +${currentBoss.reward.gems}💎`,'epic');
  playSound('victory');

  // Reset for next boss
  currentBoss=null;
  save();
  updateBossMode();
}

// ===== CASH SHOP SYSTEM =====
if(!P.cashBalance)P.cashBalance=0;
if(!P.cashPurchases)P.cashPurchases=[];

const CASH_SHOP_ITEMS=[
// === GEM PACKS (20 items) ===
{id:'gems_1',name:'Pile of Gems',icon:'💎',desc:'80 Gems',price:0.99,category:'gems',reward:{gems:80}},
{id:'gems_2',name:'Bag of Gems',icon:'💎',desc:'200 Gems',price:1.99,category:'gems',reward:{gems:200}},
{id:'gems_3',name:'Box of Gems',icon:'💎',desc:'500 Gems',price:4.99,category:'gems',reward:{gems:500}},
{id:'gems_4',name:'Chest of Gems',icon:'💎',desc:'1,200 Gems',price:9.99,category:'gems',reward:{gems:1200}},
{id:'gems_5',name:'Vault of Gems',icon:'💎',desc:'2,500 Gems',price:19.99,category:'gems',reward:{gems:2500}},
{id:'gems_6',name:'Mountain of Gems',icon:'💎',desc:'6,500 Gems',price:49.99,category:'gems',reward:{gems:6500},featured:true},
{id:'gems_7',name:'Ocean of Gems',icon:'💎',desc:'14,000 Gems',price:99.99,category:'gems',reward:{gems:14000},featured:true},
{id:'gems_8',name:'Starter Gems',icon:'💎',desc:'50 Gems',price:0.49,category:'gems',reward:{gems:50}},
{id:'gems_9',name:'Bonus Gems',icon:'💎',desc:'350 Gems +50 bonus',price:2.99,category:'gems',reward:{gems:400}},
{id:'gems_10',name:'Super Gems',icon:'💎',desc:'800 Gems +200 bonus',price:6.99,category:'gems',reward:{gems:1000}},
{id:'gems_11',name:'Mega Gems',icon:'💎',desc:'1,800 Gems +400 bonus',price:14.99,category:'gems',reward:{gems:2200}},
{id:'gems_12',name:'Ultra Gems',icon:'💎',desc:'4,000 Gems +1,000 bonus',price:34.99,category:'gems',reward:{gems:5000}},
{id:'gems_13',name:'Weekly Gems',icon:'💎',desc:'300 Gems/week',price:2.99,category:'gems',reward:{gems:300}},
{id:'gems_14',name:'Monthly Gems',icon:'💎',desc:'2,000 Gems/month',price:14.99,category:'gems',reward:{gems:2000}},
{id:'gems_15',name:'Gem Fountain',icon:'💎',desc:'100 Gems daily for 7 days',price:4.99,category:'gems',reward:{gems:700}},
{id:'gems_16',name:'Gem Rain',icon:'💎',desc:'200 Gems daily for 7 days',price:9.99,category:'gems',reward:{gems:1400}},
{id:'gems_17',name:'Gem Storm',icon:'💎',desc:'500 Gems daily for 7 days',price:19.99,category:'gems',reward:{gems:3500}},
{id:'gems_18',name:'Lucky Gems',icon:'🍀',desc:'77 Lucky Gems',price:0.77,category:'gems',reward:{gems:77}},
{id:'gems_19',name:'Double Gems',icon:'💎',desc:'1,000 Gems x2 value!',price:7.99,category:'gems',reward:{gems:1000},featured:true},
{id:'gems_20',name:'Triple Gems',icon:'💎',desc:'3,000 Gems x3 value!',price:19.99,category:'gems',reward:{gems:3000},featured:true},
// === GOLD PACKS (20 items) ===
{id:'gold_1',name:'Pile of Gold',icon:'💰',desc:'5,000 Gold',price:0.99,category:'gold',reward:{gold:5000}},
{id:'gold_2',name:'Bag of Gold',icon:'💰',desc:'15,000 Gold',price:1.99,category:'gold',reward:{gold:15000}},
{id:'gold_3',name:'Box of Gold',icon:'💰',desc:'50,000 Gold',price:4.99,category:'gold',reward:{gold:50000}},
{id:'gold_4',name:'Chest of Gold',icon:'💰',desc:'125,000 Gold',price:9.99,category:'gold',reward:{gold:125000}},
{id:'gold_5',name:'Vault of Gold',icon:'💰',desc:'300,000 Gold',price:19.99,category:'gold',reward:{gold:300000}},
{id:'gold_6',name:'Treasury',icon:'💰',desc:'1,000,000 Gold',price:49.99,category:'gold',reward:{gold:1000000},featured:true},
{id:'gold_7',name:'King\'s Fortune',icon:'💰',desc:'2,500,000 Gold',price:99.99,category:'gold',reward:{gold:2500000},featured:true},
{id:'gold_8',name:'Starter Gold',icon:'💰',desc:'2,000 Gold',price:0.49,category:'gold',reward:{gold:2000}},
{id:'gold_9',name:'Bonus Gold',icon:'💰',desc:'40,000 Gold +10k bonus',price:3.99,category:'gold',reward:{gold:50000}},
{id:'gold_10',name:'Super Gold',icon:'💰',desc:'100,000 Gold +25k bonus',price:7.99,category:'gold',reward:{gold:125000}},
{id:'gold_11',name:'Mega Gold',icon:'💰',desc:'250,000 Gold +75k bonus',price:17.99,category:'gold',reward:{gold:325000}},
{id:'gold_12',name:'Gold Mine',icon:'⛏️',desc:'10,000 Gold/day for 30 days',price:9.99,category:'gold',reward:{gold:300000}},
{id:'gold_13',name:'Gold Rush',icon:'💰',desc:'50,000 Gold instant',price:3.99,category:'gold',reward:{gold:50000}},
{id:'gold_14',name:'Gold Fever',icon:'💰',desc:'200,000 Gold instant',price:12.99,category:'gold',reward:{gold:200000}},
{id:'gold_15',name:'Midas Touch',icon:'👑',desc:'500,000 Gold +100 gems',price:29.99,category:'gold',reward:{gold:500000,gems:100}},
{id:'gold_16',name:'Dragon Hoard',icon:'🐉',desc:'750,000 Gold',price:39.99,category:'gold',reward:{gold:750000}},
{id:'gold_17',name:'Pirate Treasure',icon:'🏴‍☠️',desc:'100,000 Gold +chest',price:7.99,category:'gold',reward:{gold:100000,chest:'gold'}},
{id:'gold_18',name:'Lucky Gold',icon:'🍀',desc:'77,777 Gold',price:5.55,category:'gold',reward:{gold:77777}},
{id:'gold_19',name:'Double Gold',icon:'💰',desc:'200,000 Gold x2 value!',price:9.99,category:'gold',reward:{gold:200000},featured:true},
{id:'gold_20',name:'Infinite Gold',icon:'♾️',desc:'999,999 Gold',price:44.99,category:'gold',reward:{gold:999999}},
// === CHEST PACKS (25 items) ===
{id:'chest_1',name:'Silver Chest',icon:'📦',desc:'1 Silver Chest',price:0.49,category:'chests',reward:{chest:'silver'}},
{id:'chest_2',name:'Gold Chest',icon:'🎁',desc:'1 Gold Chest',price:0.99,category:'chests',reward:{chest:'gold'}},
{id:'chest_3',name:'Magic Chest',icon:'✨',desc:'1 Magic Chest',price:1.99,category:'chests',reward:{chest:'magic'}},
{id:'chest_4',name:'Giant Chest',icon:'🏆',desc:'1 Giant Chest',price:2.99,category:'chests',reward:{chest:'giant'}},
{id:'chest_5',name:'Super Chest',icon:'💎',desc:'1 Super Chest',price:4.99,category:'chests',reward:{chest:'super'}},
{id:'chest_6',name:'Legendary Chest',icon:'👑',desc:'1 Legendary Chest',price:9.99,category:'chests',reward:{chest:'legendary'},featured:true},
{id:'chest_7',name:'Silver x5',icon:'📦',desc:'5 Silver Chests',price:1.99,category:'chests',reward:{chestMulti:{type:'silver',count:5}}},
{id:'chest_8',name:'Gold x5',icon:'🎁',desc:'5 Gold Chests',price:3.99,category:'chests',reward:{chestMulti:{type:'gold',count:5}}},
{id:'chest_9',name:'Magic x3',icon:'✨',desc:'3 Magic Chests',price:4.99,category:'chests',reward:{chestMulti:{type:'magic',count:3}}},
{id:'chest_10',name:'Giant x3',icon:'🏆',desc:'3 Giant Chests',price:7.99,category:'chests',reward:{chestMulti:{type:'giant',count:3}}},
{id:'chest_11',name:'Legendary x3',icon:'👑',desc:'3 Legendary Chests',price:24.99,category:'chests',reward:{chestMulti:{type:'legendary',count:3}},featured:true},
{id:'chest_12',name:'Mixed Pack',icon:'📦',desc:'2 of each chest type',price:14.99,category:'chests',reward:{chestMulti:{type:'mixed',count:10}}},
{id:'chest_13',name:'Mega Pack',icon:'🎁',desc:'10 random chests',price:9.99,category:'chests',reward:{chestMulti:{type:'random',count:10}}},
{id:'chest_14',name:'Ultra Pack',icon:'💎',desc:'20 random chests',price:17.99,category:'chests',reward:{chestMulti:{type:'random',count:20}}},
{id:'chest_15',name:'Royal Pack',icon:'👑',desc:'5 Super + 2 Legendary',price:34.99,category:'chests',reward:{chestMulti:{type:'royal',count:7}},featured:true},
{id:'chest_16',name:'Crown Chest',icon:'👑',desc:'Special Crown Chest',price:4.99,category:'chests',reward:{chest:'crown'}},
{id:'chest_17',name:'Champion Chest',icon:'🏅',desc:'Guaranteed Champion',price:19.99,category:'chests',reward:{chest:'champion'},featured:true},
{id:'chest_18',name:'Fortune Chest',icon:'🍀',desc:'Extra lucky drops',price:6.99,category:'chests',reward:{chest:'fortune'}},
{id:'chest_19',name:'Lightning Chest',icon:'⚡',desc:'Mega Lightning',price:7.99,category:'chests',reward:{chest:'lightning'}},
{id:'chest_20',name:'Royal Wild',icon:'🃏',desc:'Royal Wild Chest',price:8.99,category:'chests',reward:{chest:'royalwild'}},
{id:'chest_21',name:'Starter Bundle',icon:'🎁',desc:'3 Silver + 2 Gold',price:1.99,category:'chests',reward:{chestMulti:{type:'starter',count:5}}},
{id:'chest_22',name:'Daily Chest',icon:'📅',desc:'1 chest daily for week',price:2.99,category:'chests',reward:{chestMulti:{type:'daily',count:7}}},
{id:'chest_23',name:'Weekend Chest',icon:'🎉',desc:'Special weekend chest',price:3.99,category:'chests',reward:{chest:'weekend'}},
{id:'chest_24',name:'Event Chest',icon:'🎊',desc:'Limited event chest',price:5.99,category:'chests',reward:{chest:'event'}},
{id:'chest_25',name:'Mythic Chest',icon:'🔮',desc:'Mythic rarity chest',price:14.99,category:'chests',reward:{chest:'mythic'},featured:true},
// === BUNDLES (30 items) ===
{id:'bundle_1',name:'Starter Bundle',icon:'🎁',desc:'500 gems + 10k gold',price:4.99,category:'bundles',reward:{gems:500,gold:10000}},
{id:'bundle_2',name:'Value Bundle',icon:'🎁',desc:'1000 gems + 50k gold',price:9.99,category:'bundles',reward:{gems:1000,gold:50000}},
{id:'bundle_3',name:'Super Bundle',icon:'🎁',desc:'2500 gems + 150k gold',price:19.99,category:'bundles',reward:{gems:2500,gold:150000},featured:true},
{id:'bundle_4',name:'Mega Bundle',icon:'🎁',desc:'5000 gems + 500k gold',price:49.99,category:'bundles',reward:{gems:5000,gold:500000},featured:true},
{id:'bundle_5',name:'Ultra Bundle',icon:'🎁',desc:'10000 gems + 1M gold',price:99.99,category:'bundles',reward:{gems:10000,gold:1000000},featured:true},
{id:'bundle_6',name:'Arena Bundle',icon:'🏟️',desc:'Gems + chests + gold',price:14.99,category:'bundles',reward:{gems:1000,gold:75000,chest:'magic'}},
{id:'bundle_7',name:'Champion Bundle',icon:'🏅',desc:'Champion + gems',price:24.99,category:'bundles',reward:{gems:2000,chest:'champion'}},
{id:'bundle_8',name:'Legendary Bundle',icon:'👑',desc:'Legendary + gems + gold',price:19.99,category:'bundles',reward:{gems:1500,gold:100000,chest:'legendary'}},
{id:'bundle_9',name:'Royal Bundle',icon:'👑',desc:'All premium rewards',price:34.99,category:'bundles',reward:{gems:3000,gold:250000,chest:'super'}},
{id:'bundle_10',name:'Dragon Bundle',icon:'🐉',desc:'Dragon rewards',price:29.99,category:'bundles',reward:{gems:2500,gold:200000,chest:'giant'}},
{id:'bundle_11',name:'Crystal Bundle',icon:'💠',desc:'1000 Crystals + gems',price:14.99,category:'bundles',reward:{crystals:1000,gems:500}},
{id:'bundle_12',name:'Medal Bundle',icon:'🏅',desc:'500 Medals + gold',price:12.99,category:'bundles',reward:{medals:500,gold:100000}},
{id:'bundle_13',name:'Wild Bundle',icon:'🃏',desc:'50 Wild Cards + gems',price:9.99,category:'bundles',reward:{wildCards:50,gems:300}},
{id:'bundle_14',name:'Star Bundle',icon:'⭐',desc:'5000 Star Points',price:7.99,category:'bundles',reward:{starPoints:5000}},
{id:'bundle_15',name:'Token Bundle',icon:'👹',desc:'100 Boss Tokens',price:6.99,category:'bundles',reward:{bossTokens:100}},
{id:'bundle_16',name:'Newbie Bundle',icon:'🌟',desc:'Perfect for beginners',price:2.99,category:'bundles',reward:{gems:200,gold:20000,chest:'gold'}},
{id:'bundle_17',name:'Warrior Bundle',icon:'⚔️',desc:'Battle rewards',price:11.99,category:'bundles',reward:{gems:800,gold:80000,trophies:500}},
{id:'bundle_18',name:'Victory Bundle',icon:'🏆',desc:'Winner\'s pack',price:16.99,category:'bundles',reward:{gems:1200,gold:120000,chest:'magic'}},
{id:'bundle_19',name:'Elite Bundle',icon:'💫',desc:'Elite rewards',price:44.99,category:'bundles',reward:{gems:4000,gold:400000,chest:'legendary'},featured:true},
{id:'bundle_20',name:'VIP Bundle',icon:'💎',desc:'VIP exclusive',price:79.99,category:'bundles',reward:{gems:8000,gold:800000,chest:'legendary'},featured:true},
{id:'bundle_21',name:'Weekly Bundle',icon:'📅',desc:'Best weekly value',price:5.99,category:'bundles',reward:{gems:600,gold:60000}},
{id:'bundle_22',name:'Monthly Bundle',icon:'📆',desc:'Best monthly value',price:19.99,category:'bundles',reward:{gems:2200,gold:220000}},
{id:'bundle_23',name:'Season Bundle',icon:'🍂',desc:'Seasonal rewards',price:29.99,category:'bundles',reward:{gems:3000,gold:300000,chest:'super'}},
{id:'bundle_24',name:'Event Bundle',icon:'🎊',desc:'Limited event pack',price:14.99,category:'bundles',reward:{gems:1500,gold:150000}},
{id:'bundle_25',name:'Holiday Bundle',icon:'🎄',desc:'Holiday special',price:24.99,category:'bundles',reward:{gems:2500,gold:250000,chest:'magic'}},
{id:'bundle_26',name:'Birthday Bundle',icon:'🎂',desc:'Birthday rewards',price:9.99,category:'bundles',reward:{gems:1000,gold:100000}},
{id:'bundle_27',name:'Anniversary',icon:'🎉',desc:'Anniversary pack',price:39.99,category:'bundles',reward:{gems:4500,gold:450000,chest:'legendary'}},
{id:'bundle_28',name:'Flash Bundle',icon:'⚡',desc:'Quick value!',price:3.99,category:'bundles',reward:{gems:400,gold:40000}},
{id:'bundle_29',name:'Midnight Bundle',icon:'🌙',desc:'Night special',price:7.99,category:'bundles',reward:{gems:750,gold:75000}},
{id:'bundle_30',name:'Rainbow Bundle',icon:'🌈',desc:'All currencies!',price:49.99,category:'bundles',reward:{gems:5000,gold:500000,crystals:500,starPoints:2500},featured:true},
// === SKINS (25 items) ===
{id:'skin_1',name:'Fire Tower',icon:'🔥',desc:'Flaming tower skin',price:4.99,category:'skins',reward:{towerSkin:'tower_fire'}},
{id:'skin_2',name:'Ice Tower',icon:'❄️',desc:'Frozen tower skin',price:4.99,category:'skins',reward:{towerSkin:'tower_ice'}},
{id:'skin_3',name:'Gold Tower',icon:'🏆',desc:'Golden tower skin',price:9.99,category:'skins',reward:{towerSkin:'tower_gold'},featured:true},
{id:'skin_4',name:'Crystal Tower',icon:'💎',desc:'Crystal tower skin',price:7.99,category:'skins',reward:{towerSkin:'tower_crystal'}},
{id:'skin_5',name:'Dragon Tower',icon:'🐉',desc:'Dragon tower skin',price:14.99,category:'skins',reward:{towerSkin:'tower_dragon'},featured:true},
{id:'skin_6',name:'Skeleton Tower',icon:'💀',desc:'Spooky tower skin',price:6.99,category:'skins',reward:{towerSkin:'tower_skeleton'}},
{id:'skin_7',name:'Nature Tower',icon:'🌿',desc:'Nature tower skin',price:4.99,category:'skins',reward:{towerSkin:'tower_nature'}},
{id:'skin_8',name:'Ocean Tower',icon:'🌊',desc:'Ocean tower skin',price:5.99,category:'skins',reward:{towerSkin:'tower_ocean'}},
{id:'skin_9',name:'Void Tower',icon:'🌑',desc:'Dark void skin',price:9.99,category:'skins',reward:{towerSkin:'tower_void'}},
{id:'skin_10',name:'Rainbow Tower',icon:'🌈',desc:'Rainbow tower skin',price:12.99,category:'skins',reward:{towerSkin:'tower_rainbow'},featured:true},
{id:'skin_11',name:'Electric Tower',icon:'⚡',desc:'Electric tower skin',price:7.99,category:'skins',reward:{towerSkin:'tower_electric'}},
{id:'skin_12',name:'Candy Tower',icon:'🍭',desc:'Sweet tower skin',price:5.99,category:'skins',reward:{towerSkin:'tower_candy'}},
{id:'skin_13',name:'Galaxy Tower',icon:'🌌',desc:'Cosmic tower skin',price:14.99,category:'skins',reward:{towerSkin:'tower_galaxy'},featured:true},
{id:'skin_14',name:'Lava Tower',icon:'🌋',desc:'Volcanic tower skin',price:8.99,category:'skins',reward:{towerSkin:'tower_lava'}},
{id:'skin_15',name:'Forest Tower',icon:'🌲',desc:'Forest tower skin',price:4.99,category:'skins',reward:{towerSkin:'tower_forest'}},
{id:'skin_16',name:'Royal Tower',icon:'👑',desc:'Royal tower skin',price:19.99,category:'skins',reward:{towerSkin:'tower_royal'},featured:true},
{id:'skin_17',name:'Cyber Tower',icon:'🤖',desc:'Futuristic skin',price:11.99,category:'skins',reward:{towerSkin:'tower_cyber'}},
{id:'skin_18',name:'Steampunk Tower',icon:'⚙️',desc:'Steampunk skin',price:9.99,category:'skins',reward:{towerSkin:'tower_steampunk'}},
{id:'skin_19',name:'Neon Tower',icon:'💡',desc:'Neon glow skin',price:8.99,category:'skins',reward:{towerSkin:'tower_neon'}},
{id:'skin_20',name:'Ancient Tower',icon:'🏛️',desc:'Ancient ruins skin',price:6.99,category:'skins',reward:{towerSkin:'tower_ancient'}},
{id:'skin_21',name:'Skin Pack 1',icon:'🎨',desc:'5 random skins',price:19.99,category:'skins',reward:{skinPack:5}},
{id:'skin_22',name:'Skin Pack 2',icon:'🎨',desc:'10 random skins',price:34.99,category:'skins',reward:{skinPack:10},featured:true},
{id:'skin_23',name:'Emote Pack',icon:'😀',desc:'10 exclusive emotes',price:9.99,category:'skins',reward:{emotePack:10}},
{id:'skin_24',name:'Arena Skin',icon:'🏟️',desc:'Custom arena theme',price:14.99,category:'skins',reward:{arenaSkin:'custom'}},
{id:'skin_25',name:'All Skins',icon:'✨',desc:'Unlock all skins!',price:99.99,category:'skins',reward:{allSkins:true},featured:true},
// === PASSES (15 items) ===
{id:'pass_1',name:'Pass Royale',icon:'👑',desc:'Unlock all pass perks',price:4.99,category:'passes',reward:{passRoyale:true},featured:true},
{id:'pass_2',name:'Battle Pass+',icon:'⚔️',desc:'Enhanced battle pass',price:9.99,category:'passes',reward:{battlePassPlus:true}},
{id:'pass_3',name:'VIP Pass',icon:'💎',desc:'VIP member benefits',price:14.99,category:'passes',reward:{vipPass:true},featured:true},
{id:'pass_4',name:'Season Pass',icon:'🍂',desc:'Full season access',price:19.99,category:'passes',reward:{seasonPass:true}},
{id:'pass_5',name:'Elite Pass',icon:'💫',desc:'Elite tier rewards',price:24.99,category:'passes',reward:{elitePass:true}},
{id:'pass_6',name:'Champion Pass',icon:'🏅',desc:'Champion access',price:29.99,category:'passes',reward:{championPass:true},featured:true},
{id:'pass_7',name:'Legendary Pass',icon:'👑',desc:'Legendary perks',price:39.99,category:'passes',reward:{legendaryPass:true}},
{id:'pass_8',name:'Event Pass',icon:'🎊',desc:'Event exclusive',price:7.99,category:'passes',reward:{eventPass:true}},
{id:'pass_9',name:'Tournament Pass',icon:'🏆',desc:'Tournament entry',price:4.99,category:'passes',reward:{tournamentPass:true}},
{id:'pass_10',name:'Challenge Pass',icon:'🎯',desc:'Unlimited retries',price:2.99,category:'passes',reward:{challengePass:true}},
{id:'pass_11',name:'Clan Pass',icon:'⚔️',desc:'Clan war bonuses',price:9.99,category:'passes',reward:{clanPass:true}},
{id:'pass_12',name:'Trophy Pass',icon:'🏆',desc:'2x trophy gains',price:14.99,category:'passes',reward:{trophyPass:true}},
{id:'pass_13',name:'Gold Pass',icon:'💰',desc:'2x gold earnings',price:9.99,category:'passes',reward:{goldPass:true}},
{id:'pass_14',name:'Gem Pass',icon:'💎',desc:'Daily gem bonus',price:19.99,category:'passes',reward:{gemPass:true}},
{id:'pass_15',name:'Ultimate Pass',icon:'♾️',desc:'All passes included!',price:99.99,category:'passes',reward:{ultimatePass:true},featured:true},
// === BOOSTERS (12 items) ===
{id:'boost_1',name:'XP Boost 1hr',icon:'⚡',desc:'2x XP for 1 hour',price:0.99,category:'boosters',reward:{xpBoost:1}},
{id:'boost_2',name:'XP Boost 24hr',icon:'⚡',desc:'2x XP for 24 hours',price:2.99,category:'boosters',reward:{xpBoost:24}},
{id:'boost_3',name:'Gold Boost 1hr',icon:'💰',desc:'2x gold for 1 hour',price:0.99,category:'boosters',reward:{goldBoost:1}},
{id:'boost_4',name:'Gold Boost 24hr',icon:'💰',desc:'2x gold for 24 hours',price:2.99,category:'boosters',reward:{goldBoost:24}},
{id:'boost_5',name:'Trophy Boost',icon:'🏆',desc:'2x trophies for 1hr',price:1.99,category:'boosters',reward:{trophyBoost:1}},
{id:'boost_6',name:'Chest Boost',icon:'📦',desc:'Faster chest unlock',price:1.49,category:'boosters',reward:{chestBoost:true}},
{id:'boost_7',name:'Lucky Boost',icon:'🍀',desc:'Better drop rates',price:2.49,category:'boosters',reward:{luckyBoost:true}},
{id:'boost_8',name:'Power Boost',icon:'💪',desc:'10% stronger troops',price:1.99,category:'boosters',reward:{powerBoost:true}},
{id:'boost_10',name:'Shield Boost',icon:'🛡️',desc:'Trophy loss shield',price:2.99,category:'boosters',reward:{shieldBoost:true}},
{id:'boost_11',name:'Mega Boost',icon:'🔥',desc:'All boosts for 1hr',price:4.99,category:'boosters',reward:{megaBoost:1},featured:true},
{id:'boost_12',name:'Ultra Boost',icon:'💎',desc:'All boosts for 24hr',price:500.00,category:'boosters',reward:{megaBoost:24},featured:true},
// === SPECIAL (5 items) ===
{id:'special_1',name:'Name Change',icon:'✏️',desc:'Change your name',price:2.99,category:'special',reward:{nameChange:true}},
{id:'special_2',name:'Unlock All Cards',icon:'🎴',desc:'Unlock every card!',price:49.99,category:'special',reward:{unlockAllCards:true},featured:true},
{id:'special_3',name:'Max All Cards',icon:'⬆️',desc:'Max all card levels!',price:99.99,category:'special',reward:{maxAllCards:true},featured:true},
{id:'special_4',name:'Trophy Reset',icon:'🔄',desc:'Reset trophies to 0',price:0.99,category:'special',reward:{trophyReset:true}},
{id:'special_5',name:'Everything Pack',icon:'♾️',desc:'Unlock EVERYTHING!',price:499.99,category:'special',reward:{everything:true},featured:true},
{id:'special_6',name:'Unlimited Levels',icon:'🚀',desc:'Pick 1 card - no level cap! Buy again to remove.',price:14.99,category:'special',reward:{unlimitedLevelsPick:true},featured:true}
];

let cashShopFilter='all';

function setCashBalance(){
  P.cashBalance=Math.max(0,parseFloat(document.getElementById('admCashBalance').value)||0);
  save();
  updateCashShop();
  showNotify('💵 Balance Set!\n$'+P.cashBalance.toFixed(2),'success');
}

function updateCashShop(){
  const grid=document.getElementById('cashShopGrid');
  const display=document.getElementById('cashBalanceDisplay');
  if(display)display.textContent=(P.cashBalance||0).toFixed(2);
  if(!grid)return;

  const items=cashShopFilter==='all'?CASH_SHOP_ITEMS:CASH_SHOP_ITEMS.filter(i=>i.category===cashShopFilter);
  grid.innerHTML=items.map(item=>`
    <div class="cash-item${item.featured?' featured':''}" onclick="buyCashItem('${item.id}')">
      <div class="item-icon">${item.icon}</div>
      <div class="item-name">${item.name}</div>
      <div class="item-desc">${item.desc}</div>
      <div class="item-price">$${item.price.toFixed(2)}</div>
    </div>
  `).join('');
}

function filterCashShop(category){
  cashShopFilter=category;
  document.querySelectorAll('.cash-filter').forEach(btn=>btn.classList.remove('active'));
  const btn=document.getElementById('cashFilter'+category.charAt(0).toUpperCase()+category.slice(1));
  if(btn)btn.classList.add('active');
  else document.getElementById('cashFilterAll').classList.add('active');
  updateCashShop();
}

function buyCashItem(itemId){
  const item=CASH_SHOP_ITEMS.find(i=>i.id===itemId);
  if(!item)return;
  if((P.cashBalance||0)<item.price){
    showNotify('Not enough balance!\nNeed $'+item.price.toFixed(2),'error','💵');
    return;
  }

  P.cashBalance-=item.price;
  P.cashPurchases.push({id:item.id,date:Date.now()});

  // Apply rewards
  const r=item.reward;
  if(r.gems)P.gems=(P.gems||0)+r.gems;
  if(r.gold)P.gold=(P.gold||0)+r.gold;
  if(r.crystals)P.crystals=(P.crystals||0)+r.crystals;
  if(r.starPoints)P.starPoints=(P.starPoints||0)+r.starPoints;
  if(r.medals)P.medals=(P.medals||0)+r.medals;
  if(r.wildCards)P.royalWildCards=(P.royalWildCards||0)+r.wildCards;
  if(r.bossTokens)P.bossTokens=(P.bossTokens||0)+r.bossTokens;
  if(r.trophies)P.tr=(P.tr||0)+r.trophies;
  if(r.chest){
    const ct=CHEST_TYPES.find(t=>t.id===r.chest);
    if(ct){if(!addChest(ct)){showNotify('No empty chest slots!','error','📦');P.cashBalance+=item.price;return;}}
  }
  if(r.chestMulti){
    let added=0;
    for(let i=0;i<r.chestMulti.count;i++){
      const typeId=r.chestMulti.type==='random'?['silver','gold','magic','giant','super'][Math.floor(Math.random()*5)]:r.chestMulti.type;
      const ct=CHEST_TYPES.find(t=>t.id===typeId);
      if(ct&&addChest(ct))added++;
    }
    if(added===0){showNotify('No empty chest slots!','error','📦');P.cashBalance+=item.price;return;}
    if(added<r.chestMulti.count)showNotify(`Added ${added}/${r.chestMulti.count} chests (slots full)`,'warning','📦');
  }
  if(r.passRoyale)P.bpPremium=true;
  if(r.unlockAllCards)CARDS.forEach(c=>{if(!P.unlocked.includes(c.id))P.unlocked.push(c.id);});
  if(r.maxAllCards)CARDS.forEach(c=>{P.lvls[c.id]=15;});
  if(r.towerSkin&&!P.ownedTowerSkins.includes(r.towerSkin))P.ownedTowerSkins.push(r.towerSkin);
  if(r.unlimitedLevelsPick){
    // If already has unlimited card, remove it
    if(P.unlimitedLevelCard){
      showNotify(`🚀 Removed unlimited levels from ${getCard(P.unlimitedLevelCard).icon} ${getCard(P.unlimitedLevelCard).name}`,'info');
      P.unlimitedLevelCard=null;
    }else{
      // Show card picker
      showUnlimitedLevelPicker();
    }
    save();updateCashShop();updateCards();
    playSound('click');
    return;
  }

  save();
  updateCashShop();
  updateStats();
  updateShop();
  updateChests();
  updateCards();
  showNotify(`✅ Purchased!\n${item.icon} ${item.name}`,'success');
  playSound('victory');
}

function showUnlimitedLevelPicker(){
  const modal=document.createElement('div');
  modal.id='unlimitedPickerModal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML=`
    <div style="background:linear-gradient(145deg,#1b2838,#0d1b2a);border:3px solid #2ecc71;border-radius:15px;padding:20px;max-width:350px;max-height:80vh;overflow-y:auto">
      <div style="text-align:center;font-size:16px;font-weight:900;color:#2ecc71;margin-bottom:15px">🚀 PICK 1 CARD FOR UNLIMITED LEVELS</div>
      <div style="font-size:10px;color:#888;text-align:center;margin-bottom:15px">This card will have no level cap. Buy again to remove.</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
        ${CARDS.filter(c=>P.unlocked.includes(c.id)).map(c=>`
          <div onclick="selectUnlimitedCard('${c.id}')" style="background:linear-gradient(145deg,#2a3a4a,#1a2a3a);border:2px solid #444;border-radius:8px;padding:8px;text-align:center;cursor:pointer">
            <div style="font-size:24px">${c.icon}</div>
            <div style="font-size:8px;color:#fff">${c.name}</div>
            <div style="font-size:8px;color:#888">Lv.${P.lvls[c.id]||1}</div>
          </div>
        `).join('')}
      </div>
      <button onclick="document.getElementById('unlimitedPickerModal').remove()" style="width:100%;margin-top:15px;padding:10px;background:#e74c3c;border:none;border-radius:8px;color:#fff;font-weight:800;cursor:pointer">Cancel</button>
    </div>
  `;
  document.body.appendChild(modal);
}

function selectUnlimitedCard(cardId){
  P.unlimitedLevelCard=cardId;
  const c=getCard(cardId);
  save();
  document.getElementById('unlimitedPickerModal').remove();
  updateCards();
  showNotify(`🚀 ${c.icon} ${c.name}\nNow has UNLIMITED LEVELS!`,'epic');
  playSound('victory');
}

// Initialize everything
try{updatePlay();}catch(e){console.error('updatePlay error:',e);}
try{updateChests();}catch(e){console.error('updateChests error:',e);}
try{updateCards();}catch(e){console.error('updateCards error:',e);}
try{updateShop();}catch(e){console.error('updateShop error:',e);}
try{updateDailyNotif();}catch(e){console.error('updateDailyNotif error:',e);}
try{setGameModeBtn('normal');}catch(e){console.error('setGameModeBtn error:',e);}
try{updateClan();}catch(e){console.error('updateClan error:',e);}
try{updateBattlePass();}catch(e){console.error('updateBattlePass error:',e);}
try{updateBattleLog();}catch(e){console.error('updateBattleLog error:',e);}
try{updateWorkshop();}catch(e){console.error('updateWorkshop error:',e);}
try{updateCustomModeChips();}catch(e){console.error('updateCustomModeChips error:',e);}
try{updateCashShop();}catch(e){console.error('updateCashShop error:',e);}
