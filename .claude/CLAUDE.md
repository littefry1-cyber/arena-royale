# Arena Royale

## Overview
Mobile-first card battle game with real-time PvP multiplayer.

## Tech Stack
- **Frontend**: Single-page HTML/CSS/JS (needs modularization)
- **Backend**: Python aiohttp server with WebSocket support
- **Database**: JSON file-based storage
- **Auth**: JWT tokens with bcrypt password hashing

## Core Features
- Card collection with rarities: Common, Rare, Epic, Legendary, Champion, Evolution
- Deck building (8 cards)
- Trophy-based ranking system
- Real-time PvP battles via WebSocket
- Clans with full multiplayer support
- Card donation system
- In-game shop

## Clan System
The clan feature is fully functional in multiplayer mode:
- **Create/Join/Leave clans** - Players can create clans, search and join open clans, or leave
- **Role-based permissions**: Leader, Co-Leader, Elder, Member
  - Leaders: Full control (promote, demote, kick, edit settings, delete clan)
  - Co-Leaders: Edit settings, kick regular members
  - Elders/Members: Chat, donate, request cards only
- **Real-time chat** via WebSocket with optimistic UI updates
- **Card donations** - Request and donate cards within clan
- **Clan settings** - Description, badge, type (open/invite/closed), min trophies
- **Auto-polling** - Clan data refreshes every 10 seconds

### Clan API Endpoints
```
GET  /api/clans              - List/search clans
POST /api/clan               - Create clan
GET  /api/clan/:id           - Get clan details
POST /api/clan/:id/join      - Join clan
POST /api/clan/:id/leave     - Leave clan
POST /api/clan/:id/promote   - Promote member
POST /api/clan/:id/demote    - Demote member
POST /api/clan/:id/kick      - Kick member
POST /api/clan/:id/donate    - Donate cards
POST /api/clan/:id/request   - Request cards
POST /api/clan/:id/settings  - Update clan settings
```

## Project Structure
```
/api              - REST endpoints (auth, players, clans, trading)
/websocket        - Real-time battle sync
/database         - JSON database layer
/services         - Auth & matchmaking services
/data             - Player data storage
/css              - Stylesheets (styles.css)
/js               - Game logic
  /modules        - Modular JS components
    config.js     - Game constants & configuration
    utils.js      - Utility functions
    audio.js      - Sound effects system
    notifications.js - Toast notifications
  game.js         - Main game logic (7400+ lines)
index.html        - Main game client (HTML only)
dashboard.html    - Admin dashboard
server.py         - Main backend server
```

## Frontend Modules
The JavaScript is being modularized into separate files:
- **config.js** - Server URLs, game constants, shop items, rewards
- **utils.js** - Helper functions (formatting, math, role normalization)
- **audio.js** - Sound effects with Web Audio API
- **notifications.js** - Toast notifications and confirmations
- **game.js** - Main game logic (battle, cards, clans, UI)

## Running
- `start_server.bat` - Backend API + WebSocket server (port 5004)
- `start_frontend.bat` - Static file server for game client (port 5000)
- Python uses local `.venv` virtual environment (auto-created by start_server.bat)
