# ZONA admin guide

## Becoming an admin (once)

1. In Vercel: project `dayz-web-slice` → Settings → Environment Variables → `ADMIN_PASSWORD` (Production). You have set this.
2. In the game press **Enter**, type `/admin`, press **Enter**.
3. The chat box turns into a password box (dots). Type the password, press **Enter**.
4. The chat says "You are an admin, on this and every game from now on."

Your role is tied to your browser's saved game, not to the password. You never type it again unless you clear your browser data or play from another browser.

## Keys

| Key | What it does |
| --- | --- |
| **`** (top left, under Esc) | Opens and shuts the admin panel |
| **/** | Opens the chat with a command started; commands and players are listed as you type |
| **Tab** | Takes the highlighted suggestion |
| **↑ ↓** | Chooses a suggestion |
| **N** | Noclip on and off |
| **K** | Free camera on and off |
| **H** (in the free camera) | Brings your body to where the camera is |
| Right-click on the map (**M**) | Teleports you there |

Flying (noclip and free camera): W A S D, **Space** up, **Ctrl** down, **Shift** fast, **Alt** slow.

## The panel

- **Players**: everyone online with their number, place, time on and how often the cheat checks fired on them. Click a player, then: Go to them, Bring them here, Heal, Kill, Warn, Mute, Kick, Timeout (5/10/30/60 min), Ban, Make a mod, Make an admin, Take their role. People who just left are listed underneath and can still be banned. Ban, Kill and Make an admin ask "Sure?" and need a second click.
- **Me**: God mode, Vanish, Noclip, Free camera, Heal me. Teleport by place name, by numbers, or by right-clicking the map. "Say to all" puts a line across everyone's screen. Two settings for your own death: **Void inventory** (nothing you carried is left on your body) and **Void dog tag** (no tag of yours is left to cash in).
- **Spawn**: five one-click kits, and every item in the game with a search box, a kind filter and a count. If a player is picked in Players, kits and items go to them instead of you.
- **Bans**: the list, with Unban.
- **Roles**: who is an admin or a mod.

## Commands

Mods and admins:

| Command | What it does |
| --- | --- |
| `/players` | Who is online, with numbers |
| `/recent` | Who left lately |
| `/flagged` | Who the cheat checks have flagged |
| `/kick who [why]` | Puts them off (they can come back) |
| `/timeout who minutes [why]` | Keeps them off, up to 60 minutes |
| `/warn who words` | A warning on their screen |
| `/mute who minutes` | Their chat and voice reach nobody |
| `/unmute who` | Lifts it |
| `/say words` | A line across everyone's screen |
| `/help` | The list |

Admins only:

| Command | What it does |
| --- | --- |
| `/ban who [why]` | For good: their saved game and their internet address |
| `/bans` | The list, numbered |
| `/unban number-or-name` | Lifts a ban |
| `/admin who` | Makes them an admin |
| `/mod who` | Makes them a mod |
| `/demote who` | Takes their role |
| `/roles` | Who has a role |
| `/goto who` | You go to them |
| `/bring who` | They come to you |
| `/tp x z` | You go to those map numbers |
| `/give item [count] [who]` | An item at your feet, or theirs |
| `/kit name [who]` | A whole kit: `assault`, `heavy`, `marksman`, `breacher`, `supplies` |
| `/heal [who]` | Full health, fed, watered, wound and leg mended |
| `/slay who` | Kills them |
| `/god` | Nothing hurts you |
| `/vanish` | Nobody sees you (to them you have left) |
| `/noclip` | Fly through anything |
| `/voidinv` | Your body is left empty when you die |
| `/voidtag` | No dog tag of yours is left when you die |

"who" is a name, part of a name, or `#number` from `/players`. The suggestions fill in the number for you.

## Rules the server keeps

- A dog tag can never be spawned.
- No tag is cashed in while god mode, vanish or noclip is on.
- A mod cannot kick, time out or mute an admin.
- Bans and roles are kept on the site and outlast server restarts. Mutes, timeouts and the two death settings last until the server restarts.
- One player per internet address. To allow more, set `PER_ADDRESS` on Render (for example `2`).
- The cheat checks only watch at the moment. To have the server refuse impossible movement and health, set `CHECKS=enforce` on Render.

## Leaving, and bodies left behind

- A player whose game stops answering (a hidden tab, a frozen game) can be killed: the server keeps their health. In the Players tab they are marked "not answering (tabbed out)".
- A player who closes the window without logging out leaves their body for five minutes. In the Players tab it is marked "gone: body left behind". Kick, ban and the rest still work on it.
- Log out is on the pause screen: sixty seconds, cancelled by moving, firing or being hit.
- Both times can be changed on Render: `LINGER_S` (seconds a body stays; `0` turns it off) and `LOGOUT_S` (seconds of the wait).

## What the server keeps between restarts

- Every character (where they stood, what they carried, how they were) and every stash (the case, the suitcase, the black bag: buried or not, with what is in it) is written to the site's store when a server with players on it starts, every three hours, and as it stops. It is read back when the server starts. What lies loose on the ground is not kept.
- A character is kept for 400 days from when its player last left.
- To wipe everything: set `WIPE` on Render to a new word (any word, for example `season2`). What was kept under the old word is ignored and written over.
- `KEEP=off` on Render turns the keeping off. `KEEP_EVERY_MIN` changes the three hours.
- It needs `ADMIN_PASSWORD` to be set on the site (it is): what is kept is sealed with a key drawn from it. If the password is changed, what was kept before can no longer be read, and everybody starts afresh.
- Tags carried over a restart still earn nothing, as before: the server that saw them taken is gone.

## Player slots

`MAX_PLAYERS` on Render (24 now). Above it, players wait in the line.

## Added on 12 October

- **No check ever kicks or flags an admin**, whatever they are doing (flying, under the ground, teleporting).
- **A new admin leaves nothing when they die**: Void inventory and Void dog tag are on by default. Turn them off in the Me tab.
- **The map (M) shows every player** with their name, to admins. Grey is dead, violet is staff, faint is vanished or a body left behind.
- **Other admins' powers**: pick an admin in the Players tab and a Powers row appears (God, Vanish, Noclip, Void inventory, Void tag). Or type `/god who on`, `/vanish who off`, and so on.
- **Vanished admins are visible to other admins**, drawn faintly. The infected ignore whoever is vanished.
- **Names over heads in the free camera**: everybody within 220 m, through walls, with the distance.
- **Watch them** (Players tab): the free camera goes behind that player and travels with them. K comes back.
- **Say to all** now goes across everybody's screen in a banner and into the chat, and the panel says it was sent. **Message** (Players tab, or `/msg who words`) says something to one player alone.
- **What they carry** (Players tab, or `/inv who`): the server's last copy of their pockets, and anything in them the server never put in the world.
- **Kits always replace everything** you carry (dog tags kept), however fast the buttons are pressed. **Spawn** is a kit too: what a new life starts with.
- **Night vision** (Me tab): it is day for you alone.
- **Kill me** (Me tab, or `/die`).
- **Tag colour** (Me tab): the colour of the word ADMIN before your name in the chat. RGB is the default and the RGB button goes back to it. Your name itself is no longer rainbow.
- The Players tab also shows health, kills and tags cashed, and the top line shows server uptime, stashes standing and characters kept.

## Stashes left standing

- A stash that is not buried is cleared away when nobody has opened it, changed what is in it, or dug it up for 7 days (empty) or 14 days (with anything in it). A buried stash stays until it is dug up.
- On Render: `STASH_EMPTY_S` and `STASH_FULL_S` change those times (in seconds).
