// Recordings the game plays in place of sounds it used to make up: gunshots, the bolt, a
// magazine going out and in, a slide racked.
//
//   node scripts/sounds.mjs        (npm run sounds)
//   node scripts/sounds.mjs siren  only those named (the rest's sources need not be on the machine)
//
// Sources, unpacked by hand into assets-src/sounds/ (gitignored):
//   snake/              "Snake's Authentic Gun Sounds" by Snake (f8studios.itch.io): free, may be
//                       used commercially, credit not required
//   firearm-library/    "The Free Firearm Sound Library" by Ben Jaszczak, Brian Nelson, Kevin
//                       Heras and Matthew Nanney (CC0)
//   kenney-impact/      "Impact Sounds" by Kenney (www.kenney.nl), CC0
//   qubodup-punch/      "Punch" by qubodup (opengameart.org/content/punch), CC0
//   cc0-wood-metal/     "100 CC0 metal and wood SFX" (opengameart.org/content/100-cc0-metal-and-wood-sfx), CC0
//   decoded/            the two above come as Ogg, and nothing on this machine reads Ogg but a
//                       browser: the ones used were decoded in one and written out as they are
//                       (k-impact<Kind>-<n>.wav, q-punch-<n>.wav), and are read from here
//   (in assets-src/ itself) "UH60 Black Hawk helicopter hover loop 1" by qubodup (freesound.org/s/854493), CC0:
//                       the rotor of the helicopter that brings a supply drop
//   (in assets-src/sounds/fs/) "Police Siren" by TitanKaempfer (freesound.org/s/746302), CC0: the police car's siren,
//                       decoded from Ogg by `node scripts/ogg.mjs --dir fs 746302__titankaempfer__police-siren`
//
// Each is cut to begin on the sound itself (a shot that starts a tenth of a second into its
// file is a shot that is late), let die away at its end, made one channel, brought to the
// rate given and to a common loudness, and written as 16-bit WAV into public/assets/sounds/.
// (There is no encoder on the machine these were made on, and they are short: about a
// megabyte in all.) What plays them is src/core/audio.ts; the names here are the names there.

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
// (ASSETS_SRC: the sources elsewhere, as for a worktree, which has no assets-src of its own)
const SOURCES = process.env.ASSETS_SRC ?? path.join(ROOT, 'assets-src');
const SRC = path.join(SOURCES, 'sounds');
const OUT = path.join(ROOT, 'public', 'assets', 'sounds');
const snake = (p) => path.join(SRC, 'snake', "Snake's Authentic Gun Sounds", p);
const lib = (p) => path.join(SRC, 'firearm-library', 'Prepared SFX Library', p);
const zed = (k) => path.join(SRC, 'zombies', 'zombies', `zombie-${k}.wav`);
/**
 * The infected: twenty-four recordings ("Zombies Sound Pack" by artisticdude, CC0, unpacked into
 * assets-src/sounds/zombies/), numbered and nothing more. Which is used for what was settled by
 * measuring them (whoever settled it cannot hear): the long low ones are what they do when they
 * are let alone, the long loud ones what they do when they are roused, the bright middling ones
 * the cry when they see somebody, the short ones a blow given or taken. Change the numbers here
 * if a growl turns out to be a scream, and run `npm run sounds`.
 */
const ZED = { groan: [16, 20, 1, 23], growl: [17, 18, 21, 15], alert: [8, 10, 12, 14], attack: [4, 3, 7, 2], hurt: [24, 5, 11, 13], die: [19, 9, 22, 6] };

/**
 *   src   – the recording
 *   side  – which of its two channels (both added together, if not given)
 *   takes – it holds several of the sound one after another: this many are cut out, each its own file (name, name_2, ...)
 *   len   – seconds kept of each (all of it, if not given)
 *   rate  – samples a second it is written at
 *   gain  – how loud against the rest (1: as loud as a recording can be)
 *   with  – other recordings laid under it, each begun where it begins:
 *             level – how loud against the first (1: as loud at its loudest)
 *             after – seconds of its beginning left out (it comes in over the next 40 ms): what follows the shot, without the shot
 *             low   – nothing of it above this many Hz
 *             die   – it dies away sooner than it did: to a third in this many seconds, and so on
 *   air   – how much is added to the top of it, above 3 kHz (1: as much again)
 *   press – how hard the loudest of it is pressed down, so that the rest of it comes up (0: not at all)
 *   from  – seconds of the recording passed over before the sound is looked for (the second thing in it, not the first)
 *   fade  – seconds it dies away over at its end (0.18, if not given: too long for a footstep a tenth of a second long)
 *   curve – how it dies away: 1 evenly, 2 and over quicker at first and long and soft at its last, as an echo does
 *   loop  – it is played round and round, and was made to join its own beginning: all of it is kept as it lies,
 *           neither cut to where it begins nor let die away at its end (give it the rate it came at: put to another,
 *           its end no longer meets its beginning)
 */
