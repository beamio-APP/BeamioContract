#!/usr/bin/env npx ts-node
/**
 * Test script for POST /post (gossip/mining) endpoint.
 * Verifies that the server returns proper HTTP + SSE response for HTTPS connections.
 *
 * Usage:
 *   npx ts-node scripts/test-gossip-post.ts [node_domain]
 *
 * Example:
 *   npx ts-node scripts/test-gossip-post.ts f8117e1568eeaed7
 *
 * The PGP message in this script is a sample - in production the UI encrypts
 * with the node's public key. This test mainly verifies:
 * 1. Server accepts POST with JSON body { data: "<PGP message>" }
 * 2. Server returns valid HTTP response (not raw JSON without headers)
 * 3. Response has Content-Type: text/event-stream for SSE
 */

const NODE_DOMAIN = process.argv[2] || 'f8117e1568eeaed7';

// Sample PGP message (encrypted to a node - will fail decrypt if key mismatch, but we can check HTTP response format)
const SAMPLE_PGP = `-----BEGIN PGP MESSAGE-----

wV4DlfvfqzYzhdwSAQdACtvR6cqSIQGs9QUS/iiVwuKKEGwKnwBx6qGZSCuX
axgwNC3LWHPQeUuKdAUGZBKBB6MnaG6LkczVjwxMbvKLH22v828HBei1Gfvx
ogzsnwu70sDOAXAaN1I7AURNuPk1UVheSs/ZeRG1D7xx+kqOTyZ0UnLwCVRH
dP8lIBd2jeHszhm4LvwhVVL/q6CPAV+DorJedbsKBIh/2eDvFn6dZR9o3LOU
X9wX4d/+RX9WD2inS0CydXqrwWDD2Gmm5nuFRJPhP/gAc7vBRzpxKruvTgh0
hmqcJaScBxXpAwZ3DwUKToh5hdo6ObGn3gRW14p3KmxUOtuE8mfQbm16oCOa
FDBluBZXnJxIldzO0/jxNFIxzCQdZQho8SKfKrMxw0ph/dnSr1MnFEmf0FR6
mzhQWysR+TqrIrXJ8ryO+288R27A4Tu7jrxAty/D6vpBF7qhfGDpCPT9tQH2
LPjBVlPRJHs70zd0mo8APsYICDzC5CosIEOad84TkSQ3O7SrhZlUbaJvVK81
H34iQOchKp2TCo+CYPzdoTww9hmhbHsX63ecdnZdbudVXPHULcSn8WbKMOCv
ZzI0jK8HCf4C4GX8LgcveXy9Je7/CRJ3uKYHS/OtIcW7TDBqtue5IBDSrZeL
d9g=
=q397
-----END PGP MESSAGE-----
`;

async function main() {
  const url = `https://${NODE_DOMAIN}.conet.network/post`;
  console.log(`Testing POST ${url}`);
  console.log('');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        Accept: 'text/event-stream',
        Connection: 'keep-alive',
      },
      body: JSON.stringify({ data: SAMPLE_PGP }),
    });

    console.log(`Status: ${res.status} ${res.statusText}`);
    console.log(`Content-Type: ${res.headers.get('content-type')}`);
    console.log('');

    if (!res.ok) {
      const text = await res.text();
      console.error('Error response body:', text.slice(0, 500));
      process.exit(1);
    }

    // Check that we got proper HTTP response (not raw JSON)
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream') && !contentType.includes('text/plain')) {
      console.warn('Expected text/event-stream or text/plain, got:', contentType);
    }

    // Read first chunk to verify SSE format
    const reader = res.body?.getReader();
    if (!reader) {
      console.error('No response body!');
      process.exit(1);
    }

    const { value } = await reader.read();
    const chunk = value ? new TextDecoder().decode(value) : '';
    console.log('First chunk (first 300 chars):', JSON.stringify(chunk.slice(0, 300)));

    // If server sent raw JSON without headers, chunk would start with "{"
    if (chunk.trimStart().startsWith('{') && !chunk.includes('data:')) {
      console.error('');
      console.error('BUG: Server sent raw JSON without HTTP headers!');
      console.error('The response should start with "HTTP/1.1 200 OK" or "data:" for SSE.');
      process.exit(1);
    }

    console.log('');
    console.log('OK: Server returned valid response format.');
  } catch (err: any) {
    console.error('Request failed:', err?.message || err);
    process.exit(1);
  }
}

main();
