// The part of a sender's address that the corrections form counts against: an IPv4 address whole, an IPv6
// address cut to its /64 (one subscriber usually holds a whole /64, so counting single IPv6 addresses would let
// one sender use thousands). src/index.js stores only an HMAC of this, never the address.
// An address is not a person. Someone who routes a larger IPv6 block (a /48 or /56; tunnel brokers hand out /48s
// free) holds many /64s, and anyone can use Tor or other proxies, so one person can still fill the overall caps
// and close the form for everyone. Counting wider IPv6 blocks would not stop that, and would put unrelated phone
// users, who each get a /64 from their carrier's shared block, under one allowance. Turnstile is the real fix.
export function clientPrefix(ip) {
  const a = String(ip || '').trim().toLowerCase();
  if (!a) return 'unknown';
  if (!a.includes(':')) return a;
  if (a.includes('.')) return a.slice(a.lastIndexOf(':') + 1); // IPv4-mapped, such as ::ffff:192.0.2.1
  const [head, tail] = a.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(8 - h.length - t.length, 0)).fill('0'), ...t];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