const SOUNDS = {
  shot_rifle: { src: snake('Full Sound/7.62x54R/WAV/762x54r Single WAV.wav'), rate: 44100, gain: 1 },
  // A pistol recorded close and in the open is a snap fifteen thousandths of a second long and
  // then nothing: played as it is, beside a rifle that was made to be played in a game, it was
  // a click. (And its two microphones stood either side of the muzzle and disagree: added
  // together they cancel a third of each other.) So: the snap of the 9 mm from one microphone,
  // the weight of another pistol's shot under it, and under both the air after a rifle shot,
  // by whoever recorded the rifle. Then the top of it pressed down.
  shot_pistol: {
    src: lib('Walther PPQ/X_39P.wav'), side: 1, takes: 3, len: 1.5, rate: 44100, gain: 1, press: 1.4, air: 0.9,
    with: [
      { src: lib('Bersa/F_47P.wav'), side: 0, takes: 2, level: 0.6 },
      { src: snake('Full Sound/5.56/WAV/556 Single WAV.wav'), level: 0.65, after: 0.012, die: 0.3 },
    ],
  },
  shot_quiet: { src: snake('Full Sound/.22LR/WAV/22LR Single WAV.wav'), len: 0.9, rate: 44100, gain: 0.8 },
  bolt: { src: snake('Reloads, Cycling & More/WAV/Mosin Bolt Cycle WAV.wav'), rate: 32000, gain: 0.8 },
  rifle_mag_out: { src: snake('Reloads, Cycling & More/WAV/308 Magazine Part 1 WAV.wav'), rate: 32000, gain: 0.75 },
  rifle_mag_in: { src: snake('Reloads, Cycling & More/WAV/308 Magazine Part 2 WAV.wav'), rate: 32000, gain: 0.75 },
  pistol_mag_out: { src: snake('Reloads, Cycling & More/WAV/Angel Mag Reload Part 1 WAV.wav'), rate: 32000, gain: 0.7 },
  pistol_mag_in: { src: snake('Reloads, Cycling & More/WAV/Angel Mag Reload Part 2 WAV.wav'), rate: 32000, gain: 0.7 },
  rack: { src: snake('Reloads, Cycling & More/WAV/Semi 22LR Rack WAV.wav'), rate: 32000, gain: 0.75 },
  // The shotgun: a twelve bore recorded close (the library's Benelli Nova), and under it, as
  // under the pistol, the air after a rifle shot.
  shot_shotgun: {
    // (the gun itself, pressed hard; under it the bottom of the big rifle's shot, which is the thump a twelve bore
    // has in the chest; and the air after a rifle shot, left to ring a good while)
    src: lib('Nova/O_21P.wav'), side: 1, takes: 2, len: 2.2, rate: 44100, gain: 1, press: 1.6,
    with: [
      { src: snake('Full Sound/7.62x54R/WAV/762x54r Single WAV.wav'), level: 1.1, low: 520 },
      { src: snake('Full Sound/7.62x39/WAV/762x39 Single WAV.wav'), level: 0.75, after: 0.012, die: 0.55 },
    ],
  },
  // The big pistol: a .45 (the library's 1911), which is the heaviest pistol there is a
  // recording of, with the same air under it.
  shot_magnum: {
    src: lib('1911/A_42P.wav'), side: 1, takes: 2, len: 1.9, rate: 44100, gain: 1, press: 1.3, air: 0.5,
    // (and the bottom of the big rifle's shot under it, which is the weight a .50 has and a .45 has not)
    with: [
      { src: snake('Full Sound/7.62x54R/WAV/762x54r Single WAV.wav'), level: 0.95, low: 700 },
      { src: snake('Full Sound/7.62x39/WAV/762x39 Single WAV.wav'), level: 0.7, after: 0.012, die: 0.45 },
    ],
  },
  // a shell thumbed into a shotgun's tube
  shell_in: { src: snake('Reloads, Cycling & More/WAV/Pump Shell Load WAV.wav'), rate: 32000, gain: 0.8 },
  // The two assault rifles, each as it was recorded: a single shot, its magazine out and in, and its bolt worked.
  shot_ak: { src: snake('Full Sound/7.62x39/WAV/762x39 Single WAV.wav'), len: 1.7, rate: 44100, gain: 1 },
  shot_ar: { src: snake('Full Sound/5.56/WAV/556 Single WAV.wav'), len: 1.6, rate: 44100, gain: 1 },
  ak_mag_out: { src: snake('Reloads, Cycling & More/WAV/AK Reload Part 1 WAV.wav'), rate: 32000, gain: 0.75 },
  ak_mag_in: { src: snake('Reloads, Cycling & More/WAV/AK Reload Part 2 WAV.wav'), rate: 32000, gain: 0.75 },
  ak_rack: { src: snake('Reloads, Cycling & More/WAV/AK Rack WAV.wav'), rate: 32000, gain: 0.8 },
  ar_mag_out: { src: snake('Reloads, Cycling & More/WAV/AR Reload Part 1 WAV.wav'), rate: 32000, gain: 0.75 },
  ar_mag_in: { src: snake('Reloads, Cycling & More/WAV/AR Reload Part 2 WAV.wav'), rate: 32000, gain: 0.75 },
  ar_rack: { src: snake('Reloads, Cycling & More/WAV/AR Charging Handle WAV.wav'), rate: 32000, gain: 0.8 },
  // a round pushed into a magazine against its spring (a cartridge going in at a rifle's loading gate: the same
  // click of brass past steel, and the nearest thing there is a recording of)
  mag_round: { src: snake('Reloads, Cycling & More/WAV/Lever Reload WAV.wav'), rate: 32000, gain: 0.9 },
};
for (const [kind, takes] of Object.entries(ZED)) takes.forEach((k, n) => (SOUNDS[`z_${kind}${n ? `_${n + 1}` : ''}`] = { src: zed(k), rate: 32000, gain: 0.9 }));
// A fist landing on somebody (the five of the Punch pack); something heavier landing on them (Kenney's heavy
// punches); and a round or a blow on steel: a car's door, a drum, a locker (plate for the thin of it, bar for the
// thick). Nobody who chose these could hear them: they are what their makers called them.
const dec = (n) => path.join(SRC, 'decoded', `${n}.wav`);
const several = (name, files, o) => files.forEach((f, n) => (SOUNDS[`${name}${n ? `_${n + 1}` : ''}`] = { src: dec(f), ...o }));
several('punch', [1, 2, 3, 4, 5].map((k) => `q-punch-${k}`), { rate: 32000, gain: 0.9 });
several('blow', [0, 1, 2, 3, 4].map((k) => `k-impactPunch_heavy-${k}`), { rate: 32000, gain: 0.9 });
// Doors, out of "100 CC0 metal and wood SFX" (opengameart.org/content/100-cc0-metal-and-wood-sfx, CC0; unpacked by
// hand into cc0-wood-metal/, and decoded from Ogg by `node scripts/ogg.mjs --dir cc0-wood-metal <names>`). A wooden
// door opened, its hinge, and shut; and for the bunker's, a steel door drawn open, pushed to, and slammed. Nobody
// who chose these could hear them: they are what their maker called them.
const door = (name) => path.join(SRC, 'decoded', `c-${name}.wav`);
SOUNDS.door_open = { src: door('door_open_01'), rate: 44100, gain: 0.9 };
SOUNDS.door_creak = { src: door('wood_squeak_01'), rate: 44100, gain: 0.8 };
SOUNDS.door_creak_2 = { src: door('wood_squeak_02'), rate: 44100, gain: 0.8 };
SOUNDS.door_close = { src: door('wood_close_01'), rate: 44100, gain: 0.9 };
SOUNDS.door_close_2 = { src: door('wood_close_02'), rate: 44100, gain: 0.9 };
SOUNDS.gate_open = { src: door('metal_open_01'), rate: 44100, gain: 0.9 };
SOUNDS.gate_close = { src: door('metal_close_01'), rate: 44100, gain: 0.9 };
SOUNDS.gate_slam = { src: door('metal_slam_01'), rate: 44100, gain: 0.9 };
several('hit_metal', ['k-impactPlate_heavy-0', 'k-impactPlate_heavy-1', 'k-impactPlate_heavy-3', 'k-impactMetal_heavy-1', 'k-impactMetal_heavy-3', 'k-impactMetal_light-3'], { rate: 44100, gain: 0.9 });

