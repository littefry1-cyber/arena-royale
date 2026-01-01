"""
Authentication API Endpoints
Register, login, guest login, token validation
"""

from aiohttp import web
from database import json_db as db
from services import auth_service as auth

routes = web.RouteTableDef()


@routes.post('/api/auth/register')
async def register(request: web.Request) -> web.Response:
    """Register a new account"""
    try:
        data = await request.json()
    except:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    username = data.get('username', '').strip()
    password = data.get('password', '')

    # Validate username
    valid, error = auth.validate_username(username)
    if not valid:
        return web.json_response({'error': error}, status=400)

    # Validate password
    valid, error = auth.validate_password(password)
    if not valid:
        return web.json_response({'error': error}, status=400)

    # Check if username exists
    existing = await db.find_player_by_username(username)
    if existing:
        return web.json_response({'error': 'Username already taken'}, status=400)

    # Create player
    player_id = db.generate_id()
    password_hash = auth.hash_password(password)
    player = db.create_player_template(player_id, username, password_hash, is_guest=False)

    # Save player
    success = await db.save_player(player)
    if not success:
        return web.json_response({'error': 'Failed to create account'}, status=500)

    # Generate token
    token = auth.create_token(player_id, username, is_guest=False)

    # Return player data (without password hash)
    player_safe = {k: v for k, v in player.items() if k != 'password_hash'}

    return web.json_response({
        'token': token,
        'player': player_safe,
    })


@routes.post('/api/auth/login')
async def login(request: web.Request) -> web.Response:
    """Login with username and password"""
    try:
        data = await request.json()
    except:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    username = data.get('username', '').strip()
    password = data.get('password', '')

    if not username or not password:
        return web.json_response({'error': 'Username and password required'}, status=400)

    # Find player
    player = await db.find_player_by_username(username)
    if not player:
        return web.json_response({'error': 'Invalid username or password'}, status=401)

    # Verify password
    if not auth.verify_password(password, player.get('password_hash', '')):
        return web.json_response({'error': 'Invalid username or password'}, status=401)

    # Check if player is banned
    if player.get('banned', False):
        return web.json_response({'error': 'This account has been banned'}, status=403)

    # Update last login
    player['last_login'] = __import__('datetime').datetime.now().timestamp()
    await db.save_player(player)

    # Generate token
    token = auth.create_token(player['id'], username, is_guest=False)

    # Return player data (without password hash)
    player_safe = {k: v for k, v in player.items() if k != 'password_hash'}

    return web.json_response({
        'token': token,
        'player': player_safe,
    })


@routes.post('/api/auth/guest')
async def guest_login(request: web.Request) -> web.Response:
    """Create a guest account"""
    # Generate guest username
    username = auth.generate_guest_username()

    # Create player (no password for guests)
    player_id = db.generate_id()
    player = db.create_player_template(player_id, username, '', is_guest=True)

    # Save player
    success = await db.save_player(player)
    if not success:
        return web.json_response({'error': 'Failed to create guest account'}, status=500)

    # Generate token
    token = auth.create_token(player_id, username, is_guest=True)

    # Return player data
    player_safe = {k: v for k, v in player.items() if k != 'password_hash'}

    return web.json_response({
        'token': token,
        'player': player_safe,
        'is_guest': True,
    })


@routes.post('/api/auth/validate')
async def validate_token(request: web.Request) -> web.Response:
    """Validate a token and return player data"""
    token = request.headers.get('Authorization', '').replace('Bearer ', '')

    if not token:
        return web.json_response({'error': 'Token required'}, status=401)

    payload = auth.decode_token(token)
    if not payload:
        return web.json_response({'error': 'Invalid or expired token'}, status=401)

    player_id = payload.get('player_id')
    player = await db.get_player(player_id)

    if not player:
        return web.json_response({'error': 'Player not found'}, status=404)

    # Check if player is banned
    if player.get('banned', False):
        return web.json_response({'error': 'This account has been banned', 'banned': True}, status=403)

    # Return player data (without password hash)
    player_safe = {k: v for k, v in player.items() if k != 'password_hash'}

    return web.json_response({
        'valid': True,
        'player': player_safe,
    })


