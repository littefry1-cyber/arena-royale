/**
 * Arena Royale - Configuration & Constants Module
 * Contains all game constants, card data, arenas, and configuration
 */

// Server Configuration
const SERVER_HOST = window.location.hostname || 'localhost';
const SERVER_URL = `http://${SERVER_HOST}:5004`;
const WS_URL = `ws://${SERVER_HOST}:5004/ws`;
const CONNECTION_TIMEOUT = 8000;

// Game Constants
const ADMIN_CODE = 'ak24';
const MAX_TROPHIES = 20000;
const RANKED_THRESHOLD = 15000;
const MAX_CHESTS = 50;

// Bot Names for AI opponents
const BOT_NAMES = ['xXSlayerXx','ProGamer99','ClashKing','TowerCrusher','EliteWarrior','DragonMaster','ShadowNinja','BattleLord','ThunderStrike','IceQueen','FirePhoenix','DarkKnight','StormBringer','RoyalChamp','MightyTitan','SwiftArrow','IronFist','GhostRider','StarLord','NightHawk','BlazeMaster','FrostBite','CyberWolf','PixelKing','NoobSlayer','EpicGamer','LegendX','Destroyer99','ChampionX','VictoryKing'];

// Clan Names and Badges
const CLAN_NAMES = ['Royal Warriors','Shadow Knights','Dragon Slayers','Elite Force','Storm Riders','Iron Legion','Phoenix Rising','Thunder Gods','Dark Empire','Golden Crown'];
const CLAN_BADGES = ['⚔️','🛡️','🐉','⚡','🌑','🔥','🐺','👑','🌊','🔮','🗡️','💀','⭐','🏰','🦁'];

// Emotes
const EMOTES = ['😄','😢','😠','🤔','👍','👎','😎','🔥','💀'];

// Starter Cards for new players
const STARTER_CARDS = ['knight','archer','goblin','skel','minion','bomber','arrows','zap','giant','musk','valk','hog'];

// Chest Types
const CHEST_TYPES = [
  {id:'silver',name:'Silver',icon:'📦',time:180,gold:[200,400],cards:2},
  {id:'gold',name:'Golden',icon:'🎁',time:480,gold:[500,1000],cards:3},
  {id:'magic',name:'Magical',icon:'✨',time:720,gold:[1000,2000],cards:4},
  {id:'giant',name:'Giant',icon:'🏆',time:1440,gold:[2000,4000],cards:5},
  {id:'legendary',name:'Legendary',icon:'👑',time:2880,gold:[5000,10000],cards:6},
  {id:'super',name:'Super',icon:'💎',time:4320,gold:[10000,20000],cards:8}
];

// Tower Skins
const TOWER_SKINS = [
  {id:'default',name:'Default Tower',icon:'🏰',preview:'🏰',unlockMethod:'default'},
  {id:'golden',name:'Golden Tower',icon:'👑',preview:'🏰✨',unlockMethod:'bp_premium',tier:15},
  {id:'crystal',name:'Crystal Tower',icon:'💎',preview:'🏰💠',unlockMethod:'bp_premium',tier:30},
  {id:'inferno',name:'Inferno Tower',icon:'🔥',preview:'🏰🔥',unlockMethod:'bp_premium',tier:45},
  {id:'frozen',name:'Frozen Tower',icon:'❄️',preview:'🏰❄️',unlockMethod:'bp_premium',tier:60},
  {id:'shadow',name:'Shadow Tower',icon:'🌑',preview:'🏰🖤',unlockMethod:'bp_premium',tier:75},
  {id:'rainbow',name:'Rainbow Tower',icon:'🌈',preview:'🏰🌈',unlockMethod:'bp_premium',tier:90}
];

// Star Shop Items
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
  {id:'star_boost_1',name:'XP Boost (1hr)',icon:'⚡',desc:'2x Battle XP for 1 hour',price:350,type:'boost',boostType:'xp'}
];

// Wild Items
const WILD_ITEMS = [
  {id:'wild_card',name:'Wild Card',icon:'🃏',rarity:'common',desc:'Converts to any card shards',drop:0.5},
  {id:'royal_wild',name:'Royal Wild Card',icon:'👑',rarity:'rare',desc:'Converts to higher rarity shards',drop:0.25},
  {id:'star_token',name:'Star Token',icon:'⭐',rarity:'epic',desc:'Exchange for Star Points',drop:0.15},
  {id:'gem_shard',name:'Gem Fragment',icon:'💎',rarity:'legendary',desc:'Combine 10 for a gem',drop:0.08},
  {id:'legendary_token',name:'Legendary Token',icon:'🔥',rarity:'legendary',desc:'Instant legendary shards',drop:0.02}
];