// What a body does all day (2026-10-13: "our sounds for drinking and doing basically everything can and should get
// rehauled"): feet on the ground, a thing taken up or put down, a spade, a fire, a car's door. All of it is out of
// the same two CC0 packs as the doors and the blows (Kenney's "Impact Sounds", and "100 CC0 metal and wood SFX"),
// which is all there is on this machine: neither has anybody eating, drinking, tearing cloth, a zip, an engine or
// the wind, and those are still made up in src/core/audio.ts. Every Ogg of both packs is decoded by
//   node scripts/ogg.mjs <every kind of Kenney's>     and     node scripts/ogg.mjs --dir cc0-wood-metal <every name>
// Nobody who chose these could hear them. They were chosen by what their makers called them and by their figures
// (how long, how fast up and down, where their weight lies): `?sounds` on the dev page plays each beside what it
// replaces, for somebody who can.
const five = (kind) => [0, 1, 2, 3, 4].map((k) => `k-${kind}-${k}`);
// Feet, by what is under them. Kenney's five takes of each (of the carpet, two are given twice over: three).
several('step_grass', five('footstep_grass'), { rate: 32000, gain: 0.9, len: 0.2, fade: 0.1 });
several('step_concrete', five('footstep_concrete'), { rate: 32000, gain: 0.9, fade: 0.03 });
several('step_snow', five('footstep_snow'), { rate: 32000, gain: 0.9, fade: 0.1 });
several('step_soft', ['k-footstep_carpet-0', 'k-footstep_carpet-1', 'k-footstep_carpet-3'], { rate: 32000, gain: 0.9, fade: 0.04 });
// (A boot on a board: Kenney's is all under 250 Hz, which a telephone's loudspeaker does not carry at all, so the
// knock of a real piece of wood struck is laid over each, ten decibels under it.)
['wood_hit_05', 'wood_hammer_02', 'wood_hit_08', 'wood_hit_07', 'wood_misc_08'].forEach((knock, n) => (SOUNDS[`step_wood${n ? `_${n + 1}` : ''}`] = { src: dec(`k-footstep_wood-${n}`), rate: 32000, gain: 0.9, len: 0.22, fade: 0.08, with: [{ src: door(knock), level: 0.32 }] }));
// (and on steel: a light blow on a plate, which the game lays quietly over a step on something hard)
several('step_metal', five('impactPlate_light'), { rate: 32000, gain: 0.9, len: 0.24, fade: 0.12 });
// The weight of a body coming down: a landing, a fall, a car into a wall.
several('thud', five('impactSoft_heavy'), { rate: 32000, gain: 0.9, len: 0.42, fade: 0.15 });
// A thing taken up or put down, by what it is made of: something small of steel, something heavy of steel (a gun,
// a magazine, a tool), a tin, wood, and anything else. Loose rounds are a bunch of keys: small brass on small brass.
several('take_metal', five('impactMetal_light'), { rate: 32000, gain: 0.9, len: 0.25, fade: 0.12 });
several('take_heavy', five('impactMetal_medium'), { rate: 32000, gain: 0.9, fade: 0.05 });
several('take_tin', five('impactTin_medium'), { rate: 32000, gain: 0.9, fade: 0.05 });
several('take_wood', five('impactWood_light'), { rate: 32000, gain: 0.9, len: 0.16, fade: 0.08 });
several('take_any', five('impactGeneric_light'), { rate: 32000, gain: 0.9, fade: 0.04 });
// (each begins with the hand closing on them, which is quiet and is passed over: a sound that begins late is a sound that lags)
[['keys_01', 0.109], ['keys_04', 0.07], ['keys_05', 0.16], ['keys_06', 0.125]].forEach(([name, from], n) => (SOUNDS[`take_rounds${n ? `_${n + 1}` : ''}`] = { src: door(name), from, rate: 32000, gain: 0.9, len: 0.24, fade: 0.1 }));
// A gun let fall: metal coming down and bouncing; and twice more, a piece of wood coming down with steel struck under it.
SOUNDS.drop_gun = { src: door('metal_falling_01'), from: 0.236, rate: 32000, gain: 0.9, len: 0.9, fade: 0.25 };
SOUNDS.drop_gun_2 = { src: door('wood_falling_03'), rate: 32000, gain: 0.9, len: 0.45, fade: 0.15, with: [{ src: door('metal_hit_03'), level: 0.7 }] };
SOUNDS.drop_gun_3 = { src: door('wood_falling_01'), rate: 32000, gain: 0.9, len: 0.5, fade: 0.15, with: [{ src: door('metal_sheet_05'), level: 0.6 }] };
// A spade into the ground (Kenney calls it mining: a tool driven into earth and stone, and what it loosens settling after).
several('dig', five('impactMining'), { rate: 32000, gain: 0.9, len: 0.55, fade: 0.15 });
// Wood cracking, for a fire; wood breaking, for a bone (as it has always been done for films).
several('fire_crack', ['c-wood_cracking_01', 'c-wood_cracking_02', 'c-wood_cracking_03', 'c-wood_cracking_04'], { rate: 44100, gain: 0.9, fade: 0.05 });
several('snap', ['c-wood_breaking_01', 'c-wood_breaking_02'], { rate: 44100, gain: 0.9, len: 0.4, fade: 0.12 });
// A car's door: its catch (a lock let go: the second thing in that recording, the first being the key), then the
// steel door slammed that the bunker and the lockers already have. And a car into something: sheet steel giving.
SOUNDS.latch = { src: door('lock_open_01'), from: 0.4, rate: 44100, gain: 0.9, len: 0.3, fade: 0.08 };
several('crash_tin', ['c-metal_sheet_03', 'c-metal_sheet_06', 'c-metal_sheet_01'], { rate: 44100, gain: 0.9, fade: 0.12 });
// A round or a blow on wood, as steel has had: five real pieces of wood struck.
several('hit_wood', ['c-wood_hit_03', 'c-wood_hit_04', 'c-wood_hit_07', 'c-wood_hit_08', 'c-wood_hit_01'], { rate: 44100, gain: 0.9, len: 0.26, fade: 0.1 });
// The rotor of the helicopter that brings a supply drop (2026-10-13; src/sim/airdrop.ts says how it is heard): a Black
// Hawk holding still, 2.6 seconds that join their own beginning, one channel at 48000 as it came. How loud it is
// played, and how its pitch and its top change with distance, is ROTOR there.
SOUNDS.rotor = { src: path.join(SOURCES, '854493__qubodup__uh60-black-hawk-helicopter-hover-loop-1.wav'), loop: true, rate: 48000, gain: 1 };
// The police car's siren (the owner, 2026-10-20: "Added new sound to replace the police siren"): its wail goes up and
// down every 3 s exactly, the first rising out of nothing and the last dying away; one whole turn out of the middle,
// begun where it joins its own beginning to the sample, at the rate it came (a new rate would blur the seam).
SOUNDS.siren = { src: dec('c-746302__titankaempfer__police-siren'), from: 278670 / 44100, len: 3, loop: true, rate: 44100, gain: 1 };

