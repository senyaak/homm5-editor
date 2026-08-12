// How an address travels inside a GS message: as a decimal number.
//
// Every scalar in a GS body is a string, and an IPv4 address is no exception —
// but it is the string of a NUMBER, not the dotted form. The number is what
// `inet_addr` returns: the four octets in network order, read back as a
// little-endian u32, so 127.0.0.1 is 0x0100007F = 16777343.
//
// This is not a style choice, it is what the client does with it. The wait-module
// address goes straight into a connect as a four-byte value
// (`NUbi::CStateWaitJoinWaitModuleResult::ProcessJoinWaitModuleResult`, 0xE0E8C0),
// so a dotted string arrives as whatever `atoi` makes of its first octet —
// "127.0.0.1" becomes 127, i.e. 0.0.0.127, and the connection goes nowhere. That
// is exactly how the first login attempt failed, with the client showing 1.23.0
// (the "wait module connect failed" path).
//
// Exports:
//   addressToU32(dotted) / u32ToAddress(value) / addressString(dotted)

export function addressToU32(address: string): number {
  const octets = address.replace(/^::ffff:/, '').split('.').map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    throw new Error(`not an IPv4 address: ${address}`);
  }
  return ((octets[3]! << 24) | (octets[2]! << 16) | (octets[1]! << 8) | octets[0]!) >>> 0;
}

export function u32ToAddress(value: number): string {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff].join('.');
}

/** The form that belongs in a message body. */
export function addressString(address: string): string {
  return String(addressToU32(address));
}
