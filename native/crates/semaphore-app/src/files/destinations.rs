//! Where a fetch for a picture from another site may connect: public addresses only.
//!
//! With "Load images from other sites" on, a message's link preview or GIF makes every viewer's
//! client fetch a URL someone else chose. Without this, `http://192.168.1.1/...` or a public URL
//! that redirects to `http://127.0.0.1:<port>/` would make each viewer send requests into their
//! own network (blind CSRF against routers and local services, a timing oracle on LAN hosts).
//!
//! - Names: [`PublicResolver`] resolves them and drops every address that isn't public; reqwest
//!   connects to exactly the addresses it returns, so what was checked is what is connected to
//!   (no second lookup).
//! - IP literals never reach a resolver: [`Destinations::allows_url`] checks them, for the first
//!   URL and for every redirect hop.
//! - Through a proxy from the environment (`HTTP_PROXY` and the like), reqwest resolves only the
//!   proxy's own name and the proxy resolves the target's: then only literal targets are filtered.
//!   The proxy's names are let through the resolver, since a proxy on the LAN is the user's own.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;

/// Whether an address is on the public internet: not loopback, private, link-local, CGNAT,
/// unique-local, multicast, documentation, benchmarking or reserved. IPv6 forms that carry an
/// IPv4 address (mapped, compatible, NAT64, 6to4) are judged by that address.
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => is_public_v6(v6),
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0                                   // 0.0.0.0/8 "this network"
        || a == 10                             // 10/8 private
        || (a == 100 && (64..128).contains(&b)) // 100.64/10 CGNAT
        || a == 127                            // loopback
        || (a == 169 && b == 254)              // link-local
        || (a == 172 && (16..32).contains(&b)) // 172.16/12 private
        || (a == 192 && b == 0 && c == 0)      // 192.0.0/24 protocol assignments
        || (a == 192 && b == 0 && c == 2)      // TEST-NET-1
        || (a == 192 && b == 88 && c == 99)    // 6to4 relay anycast
        || (a == 192 && b == 168)              // 192.168/16 private
        || (a == 198 && (b == 18 || b == 19))  // 198.18/15 benchmarking
        || (a == 198 && b == 51 && c == 100)   // TEST-NET-2
        || (a == 203 && b == 0 && c == 113)    // TEST-NET-3
        || a >= 224) // multicast, reserved, broadcast
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();
    let embedded = |high: u16, low: u16| {
        Ipv4Addr::new((high >> 8) as u8, high as u8, (low >> 8) as u8, low as u8)
    };
    match segments {
        // ::/96 (unspecified, loopback, IPv4-compatible) and ::ffff:0:0/96 (IPv4-mapped).
        [0, 0, 0, 0, 0, 0, high, low] => {
            !(high == 0 && low <= 1) && is_public_v4(embedded(high, low))
        }
        [0, 0, 0, 0, 0, 0xffff, high, low] => is_public_v4(embedded(high, low)),
        // 64:ff9b::/96 well-known NAT64.
        [0x64, 0xff9b, 0, 0, 0, 0, high, low] => is_public_v4(embedded(high, low)),
        // 64:ff9b:1::/48 local-use NAT64.
        [0x64, 0xff9b, 1, ..] => false,
        // 100::/64 discard.
        [0x100, 0, 0, 0, ..] => false,
        // 2001::/32 Teredo, 2001:db8::/32 documentation, 2001:2::/48 benchmarking,
        // 2001:10::/28 and 2001:20::/28 ORCHID.
        [0x2001, 0, ..] | [0x2001, 0xdb8, ..] | [0x2001, 2, 0, ..] => false,
        [0x2001, second, ..] if (0x10..0x30).contains(&second) => false,
        // 2002::/16 6to4: the IPv4 address is the next 32 bits.
        [0x2002, high, low, ..] => is_public_v4(embedded(high, low)),
        // fc00::/7 unique local, fe80::/10 link-local, fec0::/10 site-local, ff00::/8 multicast.
        [first, ..] if (first & 0xfe00) == 0xfc00 => false,
        [first, ..] if (first & 0xffc0) == 0xfe80 => false,
        [first, ..] if (first & 0xffc0) == 0xfec0 => false,
        [first, ..] if (first & 0xff00) == 0xff00 => false,
        _ => true,
    }
}

