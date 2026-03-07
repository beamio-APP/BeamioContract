# CoNET-SI: nginx must proxy `/post` for Gossip/SSE

## Problem

UI `connect_timeout` or 404 when connecting to `https://<keyID>.conet.network/post` for gossip (mining/SSE).

**Root cause**: nginx reverse proxy returns **404** for `/post` because the path is not configured to forward to the CoNET-SI backend.

## Verification

```bash
# Works (proxied): GET /nodeWallet
curl "https://b2f2f581bb2548e0.conet.network/nodeWallet"
# => 0x3C6036D37b1DC2B29AEbb4d7C8fD0E7e329086cF

# Fails (404 from nginx): POST /post
curl -X POST "https://b2f2f581bb2548e0.conet.network/post" \
  -H "Content-Type: application/json" -d '{"data":"x"}'
# => 404 Not Found (nginx)
```

## Fix for node operators

Add `/post` to your nginx `location` blocks that proxy to CoNET-SI. Example:

```nginx
# Proxy /post to CoNET-SI (gossip/mining SSE)
location /post {
    proxy_pass http://127.0.0.1:YOUR_CONET_SI_PORT;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
}
```

Or include `/post` in an existing catch-all that already proxies `/nodeWallet`, `/solana-rpc`, `/base-rpc`, etc.

## CoNET-SI backend

The CoNET-SI server handles **all** POST requests with JSON `{ data: "<PGP message>" }` regardless of path. The UI uses `/post` by convention. Ensure nginx forwards this path to the Node.js backend.
