"""
Player API Endpoints
Player data CRUD and sync
"""

from aiohttp import web
from database import json_db as db
from services import auth_service as auth

routes = web.RouteTableDef()


def get_player_id_from_request(request: web.Request) -> str:
    """Extract and validate player ID from auth token"""
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return None
    return auth.get_player_id_from_token(token)


@routes.get('/api/player/{player_id}')
async def get_player(request: web.Request) -> web.Response:
    """Get a player's public profile"""
    player_id = request.match_info['player_id']

    player = await db.get_player(player_id)
    if not player:
        return web.json_response({'error': 'Player not found'}, status=404)

    # Return public data only
    return web.json_response({
        'id': player['id'],
        'name': player.get('profile', {}).get('name', player.get('username', 'Unknown')),
        'title': player.get('profile', {}).get('title', 'rookie'),
        'tower_skin': player.get('profile', {}).get('tower_skin', 'default'),
        'stats': player.get('stats', {}),
        'clan_id': player.get('clan_id'),
    })


@routes.get('/api/player/{player_id}/full')
async def get_player_full(request: web.Request) -> web.Response:
    """Get full player data (only for self)"""
    auth_player_id = get_player_id_from_request(request)
    player_id = request.match_info['player_id']

    if auth_player_id != player_id:
        return web.json_response({'error': 'Unauthorized'}, status=403)

    player = await db.get_player(player_id)
    if not player:
        return web.json_response({'error': 'Player not found'}, status=404)

    # Return full data (without password hash)
    player_safe = {k: v for k, v in player.items() if k != 'password_hash'}
    return web.json_response(player_safe)


@routes.post('/api/player/{player_id}/sync')
async def sync_player(request: web.Request) -> web.Response:
    """Sync player data from client"""
    auth_player_id = get_player_id_from_request(request)
    player_id = request.match_info['player_id']

    if auth_player_id != player_id:
        return web.json_response({'error': 'Unauthorized'}, status=403)

    player = await db.get_player(player_id)
    if not player:
        return web.json_response({'error': 'Player not found'}, status=404)

    try:
        data = await request.json()
    except:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    # Merge client data with server data
    # Stats - use higher values for most things (anti-cheat basic)
    if 'stats' in data:
        client_stats = data['stats']
        server_stats = player.get('stats', {})

        # These fields can only go up or are server-authoritative
        for field in ['trophies', 'wins', 'losses', 'crowns', 'max_streak',
                      'medals', 'medals_wins', 'medals_losses', 'medals_highest',
                      'comp_wins', 'comp_losses', 'comp_trophies']:
            if field in client_stats:
                # For now, trust client for progression stats
                server_stats[field] = client_stats[field]

        player['stats'] = server_stats

    # Resources - SERVER AUTHORITATIVE (don't let client overwrite)
    # Resources can only be changed by server-side actions (trades, rewards, etc.)
    # Client sync is ignored to prevent overwrites from stale local data

    # Cards - trust client for now
    if 'cards' in data:
        player['cards'] = data['cards']

    # Decks
    if 'decks' in data:
        player['decks'] = data['decks']
    if 'current_deck' in data:
        player['current_deck'] = data['current_deck']

    # Profile - name is server-authoritative to prevent sync overwrites
    if 'profile' in data:
        for field in ['title', 'tower_skin']:  # name excluded - only changeable server-side
            if field in data['profile']:
                player['profile'][field] = data['profile'][field]

    # Battle pass
    if 'battle_pass' in data:
        player['battle_pass'] = data['battle_pass']

    # Trophy road
    if 'trophy_road' in data:
        player['trophy_road'] = data['trophy_road']

    # Chests
    if 'chests' in data:
        player['chests'] = data['chests']

    # Battle log
    if 'battle_log' in data:
        player['battle_log'] = data['battle_log'][-20:]  # Keep last 20

    # Save
    success = await db.save_player(player)
    if not success:
        return web.json_response({'error': 'Failed to save'}, status=500)

    return web.json_response({
        'success': True,
        'synced_at': player.get('updated_at'),
    })