@routes.post('/api/auth/convert-guest')
async def convert_guest(request: web.Request) -> web.Response:
    """Convert a guest account to a full account"""
    token = request.headers.get('Authorization', '').replace('Bearer ', '')

    if not token:
        return web.json_response({'error': 'Token required'}, status=401)

    payload = auth.decode_token(token)
    if not payload:
        return web.json_response({'error': 'Invalid or expired token'}, status=401)

    player_id = payload.get('player_id')
    player = await db.get_player(player_id)

    if not player:
        return web.json_response({'error': 'Player not found'}, status=404)

    if not player.get('is_guest'):
        return web.json_response({'error': 'Account is already registered'}, status=400)

    try:
        data = await request.json()
    except:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    username = data.get('username', '').strip()
    password = data.get('password', '')

    # Validate username
    valid, error = auth.validate_username(username)
    if not valid:
        return web.json_response({'error': error}, status=400)

    # Validate password
    valid, error = auth.validate_password(password)
    if not valid:
        return web.json_response({'error': error}, status=400)

    # Check if username exists
    existing = await db.find_player_by_username(username)
    if existing and existing['id'] != player_id:
        return web.json_response({'error': 'Username already taken'}, status=400)

    # Update player
    player['username'] = username
    player['password_hash'] = auth.hash_password(password)
    player['is_guest'] = False
    player['profile']['name'] = username

    success = await db.save_player(player)
    if not success:
        return web.json_response({'error': 'Failed to convert account'}, status=500)

    # Generate new token
    token = auth.create_token(player_id, username, is_guest=False)

    # Return player data
    player_safe = {k: v for k, v in player.items() if k != 'password_hash'}

    return web.json_response({
        'token': token,
        'player': player_safe,
    })


@routes.post('/api/admin/ban')
async def ban_player(request: web.Request) -> web.Response:
    """Ban or unban a player (admin only)"""
    try:
        data = await request.json()
    except:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    username = data.get('username', '').strip()
    banned = data.get('banned', True)

    if not username:
        return web.json_response({'error': 'Username required'}, status=400)

    # Find player
    player = await db.find_player_by_username(username)
    if not player:
        return web.json_response({'error': 'Player not found'}, status=404)

    # Update ban status
    player['banned'] = banned
    player_id = player['id']
    success = await db.save_player(player)

    if not success:
        return web.json_response({'error': 'Failed to update player'}, status=500)

    # Invalidate cache to ensure fresh read
    from database.json_db import _invalidate_cache
    _invalidate_cache(player_id)

    # If banning, kick the player immediately via WebSocket
    if banned:
        try:
            from websocket.manager import ws_manager
            import asyncio
            # Only try to kick if they're online
            if ws_manager.is_online(player_id):
                # Send banned message to player (wrapped in try in case they disconnect)
                try:
                    await ws_manager.send_to_player(player_id, 'account_banned', {
                        'message': 'Your account has been banned'
                    })
                except Exception:
                    pass  # Player may have disconnected
                # Small delay to ensure message arrives before disconnect
                await asyncio.sleep(0.5)
                # Disconnect them (check again in case they disconnected)
                if ws_manager.is_online(player_id):
                    try:
                        await ws_manager.disconnect(player_id)
                    except Exception:
                        pass  # Already disconnected
                print(f"Player {username} ({player_id}) has been banned and kicked")
            else:
                print(f"Player {username} ({player_id}) has been banned (not currently online)")
        except Exception as e:
            import traceback
            print(f"Error kicking banned player: {e}")
            traceback.print_exc()

    return web.json_response({
        'success': True,
        'username': username,
        'banned': banned,
        'message': f"Player '{username}' has been {'banned' if banned else 'unbanned'}"
    })


@routes.get('/api/admin/players')
async def get_all_players(request: web.Request) -> web.Response:
    """Get list of all players (admin only)"""
    players = await db.get_all_players(include_banned=True)

    # Return safe player data
    players_safe = []
    for player in players:
        players_safe.append({
            'id': player.get('id'),
            'username': player.get('username'),
            'banned': player.get('banned', False),
            'is_guest': player.get('is_guest', False),
            'trophies': player.get('stats', {}).get('trophies', 0),
            'last_login': player.get('last_login'),
        })

    return web.json_response({'players': players_safe})