// The weapons pass's guns, each a shot of its own (2026-10-17; the owner chose them and downloaded the Freesound ones,
// all CC0, into assets-src/ itself; the FLAC, MP3 and 32-bit ones decoded by a browser into decoded/fs-<number>.wav).
// The library's are a muzzle's snap and want weight under them, as the pistol's does; Freesound's are made to be played.
const fsnd = (f) => path.join(SOURCES, f);
const AIR = { src: snake('Full Sound/5.56/WAV/556 Single WAV.wav'), level: 0.65, after: 0.012, die: 0.3 };
const BORE = [
  { src: snake('Full Sound/7.62x54R/WAV/762x54r Single WAV.wav'), level: 1.1, low: 520 },
  { src: snake('Full Sound/7.62x39/WAV/762x39 Single WAV.wav'), level: 0.75, after: 0.012, die: 0.55 },
];
// (the Scorpion a Swedish K, the Dual SMGs a PPSh, the AKS-74U an AK-47: the library's, each its own three takes)
SOUNDS.shot_scorpion = { src: lib('Carl Gustav M45/G_31P.wav'), side: 1, takes: 3, len: 1.5, rate: 44100, gain: 1, press: 1.4, air: 0.9, with: [AIR] };
SOUNDS.shot_ppsh = { src: lib('PPSh/P_30P.wav'), side: 1, takes: 3, len: 1.5, rate: 44100, gain: 1, press: 1.4, air: 0.6, with: [AIR] };
SOUNDS.shot_aks = { src: lib('AK-47/C_28P.wav'), side: 1, takes: 3, len: 1.7, rate: 44100, gain: 1, press: 1.2, with: [{ ...AIR, level: 0.5 }] };
// (the DB-12 a Winchester Model 12, the sawn-offs a Charles Daly: twelve bores, with the shotgun's thump under them)
SOUNDS.shot_db12 = { src: lib('Model 12/K_22P.wav'), side: 1, takes: 2, len: 2.2, rate: 44100, gain: 1, press: 1.6, with: BORE };
SOUNDS.shot_sawnoff = { src: lib('CD/H_21P.wav'), side: 1, takes: 2, len: 2, rate: 44100, gain: 1, press: 1.6, with: BORE };
// (the Barrett an M82A1, the .50 an M107; the VSSK's quieted shot a quieted Tac-50; the MAC-10s a .45 USP; the MP7 the
// last shot of an Uzi's last burst; the M32 a 40 mm launcher; the Desert Eagle its own, cut before its case lands)
SOUNDS.shot_barrett = { src: dec('fs-855592'), len: 2, rate: 44100, gain: 1 };
// (its recording is loud to its last sample, and its echo stopped dead: let die away over most of its length, as an
// echo does: the owner, 2026-10-18, "the .50 sniper needs to have better end and echo fade")
SOUNDS.shot_50 = { src: dec('fs-854700'), len: 2.5, rate: 44100, gain: 1, fade: 1.9, curve: 2.2 };
// (cut short: its long boom was the loudest thing about it, and a quieted gun is not heard ringing on: the owner,
// 2026-10-18, "the vssk sound is supposed to be a lot quieter")
SOUNDS.shot_vssk = { src: dec('fs-737570'), len: 0.9, rate: 44100, gain: 1, fade: 0.35 };
SOUNDS.shot_mac10 = { src: fsnd('734062__areniporgen__heckler-koch-usp45.wav'), len: 1.6, rate: 44100, gain: 1 };
SOUNDS.shot_mp7 = { src: dec('fs-418433'), from: 0.86, len: 0.44, rate: 44100, gain: 1, fade: 0.12 };
SOUNDS.shot_m32 = { src: fsnd('163458__lemudcrab__grenade-launcher.wav'), rate: 44100, gain: 1, fade: 0.1 };
SOUNDS.shot_deagle = { src: dec('fs-233322'), len: 0.95, rate: 44100, gain: 1, fade: 0.15 };
// A pump worked (a Mossberg's, after its shot: back, and forward), for the Benelli; a spent case on the ground; and an
// Uzi reloaded empty, its magazine out, the new one in, and its bolt drawn, for the submachine guns.
SOUNDS.pump = { src: fsnd('159710__anthonychan0__mossberg-500a-1-shot-and-pump.wav'), from: 1.18, len: 0.66, rate: 32000, gain: 0.8, fade: 0.08 };
SOUNDS.casing = { src: fsnd('179006__smartwentcody__bullet-casing-on-concrete-1.wav'), len: 0.8, rate: 32000, gain: 0.7, fade: 0.2 };
const UZI = fsnd('677160__serutonin-deprivd__uzi-submachine-gun-being-reloaded-while-empty.wav');
SOUNDS.uzi_mag_out = { src: UZI, from: 0.15, len: 0.55, rate: 32000, gain: 0.75, fade: 0.08 };
SOUNDS.uzi_mag_in = { src: UZI, from: 1.5, len: 0.85, rate: 32000, gain: 0.75, fade: 0.1 };
SOUNDS.uzi_rack = { src: UZI, from: 2.95, len: 0.95, rate: 32000, gain: 0.8, fade: 0.1 };
// And what the owner added after (2026-10-17): a round's crack going by (five of a recording of thirteen), a drink
// (its gulps, cut before the "ahh" it ends with: "the end of the sound ... we wont need"), a wooden door opened then
// shut (the two halves apart), and a steel hinge creaking, for the bunker's door and the lockers.
// (the five of its thirteen that are a crack and nothing after it: two others ring on, a round striking something)
[0, 3.3, 5.8, 11.4, 12.85].forEach((from, n) => (SOUNDS[`bullet_crack${n ? `_${n + 1}` : ''}`] = { src: fsnd('161001__deleted_user_1371021__whipper-snappersbullet-hits.wav'), from, len: 0.35, rate: 44100, gain: 0.9, fade: 0.12 }));
SOUNDS.drink = { src: dec('fs-411172'), len: 1.06, rate: 32000, gain: 0.8, fade: 0.06 };
const DOOR = fsnd('125958__ryding__wooden-door-open-close.wav');
SOUNDS.door_opened = { src: DOOR, len: 1.3, rate: 44100, gain: 0.6, fade: 0.2 };
SOUNDS.door_shut = { src: DOOR, from: 1.8, len: 0.95, rate: 44100, gain: 0.9, fade: 0.2 };
SOUNDS.metal_creak = { src: fsnd('119468__ingudios__metal-creak-4.wav'), len: 1.6, rate: 44100, gain: 0.8, fade: 0.3 };
// Raiding (base building, 2026-10-25; the picks: progress/base-models/sound-picks.md and incoming-map.md, all CC0): a C4's
// timer (Kenney's "Digital Audio", twoTone1, decoded from Ogg), a satchel's fuse burning (elonen's, looped), and a stone
// and a metal piece coming down (kastenfrosch's crumble, decoded from Ogg; xkeril's falling debris)
SOUNDS.c4_beep = { src: dec('c-twoTone1'), len: 0.32, rate: 32000, gain: 0.7, fade: 0.04 };
SOUNDS.fuse = { src: fsnd('45650__elonen__fuse_burning_48khz.wav'), from: 0.4, len: 6, loop: true, rate: 32000, gain: 0.8 };
SOUNDS.break_stone = { src: dec('c-521956__kastenfrosch__stone-crumble-2'), len: 3.8, rate: 32000, gain: 2.2, fade: 0.6 };
SOUNDS.break_metal = { src: fsnd('703247__xkeril__big-falling-debris-crash.wav'), len: 4.5, rate: 32000, gain: 1, fade: 0.7 };
// And building's own (2026-10-25, the polish pass's "sounds for every action"; the picks in progress/base-models/
// sound-picks.md, all CC0, decoded from Ogg): a nail driven (four of rubberduck's hammer blows), a key lock's click, a
// hatch's or a box's latch, a box's lid up and down, a ladder's creaks, a sleeping bag's rustle, a keypad's key, a code
// taken and one refused, a wrong code's shock (Kenney's RPG, Interface and Digital Audio); a knock on a wooden door
// (flem0527's), a garage door run up or down (nicola_ariutti's roller shutter)
[1, 2, 3, 4].forEach((n) => (SOUNDS[`nail${n > 1 ? `_${n}` : ''}`] = { src: dec(`c-hammer_0${n}`), len: 0.45, rate: 32000, gain: 0.85, fade: 0.12 }));
SOUNDS.lock_click = { src: dec('c-metalClick'), len: 0.45, rate: 32000, gain: 0.8, fade: 0.08 };
SOUNDS.crate_latch = { src: dec('c-metalLatch'), len: 0.26, rate: 32000, gain: 0.8, fade: 0.06 };
SOUNDS.crate_open = { src: dec('c-doorOpen_1'), len: 0.9, rate: 32000, gain: 0.8, fade: 0.15 };
SOUNDS.crate_shut = { src: dec('c-doorClose_1'), len: 0.68, rate: 32000, gain: 0.85, fade: 0.12 };
[1, 2, 3].forEach((n) => (SOUNDS[`creak${n > 1 ? `_${n}` : ''}`] = { src: dec(`c-creak${n}`), len: 0.8, rate: 32000, gain: 0.7, fade: 0.12 }));
[1, 2, 3, 4].forEach((n) => (SOUNDS[`cloth${n > 1 ? `_${n}` : ''}`] = { src: dec(`c-cloth${n}`), len: 0.66, rate: 32000, gain: 0.7, fade: 0.1 }));
SOUNDS.keypad = { src: dec('c-click_003'), len: 0.06, rate: 32000, gain: 0.6, fade: 0.01 };
SOUNDS.code_ok = { src: dec('c-confirmation_001'), len: 0.29, rate: 32000, gain: 0.6, fade: 0.05 };
SOUNDS.code_wrong = { src: dec('c-error_004'), len: 0.12, rate: 32000, gain: 0.7, fade: 0.03 };
SOUNDS.shock = { src: dec('c-zap1'), len: 1.0, rate: 32000, gain: 0.8, fade: 0.2 };
SOUNDS.knock = { src: fsnd('629987__flem0527__knocking-on-wood-door-1.wav'), len: 0.72, rate: 32000, gain: 2.4, fade: 0.08 };
SOUNDS.garage = { src: fsnd('335364__nicola_ariutti__roller-shutter.wav'), from: 1.25, len: 3.2, rate: 32000, gain: 1, fade: 0.7 };

