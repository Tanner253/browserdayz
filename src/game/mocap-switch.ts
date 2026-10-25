// The hands on motion capture (the blow, the jab, the sips and a grenade's follow-through in first person, and the
// body's blow, jab and drink seen by everybody: src/game/held-mocap.ts, the slash and the drink of
// src/game/avatar/deeds.ts) only with ?mocaphands on the page's address. The body moves on motion capture; the hands
// and what they hold are production's (the owner, 2026-10-25: "the in motion body movements typically look pretty
// good but the hands and fingers and tool positioning is bad and our prod is better ... we pull the direct animation
// for holding tools and swinging them from the prod").
export const MOCAP_HANDS = typeof location !== 'undefined' && new URLSearchParams(location.search).has('mocaphands');