@routes.get('/api/admin/player/{player_id}')
async def get_player_data(request: web.Request) -> web.Response:
    """Get full player data for admin editing"""
    player_id = request.match_info.get('player_id')

    if not player_id:
        return web.json_response({'error': 'Player ID required'}, status=400)

    player = await db.get_player(player_id)
    if not player:
        return web.json_response({'error': 'Player not found'}, status=404)

    # Return player data (without password hash)
    player_safe = {k: v for k, v in player.items() if k != 'password_hash'}

    return web.json_response({'player': player_safe})


@routes.post('/api/admin/player/{player_id}/update')
async def update_player_data(request: web.Request) -> web.Response:
    """Update player data (admin only)"""
    player_id = request.match_info.get('player_id')

    if not player_id:
        return web.json_response({'error': 'Player ID required'}, status=400)

    try:
        data = await request.json()
    except:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    player = await db.get_player(player_id)
    if not player:
        return web.json_response({'error': 'Player not found'}, status=404)

    # Update allowed fields
    updates = data.get('updates', {})

    # Stats updates
    if 'trophies' in updates:
        player.setdefault('stats', {})['trophies'] = max(0, int(updates['trophies']))
    if 'medals' in updates:
        player.setdefault('stats', {})['medals'] = max(0, int(updates['medals']))
        player['stats']['medals_highest'] = max(player['stats'].get('medals_highest', 0), player['stats']['medals'])
    if 'wins' in updates:
        player.setdefault('stats', {})['wins'] = max(0, int(updates['wins']))
    if 'losses' in updates:
        player.setdefault('stats', {})['losses'] = max(0, int(updates['losses']))

    # Resources updates
    if 'gold' in updates:
        player.setdefault('resources', {})['gold'] = max(0, int(updates['gold']))
    if 'gems' in updates:
        player.setdefault('resources', {})['gems'] = max(0, int(updates['gems']))
    if 'crystals' in updates:
        player.setdefault('resources', {})['crystals'] = max(0, int(updates['crystals']))
    if 'star_points' in updates:
        player.setdefault('resources', {})['star_points'] = max(0, int(updates['star_points']))
    if 'royal_wild_cards' in updates:
        player.setdefault('resources', {})['royal_wild_cards'] = max(0, int(updates['royal_wild_cards']))

    # Cards updates
    if 'unlocked' in updates:
        player.setdefault('cards', {})['unlocked'] = updates['unlocked']
    if 'levels' in updates:
        player.setdefault('cards', {})['levels'] = updates['levels']
    if 'shards' in updates:
        player.setdefault('cards', {})['shards'] = updates['shards']

    # Decks updates
    if 'decks' in updates:
        player['decks'] = updates['decks']
    if 'current_deck' in updates:
        player['current_deck'] = int(updates['current_deck'])

    # Chests updates
    if 'chests' in updates:
        player['chests'] = updates['chests']

    # Trophy road updates
    if 'trophy_road_claimed' in updates:
        player.setdefault('trophy_road', {})['claimed'] = updates['trophy_road_claimed']

    success = await db.save_player(player)
    if not success:
        return web.json_response({'error': 'Failed to update player'}, status=500)

    # Return updated player data
    player_safe = {k: v for k, v in player.items() if k != 'password_hash'}

    return web.json_response({
        'success': True,
        'player': player_safe
    })


@routes.post('/api/admin/reset-password')
async def reset_password(request: web.Request) -> web.Response:
    """Reset a player's password (admin only)"""
    try:
        data = await request.json()
    except:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    username = data.get('username', '').strip()
    new_password = data.get('new_password', '')

    if not username:
        return web.json_response({'error': 'Username required'}, status=400)

    if not new_password:
        return web.json_response({'error': 'New password required'}, status=400)

    # Validate password
    valid, error = auth.validate_password(new_password)
    if not valid:
        return web.json_response({'error': error}, status=400)

    # Find player
    player = await db.find_player_by_username(username)
    if not player:
        return web.json_response({'error': 'Player not found'}, status=404)

    # Update password
    player['password_hash'] = auth.hash_password(new_password)
    success = await db.save_player(player)

    if not success:
        return web.json_response({'error': 'Failed to update password'}, status=500)

    return web.json_response({
        'success': True,
        'message': f"Password for '{username}' has been reset"
    })