/** a .wav as one channel of numbers between -1 and 1: one of its channels, or all of them together */
async function readWav(file, side) {
  const b = await fs.readFile(file);
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') throw new Error(`${file}: not a WAV file`);
  let fmt = null, data = null;
  for (let at = 12; at + 8 <= b.length; ) {
    const id = b.toString('latin1', at, at + 4), size = b.readUInt32LE(at + 4);
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(at + 10), rate: b.readUInt32LE(at + 12), bits: b.readUInt16LE(at + 22) };
    if (id === 'data') data = b.subarray(at + 8, Math.min(b.length, at + 8 + size));
    at += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`${file}: no sound in it`);
  const bytes = fmt.bits / 8, frames = Math.floor(data.length / (bytes * fmt.channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      if (side !== undefined && c !== Math.min(side, fmt.channels - 1)) continue;
      const o = (i * fmt.channels + c) * bytes;
      sum += bytes === 2 ? data.readInt16LE(o) / 32768 : bytes === 3 ? data.readIntLE(o, 3) / 8388608 : bytes === 4 ? data.readInt32LE(o) / 2147483648 : (data[o] - 128) / 128;
    }
    out[i] = side !== undefined ? sum : sum / fmt.channels;
  }
  return { rate: fmt.rate, x: out };
}

