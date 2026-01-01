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
