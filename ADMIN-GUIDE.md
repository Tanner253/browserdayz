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
| Click a player's dot on the map | Picks them, and opens a short list of what can be done |
| **Del** | Takes away whatever you are looking at: a thing on the ground, a body, a stash, a car, one of the infected |

Flying (noclip and free camera): W A S D, **Space** up, **Ctrl** down, **Shift** fast, **Alt** slow.

## The panel

- **Players**: everyone online with their number, place, time on and how often the cheat checks fired on them. Click a player, then: Go to them, Bring them here, Heal, Kill, Warn, Mute, Kick, Timeout (5/10/30/60 min), Ban, Make a mod, Make an admin, Take their role. People who just left are listed underneath and can still be banned. Ban, Kill and Make an admin ask "Sure?" and need a second click.
- **Me**: God mode, Vanish, Noclip, Free camera, Heal me. Teleport by place name, by numbers, or by right-clicking the map. "Say to all" puts a line across everyone's screen. Two settings for your own death: **Void inventory** (nothing you carried is left on your body) and **Void dog tag** (no tag of yours is left to cash in). **Carry and ammunition**: Weightless, Endless ammunition and Refill my magazines (see below).
- **Spawn**: five one-click kits, and every item in the game with a search box, a kind filter and a count. If a player is picked in Players, kits and items go to them instead of you.
- **Entities**: spawn a jeep, a police car or infected, and take cars and infected out of the world (see "Added on 13 October" below).
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
| `/bans` | The list, numbered, each with its id in brackets |
| `/unban id-number-or-name` | Lifts a ban: by its id (`a:1f3c9a2b`), by its number straight after `/bans`, or by name if only one ban has that name |
| `/spawn what [count] [x z]` | Puts something in the world: `jeep`, `police` or `infected`. A few steps in front of you (`/spawn infected 5`), or at map numbers, with how many first (`/spawn jeep 1 120 -40`) |
| `/delcar [number]` | Takes a car out of the world: the nearest to you, or the one of that number |
| `/wrecks` | Clears away every burned-out car now |
| `/delz [metres]` | Puts down the infected within so many metres of you (60 if you give no number) |
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
| `/weightless` | What you carry weighs nothing: however much it is, it never slows you. `/weightless on`, `/weightless off`; with neither word it is turned over |
| `/ammo` | Endless ammunition: firing takes no round out of your gun. `/ammo on`, `/ammo off`; with neither word it is turned over. An empty gun is still empty: `/refill` fills it |
| `/refill [who]` | Fills every magazine and every gun you carry (or they carry), wherever it is. A gun with no magazine in it is given its own |

"who" is a name, part of a name, or `#number` from `/players`. The suggestions fill in the number for you.

## Rules the server keeps

- A dog tag can never be spawned.
- No tag is cashed in while god mode, vanish or noclip is on.
- A mod cannot kick, time out or mute an admin.
- Bans and roles are kept on the site and outlast server restarts. Mutes, timeouts, the two death settings, weightless and endless ammunition last until the server restarts.
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

## Added on 13 October: the bigger window, the live map, Entities

### The window

- The panel opens over most of the screen (about 86% of its width and 84% of its height).
- **Move it**: drag the title bar. **Resize it**: drag any edge or corner, or the grip in the bottom right corner.
- It opens where you left it, at the size you left it, in this browser. **Reset layout** in the title bar (or a double click on the bar) puts it back.
- Everything in it can be reached with the keyboard: **Tab** goes from one button to the next, **Enter** presses it, **`** shuts the window.
- Kick, the timeouts and Take their role now ask once more, as Ban and Kill do: press the button again within four seconds.

### The map (M) is live

- Every player is a dot that moves as they move, with a point showing the way they face. Blue is a player, violet is staff, amber is tabbed out, a hollow dot is a body left behind, a grey cross is dead, faint is vanished.
- **Point at a dot** to read who it is, their health, how far they are from you and their map numbers.
- **Click a dot**: that player is picked (in the panel too) and a short list opens: Go to them, Bring them here, Watch them, Message them, Open in the panel.
- **Admin view**, the box in the top left of the map, is yours alone and is kept by this browser:
  - Find a player: the map goes to them.
  - Switches: Players, Names, Facing, Health, Cheat flags, The dead, Bodies left and tabbed out, Trail (where each has been in the last minute).
  - Name colour, Name size, Dot size.
  - Range ring: a ring of 50, 100, 200 or 500 m round you, and round whoever is picked.
  - The map numbers under the pointer are written at the foot of the box: they are what `/tp` and `/spawn` take.
  - Reset puts every one of these back. Click the box's title to fold it away.
- Right-click on the map still teleports you there.

### Entities (in the panel, bottom left)

- **Where a new thing is put**: a few steps in front of you, or where you are looking. "Where you are looking" is whatever is in the middle of your view behind the window: shut the panel, look, open it again (or press Look again).
- **Spawn**: a tile each for the Jeep, the Police car and the Infected. Choose how many, press Spawn. Everybody sees it at once.
- **Take out of the world**: Delete the car I am looking at, Delete the car nearest me, Clear every burned-out car, and Put down the infected within 30, 60, 120 or 250 m of me. Each asks once more.
- The numbers at the foot say how many cars stand, how many are burned out and how many infected are on their feet.
- Things to know:
  - Nobody can be sitting in a car that is deleted.
  - Infected you spawn do not come back when they are dead. Infected that lived there do, in their time, as always.
  - A car you spawn that later burns is followed, three minutes on, by a new car at the nearest parking place of its kind, as any car is.
  - At most 4 cars or 25 infected in one press, and no more than 30 cars or 80 infected over what the map starts with.
- The **Delete** key still takes away whatever you are looking at while you play.

### Carry and ammunition (in the panel, on your own page under Powers)

- **Weightless**: what you carry weighs nothing. The inventory says "weightless" where the weight was.
- **Endless ammunition**: firing takes no round out of the gun in your hands. Everything else about the shot is as it was.
- **Refill my magazines**: one press fills every magazine and every gun you carry. The same button is on the Kits page.
- Pick a player on the left to refill theirs. Pick an admin to put their two switches on and off (or type `/weightless #number on`, `/ammo #number off`).
- The top of your screen says WEIGHTLESS and ENDLESS AMMO while they are on. Both stay on when you die, and are on again when you come back in, until the server restarts.
- A mod cannot use any of the three.

### Bans

- Every ban and every time off has an id of its own (`a:…` for a ban, `t:…` for a time off). The panel's Unban uses it, so it always lifts the one you clicked, whatever else was banned or lifted in the meantime.
- `/unban Name` lifts nothing if more than one ban has that name: it lists them with their ids, and you give the id.

## Stashes left standing

- A stash that is not buried is cleared away when nobody has opened it, changed what is in it, or dug it up for 7 days (empty) or 14 days (with anything in it). A buried stash stays until it is dug up.
- On Render: `STASH_EMPTY_S` and `STASH_FULL_S` change those times (in seconds).