/** one sound cut out of a recording: from where it begins, at the rate asked for, its loudest moment at 1 */
function cutOut(x, rate, from, len, to) {
  const end = Math.min(x.length, len ? from + Math.round(len * rate) : x.length);
  const cut = resample(x.slice(from, end), rate, to);
  let peak = 0;
  for (const v of cut) peak = Math.max(peak, Math.abs(v));
  return cut.map((v) => v / (peak || 1));
}

/** how loud a stretch of it is, in decibels under as loud as can be */
function loud(x, rate, a, b) {
  let s = 0;
  const i0 = Math.round(a * rate), i1 = Math.min(x.length, Math.round(b * rate));
  for (let i = i0; i < i1; i++) s += x[i] * x[i];
  return (10 * Math.log10(s / Math.max(1, i1 - i0) + 1e-12)).toFixed(1);
}

/** where the sounds in it begin: the first sample of each that is loud, a breath before it */
function onsets(x, rate, many) {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const out = [];
  const loud = peak * (many ? 0.3 : 0.04), apart = rate * 0.9;
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i]) < loud) continue;
    if (out.length && i - out[out.length - 1] < apart) continue;
    out.push(i);
  }
  // back to where it rises out of the quiet before it
  return out.map((i) => {
    let k = i;
    while (k > 0 && i - k < rate * 0.02 && Math.abs(x[k]) > peak * 0.02) k--;
    return Math.max(0, k - Math.round(rate * 0.002));
  });
}

function resample(x, from, to) {
  if (from === to) return x;
  // what the new rate cannot carry is taken out first, roughly: the mean of as many samples as go into one
  const n = Math.max(1, Math.round(from / to));
  let y = x;
  if (n > 1) {
    y = new Float32Array(x.length);
    let sum = 0;
    for (let i = 0; i < x.length; i++) {
      sum += x[i];
      if (i >= n) sum -= x[i - n];
      y[i] = sum / Math.min(n, i + 1);
    }
  }
  const out = new Float32Array(Math.floor((y.length * to) / from));
  for (let i = 0; i < out.length; i++) {
    const p = (i * from) / to, k = Math.floor(p), f = p - k;
    out[i] = y[k] * (1 - f) + (y[Math.min(y.length - 1, k + 1)] ?? 0) * f;
  }
  return out;
}

async function writeWav(file, x, rate) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(36 + x.length * 2, 4);
  b.write('WAVEfmt ', 8, 'latin1');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  // A recording that is already there, and is the same but for its last bit or two, is left as it is. (The
  // sources that came as Ogg are decoded by a browser, and a newer browser decodes them a hair differently: 2 parts
  // in 32768 on some samples of the blows and the steel, 2026-10-13. That is not a change, and is not written as one.)
  const was = await fs.readFile(file).catch(() => null);
  if (was && was.length === b.length && was.subarray(0, 44).equals(b.subarray(0, 44))) {
    let off = 0;
    for (let i = 44; i < b.length && off <= 2; i += 2) off = Math.max(off, Math.abs(was.readInt16LE(i) - b.readInt16LE(i)));
    if (off <= 2) return;
  }
  await fs.writeFile(file, b);
}

