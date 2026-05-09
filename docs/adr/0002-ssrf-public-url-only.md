# SSRF defense: reject any URL that resolves to a private address

Arcfetch is exposed as an MCP server, which means an attacker who can prompt-inject the LLM (via page content the model is summarising, or via a malicious link surfaced by `fetch_links`) can choose the URLs the tool fetches. Without SSRF defenses that becomes a pivot into the user's local network — cloud instance metadata at `169.254.169.254`, Kubernetes/Docker internal services, router admin panels, intranet apps.

So `assertSafePublicUrl` rejects in two passes: literally on the hostname (catches `http://10.0.0.1` directly), and again after DNS resolution against every address returned (catches a public hostname that resolves to a private address, including DNS-rebinding setups). The blocklist is intentionally broad — RFC 1918, loopback, link-local, CGNAT (`100.64/10`), TEST-NET ranges, multicast/reserved (`224/4`), IPv6 ULA / link-local / documentation prefix — because the cost of a false positive (one fetch refused) is trivial compared to a false negative.

The defense is **default-on with no runtime opt-out**. A flag toggleable at call time would be reachable by the same prompt-injection path it's meant to defend against, defeating the point. If a trusted-environment opt-out is ever added it must be an env var read at process start, not a tool argument.
