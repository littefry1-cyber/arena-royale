"""
Clan API Endpoints
Clan CRUD, membership, donations, chat
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


@routes.get('/api/clans')
async def list_clans(request: web.Request) -> web.Response:
    """Search/list clans"""
    query = request.query.get('q', '')
    min_trophies = int(request.query.get('trophies', 0))

    clans = await db.search_clans(query, min_trophies)
    return web.json_response({'clans': clans})


@routes.post('/api/clan')
async def create_clan(request: web.Request) -> web.Response:
    """Create a new clan"""
    player_id = get_player_id_from_request(request)
    if not player_id:
        return web.json_response({'error': 'Unauthorized'}, status=401)

    player = await db.get_player(player_id)
    if not player:
        return web.json_response({'error': 'Player not found'}, status=404)

    if player.get('clan_id'):
        return web.json_response({'error': 'Already in a clan'}, status=400)

    try:
        data = await request.json()
    except:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    name = data.get('name', '').strip()
    if len(name) < 3 or len(name) > 20:
        return web.json_response({'error': 'Clan name must be 3-20 characters'}, status=400)

    # Create clan
    clan_id = db.generate_id()
    player_name = player.get('profile', {}).get('name', player.get('username', 'Unknown'))
    clan = db.create_clan_template(clan_id, name, player_id, player_name)

    # Apply optional settings
    if 'description' in data:
        clan['description'] = data['description'][:200]
    if 'type' in data and data['type'] in ['open', 'invite', 'closed']:
        clan['type'] = data['type']
    if 'required_trophies' in data:
        clan['required_trophies'] = max(0, int(data['required_trophies']))
    if 'badge' in data:
        clan['badge'] = data['badge']

    # Save clan
    success = await db.save_clan(clan)
    if not success:
        return web.json_response({'error': 'Failed to create clan'}, status=500)

    # Update player's clan_id
    player['clan_id'] = clan_id
    await db.save_player(player)

    return web.json_response({'clan': clan})


@routes.get('/api/clan/{clan_id}')
async def get_clan(request: web.Request) -> web.Response:
    """Get clan details"""
    clan_id = request.match_info['clan_id']

    clan = await db.get_clan(clan_id)
    if not clan:
        return web.json_response({'error': 'Clan not found'}, status=404)

    return web.json_response({'clan': clan})


@routes.post('/api/clan/{clan_id}/join')
async def join_clan(request: web.Request) -> web.Response:
    """Join a clan"""
    player_id = get_player_id_from_request(request)
    if not player_id:
        return web.json_response({'error': 'Unauthorized'}, status=401)

    player = await db.get_player(player_id)
    if not player:
        return web.json_response({'error': 'Player not found'}, status=404)

    if player.get('clan_id'):
        return web.json_response({'error': 'Already in a clan'}, status=400)

    clan_id = request.match_info['clan_id']
    clan = await db.get_clan(clan_id)
    if not clan:
        return web.json_response({'error': 'Clan not found'}, status=404)

    # Check clan type
    if clan.get('type') == 'closed':
        return web.json_response({'error': 'Clan is closed'}, status=400)

    # Check trophy requirement
    player_trophies = player.get('stats', {}).get('trophies', 0)
    if player_trophies < clan.get('required_trophies', 0):
        return web.json_response({'error': 'Not enough trophies'}, status=400)

    # Check if clan is full (max 50 members)
    if len(clan.get('members', [])) >= 50:
        return web.json_response({'error': 'Clan is full'}, status=400)

    # Add player to clan
    import time
    player_name = player.get('profile', {}).get('name', player.get('username', 'Unknown'))
    clan['members'].append({
        'player_id': player_id,
        'name': player_name,
        'role': 'member',
        'joined_at': time.time(),
        'donations': 0,
        'last_active': time.time(),
    })

    await db.save_clan(clan)

    # Update player's clan_id
    player['clan_id'] = clan_id
    await db.save_player(player)

    return web.json_response({'clan': clan})


@routes.post('/api/clan/{clan_id}/leave')
async def leave_clan(request: web.Request) -> web.Response:
    """Leave a clan"""
    player_id = get_player_id_from_request(request)
    if not player_id:
        return web.json_response({'error': 'Unauthorized'}, status=401)

    player = await db.get_player(player_id)
    if not player:
        return web.json_response({'error': 'Player not found'}, status=404)

    clan_id = request.match_info['clan_id']
    if player.get('clan_id') != clan_id:
        return web.json_response({'error': 'Not in this clan'}, status=400)

    clan = await db.get_clan(clan_id)
    if not clan:
        return web.json_response({'error': 'Clan not found'}, status=404)

    # Find member
    member = None
    for m in clan.get('members', []):
        if m.get('player_id') == player_id:
            member = m
            break

    if not member:
        return web.json_response({'error': 'Not a member'}, status=400)

    # If leader, must transfer leadership first (unless last member)
    if member.get('role') == 'leader' and len(clan['members']) > 1:
        return web.json_response({'error': 'Transfer leadership before leaving'}, status=400)

    # Remove from clan
    clan['members'] = [m for m in clan['members'] if m.get('player_id') != player_id]

    # If no members left, delete clan
    if len(clan['members']) == 0:
        await db.delete_clan(clan_id)
    else:
        await db.save_clan(clan)

    # Update player
    player['clan_id'] = None
    await db.save_player(player)

    return web.json_response({'success': True})


@routes.post('/api/clan/{clan_id}/promote')
async def promote_member(request: web.Request) -> web.Response:
    """Promote a clan member"""
    player_id = get_player_id_from_request(request)
    if not player_id:
        return web.json_response({'error': 'Unauthorized'}, status=401)

    clan_id = request.match_info['clan_id']
    clan = await db.get_clan(clan_id)
    if not clan:
        return web.json_response({'error': 'Clan not found'}, status=404)

    # Check if player is leader or co-leader
    player_member = None
    for m in clan.get('members', []):
        if m.get('player_id') == player_id:
            player_member = m
            break

    if not player_member or player_member.get('role') not in ['leader', 'co-leader']:
        return web.json_response({'error': 'Insufficient permissions'}, status=403)

    try:
        data = await request.json()
    except:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    target_id = data.get('player_id')
    if not target_id:
        return web.json_response({'error': 'Target player required'}, status=400)

    # Find target member
    for m in clan['members']:
        if m.get('player_id') == target_id:
            current_role = m.get('role', 'member')
            if current_role == 'member':
                m['role'] = 'elder'
            elif current_role == 'elder':
                m['role'] = 'co-leader'
            elif current_role == 'co-leader' and player_member.get('role') == 'leader':
                m['role'] = 'leader'
                player_member['role'] = 'co-leader'
            break

    await db.save_clan(clan)
    return web.json_response({'clan': clan})


@routes.post('/api/clan/{clan_id}/kick')
async def kick_member(request: web.Request) -> web.Response:
    """Kick a clan member"""
    player_id = get_player_id_from_request(request)
    if not player_id:
        return web.json_response({'error': 'Unauthorized'}, status=401)

    clan_id = request.match_info['clan_id']
    clan = await db.get_clan(clan_id)
    if not clan:
        return web.json_response({'error': 'Clan not found'}, status=404)

    # Check if player is leader or co-leader
    player_member = None
    for m in clan.get('members', []):
        if m.get('player_id') == player_id:
            player_member = m
            break

    if not player_member or player_member.get('role') not in ['leader', 'co-leader']:
        return web.json_response({'error': 'Insufficient permissions'}, status=403)

    try:
        data = await request.json()
    except:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    target_id = data.get('player_id')
    if not target_id or target_id == player_id:
        return web.json_response({'error': 'Invalid target'}, status=400)

    # Find and remove target
    target_found = False
    for m in clan['members']:
        if m.get('player_id') == target_id:
            # Can't kick leader or co-leader if you're not leader
            if m.get('role') in ['leader', 'co-leader'] and player_member.get('role') != 'leader':
                return web.json_response({'error': 'Cannot kick higher rank'}, status=403)
            target_found = True
            break

    if not target_found:
        return web.json_response({'error': 'Member not found'}, status=404)

    clan['members'] = [m for m in clan['members'] if m.get('player_id') != target_id]
    await db.save_clan(clan)

    # Update kicked player
    target_player = await db.get_player(target_id)
    if target_player:
        target_player['clan_id'] = None
        await db.save_player(target_player)

    return web.json_response({'clan': clan})


@routes.post('/api/clan/{clan_id}/donate')
async def donate_cards(request: web.Request) -> web.Response:
    """Donate cards to a clan request"""
    player_id = get_player_id_from_request(request)
    if not player_id:
        return web.json_response({'error': 'Unauthorized'}, status=401)

    player = await db.get_player(player_id)
    if not player:
        return web.json_response({'error': 'Player not found'}, status=404)

    clan_id = request.match_info['clan_id']
    if player.get('clan_id') != clan_id:
        return web.json_response({'error': 'Not in this clan'}, status=400)

    clan = await db.get_clan(clan_id)
    if not clan:
        return web.json_response({'error': 'Clan not found'}, status=404)

    try:
        data = await request.json()
    except:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    request_id = data.get('request_id')
    amount = int(data.get('amount', 1))

    # Find the donation request
    donation_request = None
    for req in clan.get('donation_requests', []):
        if req.get('id') == request_id:
            donation_request = req
            break

    if not donation_request:
        return web.json_response({'error': 'Request not found'}, status=404)

    if donation_request.get('requester_id') == player_id:
        return web.json_response({'error': 'Cannot donate to yourself'}, status=400)

    # Check if player has the card
    card_id = donation_request.get('card_id')
    player_shards = player.get('cards', {}).get('shards', {}).get(card_id, 0)
    if player_shards < amount:
        return web.json_response({'error': 'Not enough cards'}, status=400)

    # Check max donation
    current_donated = donation_request.get('amount', 0)
    max_donation = donation_request.get('max', 10)
    if current_donated + amount > max_donation:
        amount = max_donation - current_donated

    if amount <= 0:
        return web.json_response({'error': 'Request already filled'}, status=400)

    # Transfer cards
    player['cards']['shards'][card_id] = player_shards - amount
    await db.save_player(player)

    # Update requester
    requester = await db.get_player(donation_request['requester_id'])
    if requester:
        if 'shards' not in requester.get('cards', {}):
            requester['cards']['shards'] = {}
        requester['cards']['shards'][card_id] = requester['cards']['shards'].get(card_id, 0) + amount
        await db.save_player(requester)

    # Update donation request
    donation_request['amount'] = current_donated + amount

    # Update donator's stats
    for m in clan['members']:
        if m.get('player_id') == player_id:
            m['donations'] = m.get('donations', 0) + amount
            break

    # Ensure stats exists
    if 'stats' not in clan:
        clan['stats'] = {}
    clan['stats']['total_donations'] = clan['stats'].get('total_donations', 0) + amount

    # Remove completed requests
    if donation_request['amount'] >= donation_request['max']:
        clan['donation_requests'] = [r for r in clan['donation_requests'] if r.get('id') != request_id]

    await db.save_clan(clan)

    return web.json_response({
        'success': True,
        'donated': amount,
        'gold_earned': amount * 5,  # 5 gold per card donated
    })


@routes.post('/api/clan/{clan_id}/request')
async def request_cards(request: web.Request) -> web.Response:
    """Request cards from clan members"""
    player_id = get_player_id_from_request(request)
    if not player_id:
        return web.json_response({'error': 'Unauthorized'}, status=401)

    player = await db.get_player(player_id)
    if not player:
        return web.json_response({'error': 'Player not found'}, status=404)

    clan_id = request.match_info['clan_id']
    if player.get('clan_id') != clan_id:
        return web.json_response({'error': 'Not in this clan'}, status=400)

    clan = await db.get_clan(clan_id)
    if not clan:
        return web.json_response({'error': 'Clan not found'}, status=404)

    try:
        data = await request.json()
    except:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    card_id = data.get('card_id')
    if not card_id:
        return web.json_response({'error': 'Card ID required'}, status=400)

    # Check if player already has an active request
    for req in clan.get('donation_requests', []):
        if req.get('requester_id') == player_id:
            return web.json_response({'error': 'Already have an active request'}, status=400)

    # Create request
    import time
    import uuid

    # Determine max based on rarity (simplified)
    max_cards = 40  # Common default

    player_name = player.get('profile', {}).get('name', player.get('username', 'Unknown'))

    new_request = {
        'id': str(uuid.uuid4()),
        'requester_id': player_id,
        'requester_name': player_name,
        'card_id': card_id,
        'amount': 0,
        'max': max_cards,
        'timestamp': time.time(),
    }

    if 'donation_requests' not in clan:
        clan['donation_requests'] = []
    clan['donation_requests'].insert(0, new_request)

    await db.save_clan(clan)

    return web.json_response({'request': new_request})


@routes.post('/api/clan/{clan_id}/settings')
async def update_clan_settings(request: web.Request) -> web.Response:
    """Update clan settings (leader/co-leader only)"""
    player_id = get_player_id_from_request(request)
    if not player_id:
        return web.json_response({'error': 'Unauthorized'}, status=401)

    clan_id = request.match_info['clan_id']
    clan = await db.get_clan(clan_id)
    if not clan:
        return web.json_response({'error': 'Clan not found'}, status=404)

    # Check if player is leader or co-leader
    player_member = None
    for m in clan.get('members', []):
        if m.get('player_id') == player_id:
            player_member = m
            break

    if not player_member or player_member.get('role') not in ['leader', 'co-leader']:
        return web.json_response({'error': 'Insufficient permissions'}, status=403)

    try:
        data = await request.json()
    except:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    # Update allowed fields
    if 'description' in data:
        clan['description'] = str(data['description'])[:500]
    if 'badge' in data:
        clan['badge'] = str(data['badge'])[:4]  # emoji
    if 'type' in data and data['type'] in ['open', 'invite_only', 'closed']:
        clan['type'] = data['type']
    if 'required_trophies' in data:
        clan['required_trophies'] = max(0, min(10000, int(data['required_trophies'])))

    await db.save_clan(clan)
    return web.json_response({'clan': clan})


@routes.post('/api/clan/{clan_id}/demote')
async def demote_member(request: web.Request) -> web.Response:
    """Demote a clan member"""
    player_id = get_player_id_from_request(request)
    if not player_id:
        return web.json_response({'error': 'Unauthorized'}, status=401)

    clan_id = request.match_info['clan_id']
    clan = await db.get_clan(clan_id)
    if not clan:
        return web.json_response({'error': 'Clan not found'}, status=404)

    # Check if player is leader or co-leader
    player_member = None
    for m in clan.get('members', []):
        if m.get('player_id') == player_id:
            player_member = m
            break

    if not player_member or player_member.get('role') not in ['leader', 'co-leader']:
        return web.json_response({'error': 'Insufficient permissions'}, status=403)

    try:
        data = await request.json()
    except:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    target_id = data.get('player_id')
    if not target_id:
        return web.json_response({'error': 'Target player required'}, status=400)

    # Find target member and demote
    for m in clan['members']:
        if m.get('player_id') == target_id:
            current_role = m.get('role', 'member')
            # Can only demote if you outrank them
            if current_role == 'co-leader' and player_member.get('role') == 'leader':
                m['role'] = 'elder'
            elif current_role == 'elder':
                m['role'] = 'member'
            break

    await db.save_clan(clan)
    return web.json_response({'clan': clan})
