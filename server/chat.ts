// A line of chat sent out, each reader having it in their own language (src/sim/chat-translate.ts).
import { chatTranslator, deliver } from '../src/sim/chat-translate';
import type { S2C } from '../src/net/protocol';
import { send, type Client } from './players';

/** @param over those who overhear it, an admin not being in it */
export function sayOut<M extends Extract<S2C, { t: 'chat' | 'pm' | 'announce' }>>(line: M, by: Client, to: Iterable<Client>, over?: (c: Client) => boolean) {
  deliver(chatTranslator, line, to, {
    by,
    from: by.lang,
    who: by.key,
    lang: (c) => c.lang,
    send: (c, m) => send(c, over?.(c) ? ({ ...m, over: true } as S2C) : m),
    late: (c, mid, text) => send(c, { t: 'chatx', mid, text }),
  });
}
