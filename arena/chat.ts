// Talk in the arena and the battle royale, each reader having it in their own language (src/sim/chat-translate.ts). The
// same translator as the game server's, on a key of this service's own: with none, talk goes out as it was typed.
import type { WebSocket } from 'ws';
import { chatTranslator, deliver } from '../src/sim/chat-translate';
import { langOf, type Lang } from '../src/sim/langs';
import type { S2C } from '../src/net/protocol';

const tongues = new WeakMap<WebSocket, Lang>();
export const heardLang = (ws: WebSocket, l: unknown) => void tongues.set(ws, langOf(l));

type Line = Extract<S2C, { t: 'chat' }>;
export function sayOut<C extends { ws: WebSocket; key: string }>(by: C, to: Iterable<C>, send: (c: C, m: S2C) => void, line: Line) {
  deliver<C, Line>(chatTranslator, line, to, {
    by,
    from: tongues.get(by.ws),
    who: by.key,
    lang: (c) => tongues.get(c.ws) ?? 'en',
    send,
    late: (c, mid, text) => send(c, { t: 'chatx', mid, text }),
  });
}
