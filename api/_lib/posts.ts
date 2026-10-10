// The posts of the game's X account that its main menu shows (see api/updates.ts), by the
// number at the end of each post's link: x.com/ZonaSOL_/status/<this>.
//
// A new post is shown once its number is put here: at the top, or anywhere (they are shown
// newest first whatever the order here, by when each was posted). X does not give out the
// list of an account's posts without a paid key, so the list is kept by hand; what each post
// says and shows is read from X every time, and is never kept here.
export const X_ACCOUNT = 'ZonaSOL_';
export const POSTS = [
  '2108771898155053358',
  '2108765938724331762',
  '2108763467280965747',
  '2108747109919059980',
  '2108403882200305826',
];