/// Which destinations third-party fetches may reach.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Destinations {
    /// Public addresses only: the app, always.
    PublicOnly,
    /// Private addresses too: only the slice rig, whose fake server (the scenario's link images)
    /// listens on 127.0.0.1. Set from `AppConfig::media_allow_private`, which only the rig sets:
    /// no setting or environment variable reaches it.
    AlsoPrivate,
    /// Public addresses and these: the unit tests' local servers.
    #[cfg(test)]
    PublicAnd(Vec<IpAddr>),
}

impl Destinations {
    pub fn allows(&self, ip: IpAddr) -> bool {
        match self {
            Self::PublicOnly => is_public(ip),
            Self::AlsoPrivate => true,
            #[cfg(test)]
            Self::PublicAnd(extra) => is_public(ip) || extra.contains(&ip),
        }
    }

    /// Whether a URL's host may be asked for before any lookup: an IP literal must be allowed (a
    /// literal never reaches the resolver); a name is decided by [`PublicResolver`].
    pub fn allows_url(&self, url: &reqwest::Url) -> bool {
        let Some(host) = url.host_str() else {
            return false;
        };
        // The URL parser has already turned every IPv4 spelling (`2130706433`, `0x7f.1`) into
        // dotted form and put IPv6 in brackets.
        let literal = host
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
            .unwrap_or(host);
        match literal.parse::<IpAddr>() {
            Ok(ip) => self.allows(ip),
            Err(_) => true,
        }
    }
}

/// Resolves names with the system resolver and keeps only the addresses [`Destinations`] allows.
/// A name with none left fails, so no connection is made. `proxies` are names let through as
/// they are: the environment's proxies, which resolve the target themselves.
pub struct PublicResolver {
    pub destinations: Destinations,
    pub proxies: Vec<String>,
}

impl PublicResolver {
    /// The host names of the proxies reqwest takes from the environment.
    pub fn proxies_from_env() -> Vec<String> {
        [
            "HTTP_PROXY",
            "http_proxy",
            "HTTPS_PROXY",
            "https_proxy",
            "ALL_PROXY",
            "all_proxy",
        ]
        .iter()
        .filter_map(|name| std::env::var(name).ok())
        .filter_map(|value| {
            let value = if value.contains("://") {
                value
            } else {
                format!("http://{value}")
            };
            reqwest::Url::parse(&value)
                .ok()?
                .host_str()
                .map(|host| host.to_ascii_lowercase())
        })
        .collect()
    }
}

/// Keeps the addresses `destinations` allows, or says none were.
pub fn filter_addresses(
    destinations: &Destinations,
    name: &str,
    addresses: impl IntoIterator<Item = SocketAddr>,
) -> Result<Vec<SocketAddr>, String> {
    let kept: Vec<SocketAddr> = addresses
        .into_iter()
        .filter(|address| destinations.allows(address.ip()))
        .collect();
    if kept.is_empty() {
        Err(format!("{name} resolves to no public address"))
    } else {
        Ok(kept)
    }
}

impl reqwest::dns::Resolve for PublicResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_owned();
        let destinations = if self
            .proxies
            .iter()
            .any(|proxy| proxy.eq_ignore_ascii_case(&host))
        {
            Destinations::AlsoPrivate
        } else {
            self.destinations.clone()
        };
        Box::pin(async move {
            let found = tokio::net::lookup_host((host.as_str(), 0)).await?;
            let kept = filter_addresses(&destinations, &host, found)?;
            let addresses: reqwest::dns::Addrs = Box::new(kept.into_iter());
            Ok(addresses)
        })
    }
}

