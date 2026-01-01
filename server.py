"""
Arena Royale Multiplayer Server
Main entry point - runs on localhost:5004

Run with: python server.py
"""

import asyncio
import os
import sys

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from aiohttp import web
import aiohttp_cors

# Import API routes
from api.auth import routes as auth_routes
from api.players import routes as player_routes
from api.clans import routes as clan_routes
from api.trading import routes as trading_routes

# Import WebSocket manager
from websocket.manager import ws_manager

# Import background tasks
from services.matchmaking_service import matchmaking, matchmaking_loop
from websocket.battle_sync import battle_timer_loop

# Server configuration
HOST = '0.0.0.0'  # Listen on all interfaces
PORT = 5004


def setup_websocket_handlers():
    """Register WebSocket message handlers"""

    async def handle_queue_join(ws_mgr, player_id, data):
        """Player wants to join matchmaking queue"""
        from database import json_db as db

        player = await db.get_player(player_id)
        if not player:
            await ws_mgr.send_to_player(player_id, 'error', {'error': 'Player not found'})
            return

        mode = data.get('mode', 'normal')
        trophies = player.get('stats', {}).get('trophies', 0)
        elo = player.get('stats', {}).get('elo', 1000)
        deck = data.get('deck', player.get('decks', [[]])[player.get('current_deck', 0)])

        success = await matchmaking.join_queue(player_id, mode, trophies, elo, deck)

        if success:
            await ws_mgr.send_to_player(player_id, 'queue_joined', {
                'mode': mode,
                'position': matchmaking.get_queue_position(player_id),
            })
        else:
            await ws_mgr.send_to_player(player_id, 'error', {'error': 'Failed to join queue'})

    async def handle_queue_leave(ws_mgr, player_id, data):
        """Player wants to leave matchmaking queue"""
        success = await matchmaking.leave_queue(player_id)
        await ws_mgr.send_to_player(player_id, 'queue_left', {'success': success})

    async def handle_battle_ready(ws_mgr, player_id, data):
        """Player is ready to start battle"""
        from websocket.battle_sync import player_ready

        battle_id = data.get('battle_id')
        if battle_id:
            await player_ready(battle_id, player_id, ws_mgr)

    async def handle_battle_action(ws_mgr, player_id, data):
        """Player performed a battle action"""
        from websocket.battle_sync import handle_battle_action

        battle_id = data.get('battle_id')
        action = data.get('action', {})
        if battle_id:
            await handle_battle_action(battle_id, player_id, action, ws_mgr)

    async def handle_tower_damage(ws_mgr, player_id, data):
        """Tower took damage"""
        from websocket.battle_sync import handle_tower_damage

        battle_id = data.get('battle_id')
        if battle_id:
            await handle_tower_damage(battle_id, player_id, data, ws_mgr)

    async def handle_battle_end_request(ws_mgr, player_id, data):
        """Player wants to end/surrender battle"""
        from websocket.battle_sync import end_battle, get_player_battle

        battle = get_player_battle(player_id)
        if battle:
            # If surrendering, give opponent the win
            if data.get('surrender'):
                if player_id == battle.player1_id:
                    battle.player2_crowns = 3
                else:
                    battle.player1_crowns = 3
            await end_battle(battle.id, ws_mgr)

    async def handle_chat_send(ws_mgr, player_id, data):
        """Player sent a chat message"""
        from database import json_db as db

        channel = data.get('channel', 'global')
        message = data.get('message', '').strip()[:200]  # Max 200 chars

        if not message:
            return

        player = await db.get_player(player_id)
        if not player:
            return

        player_name = player.get('profile', {}).get('name', player.get('username', 'Unknown'))

        if channel == 'clan':
            clan_id = data.get('clan_id') or player.get('clan_id')
            if clan_id:
                # Add to clan chat history
                clan = await db.get_clan(clan_id)
                if clan:
                    if 'chat_history' not in clan:
                        clan['chat_history'] = []
                    clan['chat_history'].append({
                        'sender_id': player_id,
                        'sender_name': player_name,
                        'message': message,
                        'timestamp': __import__('time').time(),
                    })
                    # Keep last 100 messages
                    clan['chat_history'] = clan['chat_history'][-100:]
                    await db.save_clan(clan)

                    # Broadcast to clan channel
                    await ws_mgr.broadcast_channel(f"clan:{clan_id}", 'chat_message', {
                        'channel': 'clan',
                        'sender_id': player_id,
                        'sender_name': player_name,
                        'message': message,
                        'timestamp': __import__('time').time(),
                    })

        elif channel == 'global':
            # Broadcast to all online players
            await ws_mgr.broadcast_all('chat_message', {
                'channel': 'global',
                'sender_id': player_id,
                'sender_name': player_name,
                'message': message,
                'timestamp': __import__('time').time(),
            })

    async def handle_subscribe(ws_mgr, player_id, data):
        """Subscribe to a channel"""
        channel = data.get('channel')
        if channel:
            await ws_mgr.subscribe(player_id, channel)
            await ws_mgr.send_to_player(player_id, 'subscribed', {'channel': channel})

    async def handle_unsubscribe(ws_mgr, player_id, data):
        """Unsubscribe from a channel"""
        channel = data.get('channel')
        if channel:
            await ws_mgr.unsubscribe(player_id, channel)
            await ws_mgr.send_to_player(player_id, 'unsubscribed', {'channel': channel})

    # Register handlers
    ws_manager.register_handler('queue_join', handle_queue_join)
    ws_manager.register_handler('queue_leave', handle_queue_leave)
    ws_manager.register_handler('battle_ready', handle_battle_ready)
    ws_manager.register_handler('battle_action', handle_battle_action)
    ws_manager.register_handler('tower_damage', handle_tower_damage)
    ws_manager.register_handler('battle_end', handle_battle_end_request)
    ws_manager.register_handler('chat_send', handle_chat_send)
    ws_manager.register_handler('subscribe', handle_subscribe)
    ws_manager.register_handler('unsubscribe', handle_unsubscribe)