@routes.put('/api/player/{player_id}/profile')
async def update_profile(request: web.Request) -> web.Response:
    """Update player profile"""
    auth_player_id = get_player_id_from_request(request)
    player_id = request.match_info['player_id']

    if auth_player_id != player_id:
        return web.json_response({'error': 'Unauthorized'}, status=403)

    player = await db.get_player(player_id)
    if not player:
        return web.json_response({'error': 'Player not found'}, status=404)

    try:
        data = await request.json()
    except:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    # Update allowed profile fields
    if 'name' in data:
        name = data['name'].strip()
        if len(name) >= 3 and len(name) <= 20:
            player['profile']['name'] = name

    if 'title' in data:
        player['profile']['title'] = data['title']

    if 'tower_skin' in data:
        player['profile']['tower_skin'] = data['tower_skin']

    success = await db.save_player(player)
    if not success:
        return web.json_response({'error': 'Failed to save'}, status=500)

    return web.json_response({
        'success': True,
        'profile': player['profile'],
    })


@routes.get('/api/leaderboard/{type}')
async def get_leaderboard(request: web.Request) -> web.Response:
    """Get leaderboard data"""
    lb_type = request.match_info['type']
    limit = int(request.query.get('limit', 100))

    if lb_type == 'trophies':
        players = await db.get_leaderboard('trophies', limit)
    elif lb_type == 'medals':
        players = await db.get_leaderboard('medals', limit)
    elif lb_type == 'competitive':
        players = await db.get_leaderboard('comp_wins', limit)
    else:
        return web.json_response({'error': 'Invalid leaderboard type'}, status=400)

    # Get requesting player's rank if authenticated
    player_rank = -1
    auth_player_id = get_player_id_from_request(request)
    if auth_player_id:
        sort_by = 'trophies' if lb_type == 'trophies' else ('medals' if lb_type == 'medals' else 'comp_wins')
        player_rank = await db.get_player_rank(auth_player_id, sort_by)

    return web.json_response({
        'type': lb_type,
        'players': players,
        'player_rank': player_rank,
        'total_players': len(await db.get_all_players()),
    })


@routes.post('/api/player/{player_id}/battle-result')
async def report_battle_result(request: web.Request) -> web.Response:
    """Apply battle result to player stats"""
    auth_player_id = get_player_id_from_request(request)
    player_id = request.match_info['player_id']

    if auth_player_id != player_id:
        return web.json_response({'error': 'Unauthorized'}, status=403)

    player = await db.get_player(player_id)
    if not player:
        return web.json_response({'error': 'Player not found'}, status=404)

    try:
        data = await request.json()
    except:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    # Apply battle result
    stats = player.get('stats', {})

    if data.get('won'):
        stats['wins'] = stats.get('wins', 0) + 1
        stats['current_streak'] = stats.get('current_streak', 0) + 1
        if stats['current_streak'] > stats.get('max_streak', 0):
            stats['max_streak'] = stats['current_streak']
    else:
        stats['losses'] = stats.get('losses', 0) + 1
        stats['current_streak'] = 0

    # Apply trophy/elo changes
    if 'trophy_change' in data:
        stats['trophies'] = max(0, stats.get('trophies', 0) + data['trophy_change'])
    if 'new_elo' in data:
        stats['elo'] = data['new_elo']
    if 'crowns' in data:
        stats['crowns'] = stats.get('crowns', 0) + data['crowns']

    # Apply gold earned
    resources = player.get('resources', {})
    if 'gold_earned' in data:
        resources['gold'] = resources.get('gold', 0) + data['gold_earned']

    player['stats'] = stats
    player['resources'] = resources

    # Add to battle log
    if 'battle_log_entry' in data:
        if 'battle_log' not in player:
            player['battle_log'] = []
        player['battle_log'].insert(0, data['battle_log_entry'])
        player['battle_log'] = player['battle_log'][:20]  # Keep last 20

    success = await db.save_player(player)
    if not success:
        return web.json_response({'error': 'Failed to save'}, status=500)

    return web.json_response({
        'success': True,
        'stats': stats,
        'resources': resources,
    })
