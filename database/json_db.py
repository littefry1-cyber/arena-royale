"""
JSON File Database Wrapper
Simple file-based database using JSON files for Arena Royale multiplayer
With caching for improved performance
"""

import os
import json
import asyncio
import aiofiles
from typing import Optional, Dict, List, Any
from datetime import datetime
import uuid
import time

# Base data directory
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')

# Ensure directories exist
SUBDIRS = ['players', 'clans', 'tournaments', 'trades']
for subdir in SUBDIRS:
    os.makedirs(os.path.join(DATA_DIR, subdir), exist_ok=True)

# File locks for concurrent access
_locks: Dict[str, asyncio.Lock] = {}

# ==================== CACHING SYSTEM ====================
# Cache players in memory to reduce file I/O
_player_cache: Dict[str, Dict] = {}
_username_index: Dict[str, str] = {}  # username -> player_id
_cache_timestamps: Dict[str, float] = {}
CACHE_TTL = 60  # Cache expires after 60 seconds

def _is_cache_valid(player_id: str) -> bool:
    """Check if cached data is still valid"""
    if player_id not in _cache_timestamps:
        return False
    return time.time() - _cache_timestamps[player_id] < CACHE_TTL

def _cache_player(player: Dict):
    """Add player to cache"""
    player_id = player['id']
    _player_cache[player_id] = player
    _cache_timestamps[player_id] = time.time()
    # Update username index
    username = player.get('username', '').lower()
    if username:
        _username_index[username] = player_id

def _invalidate_cache(player_id: str):
    """Remove player from cache"""
    if player_id in _player_cache:
        username = _player_cache[player_id].get('username', '').lower()
        if username in _username_index:
            del _username_index[username]
        del _player_cache[player_id]
    if player_id in _cache_timestamps:
        del _cache_timestamps[player_id]

async def warm_cache():
    """Pre-load all players into cache on server startup for faster access"""
    players_dir = os.path.join(DATA_DIR, 'players')
    if not os.path.exists(players_dir):
        return 0

    count = 0
    for filename in os.listdir(players_dir):
        if filename.endswith('.json'):
            filepath = os.path.join(players_dir, filename)
            try:
                async with aiofiles.open(filepath, 'r', encoding='utf-8') as f:
                    content = await f.read()
                    player = json.loads(content) if content else None
                    if player:
                        _cache_player(player)
                        count += 1
            except Exception as e:
                print(f"Error caching {filename}: {e}")

    print(f"Cache warmed: {count} players loaded")
    return count

def _get_lock(path: str) -> asyncio.Lock:
    """Get or create a lock for a specific file path"""
    if path not in _locks:
        _locks[path] = asyncio.Lock()
    return _locks[path]

async def read_json(filepath: str) -> Optional[Dict]:
    """Read a JSON file asynchronously"""
    if not os.path.exists(filepath):
        return None
    try:
        async with _get_lock(filepath):
            async with aiofiles.open(filepath, 'r', encoding='utf-8') as f:
                content = await f.read()
                return json.loads(content) if content else None
    except (json.JSONDecodeError, IOError) as e:
        print(f"Error reading {filepath}: {e}")
        return None

async def write_json(filepath: str, data: Dict) -> bool:
    """Write a JSON file asynchronously"""
    try:
        async with _get_lock(filepath):
            async with aiofiles.open(filepath, 'w', encoding='utf-8') as f:
                await f.write(json.dumps(data, indent=2))
        return True
    except IOError as e:
        print(f"Error writing {filepath}: {e}")
        return False

async def delete_json(filepath: str) -> bool:
    """Delete a JSON file"""
    try:
        if os.path.exists(filepath):
            os.remove(filepath)
        return True
    except IOError as e:
        print(f"Error deleting {filepath}: {e}")
        return False

# ==================== PLAYER OPERATIONS ====================

def _player_path(player_id: str) -> str:
    return os.path.join(DATA_DIR, 'players', f'{player_id}.json')