// Daily Rewards
const DAILY_REWARDS = [
  {day:1,icon:'💰',reward:{gold:500},desc:'+500 Gold'},
  {day:2,icon:'💎',reward:{gems:10},desc:'+10 Gems'},
  {day:3,icon:'📦',reward:{chest:'silver'},desc:'Silver Chest'},
  {day:4,icon:'💰',reward:{gold:1000},desc:'+1000 Gold'},
  {day:5,icon:'💎',reward:{gems:25},desc:'+25 Gems'},
  {day:6,icon:'🎁',reward:{chest:'gold'},desc:'Golden Chest'},
  {day:7,icon:'👑',reward:{chest:'legendary',gems:50},desc:'Legendary + 50 Gems'}
];

// Challenges
const CHALLENGES = [
  {id:'wins',name:'Win Battles',target:3,reward:{gold:200},icon:'⚔️'},
  {id:'crowns',name:'Earn Crowns',target:5,reward:{gems:10},icon:'👑'},
  {id:'troops',name:'Deploy Troops',target:20,reward:{gold:100},icon:'🎯'},
  {id:'destroy',name:'Destroy Towers',target:5,reward:{gems:5},icon:'🏰'}
];

// Achievements
const ACHIEVEMENTS = [
  {id:'first_win',name:'First Victory',desc:'Win your first battle',reward:{gems:20},icon:'🏆',check:()=>P.wins>=1},
  {id:'trophy_100',name:'Rising Star',desc:'Reach 100 trophies',reward:{gold:500},icon:'⭐',check:()=>P.tr>=100},
  {id:'trophy_1000',name:'Arena Master',desc:'Reach 1000 trophies',reward:{gems:50},icon:'🌟',check:()=>P.tr>=1000},
  {id:'trophy_5000',name:'Champion',desc:'Reach 5000 trophies',reward:{gems:100,gold:5000},icon:'👑',check:()=>P.tr>=5000},
  {id:'collect_20',name:'Collector',desc:'Collect 20 cards',reward:{gold:1000},icon:'🃏',check:()=>P.unlocked.length>=20},
  {id:'collect_50',name:'Card Master',desc:'Collect 50 cards',reward:{gems:75},icon:'📚',check:()=>P.unlocked.length>=50},
  {id:'win_10',name:'Winner',desc:'Win 10 battles',reward:{gold:300},icon:'🎯',check:()=>P.wins>=10},
  {id:'win_100',name:'Veteran',desc:'Win 100 battles',reward:{gems:150},icon:'🎖️',check:()=>P.wins>=100},
  {id:'crown_50',name:'Crown Collector',desc:'Earn 50 crowns',reward:{gold:500},icon:'👑',check:()=>P.totalCrowns>=50},
  {id:'clan_join',name:'Team Player',desc:'Join a clan',reward:{gems:25},icon:'🏰',check:()=>P.clan!==null}
];

// Workshop Boosts
const WORKSHOP_BOOSTS = [
  {id:'dmg_boost',name:'Power Surge',desc:'+15% Damage',icon:'⚔️',cost:15,effect:{dmg:0.15},charges:3},
  {id:'hp_boost',name:'Fortify',desc:'+20% HP',icon:'🛡️',cost:15,effect:{hp:0.20},charges:3},
  {id:'elixir_boost',name:'Elixir Rush',desc:'+1 Starting Elixir',icon:'💧',cost:20,effect:{startElixir:1},charges:2},
  {id:'speed_boost',name:'Haste',desc:'+10% Speed',icon:'⚡',cost:12,effect:{speed:0.10},charges:3},
  {id:'mega_boost',name:'Mega Power',desc:'ALL Boosts Combined!',icon:'🔥',cost:50,effect:{dmg:0.15,hp:0.20,startElixir:1,speed:0.10},charges:1,tier:'legendary'}
];

// Spin Wheel Rewards
const SPIN_REWARDS = [
  {id:0,name:'100 Gold',icon:'💰',reward:{gold:100},weight:25},
  {id:1,name:'500 Gold',icon:'💰',reward:{gold:500},weight:20},
  {id:2,name:'10 Gems',icon:'💎',reward:{gems:10},weight:15},
  {id:3,name:'50 Gems',icon:'💎',reward:{gems:50},weight:5},
  {id:4,name:'Silver Chest',icon:'📦',reward:{chest:'silver'},weight:15},
  {id:5,name:'Gold Chest',icon:'🎁',reward:{chest:'gold'},weight:10},
  {id:6,name:'1000 Star Points',icon:'⭐',reward:{stars:1000},weight:8},
  {id:7,name:'JACKPOT!',icon:'👑',reward:{gold:5000,gems:100},weight:2}
];