// The animals (2026-10-23). The owner, of what was downloaded: "make use of the sounds we have where yuo can", and of
// some of it: "literally actually useless garbage". So: field recordings looked at, since nobody who cut them can hear
// (each one's spectrogram and every sound in it: progress/animals/listen), and only their clean parts kept: each take
// cut at the times written here, its rumble and hiss filtered off, the quiet between its sounds taken down, faded in
// and out, and brought to one loudness by the body of it (its loudest third of a second), not by one peak.
// Left out: the roe deer's dawn chorus (99645: its barks stand barely over the nightingales singing through them),
// the synthetic bear growl (728102: made, not recorded, a wash of noise over all of it) and a horse galloping (175356:
// in hiss twenty decibels under its hooves). Sources in assets-src/ (the MP3 and FLAC ones decoded into
// assets-src/sounds/decoded/ by `node scripts/ogg.mjs --dir fs <file>`), each named in CREDITS.md.
//   cuts   – [seconds in, seconds long] of each take, written out as name, name_2, ...
//   high   – nothing of it under this many Hz (wind, the recorder's own rumble); top: nothing over (hiss)
//   gate   – the quiet between its sounds: what is this many dB under its loudest is brought down further
//   level  – the loudness of its loudest third of a second, dB under full (audio.ts sets each against the rest)
//   rise   – seconds it comes in over (0.03 if not given); fade: seconds it dies away over
const SRCS = SOURCES, DEC = path.join(SOURCES, 'sounds', 'decoded');
const ANIMALS = {
  // a brown bear: its charge, the roars of craigsmith's recording; its swipe and bite, the grunts and the roars' ends
  animal_bear_roar: { src: path.join(SRCS, '479825__craigsmith__r19-13-bear-roaring.wav'), cuts: [[0.22, 1.65], [3.2, 2.6], [6.85, 2.15]], high: 60, top: 9000, gate: -32, level: -11, fade: 0.35, rate: 32000 },
  animal_bear_growl: { src: path.join(SRCS, '479825__craigsmith__r19-13-bear-roaring.wav'), cuts: [[1.92, 0.8], [4.4, 1.0], [7.6, 0.9]], high: 60, top: 9000, gate: -32, level: -12, rise: 0.06, fade: 0.25, rate: 32000 },
  animal_bear_bite: { src: path.join(SRCS, '479825__craigsmith__r19-13-bear-roaring.wav'), cuts: [[0.95, 0.75], [5.05, 0.75]], high: 60, top: 9000, gate: -32, level: -12, rise: 0.04, fade: 0.2, rate: 32000 },
  // a red deer stag at the rut: Robert.Crosley's, in Scotland (CC-BY 4.0), six of its roars
  animal_roar: { src: path.join(SRCS, '776204__robertcrosley__red-deer-bugles-and-roars-northern-scotland-time-compressed.wav'), cuts: [[1.85, 2.35], [9.55, 2.3], [16.6, 3.6], [24.35, 3.0], [73.45, 2.3], [100.45, 2.4]], high: 70, top: 10000, gate: -36, level: -12, fade: 0.4, rate: 32000 },
  // hooves at a run: ebenvie's horse, its clean stretches
  animal_hooves: { src: path.join(DEC, 'c-792860__ebenvie__horse-running.wav'), cuts: [[2.5, 2.6], [8.0, 1.95], [11.6, 1.45], [18.75, 3.0]], high: 90, top: 12000, gate: -30, level: -16, rise: 0.02, fade: 0.3, rate: 32000 },
  // a lone wolf (NaturesTemper's) and a pack together (Kingcornz's), each its whole howl
  animal_howl: [
    { src: path.join(DEC, 'c-398430__naturestemper__wolf-howl.wav'), cut: [0.85, 6.9] },
    { src: path.join(SRCS, '378334__kingcornz__howling-wolves.wav'), cut: [0.2, 7.4] },
  ],
  // a wolf watching you from close: newagesoup's growl (CC-BY 4.0); going in: qubodup's dog, its snarls
  animal_wolf_growl: { src: path.join(SRCS, '338674__newagesoup__wolf-growl.wav'), cuts: [[0.0, 2.7]], high: 60, top: 9000, gate: -34, level: -13, fade: 0.3, rate: 32000 },
  animal_wolf_snarl: { src: path.join(DEC, 'c-122183__qubodup__dog-growling-snarling-grumbling.wav'), cuts: [[4.35, 1.1], [18.15, 1.1], [31.5, 1.1], [45.45, 0.75], [51.3, 1.0]], high: 80, top: 10000, gate: -30, level: -12, rise: 0.02, fade: 0.2, rate: 32000 },
  // a cow: JosephSardin's five moos (each came cut hard at its end: ended a little before, and faded)
  animal_moo: { src: path.join(SRCS, '177253__josephsardin__cow-moos.wav'), cuts: [[0.2, 2.05], [2.8, 2.3], [5.6, 2.35], [8.45, 3.0], [12.1, 1.95]], high: 60, top: 9000, level: -13, rise: 0.06, fade: 0.3, rate: 32000 },
  // food poisoning: SpliceSound's, the three fullest of it
  vomit: { src: path.join(SRCS, '338116__splicesound__vomit-puking-spilling-water-onto-grass-splat.wav'), cuts: [[10.3, 1.2], [20.65, 1.6], [4.7, 0.9]], high: 120, top: 11000, gate: -30, level: -14, rise: 0.02, fade: 0.25, rate: 32000 },
};
// And base building's, cut the same way (2026-10-25, CC0): a wooden piece splintering (three of craigsmith's poles
// breaking) and a sledgehammer on a wall (four of jerryberumen's blows, each to its ring)
Object.assign(ANIMALS, {
  break_wood: { src: path.join(SRCS, '481936__craigsmith__r29-30-breaking-wooden-poles.wav'), cuts: [[13.48, 1.5], [31.26, 1.3], [28.86, 1.3]], high: 60, top: 12000, gate: -34, level: -10, rise: 0.01, fade: 0.35, rate: 32000 },
  sledge: { src: path.join(SRCS, '827432__jerryberumen__destrcrsh_-sledgehammer-hitting-drywall-stonewall-variation-construction-debris-hard-continous_gabr_fcs2.wav'), cuts: [[5.62, 0.55], [8.64, 0.5], [9.6, 0.5], [7.68, 0.5]], high: 50, top: 12000, level: -10, rise: 0.005, fade: 0.15, rate: 32000 },
});
// (the howls are one take from each of two recordings)
for (const [name, cfg] of Object.entries(ANIMALS)) {
  if (!Array.isArray(cfg)) continue;
  ANIMALS[name] = { many: cfg.map((c) => ({ ...c })), high: 90, top: 9000, gate: -38, level: -12, rise: 0.25, fade: 1.0, rate: 32000 };
}

/** a one-pole filter run twice: 12 dB an octave off above (`low`) or below (`high`) `hz` */
function pass(x, rate, hz, high) {
  const a = Math.exp((-2 * Math.PI * hz) / rate), y = Float32Array.from(x);
  for (let round = 0; round < 2; round++) {
    let lo = 0;
    for (let i = 0; i < y.length; i++) {
      lo = a * lo + (1 - a) * y[i];
      y[i] = high ? y[i] - lo : lo;
    }
  }
  return y;
}