async def get_player(player_id: str) -> Optional[Dict]:
    """Get a player by ID (with caching)"""
    # Check cache first
    if _is_cache_valid(player_id) and player_id in _player_cache:
        return _player_cache[player_id]

    # Load from file
    player = await read_json(_player_path(player_id))
    if player:
        _cache_player(player)
    return player

async def save_player(player: Dict) -> bool:
    """Save a player (create or update) and update cache"""
    player['updated_at'] = datetime.now().timestamp()
    success = await write_json(_player_path(player['id']), player)
    if success:
        _cache_player(player)
    return success

async def delete_player(player_id: str) -> bool:
    """Delete a player and remove from cache"""
    _invalidate_cache(player_id)
    return await delete_json(_player_path(player_id))

async def find_player_by_username(username: str) -> Optional[Dict]:
    """Find a player by username (case-insensitive) with index optimization"""
    username_lower = username.lower()

    # Check username index first (fast lookup)
    if username_lower in _username_index:
        player_id = _username_index[username_lower]
        return await get_player(player_id)

    # Fallback to scanning files
    players_dir = os.path.join(DATA_DIR, 'players')
    if not os.path.exists(players_dir):
        return None

    for filename in os.listdir(players_dir):
        if filename.endswith('.json'):
            player = await read_json(os.path.join(players_dir, filename))
            if player:
                _cache_player(player)  # Cache while scanning
                if player.get('username', '').lower() == username_lower:
                    return player
    return None

async def get_all_players(include_banned: bool = False) -> List[Dict]:
    """Get all players (for leaderboards) with caching

    Args:
        include_banned: If True, include banned players (for admin use)
    """
    players = []
    players_dir = os.path.join(DATA_DIR, 'players')

    if not os.path.exists(players_dir):
        return players

    # Use concurrent file reading for better performance
    filenames = [f for f in os.listdir(players_dir) if f.endswith('.json')]

    for filename in filenames:
        player_id = filename.replace('.json', '')

        # Try cache first
        if _is_cache_valid(player_id) and player_id in _player_cache:
            player = _player_cache[player_id]
        else:
            player = await read_json(os.path.join(players_dir, filename))
            if player:
                _cache_player(player)

        # Exclude guests, and exclude banned players unless include_banned is True
        if player and not player.get('is_guest', False):
            if include_banned or not player.get('banned', False):
                players.append(player)

    return players

async def get_leaderboard(sort_by: str = 'trophies', limit: int = 100) -> List[Dict]:
    """Get sorted leaderboard"""
    players = await get_all_players()

    # Sort by the specified field
    if sort_by == 'trophies':
        players.sort(key=lambda p: p.get('stats', {}).get('trophies', 0), reverse=True)
    elif sort_by == 'medals':
        players.sort(key=lambda p: p.get('stats', {}).get('medals', 0), reverse=True)
    elif sort_by == 'comp_wins':
        players.sort(key=lambda p: p.get('stats', {}).get('comp_wins', 0), reverse=True)

    # Return top N with ranking info
    result = []
    for i, player in enumerate(players[:limit]):
        result.append({
            'rank': i + 1,
            'id': player['id'],
            'name': player.get('profile', {}).get('name', player.get('username', 'Unknown')),
            'trophies': player.get('stats', {}).get('trophies', 0),
            'medals': player.get('stats', {}).get('medals', 0),
            'comp_wins': player.get('stats', {}).get('comp_wins', 0),
        })
    return result

async def get_player_rank(player_id: str, sort_by: str = 'trophies') -> int:
    """Get a player's rank on the leaderboard"""
    players = await get_all_players()

    if sort_by == 'trophies':
        players.sort(key=lambda p: p.get('stats', {}).get('trophies', 0), reverse=True)
    elif sort_by == 'medals':
        players.sort(key=lambda p: p.get('stats', {}).get('medals', 0), reverse=True)
    elif sort_by == 'comp_wins':
        players.sort(key=lambda p: p.get('stats', {}).get('comp_wins', 0), reverse=True)

    for i, player in enumerate(players):
        if player['id'] == player_id:
            return i + 1
    return -1

