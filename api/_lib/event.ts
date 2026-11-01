// The Halloween event (the owner, 2026-10-31: "double zombie spawns and also bump payouts to .025 for everyone for the next 4 hours, for halloween special event").
// One window for all of it, and it ends by itself: between these two moments the server stands twice the infected, and a tag cashed in pays `pay` whatever its wallet
// holds, however late it is then paid. Who is paid does not change: five tags a wallet a day, and the holding asked for past the free tags, stand as they were.

export const EVENT = { from: Date.parse('2026-11-01T00:05:00.000Z'), to: Date.parse('2026-11-01T04:05:00.000Z'), pay: 0.025, crowd: 2 };

export const eventOn = (t: number) => t >= EVENT.from && t < EVENT.to;
