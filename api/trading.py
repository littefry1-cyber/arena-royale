"""
Trading API Endpoints
Card trading between players
"""

import time
import uuid
from aiohttp import web
from database import json_db as db
from services import auth_service as auth

routes = web.RouteTableDef()

# Trade expiration time (24 hours)
TRADE_EXPIRATION = 24 * 60 * 60


def get_player_id_from_request(request: web.Request) -> str:
    """Extract and validate player ID from auth token"""
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return None
    return auth.get_player_id_from_token(token)


@routes.get('/api/trades')
async def list_trades(request: web.Request) -> web.Response:
    """List open trades"""
    player_id = get_player_id_from_request(request)

    # Get open trades (excluding player's own)
    trades = await db.get_open_trades(exclude_player_id=player_id)

    # Filter by card if specified
    card_filter = request.query.get('card')
    if card_filter:
        trades = [t for t in trades if t.get('requesting', {}).get('card_id') == card_filter]

    return web.json_response({'trades': trades[:50]})  # Max 50 trades


@routes.get('/api/trades/mine')
async def my_trades(request: web.Request) -> web.Response:
    """Get player's own trades"""
    player_id = get_player_id_from_request(request)
    if not player_id:
        return web.json_response({'error': 'Unauthorized'}, status=401)

    trades = await db.get_player_trades(player_id)
    return web.json_response({'trades': trades})


@routes.post('/api/trade')
async def create_trade(request: web.Request) -> web.Response:
    """Create a new trade offer"""
    player_id = get_player_id_from_request(request)
    if not player_id:
        return web.json_response({'error': 'Unauthorized'}, status=401)

    player = await db.get_player(player_id)
    if not player:
        return web.json_response({'error': 'Player not found'}, status=404)

    try:
        data = await request.json()
    except:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    offer_card = data.get('offer_card')
    want_card = data.get('want_card')
    offer_amount = int(data.get('offer_amount', 1))
    want_amount = int(data.get('want_amount', 1))

    if not offer_card or not want_card:
        return web.json_response({'error': 'Both cards required'}, status=400)

    if offer_card == want_card:
        return web.json_response({'error': 'Cannot trade same card'}, status=400)

    # Check player has the card
    player_shards = player.get('cards', {}).get('shards', {}).get(offer_card, 0)
    if player_shards < offer_amount:
        return web.json_response({'error': 'Not enough cards to offer'}, status=400)

    # Check trade limit (max 5 active trades)
    player_trades = await db.get_player_trades(player_id)
    active_trades = [t for t in player_trades if t.get('status') == 'open']
    if len(active_trades) >= 5:
        return web.json_response({'error': 'Maximum 5 active trades'}, status=400)

    # Create trade
    now = time.time()
    player_name = player.get('profile', {}).get('name', player.get('username', 'Unknown'))

    trade = {
        'id': str(uuid.uuid4()),
        'creator_id': player_id,
        'creator_name': player_name,
        'status': 'open',
        'offering': {
            'card_id': offer_card,
            'amount': offer_amount,
        },
        'requesting': {
            'card_id': want_card,
            'amount': want_amount,
        },
        'created_at': now,
        'expires_at': now + TRADE_EXPIRATION,
        'accepted_by': None,
        'accepted_at': None,
    }

    success = await db.save_trade(trade)
    if not success:
        return web.json_response({'error': 'Failed to create trade'}, status=500)

    return web.json_response({'trade': trade})


@routes.get('/api/trade/{trade_id}')
async def get_trade(request: web.Request) -> web.Response:
    """Get trade details"""
    trade_id = request.match_info['trade_id']

    trade = await db.get_trade(trade_id)
    if not trade:
        return web.json_response({'error': 'Trade not found'}, status=404)

    return web.json_response({'trade': trade})


@routes.post('/api/trade/{trade_id}/accept')
async def accept_trade(request: web.Request) -> web.Response:
    """Accept a trade offer"""
    player_id = get_player_id_from_request(request)
    if not player_id:
        return web.json_response({'error': 'Unauthorized'}, status=401)

    player = await db.get_player(player_id)
    if not player:
        return web.json_response({'error': 'Player not found'}, status=404)

    trade_id = request.match_info['trade_id']
    trade = await db.get_trade(trade_id)

    if not trade:
        return web.json_response({'error': 'Trade not found'}, status=404)

    if trade.get('status') != 'open':
        return web.json_response({'error': 'Trade not available'}, status=400)

    if trade.get('creator_id') == player_id:
        return web.json_response({'error': 'Cannot accept own trade'}, status=400)

    # Check if expired
    if trade.get('expires_at', 0) < time.time():
        trade['status'] = 'expired'
        await db.save_trade(trade)
        return web.json_response({'error': 'Trade expired'}, status=400)

    # Check acceptor has the requested card
    want_card = trade['requesting']['card_id']
    want_amount = trade['requesting']['amount']
    player_shards = player.get('cards', {}).get('shards', {}).get(want_card, 0)

    if player_shards < want_amount:
        return web.json_response({'error': 'Not enough cards'}, status=400)

    # Get creator
    creator = await db.get_player(trade['creator_id'])
    if not creator:
        trade['status'] = 'cancelled'
        await db.save_trade(trade)
        return web.json_response({'error': 'Trade creator not found'}, status=400)

    # Check creator still has the offered card
    offer_card = trade['offering']['card_id']
    offer_amount = trade['offering']['amount']
    creator_shards = creator.get('cards', {}).get('shards', {}).get(offer_card, 0)

    if creator_shards < offer_amount:
        trade['status'] = 'cancelled'
        await db.save_trade(trade)
        return web.json_response({'error': 'Creator no longer has cards'}, status=400)

    # Execute trade
    # Remove from creator, add to acceptor
    creator['cards']['shards'][offer_card] = creator_shards - offer_amount
    if 'shards' not in player.get('cards', {}):
        player['cards']['shards'] = {}
    player['cards']['shards'][offer_card] = player['cards']['shards'].get(offer_card, 0) + offer_amount

    # Remove from acceptor, add to creator
    player['cards']['shards'][want_card] = player_shards - want_amount
    creator['cards']['shards'][want_card] = creator['cards']['shards'].get(want_card, 0) + want_amount

    # Save players
    await db.save_player(player)
    await db.save_player(creator)

    # Update trade
    trade['status'] = 'accepted'
    trade['accepted_by'] = player_id
    trade['accepted_at'] = time.time()
    await db.save_trade(trade)

    player_name = player.get('profile', {}).get('name', player.get('username', 'Unknown'))

    return web.json_response({
        'success': True,
        'trade': trade,
        'message': f'Trade completed! You traded {want_amount}x {want_card} for {offer_amount}x {offer_card}',
    })


@routes.post('/api/trade/{trade_id}/cancel')
async def cancel_trade(request: web.Request) -> web.Response:
    """Cancel a trade offer"""
    player_id = get_player_id_from_request(request)
    if not player_id:
        return web.json_response({'error': 'Unauthorized'}, status=401)

    trade_id = request.match_info['trade_id']
    trade = await db.get_trade(trade_id)

    if not trade:
        return web.json_response({'error': 'Trade not found'}, status=404)

    if trade.get('creator_id') != player_id:
        return web.json_response({'error': 'Not your trade'}, status=403)

    if trade.get('status') != 'open':
        return web.json_response({'error': 'Trade cannot be cancelled'}, status=400)

    trade['status'] = 'cancelled'
    await db.save_trade(trade)

    return web.json_response({'success': True})