# ==================== CLAN OPERATIONS ====================

def _clan_path(clan_id: str) -> str:
    return os.path.join(DATA_DIR, 'clans', f'{clan_id}.json')

async def get_clan(clan_id: str) -> Optional[Dict]:
    """Get a clan by ID"""
    return await read_json(_clan_path(clan_id))

async def save_clan(clan: Dict) -> bool:
    """Save a clan"""
    clan['updated_at'] = datetime.now().timestamp()
    return await write_json(_clan_path(clan['id']), clan)

async def delete_clan(clan_id: str) -> bool:
    """Delete a clan"""
    return await delete_json(_clan_path(clan_id))

async def get_all_clans() -> List[Dict]:
    """Get all clans"""
    clans = []
    clans_dir = os.path.join(DATA_DIR, 'clans')

    if not os.path.exists(clans_dir):
        return clans

    for filename in os.listdir(clans_dir):
        if filename.endswith('.json'):
            clan = await read_json(os.path.join(clans_dir, filename))
            if clan:
                clans.append(clan)
    return clans

async def search_clans(query: str = '', min_trophies: int = 0) -> List[Dict]:
    """Search clans by name"""
    clans = await get_all_clans()
    query_lower = query.lower()

    results = []
    for clan in clans:
        if query_lower in clan.get('name', '').lower():
            if clan.get('required_trophies', 0) <= min_trophies or not query:
                results.append({
                    'id': clan['id'],
                    'name': clan['name'],
                    'badge': clan.get('badge', 'default'),
                    'members': len(clan.get('members', [])),
                    'max_members': 50,
                    'required_trophies': clan.get('required_trophies', 0),
                    'type': clan.get('type', 'open'),
                    'war_trophies': clan.get('stats', {}).get('war_trophies', 0),
                })

    # Sort by member count
    results.sort(key=lambda c: c['members'], reverse=True)
    return results[:50]

# ==================== TOURNAMENT OPERATIONS ====================

def _tournament_path(tournament_id: str) -> str:
    return os.path.join(DATA_DIR, 'tournaments', f'{tournament_id}.json')

async def get_tournament(tournament_id: str) -> Optional[Dict]:
    """Get a tournament by ID"""
    return await read_json(_tournament_path(tournament_id))

async def save_tournament(tournament: Dict) -> bool:
    """Save a tournament"""
    tournament['updated_at'] = datetime.now().timestamp()
    return await write_json(_tournament_path(tournament['id']), tournament)

async def get_active_tournaments() -> List[Dict]:
    """Get all active tournaments"""
    tournaments = []
    tournaments_dir = os.path.join(DATA_DIR, 'tournaments')

    if not os.path.exists(tournaments_dir):
        return tournaments

    for filename in os.listdir(tournaments_dir):
        if filename.endswith('.json'):
            tournament = await read_json(os.path.join(tournaments_dir, filename))
            if tournament and tournament.get('status') in ['open', 'active']:
                tournaments.append(tournament)
    return tournaments

# ==================== TRADE OPERATIONS ====================

def _trade_path(trade_id: str) -> str:
    return os.path.join(DATA_DIR, 'trades', f'{trade_id}.json')

async def get_trade(trade_id: str) -> Optional[Dict]:
    """Get a trade by ID"""
    return await read_json(_trade_path(trade_id))

async def save_trade(trade: Dict) -> bool:
    """Save a trade"""
    trade['updated_at'] = datetime.now().timestamp()
    return await write_json(_trade_path(trade['id']), trade)

async def delete_trade(trade_id: str) -> bool:
    """Delete a trade"""
    return await delete_json(_trade_path(trade_id))