/** one take of an animal: filtered, the quiet in it taken down, faded, and at its loudness */
function take(raw, rate, cfg) {
  let y = raw;
  if (cfg.high) y = pass(y, rate, cfg.high, true);
  if (cfg.top) y = pass(y, rate, cfg.top, false);
  y = resample(y, rate, cfg.rate);
  const r = cfg.rate;
  if (cfg.gate) {
    // (an envelope that rises in 5 ms and falls in 120; under the gate, the further under the more it is brought down)
    const up = Math.exp(-1 / (0.005 * r)), down = Math.exp(-1 / (0.12 * r)), env = new Float32Array(y.length);
    let e = 0, top = 0;
    for (let i = 0; i < y.length; i++) {
      const v = Math.abs(y[i]);
      e = v > e ? up * e + (1 - up) * v : down * e + (1 - down) * v;
      env[i] = e;
      top = Math.max(top, e);
    }
    const at = top * 10 ** (cfg.gate / 20);
    y = y.map((v, i) => (env[i] >= at ? v : v * (env[i] / at) ** 1.5));
  }
  const rise = Math.round((cfg.rise ?? 0.03) * r), fade = Math.round((cfg.fade ?? 0.18) * r);
  y = y.map((v, i) => v * Math.min(1, i / Math.max(1, rise)) * Math.min(1, (y.length - i) / Math.max(1, fade)));
  // its loudest third of a second to `level`; what would go over the top bent down, not cut off
  const w = Math.round(0.33 * r);
  let most = 0, sum = 0;
  for (let i = 0; i < y.length; i++) {
    sum += y[i] * y[i];
    if (i >= w) sum -= y[i - w] * y[i - w];
    most = Math.max(most, sum / Math.min(w, i + 1));
  }
  const k = 10 ** (cfg.level / 20) / Math.sqrt(most || 1e-12);
  return y.map((v) => Math.tanh(v * k * 1.05) / 1.05);
}

await fs.mkdir(OUT, { recursive: true });
let total = 0;
const made = [];
const ONLY = process.argv.slice(2);
for (const [name, cfg] of Object.entries(SOUNDS)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  const whole = await readWav(cfg.src, cfg.side);
  // (what comes before `from` is as if it were not in the recording)
  const rate = whole.rate, x = cfg.from ? whole.x.subarray(Math.round(cfg.from * rate)) : whole.x;
  const starts = cfg.loop ? [0] : onsets(x, rate, (cfg.takes ?? 1) > 1).slice(0, cfg.takes ?? 1);
  if (!starts.length) throw new Error(`${name}: nothing loud in ${cfg.src}`);
  const under = [];
  for (const l of cfg.with ?? []) {
    const w = await readWav(l.src, l.side);
    const at = onsets(w.x, w.rate, (l.takes ?? 1) > 1).slice(0, l.takes ?? 1);
    if (!at.length) throw new Error(`${name}: nothing loud in ${l.src}`);
    under.push({ ...l, takes: at.map((from) => cutOut(w.x, w.rate, from, cfg.len, cfg.rate)) });
  }
  for (const [k, from] of starts.entries()) {
    let cut = cutOut(x, rate, from, cfg.len, cfg.rate);
    for (const l of under) {
      const y = l.takes[k % l.takes.length];
      if (y.length > cut.length) cut = Float32Array.from({ length: y.length }, (_, i) => cut[i] ?? 0);
      const skip = Math.round((l.after ?? 0) * cfg.rate), rise = Math.round(0.04 * cfg.rate);
      const a = l.low ? Math.exp((-2 * Math.PI * l.low) / cfg.rate) : 0;
      let low = 0;
      for (let i = 0; i < y.length; i++) {
        low = a * low + (1 - a) * y[i];
        if (i >= skip) cut[i] += low * l.level * (l.after ? Math.min(1, (i - skip) / rise) : 1) * (l.die ? Math.exp(-i / (l.die * cfg.rate)) : 1);
      }
    }
    if (cfg.air) {
      // what is above 3 kHz, and that much of it again
      const k = Math.exp((-2 * Math.PI * 3000) / cfg.rate);
      let low = 0;
      cut = cut.map((v) => {
        low = k * low + (1 - k) * v;
        return v + (v - low) * cfg.air;
      });
    }
    // (pressed: what is over the top of it is bent down, not cut off)
    if (cfg.press) cut = cut.map((v) => Math.tanh(v * cfg.press));
    let peak = 0;
    for (const v of cut) peak = Math.max(peak, Math.abs(v));
    const fade = cfg.loop ? 0 : Math.min(cut.length, Math.round(cfg.rate * (cfg.fade ?? 0.18)));
    cut = cut.map((v, i) => (v / (peak || 1)) * 0.92 * cfg.gain * (i > cut.length - fade ? ((cut.length - i) / fade) ** (cfg.curve ?? 1) : 1));
    const file = `${name}${k ? `_${k + 1}` : ''}.wav`;
    await writeWav(path.join(OUT, file), cut, cfg.rate);
    total += 44 + cut.length * 2;
    made.push(`${file} ${(cut.length / cfg.rate).toFixed(2)} s (began ${(from / rate).toFixed(3)} s into ${path.basename(cfg.src)}); loud ${loud(cut, cfg.rate, 0, 0.1)} dB in its first tenth of a second, ${loud(cut, cfg.rate, 0.1, 0.4)} over the next three`);
  }
}
for (const [name, cfg] of Object.entries(ANIMALS)) {
  if (ONLY.length && !ONLY.includes(name) && !ONLY.includes('animals')) continue;
  const parts = cfg.many ?? cfg.cuts.map((cut) => ({ src: cfg.src, cut }));
  const read = new Map();
  for (const [k, part] of parts.entries()) {
    const whole = read.get(part.src) ?? (await readWav(part.src));
    read.set(part.src, whole);
    const [from, len] = part.cut, i0 = Math.round(from * whole.rate), i1 = Math.min(whole.x.length, Math.round((from + len) * whole.rate));
    const cut = take(whole.x.slice(i0, i1), whole.rate, cfg);
    const file = `${name}${k ? `_${k + 1}` : ''}.wav`;
    await writeWav(path.join(OUT, file), cut, cfg.rate);
    total += 44 + cut.length * 2;
    made.push(`${file} ${(cut.length / cfg.rate).toFixed(2)} s (from ${from} s of ${path.basename(part.src)}); loudest third of a second ${loud(cut, cfg.rate, 0, cut.length / cfg.rate)} dB on the whole`);
  }
}
console.log(made.join('\n'));
console.log(`${made.length} recordings, ${(total / 1024).toFixed(0)} KB`);