async def start_background_tasks(app):
    """Start background tasks"""
    app['matchmaking_task'] = asyncio.create_task(matchmaking_loop(ws_manager))
    app['battle_timer_task'] = asyncio.create_task(battle_timer_loop(ws_manager))
    print("Background tasks started")


async def cleanup_background_tasks(app):
    """Cleanup background tasks"""
    app['matchmaking_task'].cancel()
    app['battle_timer_task'].cancel()
    try:
        await app['matchmaking_task']
        await app['battle_timer_task']
    except asyncio.CancelledError:
        pass
    print("Background tasks stopped")


def create_app() -> web.Application:
    """Create and configure the application"""
    app = web.Application()

    # Setup CORS
    cors = aiohttp_cors.setup(app, defaults={
        "*": aiohttp_cors.ResourceOptions(
            allow_credentials=True,
            expose_headers="*",
            allow_headers="*",
            allow_methods="*",
        )
    })

    # Add API routes
    app.router.add_routes(auth_routes)
    app.router.add_routes(player_routes)
    app.router.add_routes(clan_routes)
    app.router.add_routes(trading_routes)

    # Add WebSocket route
    app.router.add_get('/ws', ws_manager.handle_connection)

    # Add CORS to all routes
    for route in list(app.router.routes()):
        if not isinstance(route.resource, web.StaticResource):
            cors.add(route)

    # Setup WebSocket handlers
    setup_websocket_handlers()

    # Background tasks
    app.on_startup.append(start_background_tasks)
    app.on_cleanup.append(cleanup_background_tasks)

    # Add a simple health check
    async def health_check(request):
        return web.json_response({
            'status': 'ok',
            'online_players': ws_manager.get_online_count(),
            'queue_sizes': {
                mode: matchmaking.get_queue_size(mode)
                for mode in ['normal', 'ranked', 'medals', '2v2', 'draft', 'chaos']
            }
        })

    app.router.add_get('/health', health_check)
    app.router.add_get('/api/status', health_check)

    return app


def main():
    """Main entry point"""
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║              ARENA ROYALE MULTIPLAYER SERVER                 ║
║                                                              ║
║  Starting on http://{HOST}:{PORT}                            ║
║  WebSocket: ws://localhost:{PORT}/ws                         ║
║                                                              ║
║  Endpoints:                                                  ║
║    POST /api/auth/register   - Create account                ║
║    POST /api/auth/login      - Login                         ║
║    POST /api/auth/guest      - Guest login                   ║
║    GET  /api/leaderboard/:t  - Leaderboards                  ║
║    GET  /api/player/:id      - Player profile                ║
║    POST /api/player/:id/sync - Sync player data              ║
║    GET  /health              - Server status                 ║
║                                                              ║
║  Press Ctrl+C to stop                                        ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    """)

    app = create_app()
    web.run_app(app, host=HOST, port=PORT, print=None)


if __name__ == '__main__':
    main()
