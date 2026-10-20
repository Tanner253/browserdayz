// A lamp's light worked out only where it reaches (2026-10-20, the owner: "we need to figure out why"; a forest at noon
// cost the card 22 ms a frame at 2560x1440). three works out every point and spot light in the world's light list for
// every pixel of every lit thing, whatever its strength and however far it is: the gun's flash and the nearest fire's
// lamp are kept in the list at nothing, so that lighting one never makes new shaders, and by night the lamps' pool is
// in it too. A light is now worked out only if it has any colour, the pixel is within its reach, and for a spot,
// within its cone: past any of those three's own sums give it nothing at all, so the picture is the same to the bit.
// (`LIGHTS_ALL` defined on a material works every one out again, as before; `?lightsall` on a development page, all.)

import { ShaderChunk } from 'three';
// (its typings name it a type only; the module has the object itself)
import * as csmModule from 'three/addons/csm/CSMShader.js';

const POINT = 'dot( pointLight.color, vec3( 1.0 ) ) > 0.0 && ( pointLight.distance <= 0.0 || distance( pointLight.position, geometryPosition ) < pointLight.distance )';
const SPOT =
  'dot( spotLight.color, vec3( 1.0 ) ) > 0.0 && ( spotLight.distance <= 0.0 || distance( spotLight.position, geometryPosition ) < spotLight.distance ) && dot( normalize( spotLight.position - geometryPosition ), spotLight.direction ) > spotLight.coneCos';

/** the body of each point and spot light's turn, from taking the light to adding what it gives, only where it reaches */
function onlyWhereItReaches(chunk: string): string {
  const wrap = (s: string, take: string, when: string) =>
    s.replace(new RegExp(`(${take.replace(/[[\]]/g, '\\$&')})([\\s\\S]*?RE_Direct\\([^;]*;)`), `$1\n#ifndef LIGHTS_ALL\nif ( ${when} ) {\n#endif$2\n#ifndef LIGHTS_ALL\n}\n#endif`);
  return wrap(wrap(chunk, 'pointLight = pointLights[ i ];', POINT), 'spotLight = spotLights[ i ];', SPOT);
}

let done = false;
/** once, before any shader is made (the shadows' cascades put their own copy of the chunk in as they are made: both are changed) */
export function lightsOnlyWhereTheyReach() {
  if (done) return;
  done = true;
  // (development: `?lightsall`, every light worked out everywhere, as it was)
  if (import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('lightsall')) return;
  const csm = (csmModule as unknown as { CSMShader: { lights_fragment_begin: string } }).CSMShader;
  for (const [o, k] of [[ShaderChunk, 'lights_fragment_begin'], [csm, 'lights_fragment_begin']] as [Record<string, string>, string][]) {
    const was = o[k], now = onlyWhereItReaches(was);
    // (a three whose chunk reads otherwise is left as it is: nothing is changed by halves)
    if (now.split('#ifndef LIGHTS_ALL').length === 5) o[k] = now;
    else if (import.meta.env.DEV) console.warn('light-reach: the lights chunk reads otherwise; left as it is');
  }
}