/// The resolver for a client, shared by its connections.
pub fn resolver(destinations: Destinations) -> Arc<PublicResolver> {
    Arc::new(PublicResolver {
        destinations,
        proxies: PublicResolver::proxies_from_env(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::prelude::rust_2024::test;

    fn ip(text: &str) -> IpAddr {
        text.parse().unwrap()
    }

    #[test]
    fn public_ipv4_addresses_pass() {
        for text in [
            "1.1.1.1",
            "8.8.8.8",
            "9.255.255.255",
            "11.0.0.0",
            "100.63.255.255",
            "100.128.0.0",
            "126.255.255.255",
            "128.0.0.0",
            "169.253.255.255",
            "169.255.0.0",
            "172.15.255.255",
            "172.32.0.0",
            "192.0.1.0",
            "192.0.3.0",
            "192.88.98.255",
            "192.167.255.255",
            "192.169.0.0",
            "198.17.255.255",
            "198.20.0.0",
            "198.51.99.255",
            "203.0.112.255",
            "223.255.255.255",
        ] {
            assert!(is_public(ip(text)), "{text} refused");
        }
    }

    #[test]
    fn private_and_special_ipv4_addresses_are_refused() {
        for text in [
            "0.0.0.0",
            "0.255.255.255",
            "10.0.0.0",
            "10.255.255.255",
            "100.64.0.0",
            "100.127.255.255",
            "127.0.0.1",
            "127.255.255.254",
            "169.254.0.0",
            "169.254.169.254",
            "172.16.0.0",
            "172.31.255.255",
            "192.0.0.0",
            "192.0.0.255",
            "192.0.2.1",
            "192.88.99.1",
            "192.168.0.0",
            "192.168.1.1",
            "192.168.255.255",
            "198.18.0.0",
            "198.19.255.255",
            "198.51.100.1",
            "203.0.113.5",
            "224.0.0.1",
            "239.255.255.255",
            "240.0.0.0",
            "255.255.255.255",
        ] {
            assert!(!is_public(ip(text)), "{text} allowed");
        }
    }

    #[test]
    fn ipv6_addresses_are_judged_by_range_and_by_any_ipv4_inside() {
        for text in [
            "2606:4700:4700::1111",
            "2a00:1450:4001::200e",
            "::ffff:8.8.8.8",
            "::8.8.8.8",
            "64:ff9b::808:808",
            "2002:808:808::1",
            "2001:4860::1",
            "2001:30::1",
            "fbff:ffff::1",
            "fe7f::1",
        ] {
            assert!(is_public(ip(text)), "{text} refused");
        }
        for text in [
            "::",
            "::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "::ffff:192.168.1.1",
            "::ffff:169.254.169.254",
            "::ffff:0.0.0.0",
            "::127.0.0.1",
            "::10.0.0.1",
            "64:ff9b::7f00:1",
            "64:ff9b::a00:1",
            "64:ff9b:1::1",
            "100::1",
            "2001::1",
            "2001:0:ffff::1",
            "2001:db8::1",
            "2001:2::1",
            "2001:10::1",
            "2001:2f::1",
            "2002:7f00:1::1",
            "2002:c0a8:101::1",
            "fc00::1",
            "fd12:3456::1",
            "fdff:ffff::1",
            "fe80::1",
            "febf::1",
            "fec0::1",
            "fef0::1",
            "feff::1",
            "ff02::1",
            "ffff::1",
        ] {
            assert!(!is_public(ip(text)), "{text} allowed");
        }
    }

    #[test]
    fn literal_hosts_are_checked_before_any_lookup() {
        let public = Destinations::PublicOnly;
        let url = |text: &str| reqwest::Url::parse(text).unwrap();
        assert!(public.allows_url(&url("https://example.com/a.png")));
        assert!(public.allows_url(&url("https://1.1.1.1/a.png")));
        assert!(public.allows_url(&url("https://[2606:4700:4700::1111]/a.png")));
        for refused in [
            "http://127.0.0.1:8080/a.png",
            "http://192.168.1.1/a.png",
            "http://[::1]/a.png",
            "http://[::ffff:127.0.0.1]/a.png",
            "http://[fe80::1]/a.png",
            // Other spellings of 127.0.0.1 are parsed to it.
            "http://2130706433/a.png",
            "http://0x7f.1/a.png",
            "http://0177.0.0.1/a.png",
            "http://0/a.png",
        ] {
            assert!(!public.allows_url(&url(refused)), "{refused}");
        }
        assert!(Destinations::AlsoPrivate.allows_url(&url("http://127.0.0.1/")));
        let some = Destinations::PublicAnd(vec![ip("127.0.0.1")]);
        assert!(some.allows_url(&url("http://127.0.0.1/")));
        assert!(!some.allows_url(&url("http://127.0.0.2/")));
    }

    #[test]
    fn resolved_addresses_keep_only_the_allowed_ones() {
        let at = |text: &str| SocketAddr::new(ip(text), 443);
        assert_eq!(
            filter_addresses(
                &Destinations::PublicOnly,
                "mixed.example",
                [at("10.0.0.1"), at("1.1.1.1"), at("::1"), at("2606:4700::1")]
            ),
            Ok(vec![at("1.1.1.1"), at("2606:4700::1")])
        );
        assert!(
            filter_addresses(
                &Destinations::PublicOnly,
                "lan.example",
                [at("192.168.1.1"), at("fe80::1")]
            )
            .is_err()
        );
        assert!(filter_addresses(&Destinations::PublicOnly, "none.example", []).is_err());
        assert_eq!(
            filter_addresses(&Destinations::AlsoPrivate, "rig", [at("127.0.0.1")]),
            Ok(vec![at("127.0.0.1")])
        );
    }
}