async def get_open_trades(exclude_player_id: str = None) -> List[Dict]:
    """Get all open trades"""
    trades = []
    trades_dir = os.path.join(DATA_DIR, 'trades')

    if not os.path.exists(trades_dir):
        return trades

    current_time = datetime.now().timestamp()

    for filename in os.listdir(trades_dir):
        if filename.endswith('.json'):
            trade = await read_json(os.path.join(trades_dir, filename))
            if trade and trade.get('status') == 'open':
                # Check if expired
                if trade.get('expires_at', 0) < current_time:
                    trade['status'] = 'expired'
                    await save_trade(trade)
                    continue
                # Exclude player's own trades if specified
                if exclude_player_id and trade.get('creator_id') == exclude_player_id:
                    continue
                trades.append(trade)

    # Sort by creation time (newest first)
    trades.sort(key=lambda t: t.get('created_at', 0), reverse=True)
    return trades

async def get_player_trades(player_id: str) -> List[Dict]:
    """Get all trades created by a player"""
    trades = []
    trades_dir = os.path.join(DATA_DIR, 'trades')

    if not os.path.exists(trades_dir):
        return trades

    for filename in os.listdir(trades_dir):
        if filename.endswith('.json'):
            trade = await read_json(os.path.join(trades_dir, filename))
            if trade and trade.get('creator_id') == player_id:
                trades.append(trade)
    return trades

# ==================== UTILITY FUNCTIONS ====================

def generate_id() -> str:
    """Generate a unique ID"""
    return str(uuid.uuid4())

def create_player_template(player_id: str, username: str, password_hash: str, is_guest: bool = False) -> Dict:
    """Create a new player data template"""
    now = datetime.now().timestamp()
    return {
        'id': player_id,
        'username': username,
        'password_hash': password_hash,
        'is_guest': is_guest,
        'created_at': now,
        'updated_at': now,
        'last_login': now,

        'profile': {
            'name': username,
            'title': 'rookie',
            'tower_skin': 'default',
        },

        'stats': {
            'trophies': 0,
            'elo': 1000,  # Starting ELO
            'wins': 0,
            'losses': 0,
            'crowns': 0,
            'max_streak': 0,
            'current_streak': 0,
            'medals': 0,
            'medals_wins': 0,
            'medals_losses': 0,
            'medals_highest': 0,
            'comp_wins': 0,
            'comp_losses': 0,
            'comp_trophies': 0,
        },

        'banned': False,  # Account ban status

        'resources': {
            'gold': 1000,
            'gems': 100,
            'crystals': 0,
            'star_points': 0,
            'royal_wild_cards': 0,
        },

        'cards': {
            'unlocked': ['knight', 'archer', 'goblin', 'bomber', 'arrows', 'minion', 'giant', 'zap'],
            'levels': {},
            'shards': {},
        },

        'decks': [
            ['knight', 'archer', 'goblin', 'bomber', 'arrows', 'minion', 'giant', 'zap'],
            [], [], [], []
        ],
        'current_deck': 0,

        'clan_id': None,

        'chests': [None] * 4,

        'battle_pass': {
            'level': 1,
            'xp': 0,
            'premium': False,
            'claimed': [],
        },

        'trophy_road': {
            'claimed': [],
        },

        'battle_log': [],
    }

def create_clan_template(clan_id: str, name: str, creator_id: str, creator_name: str) -> Dict:
    """Create a new clan data template"""
    now = datetime.now().timestamp()
    return {
        'id': clan_id,
        'name': name,
        'badge': 'default',
        'description': '',
        'type': 'open',
        'required_trophies': 0,
        'created_at': now,
        'updated_at': now,

        'stats': {
            'war_wins': 0,
            'war_trophies': 0,
            'total_donations': 0,
        },

        'members': [
            {
                'player_id': creator_id,
                'name': creator_name,
                'role': 'leader',
                'joined_at': now,
                'donations': 0,
                'last_active': now,
            }
        ],

        'chat_history': [],
        'donation_requests': [],

        'war': {
            'active': False,
            'start_time': None,
            'participants': [],
            'attacks': [],
        },
    }
