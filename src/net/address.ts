// How an address travels inside a GS message: as a decimal number.
//
// Every scalar in a GS body is a string, and an IPv4 address is no exception —
// but it is the string of a NUMBER, not the dotted form. The number is what
// `inet_addr` returns: the four octets in network order, read back as a
// little-endian u32, so 127.0.0.1 is 0x0100007F = 16777343.
//
// This is not a style choice, it is what the client does with it, and it took two
// measurements to get right. The wait-module address goes straight into a connect
// as a four-byte value
// (`NUbi::CStateWaitJoinWaitModuleResult::ProcessJoinWaitModuleResult`, 0xE0E8C0):
//
//   - "127.0.0.1" — `atoi` stops at the first dot, so the client connected to
//     0.0.0.127 and hung. On screen: error 1.23.0, the "wait module connect
//     failed" path.
//   - 16777343, what `inet_addr` returns — the client laid those bytes out the
//     other way and went to 1.0.0.127, caught in the act by watching its sockets:
//     `192.168.178.27:49887 -> 1.0.0.127:40001 SynSent`.
//   - 2130706433, the octets read as one big-endian number — 127.0.0.1.
//
// So this field is HOST order. The NAT service is the odd one out: it was given
// the `inet_addr` form and accepted it, so that one is left alone until something
// says otherwise — a mirror that reports an address nobody dials is easy to get
// wrong without noticing.
//
// Exports:
//   hostU32(dotted) / hostU32String(dotted)      the wait module's form
//   inetU32(dotted) / u32ToAddress(value)        inet_addr's form (NAT)

/** The octets as one big-endian number: 127.0.0.1 -> 2130706433. */
export function hostU32(address: string): number {
  const o = octetsOf(address);
  return ((o[0]! << 24) | (o[1]! << 16) | (o[2]! << 8) | o[3]!) >>> 0;
}

/** What `inet_addr` returns: the network-order bytes read as a little-endian u32. */
export function inetU32(address: string): number {
  const o = octetsOf(address);
  return ((o[3]! << 24) | (o[2]! << 16) | (o[1]! << 8) | o[0]!) >>> 0;
}

function octetsOf(address: string): number[] {
  const octets = address.replace(/^::ffff:/, '').split('.').map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    throw new Error(`not an IPv4 address: ${address}`);
  }
  return octets;
}

/** The dotted form of an `inetU32` value. */
export function u32ToAddress(value: number): string {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff].join('.');
}

/** The form that belongs in a body the client will dial. */
export function hostU32String(address: string): string {
  return String(hostU32(address));
}
