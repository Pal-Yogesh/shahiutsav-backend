import dns from "node:dns";
import net from "node:net";

// Some home routers / ISP resolvers intermittently fail to resolve the Neon hostname
// while public resolvers answer fine. This affects only how the database host is looked up:
// the system resolver is always tried first, and public DNS is asked only when it fails.
// TLS still verifies the real hostname, so a wrong answer can't impersonate the database.

const FALLBACK_SERVERS = (process.env.DB_DNS_FALLBACK ?? "1.1.1.1,8.8.8.8")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s && s !== "off");

const resolver = new dns.promises.Resolver({ timeout: 3000, tries: 2 });
if (FALLBACK_SERVERS.length) resolver.setServers(FALLBACK_SERVERS);

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

function lookupWithFallback(hostname: string, options: dns.LookupOptions, callback: LookupCallback) {
  dns.lookup(hostname, { ...options, all: true }, (err, found) => {
    const system = err ? [] : (found as dns.LookupAddress[]);
    const hasIPv4 = system.some((a) => a.family === 4);

    const finish = (list: dns.LookupAddress[]) => {
      if (!list.length) return callback(err ?? Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }), "");
      if (options.all) callback(null, list);
      else callback(null, list[0].address, list[0].family);
    };

    // The system resolver answered with IPv4: use it as is
    if (hasIPv4) return finish(system);

    // No answer, or IPv6 only: add IPv4 addresses from public DNS so either route can connect
    resolver
      .resolve4(hostname)
      .then((v4) => {
        if (v4.length) console.warn(`[db] System DNS gave no IPv4 address for ${hostname}; added it from public DNS.`);
        finish([...v4.map((address) => ({ address, family: 4 })), ...system]);
      })
      .catch(() => finish(system));
  });
}

// pg calls socket.connect(port, host); route that through the fallback lookup
class FallbackDnsSocket extends net.Socket {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override connect(...args: any[]): this {
    if (typeof args[0] === "number" && typeof args[1] === "string" && !net.isIP(args[1])) {
      return super.connect({ port: args[0], host: args[1], lookup: lookupWithFallback as net.LookupFunction });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (super.connect as any)(...args);
  }
}

// Development only by default; set DB_DNS_FALLBACK=off to disable, or to a list of DNS servers
export const dnsFallbackEnabled = FALLBACK_SERVERS.length > 0 && process.env.NODE_ENV !== "production";
export const createDbSocket = () => new FallbackDnsSocket();