// Weekly Quests
const WEEKLY_QUESTS = [
  {id:'weekly_wins',name:'Weekly Warrior',target:20,reward:{gems:100,gold:5000},icon:'⚔️'},
  {id:'weekly_crowns',name:'Crown Crusher',target:30,reward:{gems:75,gold:3000},icon:'👑'},
  {id:'weekly_donations',name:'Generous Soul',target:50,reward:{gems:50,gold:2000},icon:'🎁'}
];

// Tournament Types
const TOURNAMENTS = [
  {id:'daily_challenge',name:'Daily Challenge',type:'challenge',entry:'free',maxWins:5,maxLosses:3,rewards:{gold:500,gems:10},minTrophies:0},
  {id:'classic',name:'Classic Challenge',type:'challenge',entry:{gems:10},maxWins:12,maxLosses:3,rewards:{gold:2000,gems:50,chest:'gold'},minTrophies:0},
  {id:'grand',name:'Grand Challenge',type:'challenge',entry:{gems:100},maxWins:12,maxLosses:3,rewards:{gold:10000,gems:200,chest:'legendary'},minTrophies:4000},
  {id:'bracket_8',name:'8-Player Bracket',type:'bracket',entry:{gems:50},players:8,rewards:{gold:5000,gems:100,chest:'magic'},minTrophies:2000}
];

// Treasure Hunt Items
const TREASURE_ITEMS = [
  {id:'gold_small',name:'Gold Pouch',icon:'💰',reward:{gold:100},weight:30},
  {id:'gold_medium',name:'Gold Bag',icon:'💰',reward:{gold:500},weight:20},
  {id:'gold_large',name:'Gold Chest',icon:'💰',reward:{gold:2000},weight:10},
  {id:'gems_small',name:'Gem Shard',icon:'💎',reward:{gems:5},weight:15},
  {id:'gems_medium',name:'Gem Cluster',icon:'💎',reward:{gems:25},weight:8},
  {id:'gems_large',name:'Gem Hoard',icon:'💎',reward:{gems:100},weight:2},
  {id:'empty',name:'Empty',icon:'💨',reward:{},weight:10},
  {id:'trap',name:'Trap!',icon:'💥',reward:{gold:-50},weight:5}
];
const TREASURE_HUNT_COST = 300;

// Boss Data
const BOSSES = [
  {id:'giant_boss',name:'Giant King',icon:'🦾',hp:50000,dmg:500,reward:{gold:5000,gems:50},minTrophies:0},
  {id:'dragon_boss',name:'Elder Dragon',icon:'🐉',hp:75000,dmg:750,reward:{gold:10000,gems:100},minTrophies:3000},
  {id:'golem_boss',name:'Ancient Golem',icon:'🗿',hp:100000,dmg:1000,reward:{gold:20000,gems:200,chest:'legendary'},minTrophies:6000},
  {id:'demon_boss',name:'Infernal Demon',icon:'👹',hp:150000,dmg:1500,reward:{gold:50000,gems:500,chest:'super'},minTrophies:10000}
];

// Season Themes
const SEASON_THEMES = [
  {name:'Frost Festival',icon:'❄️',color:'#00bcd4'},
  {name:'Spring Bloom',icon:'🌸',color:'#e91e63'},
  {name:'Summer Heat',icon:'☀️',color:'#ff9800'},
  {name:'Autumn Harvest',icon:'🍂',color:'#795548'},
  {name:'Spooky Season',icon:'🎃',color:'#9c27b0'},
  {name:'Winter Wonder',icon:'⛄',color:'#2196f3'}
];
var CURRENT_SEASON = SEASON_THEMES[Math.floor(Date.now()/2592000000)%SEASON_THEMES.length];

// Sound Effects - defined in audio.js module

// Export to global scope for non-module usage
window.GameConfig = {
  SERVER_HOST,
  SERVER_URL,
  WS_URL,
  CONNECTION_TIMEOUT,
  ADMIN_CODE,
  MAX_TROPHIES,
  RANKED_THRESHOLD,
  MAX_CHESTS,
  BOT_NAMES,
  CLAN_NAMES,
  CLAN_BADGES,
  EMOTES,
  STARTER_CARDS,
  CHEST_TYPES,
  TOWER_SKINS,
  STAR_SHOP_ITEMS,
  WILD_ITEMS,
  DAILY_REWARDS,
  CHALLENGES,
  ACHIEVEMENTS,
  WORKSHOP_BOOSTS,
  SPIN_REWARDS,
  WEEKLY_QUESTS,
  TOURNAMENTS,
  TREASURE_ITEMS,
  TREASURE_HUNT_COST,
  BOSSES,
  SEASON_THEMES,
  CURRENT_SEASON,
  SOUNDS
};
